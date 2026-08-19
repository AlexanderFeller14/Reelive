import AVFoundation
import CoreImage
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
  // Kodieren und Schreiben des Fotos laufen HIER, nie auf der videoQueue: dort
  // kostet jede Millisekunde Frames aus allen drei Strömen. `userInitiated`,
  // weil am anderen Ende ein gedrückter Auslöser wartet.
  private static let fotoQueue = DispatchQueue(
    label: "reelive.multikamera.foto", qos: .userInitiated
  )
  // Ein einziger Kontext für alle Fotos: sein Aufbau ist teuer (Shader,
  // Puffer), und er ist laut Apple thread-sicher.
  private static let fotoKontext = CIContext()

  // Wie lange nach dem Zünden gewartet wird, bevor gegriffen wird: die
  // Belichtung zieht dem Licht hinterher, ein sofort gegriffener Frame wäre so
  // dunkel wie einer ohne Blitz.
  private static let blitzVorlaufMs = 150
  // Frist für den Griff. Kommt binnen dieser Zeit kein Frame (unterbrochene
  // Session, abgeschaltete Verbindung), lehnt das Versprechen ab, statt den
  // Auslöser für immer im laufenden Zyklus stehen zu lassen.
  private static let fotoFristMs = 1000

  private static var session: AVCaptureMultiCamSession?
  // Geräte, Inputs, Outputs und Verbindungen werden AUSSCHLIESSLICH auf der
  // Session-Queue geschrieben: beim Aufbau und beim Abbau. Innerhalb der
  // Session-Queue wird frei gelesen, der Verteiler tut es pro Frame auf der
  // Video-Queue; er läuft erst, wenn der Aufbau committet ist, und der Abbau
  // drainiert seine Queue, bevor er leert. NICHT verlassen darf sich darauf,
  // wer von Main oder vom JS-Thread hereinschaut: der Sucher nimmt Gesten
  // sofort an, der erste Aufbau braucht 300-400 ms, ein Doppeltipp oder Zoom
  // in diesem Fenster träfe die Dictionaries mitten in der Mutation
  // (Final-Review 2026-08-19, Important 1). Für diese Aufrufer gilt darum:
  // `geraete` und `session` nur über geraetFuer()/laufendeSession() lesen:
  // beide prüfen unter dem zustandLock das bereit-Zeichen, und die
  // Schreibstellen der beiden Felder nehmen dasselbe Lock.
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
  // Ob das Dauerlicht brennen SOLL. Der Wunsch wird getrennt vom Schalten
  // gehalten, weil beide zu verschiedenen Zeiten und auf verschiedenen Queues
  // eintreffen: der Wunsch kommt vom JS-Thread, die Lage der Kameras ändert
  // sich vom Wechsel her (siehe blitzAnwenden).
  private static var _blitzGewuenscht = false
  // Der offene Foto-Wunsch (Spec §6). Er wird vom JS-Aufruf gestellt und vom
  // Verteiler auf der Video-Queue eingelöst, liegt also zwischen zwei Threads:
  // deshalb unter demselben zustandLock wie die übrigen kleinen geteilten
  // Werte. Ein eigenes Schloss wäre ein zweites ohne zweiten Zweck; gehalten
  // wird es nur für die Zuweisung, nie über den Aufruf des Wunsches hinweg.
  //
  // Warum am Modul und nicht am Verteiler: der Verteiler entsteht bei jedem
  // Session-Aufbau neu, ein dort geparkter Wunsch ginge beim Neuaufbau still
  // verloren. Die Nummer unterscheidet zwei Wünsche voneinander, damit eine
  // verspätete Frist nicht den Wunsch des NÄCHSTEN Auslösers wegräumt.
  private static var _fotoWunsch: ((CMSampleBuffer) -> Void)?
  private static var _fotoWunschNummer: UInt64 = 0

  // Ob die Session fertig gebaut und veröffentlicht ist. Gesetzt am Ende von
  // sessionSicherstellen, genommen beim Abbau und bei einem gescheiterten
  // Aufbau. Solange es fehlt, lehnen die Einstiege von Main und vom JS-Thread
  // ab (wechsleKamera) oder verpuffen still (Zoom, Fokus), statt halbgebauten
  // Zustand zu lesen.
  private static var _bereit = false

  private static var bereit: Bool {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    return _bereit
  }

  static var aktiveKamera: String {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    return _aktiveKamera
  }

  // Das Gerät einer Ebene für Aufrufer AUSSERHALB der Session-Queue (Zoom vom
  // JS-Thread, Fokus auf Main): unter dem Lock und nur bei fertiger Session;
  // deren unbewachter Blick in `geraete` liefe sonst in die Mutation des
  // Aufbaus. Die Session-Queue selbst liest weiterhin direkt.
  private static func geraetFuer(_ name: String) -> AVCaptureDevice? {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    guard _bereit else { return nil }
    return geraete[name]
  }

  // Die veröffentlichte Session für Blicke von ausserhalb der Session-Queue,
  // nach derselben Regel wie geraetFuer.
  private static func laufendeSession() -> AVCaptureMultiCamSession? {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    guard _bereit else { return nil }
    return session
  }

  // Ob die Session einen Ton-Anschluss hat, nach derselben Regel:
  // aufnahmeStarten fragt es auf Main, geschrieben wird audioOutput auf der
  // Session-Queue (Aufbau vor dem bereit-Zeichen, Abbau danach).
  private static func tonVerbunden() -> Bool {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    guard _bereit else { return false }
    return audioOutput?.connection(with: .audio) != nil
  }

  private static var blitzGewuenscht: Bool {
    get {
      zustandLock.lock()
      defer { zustandLock.unlock() }
      return _blitzGewuenscht
    }
    set {
      zustandLock.lock()
      _blitzGewuenscht = newValue
      zustandLock.unlock()
    }
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
      // Im Aufbau-Fenster (der Sucher nimmt Gesten sofort an, der erste
      // Aufbau braucht 300-400 ms) gibt es nichts zu wechseln: ablehnen,
      // statt eine Zielrichtung zu versprechen, die die Session nie
      // angewandt hat: der Screen glaubte der Antwort und stünde danach
      // dauerhaft verkehrt zur Session, jeder weitere Doppeltipp hielte die
      // Vertauschung aufrecht. Die JS-Seite macht aus der Ablehnung ein
      // null und rollt ihre optimistische Umstellung zurück.
      guard Self.bereit else {
        promise.reject("keine_session", "Die MultiCam-Session steht noch nicht")
        return
      }
      let ziel = Self.wechselZiel()
      Self.aktiveKameraSetzen(ziel)
      // Aufgelöst wird der ANGEWANDTE Zustand, nicht das Ziel: steigt
      // aktiveKameraSetzen an seinem Guard aus, erfährt der Screen die
      // wirkliche Lage statt eines Versprechens.
      let angewandt = Self.aktiveKamera
      promise.resolve(angewandt == "front" ? "front" : "back")
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
        let geraet = Self.geraetFuer(name),
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

    // Die Video-Aufnahme aus DIESER Session. Erzeugt wird dieselbe `Aufnahme`
    // wie in KameraAufnahmeModule.aufnahmeStarten (gleiches Ziel im tmp,
    // gleicher Writer) und in dessen `aktuelle` gehängt: der Verteiler oben
    // füllt sie ab dem nächsten Frame, und `dateiAbwarten`, `verwerfen` sowie
    // die SofortVorschau-View bleiben unverändert, weil sie alle an genau
    // dieser Referenz hängen. Was hier gegenüber dem Vorbild fehlt, ist allein
    // die Suche nach dem expo-camera-Sucher: Session, Outputs und
    // Verbindungen gehören diesem Modul.
    //
    // Auf Main wie das Vorbild, und aus demselben Grund: `aktuelle` wird von
    // den beiden Delegate-Queues pro Frame GELESEN und darf deshalb nur von
    // einer einzigen Stelle geschrieben werden: sonst schrieben zwei Module
    // von zwei Queues aus auf dieselbe Objektreferenz. Die Session wird hier
    // nur gelesen (`isRunning`), nicht umgebaut; sie kommt darum über
    // laufendeSession() herein und der Ton-Anschluss über tonVerbunden(),
    // beide gelockt und nur bei fertigem Aufbau: der frühere direkte Blick
    // von Main in diese Felder ist seit dem Aufbau-Fenster-Gate widerrufen
    // (siehe oben bei `geraete`).
    AsyncFunction("aufnahmeStarten") { (maxSekunden: Double, promise: Promise) in
      // Lehnt NUR ab, wenn eine Aufnahme läuft, die noch nicht gestoppt ist:
      // eine gestoppte bleibt absichtlich stehen (die Vorschau spielt noch aus
      // ihrem Startfenster) und wird hier einfach ersetzt.
      if let vorhandene = KameraAufnahmeModule.aktuelle, !vorhandene.istGestoppt {
        promise.reject("laeuft_schon", "Es läuft bereits eine Aufnahme")
        return
      }
      guard let session = Self.laufendeSession(), session.isRunning else {
        promise.reject("keine_session", "Die MultiCam-Session läuft nicht")
        return
      }
      do {
        let ziel = FileManager.default.temporaryDirectory
          .appendingPathComponent("reelive-\(UUID().uuidString).mov")
        // mitTon hängt an der VERBINDUNG, nicht am Output (Muster
        // KameraAufnahmeModule): ohne Mikrofon-Berechtigung bleibt der Output
        // angehängt, liefert aber nie einen Puffer, und ein leerer Ton-Eingang
        // beschriebe die Datei falsch.
        let aufnahme = try Aufnahme(
          ziel: ziel, maxSekunden: maxSekunden,
          mitTon: Self.tonVerbunden()
        )
        KameraAufnahmeModule.aktuelle = aufnahme
        promise.resolve()
      } catch {
        promise.reject("start_gescheitert", error.localizedDescription)
      }
    }.runOnQueue(.main)

    // Gestoppt wird dieselbe Aufnahme, egal wer sie gestartet hat: es gibt im
    // Prozess nur eine (`KameraAufnahmeModule.aktuelle`). Ebenfalls auf Main,
    // aus dem Grund oben.
    AsyncFunction("aufnahmeStoppen") { (promise: Promise) in
      guard let aufnahme = KameraAufnahmeModule.aktuelle else {
        promise.reject("keine_aufnahme", "Es läuft keine Aufnahme")
        return
      }
      aufnahme.stoppen()
      promise.resolve([
        "uri": aufnahme.ziel.absoluteString,
        "dauerS": aufnahme.dauerS,
      ])
    }.runOnQueue(.main)

    // Das Foto dieses Pfads (Spec §6): ein Griff in den laufenden Strom. Die
    // Session bekommt KEINEN zweiten Ausgang dafür: ein AVCapturePhotoOutput
    // wäre bei drei laufenden Strömen zusätzliche Hardware-Last, und seine
    // Aufnahme brächte genau die Wartezeit zurück, die dieser Pfad gerade
    // abgeschafft hat. Das Bild ist darum der nächste Frame der aktiven
    // Kamera, den der Verteiler an den hinterlegten Wunsch weiterreicht.
    AsyncFunction("fotoAufnehmen") { (blitz: Bool, promise: Promise) in
      Self.fotoAufnehmen(blitz: blitz, promise: promise)
    }

    // Das Dauerlicht fürs Video (im expo-camera-Zweig das Prop `enableTorch`).
    // Synchron wie `zoomSetzen`: der Aufruf merkt nur den WUNSCH, geschaltet
    // wird auf der Session-Queue (siehe blitzAnwenden).
    Function("blitz") { (an: Bool) in
      Self.blitzGewuenscht = an
      Self.blitzAnwenden()
    }

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
    // Unter dem Lock, obwohl wir auf der Session-Queue sind: geraetFuer liest
    // dasselbe Feld von Main und vom JS-Thread unter genau diesem Lock, ein
    // ungesperrtes Schreiben hier liefe an diesen Lesern vorbei.
    zustandLock.lock()
    geraete = gefunden
    zustandLock.unlock()
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
    zustandLock.lock()
    session = neue
    zustandLock.unlock()
    beobachterAnhaengen(neue)
    zustandAnwenden(aktiv: aktiveKamera)
    // Erst jetzt, mit fertig committeter Session und angehängten Beobachtern,
    // öffnet das bereit-Zeichen die Einstiege von Main und vom JS-Thread.
    zustandLock.lock()
    _bereit = true
    zustandLock.unlock()
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
        zustandLock.lock()
        geraete["ultraweit"] = nil
        zustandLock.unlock()
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
    // Das Dauerlicht zieht mit: es hängt an einem GERÄT, die neue Lage kennt
    // aber erst dieser Moment. Ohne das Nachführen bliebe die Lampe nach einem
    // Wechsel an der alten Ebene brennen (Front filmt, Rückseite leuchtet) oder
    // nach dem Rückweg aus, bis jemand den Schalter erneut anfasst.
    blitzAnwenden()
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
    // Faktor 1 zurück, also auf die 1x-Grenze. geraetFuer statt des direkten
    // Blicks in `geraete`: der Aufruf kommt vom JS-Thread (oder von der
    // Druck-Schaltung auf der Session-Queue) und verpufft im Aufbau-Fenster.
    if name == "ultraweit", geraetFuer("ultraweit") == nil || druckStufe != .nominal {
      name = "weit"
      ziel = 1.0
    }
    guard let geraet = geraetFuer(name) else { return }

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

  // MARK: - Blitz

  // Die LED sitzt physisch an der Rückseite, ihr Schalter hängt aber am
  // einzelnen Gerät. Eingeschaltet wird darum am AKTIVEN Back-Gerät; steht die
  // Front im Bild, gibt es nichts einzuschalten (das Licht fiele nach hinten
  // weg), der Wunsch bleibt dann bloss gemerkt.
  //
  // Ausgeschaltet wird dagegen an ALLEN Back-Geräten: der Wechsel auf die Front
  // und der Übertritt über die 0,5-Grenze verschieben die aktive Kamera,
  // während das Licht noch am zuvor aktiven Gerät hängt. Ein Schalter, der nur
  // das jetzt aktive Gerät fände, liesse die Lampe brennen.
  //
  // Warum das nicht am Aufruf aus JS hängen darf: `blitz` kommt synchron auf
  // dem JS-Thread an, der Wechsel läuft auf Main (`wechsleKamera`) oder auf der
  // Session-Queue (`druckAnwenden`). Der Screen-Effekt feuert nach dem
  // React-Commit und kann hier ankommen, BEVOR `aktiveKameraSetzen` die neue
  // Kamera eingetragen hat: Back zu Front sähe dann noch «weit» und liesse die
  // Lampe brennen, während die Front filmt, Front zu Back sähe noch «front»
  // und liesse sie aus, ohne dass je ein zweiter Auslöser käme. Deshalb hält
  // das Modul den WUNSCH und führt ihn bei jedem Wechsel selbst nach
  // (aktiveKameraSetzen, druckAnwenden).
  //
  // Gearbeitet wird auf der Session-Queue, dem Muster von `zustandAnwenden`
  // folgend: dort werden `geraete` und der übrige Session-Zustand geschrieben,
  // ein Zugriff von einem fremden Thread entfällt damit ganz. Anders als dort
  // wird die aktive Kamera ERST IM BLOCK gelesen, nicht als Parameter
  // hereingereicht: die Lampe hat keine eigene Reihenfolge, sie soll am Ende
  // zur zuletzt eingetragenen Lage passen, und der zuletzt eingereihte Block
  // sieht genau die. Jede Änderung (Wunsch wie Wechsel) reiht selbst einen
  // Block ein, nachdem sie ihren Zustand geschrieben hat.
  private static func blitzAnwenden() {
    sessionQueue.async {
      let aktiv = aktiveKamera
      let zuenden = blitzGewuenscht && aktiv != "front"
      // Feste Namensliste mit Subscript-Zugriff statt einer Iteration über das
      // Dictionary: über `kameraNamen` läuft nichts, was `zustandLeeren`
      // gleichzeitig umbauen könnte (dieselbe Regel wie im Kopf der Datei).
      //
      // Erst löschen, dann zünden: die Rückseiten-Geräte teilen sich EINE
      // Lampe, ein nachlaufendes Ausschalten am inaktiven Gerät nähme dem
      // aktiven sonst das Licht wieder weg.
      for name in kameraNamen where name != "front" && !(zuenden && name == aktiv) {
        if let geraet = geraete[name] {
          torchSetzen(geraet, .off)
        }
      }
      if zuenden, let geraet = geraete[aktiv] {
        torchSetzen(geraet, .on)
      }
    }
  }

  private static func torchSetzen(_ geraet: AVCaptureDevice, _ modus: AVCaptureDevice.TorchMode) {
    guard geraet.hasTorch, geraet.isTorchModeSupported(modus), geraet.torchMode != modus else {
      return
    }
    do {
      try geraet.lockForConfiguration()
      defer { geraet.unlockForConfiguration() }
      geraet.torchMode = modus
    } catch {
      // Wie beim Zoom: die Kamera gehört gerade jemand anderem (Anruf, andere
      // App). Eine nicht geschaltete Lampe ist harmloser als ein Absturz.
    }
  }

  // MARK: - Foto

  // Der Griff in den laufenden Strom. Er läuft über drei Queues, und jeder
  // Schritt liegt dort, wo sein Zustand hingehört:
  //   Session-Queue: Lampe, Session-Zustand und die Wartezeit fürs Licht
  //     (dieselbe Regel wie im Kopf der Datei).
  //   Video-Queue (im Wunsch): NUR den Puffer übernehmen, nichts sonst.
  //   Foto-Queue: kodieren und schreiben, beides zweistellige Millisekunden.
  private static func fotoAufnehmen(blitz: Bool, promise: Promise) {
    sessionQueue.async {
      guard let session = session, session.isRunning else {
        promise.reject("keine_session", "Die MultiCam-Session läuft nicht")
        return
      }
      let aktiv = aktiveKamera
      // Die LED sitzt an der Rückseite: vor der Front gibt es nichts zu zünden
      // (der helle Screen ist bewusst nicht Teil dieses Pfads). Ohne Licht
      // gibt es auch nichts abzuwarten, der Griff beginnt dann sofort.
      guard blitz, aktiv != "front", let geraet = geraete[aktiv], geraet.hasTorch else {
        fotoWunschStellen(mitLicht: false, promise: promise)
        return
      }
      torchSetzen(geraet, .on)
      sessionQueue.asyncAfter(deadline: .now() + .milliseconds(blitzVorlaufMs)) {
        fotoWunschStellen(mitLicht: true, promise: promise)
      }
    }
  }

  // Stellt den Wunsch und die Frist. Beide rennen gegeneinander, `auftrag`
  // sorgt dafür, dass genau EINE Antwort ans Versprechen geht.
  private static func fotoWunschStellen(mitLicht: Bool, promise: Promise) {
    let auftrag = FotoAuftrag()
    let nummer = fotoWunschSetzen { puffer in
      guard auftrag.uebernehmen() else { return }
      guard let bild = CMSampleBufferGetImageBuffer(puffer) else {
        fotoLichtZurueck(mitLicht)
        promise.reject("kein_bild", "Der Frame trug kein Bild")
        return
      }
      // Auf der Video-Queue wird nur ÜBERNOMMEN: die CIImage-Referenz hält den
      // Puffer fest, er geht also nicht in den Pool zurück, bevor die
      // Foto-Queue ihn gelesen hat. Die Masse gleich mit, danach ist hier
      // Schluss, jede weitere Zeile hier fehlte allen drei Strömen.
      //
      // Der Träger statt des blossen CIImage: ein mitgereichtes Bild hinge am
      // Closure-Kontext und hielte den Puffer bis zum ENDE des Blocks fest,
      // also über das Kodieren und das Schreiben hinweg. Aus dem Träger nimmt
      // ihn das Rendern heraus und lässt ihn sofort los.
      let traeger = FotoTraeger(CIImage(cvPixelBuffer: bild))
      let breite = CVPixelBufferGetWidth(bild)
      let hoehe = CVPixelBufferGetHeight(bild)
      fotoQueue.async {
        // Zuerst das Licht, dann die Arbeit: die LED hat ihren Zweck mit dem
        // gegriffenen Frame erfüllt und soll nicht noch durch das Kodieren und
        // das Schreiben hindurch nachbrennen.
        fotoLichtZurueck(mitLicht)
        fotoSichern(traeger, breite: breite, hoehe: hoehe, promise: promise)
      }
    }
    // Die Frist: eine unterbrochene Session (Anruf, andere App) oder eine
    // abgeschaltete Verbindung (Druckstufe 'kritisch') liefert nie einen
    // Frame. Ohne sie bliebe der Auslöser für immer im laufenden Zyklus
    // stehen (laeuftFoto im Screen), mit ihr bekommt er die Fehlerpille.
    fotoQueue.asyncAfter(deadline: .now() + .milliseconds(fotoFristMs)) {
      guard auftrag.uebernehmen() else { return }
      fotoWunschRaeumen(nummer)
      fotoLichtZurueck(mitLicht)
      promise.reject("kein_frame", "Die Kamera lieferte kein Bild")
    }
  }

  // Nach dem Griff steht das Licht wieder auf dem GEWÜNSCHTEN Stand, nicht
  // hart aus: läuft gerade ein Video mit Dauerlicht, nähme ein hartes Aus ihm
  // mitten in der Aufnahme die Lampe weg. `blitzAnwenden` stellt genau den
  // Zustand her, den der Screen zuletzt bestellt hat, und zwar für die dann
  // aktive Kamera, ein Wechsel zwischendrin ist damit gleich mit erledigt.
  private static func fotoLichtZurueck(_ mitLicht: Bool) {
    guard mitLicht else { return }
    blitzAnwenden()
  }

  // Kodieren und schreiben, auf der Foto-Queue.
  private static func fotoSichern(
    _ traeger: FotoTraeger, breite: Int, hoehe: Int, promise: Promise
  ) {
    // Das Rendern steht in einem eigenen, engen Bereich: danach hält NICHTS
    // mehr den Frame, und der Puffer geht zurück in den Pool der aktiven
    // Kamera. Sonst fehlte er dort über das Kodieren und das Schreiben hinweg,
    // zusammen zwei bis drei Frame-Abstände, und die Kamera müsste in dieser
    // Zeit auf einen anderen Puffer ausweichen oder Frames fallen lassen.
    // Das gerenderte CGImage trägt seine Bildpunkte selbst, es hängt nicht
    // mehr am Puffer.
    //
    // Keine zweite Spiegelung und keine Drehung: Hochkant und die Spiegelung
    // der Front stehen fest an der Verbindung (siehe `ausrichten`), der Puffer
    // kommt also schon so an, wie das Bild aussehen soll.
    let gerendert: CGImage? = {
      guard let quelle = traeger.entnehmen() else { return nil }
      return fotoKontext.createCGImage(quelle, from: quelle.extent)
    }()
    guard
      let bild = gerendert,
      let daten = UIImage(cgImage: bild).jpegData(compressionQuality: 0.9)
    else {
      promise.reject("kein_jpeg", "Der Frame liess sich nicht als JPEG kodieren")
      return
    }
    let ziel = FileManager.default.temporaryDirectory
      .appendingPathComponent("reelive-foto-\(UUID().uuidString).jpg")
    do {
      try daten.write(to: ziel, options: .atomic)
      // absoluteString wie bei der Video-Aufnahme: die JS-Seite bekommt
      // durchgehend file://-URIs, keine nackten Pfade.
      promise.resolve(["uri": ziel.absoluteString, "breite": breite, "hoehe": hoehe])
    } catch {
      promise.reject("nicht_gespeichert", error.localizedDescription)
    }
  }

  private static func fotoWunschSetzen(_ wunsch: @escaping (CMSampleBuffer) -> Void) -> UInt64 {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    _fotoWunschNummer &+= 1
    _fotoWunsch = wunsch
    return _fotoWunschNummer
  }

  // Räumt den Wunsch, aber nur wenn es noch DIESER ist: eine verspätete Frist
  // darf den Wunsch des nächsten Auslösers nicht mitnehmen.
  private static func fotoWunschRaeumen(_ nummer: UInt64) {
    zustandLock.lock()
    defer { zustandLock.unlock() }
    guard _fotoWunschNummer == nummer else { return }
    _fotoWunsch = nil
  }

  // Vom Verteiler pro Frame der AKTIVEN Kamera gerufen: steht ein Wunsch,
  // bekommt er genau diesen Frame und ist damit erledigt. Gerufen wird er
  // ausserhalb des Locks, das Schloss trägt allein die Zuweisung.
  static func fotoWunschEinloesen(_ puffer: CMSampleBuffer) {
    zustandLock.lock()
    let wunsch = _fotoWunsch
    _fotoWunsch = nil
    zustandLock.unlock()
    wunsch?(puffer)
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
      // Zweite Linie und ohne Kosten (torchSetzen schaltet nur bei echtem
      // Unterschied): das Nachführen steckt schon in aktiveKameraSetzen, das
      // aber an seinem Guard aussteigen kann. Dann hinge die Lampe weiter an
      // der Ebene, die diese Stufe gerade abschaltet.
      blitzAnwenden()
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

      // Zeichen zuerst: ab hier antworten geraetFuer/laufendeSession mit nil,
      // kein neuer Blick von Main oder JS trifft mehr in den Abbau hinein.
      zustandLock.lock()
      _bereit = false
      let alte = session
      session = nil
      zustandLock.unlock()
      sollLaufen = false
      // stopRunning blockiert, bis die Ströme stehen: nach dem Anhalten kann
      // kein NEUER captureOutput-Aufruf mehr beginnen.
      alte?.stopRunning()
      for ausgabe in videoOutputs.values {
        ausgabe.setSampleBufferDelegate(nil, queue: nil)
      }
      audioOutput?.setSampleBufferDelegate(nil, queue: nil)
      let alterVerteiler = verteiler

      // Die Reihenfolge ist der ganze Punkt: erst die Delegates nullen (oben),
      // dann die beiden Delegate-Queues leerlaufen lassen, ERST DANACH den
      // geteilten Zustand leeren. Weder `stopRunning` noch
      // `setSampleBufferDelegate(nil, …)` warten auf einen Aufruf, der schon
      // eingereiht ist: der liest im Verteiler noch `ausgabeNamen` und ruft den
      // Verteiler selbst, den AVFoundation nur unowned(unsafe) hält. Je ein Hop
      // über Video- und Ton-Queue heisst, dass jeder solche Aufruf durch ist.
      // Geleert wird von dort aus wieder auf der Session-Queue, denn dieser
      // Zustand wird ausschliesslich dort geschrieben.
      videoQueue.async {
        audioQueue.async {
          withExtendedLifetime(alterVerteiler) {}
          sessionQueue.async {
            // Nur leeren, wenn in der Zwischenzeit keine neue Session
            // entstanden ist: zwischen Abbau und Drain kann ein neuer
            // `starten`-Aufruf schon wieder aufgebaut haben, und dessen Geräte
            // und Outputs dürfen hier nicht mit weggewischt werden.
            guard session == nil else { return }
            zustandLeeren()
          }
        }
      }
    }
  }

  // Nur von der Session-Queue aus rufen (Aufbau-Fehlschlag und Abbau): leert
  // genau die Felder, die anderswo ohne Lock gelesen werden.
  private static func zustandLeeren() {
    inputs = [:]
    videoOutputs = [:]
    ausgabeNamen = [:]
    ausgangsVerbindungen = [:]
    vorschauVerbindungen = [:]
    audioInput = nil
    audioOutput = nil
    verteiler = nil
    zustandLock.lock()
    // Im Lock-Teil, weil geraetFuer dieses Feld von fremden Threads unter
    // demselben Lock liest; das bereit-Zeichen fällt mit (der Abbau hat es
    // schon genommen, der gescheiterte Aufbau kommt allein hierüber).
    _bereit = false
    geraete = [:]
    _aktiveKamera = "weit"
    _letzteBack = "weit"
    _druckStufe = .nominal
    // Auch der Blitz-Wunsch beginnt neu: eine frisch aufgebaute Session soll
    // nicht die Lampe einer längst beendeten Aufnahme erben.
    _blitzGewuenscht = false
    // Ein offener Foto-Wunsch stirbt mit der Session: er wartet auf einen
    // Frame, der nicht mehr kommt. Sein Versprechen löst die Frist auf
    // («kein_frame»), es bleibt also niemand hängen.
    _fotoWunsch = nil
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
    // Der Foto-Griff (Spec §6) bekommt den Frame ZUERST und ist damit
    // erledigt; die laufende Aufnahme bekommt denselben Frame gleich danach.
    // Foto und Video schliessen einander also nicht aus: ein Foto mitten in
    // einer Aufnahme reisst keine Lücke ins Video. Steht kein Wunsch, ist der
    // Aufruf ein Schloss und ein nil-Vergleich, sonst nichts.
    MultiKameraModule.fotoWunschEinloesen(sampleBuffer)
    KameraAufnahmeModule.aktuelle?.schreibeVideo(sampleBuffer)
  }
}

// Trägt den gegriffenen Frame von der Video- auf die Foto-Queue. Eine Klasse,
// weil die Referenz LOSLASSBAR sein muss: ein direkt mitgereichtes CIImage
// hinge am Closure-Kontext und hielte den Puffer der aktiven Kamera bis zum
// Ende des Blocks aus deren Pool heraus. Angefasst wird der Träger nur von je
// einer Queue nacheinander (gefüllt auf der Video-, geleert auf der
// Foto-Queue), die Übergabe dazwischen ist das `async` selbst.
private final class FotoTraeger {
  private var bild: CIImage?

  init(_ bild: CIImage) {
    self.bild = bild
  }

  // Gibt den Frame heraus und lässt ihn hier los: wer ihn nimmt, hält ihn ab
  // jetzt allein und kann ihn mit seinem Bereich beenden.
  func entnehmen() -> CIImage? {
    defer { bild = nil }
    return bild
  }
}

// Wer zuerst kommt, antwortet: der gegriffene Frame und die Frist rennen
// gegeneinander, ein Versprechen verträgt aber genau EINE Antwort.
private final class FotoAuftrag {
  private let lock = NSLock()
  private var offen = true

  func uebernehmen() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard offen else { return false }
    offen = false
    return true
  }
}
