import AVFoundation
import ExpoModulesCore
import UIKit

// Die eigene MultiCam-Session (Spec 2026-08-18): Front-, Weitwinkel- und
// Ultraweitwinkel-Kamera laufen DAUERHAFT parallel, solange der Sucher steht.
// Ein Kamerawechsel schaltet dann nur noch die Sichtbarkeit der Preview-Ebenen
// und das Ziel des Verteilers um (ein Frame), statt wie bisher den Geräte-Input
// zu tauschen und auf den Sensor-Anlauf zu warten (300 bis 900 ms gemessen).
//
// Der Zustand liegt statisch wie in KameraAufnahmeModule: die Session soll die
// einzelne View und den Modul-Lebenszyklus überleben, und der Verteiler greift
// direkt auf `KameraAufnahmeModule.aktuelle` zu.
//
// Aufbau, Zoom und Fokus folgen den erprobten Mustern aus MultiCamSondeModule
// (Formatwahl, manuelle Verdrahtung) und KameraZoomModule (Rampe, Tap-to-Focus).
public class MultiKameraModule: Module {
  // Die drei Ebenen in fester Reihenfolge. Dictionaries sind unsortiert, der
  // Aufbau soll aber reproduzierbar bleiben (Front zuerst, damit die teurere
  // Rückseite auf ein bereits stehendes Budget trifft).
  static let kameraNamen = ["front", "weit", "ultraweit"]

  // Wie schnell `zoomSetzen(sanft:)` hineinfährt, in Verdopplungen pro Sekunde.
  // Derselbe Wert wie im KameraZoom-Modul, damit sich der Tipp auf eine
  // Zoomstufe in beiden Pfaden gleich anfühlt.
  private static let rampenRate: Float = 8.0

  // Alles, was die Session baut oder anwirft, läuft hier: `startRunning`
  // blockiert laut Sonde 300 bis 400 ms und hat auf Main nichts verloren.
  private static let sessionQueue = DispatchQueue(label: "reelive.multikamera.session")
  // Eine EINZIGE Queue für alle drei Video-Outputs: so kommen die Puffer
  // serialisiert beim Verteiler an, und ein Kamerawechsel kann nicht zwei
  // Ströme gleichzeitig in denselben Writer schieben.
  private static let videoQueue = DispatchQueue(label: "reelive.multikamera.video")
  private static let audioQueue = DispatchQueue(label: "reelive.multikamera.ton")

  private static var session: AVCaptureMultiCamSession?
  // Geräte, Inputs, Outputs und Verbindungen werden AUSSCHLIESSLICH auf der
  // Session-Queue geschrieben: beim Aufbau (der noch vor dem Auflösen von
  // `starten` durch ist, also bevor der erste Frame oder der erste JS-Aufruf
  // kommt) und beim Abbau. Gelesen wird von überall, der Verteiler tut es pro
  // Frame auf der Video-Queue und der Fokus auf Main. Auf dieser Regel beruht
  // der Verzicht auf ein Lock für diese Felder: kein Schreibzugriff darf an der
  // Session-Queue vorbei laufen.
  private static var geraete: [String: AVCaptureDevice] = [:]
  private static var inputs: [String: AVCaptureDeviceInput] = [:]
  private static var videoOutputs: [String: AVCaptureVideoDataOutput] = [:]
  private static var ausgangsVerbindungen: [String: AVCaptureConnection] = [:]
  private static var vorschauVerbindungen: [String: AVCaptureConnection] = [:]
  private static var audioInput: AVCaptureDeviceInput?
  private static var audioOutput: AVCaptureAudioDataOutput?
  // Umgekehrte Zuordnung für den Verteiler: welcher Output gehört zu welcher
  // Kamera. Pro Frame ein Dictionary-Zugriff statt drei Objektvergleiche.
  static var ausgabeNamen: [ObjectIdentifier: String] = [:]
  private static var verteiler: MultiKameraVerteiler?

  // Die Sucher-View meldet sich selbst an (didMoveToWindow). Weak, weil sie
  // React Native gehört; das Modul überlebt sie.
  static weak var sucher: MultiKameraSucherView?

  // Ob die Session laufen SOLL. Trennt «gerade unterbrochen» von «bewusst
  // gestoppt»: nach einer Unterbrechung wird nur wieder angeworfen, wenn der
  // Sucher überhaupt noch offen ist.
  private static var sollLaufen = false

  private static var druckBeobachtung: NSKeyValueObservation?
  private static var unterbrechungsEndeBeobachter: NSObjectProtocol?
  private static weak var instanz: MultiKameraModule?

  // Die Wärme-Schutzschaltung (Spec §8) in drei Stufen, wie sie auch über das
  // Ereignis nach JavaScript geht.
  enum Druckstufe: String {
    case nominal
    case ernst
    case kritisch
  }

  // Schützt den Zustand, den mehrere Threads anfassen: der Verteiler liest
  // `aktiveKamera` pro Frame auf der Video-Queue, der Wechsel schreibt sie auf
  // Main, `zoomSetzen` kommt vom JS-Thread.
  private static let zustandLock = NSLock()
  private static var _aktiveKamera = "weit"
  private static var _letzteBack = "weit"
  private static var _druckStufe = Druckstufe.nominal

  static var aktiveKamera: String {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    return _aktiveKamera
  }

  private static var druckStufe: Druckstufe {
    get {
      zustandLock.lock()
      defer { zustandLock.unlock() }
      return _druckStufe
    }
    set {
      zustandLock.lock()
      _druckStufe = newValue
      zustandLock.unlock()
    }
  }

  public func definition() -> ModuleDefinition {
    Name("MultiKamera")

    // Die Schutzschaltung meldet sich hierüber beim Screen: bei 'ernst' fällt
    // der Ultraweitwinkel weg, der Screen holt seinen Zoom auf 1 zurück.
    Events("druckGeaendert")

    OnCreate { [weak self] in
      MultiKameraModule.instanz = self
    }

    // Modul weg (App-Neustart, Metro-Reload) heisst Session weg: sonst hielte
    // eine verwaiste Session die Kameras fest, und der Neuaufbau bekäme sie
    // nicht mehr. Abräumen darf nur die angemeldete Instanz: bei einem Reload
    // kann die neue schon stehen, bevor die alte zerstört wird, und die soll
    // ihr die frische Session nicht unter den Füssen wegziehen.
    OnDestroy { [weak self] in
      guard MultiKameraModule.instanz === self else { return }
      MultiKameraModule.instanz = nil
      MultiKameraModule.abbauen()
    }

    // Die Weiche der JS-Seite. Synchron, weil der Screen sie schon beim ersten
    // Rendern braucht (MultiKameraSucher oder CameraView).
    Function("istVerfuegbar") { () -> Bool in
      Self.istVerfuegbar()
    }

    AsyncFunction("starten") { (promise: Promise) in
      Self.sessionQueue.async {
        do {
          let session = try Self.sessionSicherstellen()
          Self.sollLaufen = true
          if !session.isRunning {
            session.startRunning()
          }
          promise.resolve()
        } catch {
          // Die JS-Seite entscheidet über den Fallback (zweimal daneben heisst
          // expo-camera für den Rest der Sitzung, Spec §9).
          promise.reject("aufbau_gescheitert", "\(error)")
        }
      }
    }

    // Stoppt nur den Lauf. Die Session bleibt gebaut, damit der Rückweg in den
    // Sucher wieder ein blosses startRunning ist und kein Neuaufbau.
    AsyncFunction("stoppen") { (promise: Promise) in
      Self.sessionQueue.async {
        Self.sollLaufen = false
        Self.session?.stopRunning()
        promise.resolve()
      }
    }

    // Der Doppeltipp. Kein Session-Umbau, kein Input-Tausch: nur Zustand,
    // Sichtbarkeit und Verteiler-Ziel. Auf Main, weil die Sichtbarkeit der
    // Preview-Ebenen dorthin gehört.
    AsyncFunction("wechsleKamera") { (promise: Promise) in
      let ziel = Self.wechselZiel()
      Self.aktiveKameraSetzen(ziel)
      promise.resolve(ziel == "front" ? "front" : "back")
    }.runOnQueue(.main)

    // `kamera` ist das Ziel aus multiCamZiel (front | weit | ultraweit). Liegt
    // es auf der anderen BACK-Ebene, wechselt die Ebene gleich mit: der
    // Übertritt über die 1x-Grenze ist derselbe Vorgang wie ein Kamerawechsel.
    Function("zoomSetzen") { (kamera: String, faktor: Double, sanft: Bool) in
      Self.zoomSetzen(kamera: kamera, faktor: faktor, sanft: sanft)
    }

    // Tap-to-Focus auf dem AKTIVEN Gerät. Die Umrechnung Fenster zu Gerät macht
    // die zugehörige Preview-Ebene selbst (sie kennt Orientierung, Spiegelung
    // und den Aspect-Fill-Beschnitt); anders als im KameraZoom-Modul braucht es
    // dafür keine Suche durch die View-Hierarchie, das Modul hält die Ebenen.
    // Das Zurückstellen nach einer Szenenänderung übernimmt der bestehende
    // Beobachter in KameraZoomModule, der global auf
    // AVCaptureDeviceSubjectAreaDidChange hört.
    AsyncFunction("fokussiere") { (x: Double, y: Double) in
      let name = Self.aktiveKamera
      guard
        let geraet = Self.geraete[name],
        let sucher = Self.sucher,
        let ebene = sucher.ebene(fuer: name)
      else {
        return
      }
      let imSucher = sucher.convert(CGPoint(x: x, y: y), from: nil)
      let punkt = ebene.captureDevicePointConverted(fromLayerPoint: imSucher)

      do {
        try geraet.lockForConfiguration()
        defer { geraet.unlockForConfiguration() }
        // Der Punkt MUSS vor dem Modus gesetzt werden: der Moduswechsel stösst
        // die Messung an, und die soll den neuen Punkt schon sehen.
        if geraet.isFocusPointOfInterestSupported {
          geraet.focusPointOfInterest = punkt
        }
        if geraet.isFocusModeSupported(.autoFocus) {
          geraet.focusMode = .autoFocus
        }
        if geraet.isExposurePointOfInterestSupported {
          geraet.exposurePointOfInterest = punkt
        }
        // Belichtung kontinuierlich, nicht einmalig: .autoExpose misst genau
        // einmal und stellt danach fest, ein Lichtwechsel bliebe stehen.
        if geraet.isExposureModeSupported(.continuousAutoExposure) {
          geraet.exposureMode = .continuousAutoExposure
        } else if geraet.isExposureModeSupported(.autoExpose) {
          geraet.exposureMode = .autoExpose
        }
        geraet.isSubjectAreaChangeMonitoringEnabled = true
      } catch {
        // Wie im KameraZoom-Modul: ein nicht gesetzter Fokus ist harmloser als
        // ein Absturz, der nächste Tipp versucht es neu.
      }
    }.runOnQueue(.main)

    View(MultiKameraSucherView.self) {
      ViewName("MultiKameraSucher")
    }
  }

  // MARK: - Verfügbarkeit

  static func istVerfuegbar() -> Bool {
    guard AVCaptureMultiCamSession.isMultiCamSupported else { return false }
    let gefunden = geraeteSuchen()
    return gefunden["front"] != nil && gefunden["weit"] != nil
  }

  // Ultraweitwinkel darf fehlen (Spec §9): dann läuft die Session mit zwei
  // Kameras und die Zoomgrenze liegt bei 1x.
  private static func geraeteSuchen() -> [String: AVCaptureDevice] {
    var gefunden: [String: AVCaptureDevice] = [:]
    if let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) {
      gefunden["front"] = front
    }
    if let weit = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) {
      gefunden["weit"] = weit
    }
    if let ultraweit = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) {
      gefunden["ultraweit"] = ultraweit
    }
    return gefunden
  }

  // MARK: - Session-Aufbau

  // Baut beim ersten Aufruf, danach nur noch nachschlagen. Läuft auf der
  // Session-Queue.
  private static func sessionSicherstellen() throws -> AVCaptureMultiCamSession {
    if let vorhandene = session {
      return vorhandene
    }
    guard AVCaptureMultiCamSession.isMultiCamSupported else {
      throw MultiKameraFehler(grund: "MultiCam wird auf diesem Gerät nicht unterstützt")
    }
    let gefunden = geraeteSuchen()
    guard gefunden["front"] != nil, gefunden["weit"] != nil else {
      throw MultiKameraFehler(grund: "Front- oder Weitwinkel-Kamera fehlt")
    }
    geraete = gefunden
    verteiler = MultiKameraVerteiler()

    let neue = AVCaptureMultiCamSession()
    do {
      try aufbauen(neue)
    } catch {
      // Halb aufgebaute Session nicht stehen lassen: der nächste Versuch soll
      // bei null anfangen, nicht auf Resten weiterbauen.
      zustandLeeren()
      throw error
    }
    session = neue
    beobachterAnhaengen(neue)
    zustandAnwenden(aktiv: aktiveKamera)
    return neue
  }

  private static func aufbauen(_ session: AVCaptureMultiCamSession) throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    // Front und Weitwinkel sind Pflicht, ohne sie gibt es keinen MultiCam-Pfad.
    for name in ["front", "weit"] {
      guard let geraet = geraete[name] else {
        throw MultiKameraFehler(grund: "\(name): Kamera fehlt")
      }
      try anschliessen(geraet, an: session, als: name)
    }
    // Der Ultraweitwinkel ist die Kür: auf Geräten, die nur zwei gleichzeitige
    // Ströme erlauben, scheitert erst der dritte. Dann wird er sauber wieder
    // gelöst und die Session läuft zu zweit weiter (Spec §9).
    if let ultraweit = geraete["ultraweit"] {
      do {
        try anschliessen(ultraweit, an: session, als: "ultraweit")
      } catch {
        loesen("ultraweit", aus: session)
        geraete["ultraweit"] = nil
      }
    }

    vorschauVerbinden(session)
    mikrofonAnhaengen(session)
  }

  // Hängt eine Kamera mit eigenem Video-Output und manueller Verbindung an.
  // MultiCam-Sessions bilden Verbindungen nicht automatisch sinnvoll, Apples
  // Muster ist addInputWithNoConnections / addOutputWithNoConnections plus
  // explizite AVCaptureConnection (in der Phase-0-Sonde am Gerät erprobt).
  private static func anschliessen(
    _ geraet: AVCaptureDevice,
    an session: AVCaptureMultiCamSession,
    als name: String
  ) throws {
    guard let format = formatWaehlen(geraet) else {
      throw MultiKameraFehler(grund: "\(name): kein MultiCam-Format")
    }
    try geraet.lockForConfiguration()
    // Eigener Block mit defer (Muster der Datei, vgl. fokussiere und
    // zoomSetzen): so bleibt die Kamera auch bei einem Fehler zwischendrin
    // nicht gesperrt zurück, und der Rest der Funktion arbeitet ohne Sperre.
    do {
      defer { geraet.unlockForConfiguration() }
      geraet.activeFormat = format
      let fps = min(30.0, format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30.0)
      let dauer = CMTime(value: 1, timescale: CMTimeScale(fps))
      geraet.activeVideoMinFrameDuration = dauer
      geraet.activeVideoMaxFrameDuration = dauer
      // Grundzustand aller drei Kameras (Spec §7); der Tipp auf einen Punkt
      // stellt später um, die Szenen-Rückstellung kommt hierher zurück.
      if geraet.isFocusModeSupported(.continuousAutoFocus) {
        geraet.focusMode = .continuousAutoFocus
      }
      if geraet.isExposureModeSupported(.continuousAutoExposure) {
        geraet.exposureMode = .continuousAutoExposure
      }
    }

    let input = try AVCaptureDeviceInput(device: geraet)
    guard session.canAddInput(input) else {
      throw MultiKameraFehler(grund: "\(name): Input nicht erlaubt")
    }
    session.addInputWithNoConnections(input)
    inputs[name] = input

    let ausgabe = AVCaptureVideoDataOutput()
    ausgabe.setSampleBufferDelegate(verteiler, queue: videoQueue)
    guard session.canAddOutput(ausgabe) else {
      throw MultiKameraFehler(grund: "\(name): Output nicht erlaubt")
    }
    session.addOutputWithNoConnections(ausgabe)
    videoOutputs[name] = ausgabe
    ausgabeNamen[ObjectIdentifier(ausgabe)] = name

    guard let port = videoPort(input, geraet: geraet) else {
      throw MultiKameraFehler(grund: "\(name): kein Video-Port")
    }
    let verbindung = AVCaptureConnection(inputPorts: [port], output: ausgabe)
    guard session.canAddConnection(verbindung) else {
      throw MultiKameraFehler(grund: "\(name): Verbindung nicht erlaubt")
    }
    session.addConnection(verbindung)
    // Erst anhängen, dann ausrichten: an einer noch nicht hinzugefügten
    // Verbindung melden Orientierung und Spiegelung «nicht unterstützt».
    ausrichten(verbindung, front: name == "front")
    ausgangsVerbindungen[name] = verbindung
  }

  // Verbindet die Preview-Ebenen der Sucher-View mit der Session. Wird beim
  // Aufbau gerufen und erneut, wenn die View später ankommt (Remount nach
  // Metro-Reload, Tab-Wechsel). Der Aufrufer klammert die Session-Konfiguration.
  private static func vorschauVerbinden(_ session: AVCaptureMultiCamSession) {
    // Gehört auf die Session-Queue: die Ebenen-Bindung weiter unten greift
    // synchron auf Main durch, ein Aufruf VON Main hinge auf der Stelle fest.
    precondition(
      !Thread.isMainThread, "vorschauVerbinden gehört auf die Session-Queue, nie auf Main"
    )
    for verbindung in vorschauVerbindungen.values where session.connections.contains(verbindung) {
      session.removeConnection(verbindung)
    }
    vorschauVerbindungen = [:]

    // CoreAnimation gehört dem Main-Thread, die Session-Bindung der Ebenen
    // deshalb auch. Synchron, weil die Verbindungen unmittelbar danach
    // entstehen; Main wartet nie auf die Session-Queue, ein Deadlock kann
    // daraus nicht werden.
    let ebenen: [String: AVCaptureVideoPreviewLayer] = DispatchQueue.main.sync {
      guard let sucher = sucher else { return [:] }
      let gefunden = sucher.alleEbenen()
      // Ohne diese Bindung nimmt die Session keine manuelle
      // Preview-Verbindung an (Apples MultiCam-Muster).
      for ebene in gefunden.values {
        ebene.setSessionWithNoConnection(session)
      }
      return gefunden
    }

    for (name, ebene) in ebenen {
      guard
        let input = inputs[name],
        let geraet = geraete[name],
        let port = videoPort(input, geraet: geraet)
      else {
        continue
      }
      let verbindung = AVCaptureConnection(inputPort: port, videoPreviewLayer: ebene)
      guard session.canAddConnection(verbindung) else { continue }
      session.addConnection(verbindung)
      ausrichten(verbindung, front: name == "front")
      vorschauVerbindungen[name] = verbindung
    }
  }

  // Ein Mikrofon-Input, ein Audio-Output, eine Verbindung. Das Mikrofon hängt
  // dran, solange der Sucher steht (Spec §3): so ruckelt der Aufnahmestart
  // nicht durch einen Session-Umbau. Fehlt die Berechtigung, läuft die Session
  // ohne Ton weiter, statt zu scheitern (Muster outputsAnhaengen).
  private static func mikrofonAnhaengen(_ session: AVCaptureMultiCamSession) {
    guard
      let mikrofon = AVCaptureDevice.default(for: .audio),
      let input = try? AVCaptureDeviceInput(device: mikrofon),
      session.canAddInput(input)
    else {
      return
    }
    session.addInputWithNoConnections(input)
    audioInput = input

    let ausgabe = AVCaptureAudioDataOutput()
    ausgabe.setSampleBufferDelegate(verteiler, queue: audioQueue)
    guard session.canAddOutput(ausgabe) else { return }
    session.addOutputWithNoConnections(ausgabe)
    // Ab hier gemerkt, nicht erst nach der Verbindung: sonst bliebe in den
    // Rückwegen unten ein Output mit gesetztem Delegate in der Session hängen,
    // den der Abbau nie fände. Ohne Verbindung liefert er nie einen Puffer, und
    // ob es Ton gibt, entscheidet ohnehin die Verbindung (Muster
    // KameraAufnahmeModule.aufnahmeStarten, `mitTon`).
    audioOutput = ausgabe

    let ports = input.ports(
      for: .audio, sourceDeviceType: mikrofon.deviceType, sourceDevicePosition: .unspecified
    )
    guard let port = ports.first ?? input.ports.first else { return }
    let verbindung = AVCaptureConnection(inputPorts: [port], output: ausgabe)
    guard session.canAddConnection(verbindung) else { return }
    session.addConnection(verbindung)
  }

  // Löst alles wieder, was für eine Kamera schon in der Session hängt.
  private static func loesen(_ name: String, aus session: AVCaptureMultiCamSession) {
    if let verbindung = ausgangsVerbindungen.removeValue(forKey: name),
      session.connections.contains(verbindung)
    {
      session.removeConnection(verbindung)
    }
    if let verbindung = vorschauVerbindungen.removeValue(forKey: name),
      session.connections.contains(verbindung)
    {
      session.removeConnection(verbindung)
    }
    if let ausgabe = videoOutputs.removeValue(forKey: name) {
      ausgabeNamen.removeValue(forKey: ObjectIdentifier(ausgabe))
      session.removeOutput(ausgabe)
    }
    if let input = inputs.removeValue(forKey: name) {
      session.removeInput(input)
    }
  }

  // Hochkant fest an der Verbindung, Front fest gespiegelt (Spec §3): damit
  // stimmen Sucher und Aufnahme ohne Pro-Frame-Angleichen überein. Der
  // Hochkant-Wächter im Verteiler bleibt als zweite Linie.
  private static func ausrichten(_ verbindung: AVCaptureConnection, front: Bool) {
    if verbindung.isVideoOrientationSupported {
      verbindung.videoOrientation = .portrait
    }
    if front, verbindung.isVideoMirroringSupported {
      verbindung.automaticallyAdjustsVideoMirroring = false
      verbindung.isVideoMirrored = true
    }
  }

  private static func videoPort(
    _ input: AVCaptureDeviceInput, geraet: AVCaptureDevice
  ) -> AVCaptureInput.Port? {
    input.ports(
      for: .video, sourceDeviceType: geraet.deviceType, sourceDevicePosition: geraet.position
    ).first
  }

  // Bevorzugt exakt 1080p30 (unser Aufnahmeformat), sonst das kleinste
  // MultiCam-Format ab 720p. Kleine Formate halten die Hardware-Kosten niedrig,
  // und mit drei Strömen ist das Budget laut Sonde zu 0,75 ausgeschöpft.
  private static func formatWaehlen(_ geraet: AVCaptureDevice) -> AVCaptureDevice.Format? {
    let multiCam = geraet.formats.filter { $0.isMultiCamSupported }
    if let exakt = multiCam.first(where: { ist1080p30($0) }) { return exakt }
    return multiCam
      .filter { masse($0).height >= 720 }
      .min { flaeche($0) < flaeche($1) } ?? multiCam.first
  }

  private static func ist1080p30(_ format: AVCaptureDevice.Format) -> Bool {
    let m = masse(format)
    let fps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
    return m.width == 1920 && m.height == 1080 && fps >= 30
  }

  private static func masse(_ format: AVCaptureDevice.Format) -> CMVideoDimensions {
    CMVideoFormatDescriptionGetDimensions(format.formatDescription)
  }

  private static func flaeche(_ format: AVCaptureDevice.Format) -> Int {
    let m = masse(format)
    return Int(m.width) * Int(m.height)
  }

  // MARK: - Sucher-View

  // Die View meldet sich in didMoveToWindow. Steht die Session schon, bekommt
  // sie ihre Verbindungen sofort; sonst holt der Aufbau sie später ab.
  static func sucherAnmelden(_ view: MultiKameraSucherView) {
    sucher = view
    sessionQueue.async {
      guard let session = session else { return }
      session.beginConfiguration()
      vorschauVerbinden(session)
      session.commitConfiguration()
      zustandAnwenden(aktiv: aktiveKamera)
    }
  }

  // Verlässt die View das Fenster, gehen ihre Verbindungen mit: eine Verbindung
  // auf eine gleich freigegebene Ebene hat keinen Empfänger mehr. Nur die
  // WIRKLICH registrierte View meldet ab; beim Remount kommt die neue View
  // zuerst und darf sich ihre frischen Verbindungen nicht wegnehmen lassen.
  static func sucherAbmelden(_ view: MultiKameraSucherView) {
    guard sucher === view else { return }
    sucher = nil
    sessionQueue.async {
      guard let session = session else {
        vorschauVerbindungen = [:]
        return
      }
      session.beginConfiguration()
      for verbindung in vorschauVerbindungen.values where session.connections.contains(verbindung) {
        session.removeConnection(verbindung)
      }
      vorschauVerbindungen = [:]
      session.commitConfiguration()
    }
  }

  // MARK: - Wechsel

  // Front zu Back geht auf die zuletzt benutzte Back-Ebene zurück, Back zu
  // Front merkt sie sich (in aktiveKameraSetzen).
  private static func wechselZiel() -> String {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    if _aktiveKamera == "front" {
      return geraete[_letzteBack] != nil ? _letzteBack : "weit"
    }
    return "front"
  }

  // Der ganze Wechsel: Zustand, Sichtbarkeit, Verteiler-Ziel. KEIN
  // beginConfiguration, KEIN Input-Umbau, deshalb kostet er einen Frame.
  static func aktiveKameraSetzen(_ name: String) {
    zustandLock.lock()
    guard _aktiveKamera != name, geraete[name] != nil else {
      zustandLock.unlock()
      return
    }
    if name == "front" {
      _letzteBack = _aktiveKamera
    } else {
      _letzteBack = name
    }
    _aktiveKamera = name
    zustandLock.unlock()
    zustandAnwenden(aktiv: name)
  }

  // Sichtbarkeit auf Main, Verbindungs-Schaltung auf der Session-Queue: beides
  // hängt an derselben Frage «welche Kamera ist aktiv». Der Name kommt als
  // Parameter herein, statt hier neu gelesen zu werden: zwei fast gleichzeitige
  // Wechsel reihten sonst Blöcke mit vertauschten Werten ein.
  private static func zustandAnwenden(aktiv: String) {
    aufMain { sucher?.sichtbarSetzen(aktiv) }
    sessionQueue.async { verbindungenAnwenden(aktiv: aktiv) }
  }

  private static func aufMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async(execute: block)
    }
  }

  // MARK: - Zoom

  static func zoomSetzen(kamera: String, faktor: Double, sanft: Bool) {
    var name = kamera
    var ziel = faktor
    // Ohne Ultraweitwinkel (Spec §9) und solange die Schutzschaltung ihn
    // abgeschaltet hat (Spec §8) fällt das Ziel still auf den Weitwinkel bei
    // Faktor 1 zurück, also auf die 1x-Grenze.
    if name == "ultraweit", geraete["ultraweit"] == nil || druckStufe != .nominal {
      name = "weit"
      ziel = 1.0
    }
    guard let geraet = geraete[name] else { return }

    // Zoomen über die 1x-Grenze wechselt die BACK-Ebene gleich mit. Zwischen
    // den Blickrichtungen wechselt nur der Doppeltipp: ein Zoom auf der
    // Rückseite darf keinen Front-Sucher umschalten und umgekehrt.
    let aktiv = aktiveKamera
    if name != aktiv, name != "front", aktiv != "front" {
      aktiveKameraSetzen(name)
    }

    do {
      try geraet.lockForConfiguration()
      defer { geraet.unlockForConfiguration() }

      let geklemmt = min(
        max(CGFloat(ziel), geraet.minAvailableVideoZoomFactor),
        geraet.maxAvailableVideoZoomFactor
      )
      // Beendet eine noch laufende Rampe. Ohne das zöge ein Tipp weiter,
      // während der Finger schon wieder zieht.
      geraet.cancelVideoZoomRamp()
      if sanft {
        geraet.ramp(toVideoZoomFactor: geklemmt, withRate: rampenRate)
      } else {
        geraet.videoZoomFactor = geklemmt
      }
    } catch {
      // Die Kamera gehört gerade jemand anderem (Anruf, andere App). Ein
      // stehengebliebener Zoom ist harmloser als ein Absturz.
    }
  }

  // MARK: - Beobachter

  private static func beobachterAnhaengen(_ neue: AVCaptureMultiCamSession) {
    // Der Systemdruck wird am Weitwinkel gemessen: er läuft immer, und die
    // Sonde hat mit drei Strömen 0,90 vom Budget 1,0 gesehen. Die
    // Schutzschaltung ist deshalb Pflichtteil (Spec §8).
    if let weit = geraete["weit"] {
      druckBeobachtung = weit.observe(
        \.systemPressureState, options: [.initial, .new]
      ) { _, aenderung in
        guard let zustand = aenderung.newValue else { return }
        let stufe = stufeAus(zustand.level)
        sessionQueue.async { druckAnwenden(stufe) }
      }
    }

    // Nur das ENDE der Unterbrechung braucht einen eigenen Beobachter: eine
    // laufende Aufnahme stoppt bereits der globale Beobachter in
    // KameraAufnahmeModule (object: nil), der auch unsere Session sieht.
    unterbrechungsEndeBeobachter = NotificationCenter.default.addObserver(
      forName: .AVCaptureSessionInterruptionEnded,
      object: neue,
      queue: nil
    ) { _ in
      sessionQueue.async {
        // Nur wieder anwerfen, wenn der Sucher überhaupt noch offen ist: nach
        // einem Tab-Wechsel im Hintergrund soll die Kamera aus bleiben.
        guard sollLaufen, let session = session, !session.isRunning else { return }
        session.startRunning()
      }
    }
  }

  private static func stufeAus(_ level: AVCaptureDevice.SystemPressureState.Level) -> Druckstufe {
    switch level {
    case .serious: return .ernst
    case .critical, .shutdown: return .kritisch
    default: return .nominal
    }
  }

  // Läuft auf der Session-Queue.
  private static func druckAnwenden(_ stufe: Druckstufe) {
    guard stufe != druckStufe else { return }
    druckStufe = stufe
    // Ab 'ernst' ist der Ultraweitwinkel aus: war er aktiv, tritt der
    // Weitwinkel bei Faktor 1 an seine Stelle (der Sucher springt von 0,5x
    // auf 1x, Spec §8).
    if stufe != .nominal, aktiveKamera == "ultraweit" {
      aktiveKameraSetzen("weit")
      zoomSetzen(kamera: "weit", faktor: 1.0, sanft: false)
    }
    verbindungenAnwenden(aktiv: aktiveKamera)
    aufMain { instanz?.sendEvent("druckGeaendert", ["stufe": stufe.rawValue]) }
  }

  // Welche Ströme laufen dürfen. Eine Verbindung abzuschalten braucht keinen
  // Session-Umbau, kostet aber sofort Systemdruck (Spec §8). Läuft auf der
  // Session-Queue, wo auch die Verbindungs-Dictionaries geschrieben werden.
  private static func verbindungenAnwenden(aktiv: String) {
    let stufe = druckStufe
    for name in kameraNamen {
      var an = true
      // Ab 'ernst' fällt der Ultraweitwinkel weg (er ist der teuerste Strom
      // und nur unter 1x sichtbar).
      if name == "ultraweit", stufe != .nominal {
        an = false
      }
      // Ab 'kritisch' zusätzlich die ganze inaktive Blickrichtung: der Wechsel
      // kostet dann wieder Sensor-Anlauf, das ist der gewollte Preis fürs
      // Nicht-Drosseln.
      if stufe == .kritisch, (name == "front") != (aktiv == "front") {
        an = false
      }
      ausgangsVerbindungen[name]?.isEnabled = an
      vorschauVerbindungen[name]?.isEnabled = an
    }
  }

  // MARK: - Abbau

  // Der ganze Abbau liegt auf der Session-Queue, nicht nur das Anhalten: er
  // schreibt dieselben Dictionaries, die der Verteiler pro Frame und der Fokus
  // auf Main lesen. Von Main aus geleert (OnDestroy läuft dort), wäre jeder
  // Metro-Reload ein Schreib-Lese-Rennen auf einem Swift-Dictionary, und das
  // endet nicht bei einem falschen Wert, sondern im kaputten Speicher.
  private static func abbauen() {
    sessionQueue.async {
      druckBeobachtung?.invalidate()
      druckBeobachtung = nil
      if let beobachter = unterbrechungsEndeBeobachter {
        NotificationCenter.default.removeObserver(beobachter)
        unterbrechungsEndeBeobachter = nil
      }

      let alte = session
      session = nil
      sollLaufen = false
      // stopRunning blockiert, bis die Ströme stehen: nach dem Anhalten kann
      // kein NEUER captureOutput-Aufruf mehr beginnen.
      alte?.stopRunning()
      for ausgabe in videoOutputs.values {
        ausgabe.setSampleBufferDelegate(nil, queue: nil)
      }
      audioOutput?.setSampleBufferDelegate(nil, queue: nil)

      let alterVerteiler = verteiler
      zustandLeeren()

      // Den Verteiler erst freigeben, wenn beide Delegate-Queues durch sind.
      // setSampleBufferDelegate(nil, …) wartet NICHT auf einen gerade
      // laufenden captureOutput-Aufruf, und AVFoundation hält den Delegate
      // unowned(unsafe): ein Aufruf auf ein schon freigegebenes Objekt stürzt
      // ab. Je ein Hop über Video- und Ton-Queue heisst, dass jeder bereits
      // begonnene Aufruf fertig ist, bevor die letzte Referenz fällt.
      videoQueue.async {
        audioQueue.async {
          withExtendedLifetime(alterVerteiler) {}
        }
      }
    }
  }

  // Nur von der Session-Queue aus rufen (Aufbau-Fehlschlag und Abbau): leert
  // genau die Felder, die anderswo ohne Lock gelesen werden.
  private static func zustandLeeren() {
    geraete = [:]
    inputs = [:]
    videoOutputs = [:]
    ausgabeNamen = [:]
    ausgangsVerbindungen = [:]
    vorschauVerbindungen = [:]
    audioInput = nil
    audioOutput = nil
    verteiler = nil
    zustandLock.lock()
    _aktiveKamera = "weit"
    _letzteBack = "weit"
    _druckStufe = .nominal
    zustandLock.unlock()
  }

  // Ob dieser Output zur aktiven Kamera gehört. Vom Verteiler pro Frame
  // gerufen, deshalb ein Dictionary-Zugriff statt einer Suche.
  static func istAktiverAusgang(_ output: AVCaptureOutput) -> Bool {
    guard let name = ausgabeNamen[ObjectIdentifier(output)] else { return false }
    return name == aktiveKamera
  }
}

private struct MultiKameraFehler: Error, CustomStringConvertible {
  let grund: String
  var description: String { grund }
}

// Nimmt die Puffer aller drei Kameras und des Mikrofons entgegen und reicht
// weiter, was gebraucht wird. Alle Video-Outputs teilen sich eine Queue, die
// Aufrufe kommen also serialisiert an.
//
// Läuft keine Aufnahme, sind beide Weitergaben durch das optionale `aktuelle`
// von selbst billige No-ops; der Verteiler bleibt trotzdem angeschlossen, weil
// jedes An- und Abhängen ein Session-Umbau wäre.
final class MultiKameraVerteiler: NSObject,
  AVCaptureVideoDataOutputSampleBufferDelegate,
  AVCaptureAudioDataOutputSampleBufferDelegate
{
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if output is AVCaptureAudioDataOutput {
      // Ton läuft ununterbrochen durch, auch über einen Kamerawechsel hinweg.
      KameraAufnahmeModule.aktuelle?.schreibeTon(sampleBuffer)
      return
    }
    // Die anderen beiden Kameras laufen mit, sind aber nicht auf dem Schirm:
    // ihre Puffer werden sofort verworfen, damit der Pool sie zurückbekommt.
    guard MultiKameraModule.istAktiverAusgang(output) else { return }
    // Hochkant-Wächter, übernommen aus PufferAbgriff: Orientierung und
    // Spiegelung stehen zwar fest an der Verbindung, aber ein querer Frame
    // würde vom Writer verzerrt in seine 1080x1920-Spur gepresst. Die App ist
    // hochkant-gesperrt, jeder rechtmässige Frame ist höher als breit.
    if let bild = CMSampleBufferGetImageBuffer(sampleBuffer),
      CVPixelBufferGetWidth(bild) > CVPixelBufferGetHeight(bild)
    {
      return
    }
    KameraAufnahmeModule.aktuelle?.schreibeVideo(sampleBuffer)
  }
}
