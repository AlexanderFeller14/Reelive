import AVFoundation
import ExpoModulesCore
import UIKit

// Eigene Video-Aufnahme (Spec 2026-08-14-instant-video-vorschau): greift die
// Puffer der laufenden expo-camera-Session ab, statt auf recordAsyncs Datei
// zu warten. Die Phase-0-Probe (Task 1) ist gelaufen: 64 Frames in 2 s neben
// dem untätigen MovieFileOutput — der Abgriff koexistiert, ein Entfernen-Zweig
// entfällt. Dieses Modul trägt den Aufnahme-Kern samt Tonspur (AAC über
// AVCaptureAudioDataOutput, Task 4).
public class KameraAufnahmeModule: Module {
  // Die Outputs hängen EINMAL an der Session und bleiben (jedes An-/Abhängen
  // ist ein Session-Umbau und damit ein sichtbarer Sucher-Ruckler, Spec §
  // Session-Umbauten). `laufend` schaltet nur, ob Puffer verarbeitet werden.
  private static var videoOutput: AVCaptureVideoDataOutput?
  private static let videoQueue = DispatchQueue(label: "reelive.aufnahme.video")
  private static var audioOutput: AVCaptureAudioDataOutput?
  private static let audioQueue = DispatchQueue(label: "reelive.aufnahme.ton")
  private static var abgriff: PufferAbgriff?

  // Genau eine Aufnahme zu jeder Zeit (Pendant zum laeuftFoto-Guard in JS).
  static var aktuelle: Aufnahme?

  // Der Sucher der laufenden Aufnahme (gesetzt bei aufnahmeStarten): der
  // Puffer-Abgriff vergleicht pro Frame die Ausrichtung seiner Verbindung
  // mit der des Suchers — beim Kamerawechsel MITTEN in der Aufnahme
  // (Doppeltipp) entsteht die Output-Verbindung neu und stünde sonst auf
  // Standard-Ausrichtung statt auf der des Suchers. Weak: die View gehört
  // expo-camera, hier wird nur hineingeschaut.
  static weak var sucherLayer: AVCaptureVideoPreviewLayer?

  // Der Beobachter für Unterbrechungen (Anruf, Hintergrund, Split-View). Statisch,
  // weil die Hilfsfunktionen des Moduls statisch sind; es gibt ihn höchstens einmal,
  // OnCreate/OnDestroy halten ihn im Gleichgewicht.
  private static var unterbrechungsBeobachter: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("KameraAufnahme")

    // Anruf, Hintergrund, Split-View können die Session unterbrechen: das bis hierher
    // Gefilmte bleibt eine gültige Datei (Spec § Grenzfälle); der JS-Stopp läuft über
    // den Auslöser-Pfad, weil iOS die Berührungen ohnehin cancelt.
    OnCreate {
      Self.unterbrechungsBeobachter = NotificationCenter.default.addObserver(
        forName: .AVCaptureSessionWasInterrupted,
        object: nil,
        queue: .main
      ) { _ in
        Self.aktuelle?.stoppen()
      }
    }

    OnDestroy {
      if let beobachter = Self.unterbrechungsBeobachter {
        NotificationCenter.default.removeObserver(beobachter)
        Self.unterbrechungsBeobachter = nil
      }
    }

    AsyncFunction("aufnahmeStarten") { (maxSekunden: Double, promise: Promise) in
      // Lehnt NUR ab, wenn eine Aufnahme läuft, die noch NICHT gestoppt ist.
      // Eine gestoppte `aktuelle` bleibt nach dem Stopp absichtlich stehen
      // (die Vorschau-View aus Task 8 braucht sie) und wird hier einfach
      // ersetzt — ihr StartFenster braucht kein explizites Freigeben: die
      // ersetzte Referenz fällt mit der ganzen Aufnahme ARC anheim. Explizites
      // Freigeben (startFensterFreigeben) braucht nur der Weiterbetrieb
      // derselben Aufnahme (Übernahme in die Datei-Vorschau oder Verwerfen,
      // Task 9).
      if let vorhandene = Self.aktuelle, !vorhandene.istGestoppt {
        promise.reject("laeuft_schon", "Es läuft bereits eine Aufnahme")
        return
      }
      guard
        let sucher = Self.sucherView(),
        let layer = sucher.layer as? AVCaptureVideoPreviewLayer,
        let session = layer.session
      else {
        promise.reject("keine_session", "Keine laufende Kamera-Session")
        return
      }
      do {
        try Self.outputsAnhaengen(session, layer: layer)
        // Kamerawechsel Front/Back zwischen zwei Aufnahmen ändert die
        // Sucher-Verbindung; die Outputs bleiben aber angehängt (Grund oben)
        // und outputsAnhaengen legt sie dann nicht neu an. Deshalb hier
        // erneut angleichen — idempotent, unabhängig davon, ob gerade neu
        // angelegt wurde oder nicht.
        if let videoOutput = Self.videoOutput {
          Self.verbindungAngleichen(output: videoOutput, layer: layer)
        }
        Self.sucherLayer = layer
        let ziel = FileManager.default.temporaryDirectory
          .appendingPathComponent("reelive-\(UUID().uuidString).mov")
        // mitTon hängt an der VERBINDUNG, nicht am Output: ein Output ohne
        // Audio-Verbindung (kein Mikrofon) bleibt angehängt, liefert aber nie
        // Puffer — ein Ton-Eingang, der leer bliebe, beschriebe die Datei
        // falsch.
        let aufnahme = try Aufnahme(
          ziel: ziel, maxSekunden: maxSekunden,
          mitTon: Self.audioOutput?.connection(with: .audio) != nil
        )
        Self.aktuelle = aufnahme
        promise.resolve()
      } catch {
        promise.reject("start_gescheitert", error.localizedDescription)
      }
    }.runOnQueue(.main)

    AsyncFunction("aufnahmeStoppen") { (promise: Promise) in
      guard let aufnahme = Self.aktuelle else {
        promise.reject("keine_aufnahme", "Es läuft keine Aufnahme")
        return
      }
      aufnahme.stoppen()
      promise.resolve([
        "uri": aufnahme.ziel.absoluteString,
        "dauerS": aufnahme.dauerS,
      ])
    }.runOnQueue(.main)

    // Löst erst, wenn finishWriting durch ist — oder lehnt ab (voller
    // Speicher, Writer-Fehler). Das JS-dateiFertig-Promise hängt hieran.
    AsyncFunction("dateiAbwarten") { (promise: Promise) in
      guard let aufnahme = Self.aktuelle else {
        promise.resolve()
        return
      }
      aufnahme.wennFertig { fehler in
        if let fehler {
          promise.reject("schreiben_gescheitert", fehler.localizedDescription)
        } else {
          promise.resolve()
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("verwerfen") { (promise: Promise) in
      Self.aktuelle?.verwerfen()
      Self.aktuelle = nil
      promise.resolve()
    }.runOnQueue(.main)

    View(SofortVorschauView.self) {
      ViewName("SofortVorschau")
    }
  }

  private static func outputsAnhaengen(
    _ session: AVCaptureSession, layer: AVCaptureVideoPreviewLayer
  ) throws {
    // expo-camera baut die Session PRO CameraView: nach Metro-Reload oder
    // Remount hängen die gemerkten Outputs an der ALTEN, toten Session — es
    // käme nie wieder ein Puffer an. Gehört der Output nicht zu DIESER
    // Session, verwerfen und regulär neu anhängen.
    if let vorhandener = videoOutput, !session.outputs.contains(vorhandener) {
      videoOutput = nil
      audioOutput = nil
      abgriff = nil
    }
    guard videoOutput == nil else { return }
    let output = AVCaptureVideoDataOutput()
    let abgriff = PufferAbgriff()
    output.setSampleBufferDelegate(abgriff, queue: videoQueue)
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    guard session.canAddOutput(output) else {
      throw NSError(domain: "reelive", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Session nimmt den Video-Abgriff nicht an",
      ])
    }
    session.addOutput(output)
    verbindungAngleichen(output: output, layer: layer)
    videoOutput = output
    self.abgriff = abgriff

    let ton = AVCaptureAudioDataOutput()
    ton.setSampleBufferDelegate(abgriff, queue: audioQueue)
    // canAddOutput hängt NICHT am Mikrofon-Input: Anhängen gelingt auch ohne
    // Mikrofon (mute, Berechtigung fehlt), nur entsteht dann keine
    // Audio-Verbindung und der Track bliebe leer — deshalb prüft
    // aufnahmeStarten die Verbindung, nicht den Output. Ohne Ton wird ohne
    // Tonspur aufgenommen statt zu scheitern (Spec § Grenzfälle), deshalb
    // kein throw hier.
    if session.canAddOutput(ton) {
      session.addOutput(ton)
      audioOutput = ton
    }
  }

  // Übernimmt Rotation und Spiegelung 1:1 vom Sucher auf den Video-Abgriff.
  // Aufgerufen beim Anhängen UND erneut vor jedem Aufnahmestart (idempotent):
  // die Outputs bleiben über Kamerawechsel hinweg hängen (Kommentar oben an
  // videoOutput), ihre Verbindung aber muss dem jeweils AKTUELLEN Sucher
  // folgen — sonst spiegelt eine Front-Aufnahme nicht, obwohl der Sucher es
  // tut (Spec: «wie man es im Sucher sieht»).
  private static func verbindungAngleichen(
    output: AVCaptureVideoDataOutput, layer: AVCaptureVideoPreviewLayer
  ) {
    guard
      let verbindung = output.connection(with: .video),
      let sucherVerbindung = layer.connection
    else { return }
    verbindungAngleichen(verbindung, an: sucherVerbindung)
  }

  static func verbindungAngleichen(
    _ verbindung: AVCaptureConnection, an sucher: AVCaptureConnection
  ) {
    if verbindung.isVideoOrientationSupported {
      verbindung.videoOrientation = sucher.videoOrientation
    }
    if verbindung.isVideoMirroringSupported {
      verbindung.automaticallyAdjustsVideoMirroring = false
      verbindung.isVideoMirrored = sucher.isVideoMirrored
    }
  }

  // Ob die Output-Verbindung von der des Suchers abweicht — nach einem
  // Kamerawechsel mitten in der Aufnahme ist sie frisch entstanden und
  // steht noch auf Standardwerten.
  static func verbindungWeichtAb(
    _ verbindung: AVCaptureConnection, von sucher: AVCaptureConnection
  ) -> Bool {
    verbindung.videoOrientation != sucher.videoOrientation
      || verbindung.isVideoMirrored != sucher.isVideoMirrored
  }

  // Gleicher Suchweg wie KameraZoomModule.sucherView(): die View, deren Layer
  // die Kamera-Vorschau IST. Bewusst dupliziert statt geteilt — die beiden
  // Module bleiben unabhängig voneinander lebensfähig.
  private static func sucherView() -> UIView? {
    let fenster = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    for einzelnes in fenster {
      if let treffer = sucherView(in: einzelnes) { return treffer }
    }
    return nil
  }

  private static func sucherView(in view: UIView) -> UIView? {
    if view.layer is AVCaptureVideoPreviewLayer { return view }
    for kind in view.subviews {
      if let treffer = sucherView(in: kind) { return treffer }
    }
    return nil
  }
}

// Nimmt die Puffer entgegen und reicht sie an die laufende Aufnahme weiter.
// Bedient Video- UND Ton-Output (zwei Delegate-Protokolle, eine Instanz) —
// die Quelle unterscheidet, wohin der Puffer geht.
final class PufferAbgriff: NSObject,
  AVCaptureVideoDataOutputSampleBufferDelegate,
  AVCaptureAudioDataOutputSampleBufferDelegate
{
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if output is AVCaptureAudioDataOutput {
      KameraAufnahmeModule.aktuelle?.schreibeTon(sampleBuffer)
    } else {
      // Kamerawechsel WÄHREND der Aufnahme (Doppeltipp): expo-camera tauscht
      // den Geräte-Input derselben Session, dabei entsteht diese Verbindung
      // neu — mit Standard-Ausrichtung statt der des Suchers. Pro Frame
      // prüfen und nachziehen; der abweichende Frame selbst trägt noch die
      // alte Ausrichtung und bleibt draussen. Im Normalfall kostet das zwei
      // Property-Vergleiche pro Frame.
      if let sucher = KameraAufnahmeModule.sucherLayer?.connection,
        KameraAufnahmeModule.verbindungWeichtAb(connection, von: sucher)
      {
        KameraAufnahmeModule.verbindungAngleichen(connection, an: sucher)
        return
      }
      // Nachzügler des Wechsels: einzelne Frames können noch mit der ALTEN
      // Ausrichtung unterwegs sein, obwohl die Verbindung schon stimmt —
      // quer statt hochkant. Der Writer presste sie verzerrt in seine
      // 1080×1920-Spur, also bleiben auch sie draussen (die App ist
      // hochkant-gesperrt, jeder rechtmässige Frame ist höher als breit).
      if let bild = CMSampleBufferGetImageBuffer(sampleBuffer),
        CVPixelBufferGetWidth(bild) > CVPixelBufferGetHeight(bild)
      {
        return
      }
      KameraAufnahmeModule.aktuelle?.schreibeVideo(sampleBuffer)
    }
  }
}

// Eine Aufnahme: Writer, Zeiten, Fertig-Rückrufe. schreibeVideo läuft auf der
// videoQueue, schreibeTon auf der audioQueue (zwei Delegate-Queues), Stopp und
// Fenster-Zugriffe auf Main; jeder AVAssetWriterInput wird nur von seiner
// eigenen Queue befüllt. Das Lock macht den Zustandsübergang (istGestoppt
// setzen + markAsFinished) und jedes Append atomar ZUEINANDER — ein Append
// nach markAsFinished ist eine NSException, kein tolerierter Puffer-Verlust.
final class Aufnahme {
  // Wie viele Frames die Sofort-Vorschau aus dem Speicher spielen kann, bevor
  // die Datei übernimmt. 24 Frames ≈ 0,8 s bei 30 fps ≈ ~70 MB bei 1080p —
  // nur für Sekunden im Speicher; wird nach Übernahme oder Verwerfen
  // freigegeben. Am Gerät kalibrieren (Spec § Offene Kalibrierungen).
  private let STARTFENSTER_FRAMES = 24

  let ziel: URL
  private let writer: AVAssetWriter
  private let videoEingang: AVAssetWriterInput
  private let tonEingang: AVAssetWriterInput?
  // Schützt alles, was Delegate-Queues UND Main gemeinsam anfassen:
  // _istGestoppt, sessionGestartet, _startPTS, startFenster, maxTimer.
  private let lock = NSLock()
  private var sessionGestartet = false
  private var _istGestoppt = false
  // Öffentlich lesbar (Lock-gesichert): der Start-Guard in aufnahmeStarten
  // muss nach dem Stopp einer alten Aufnahme unterscheiden können, ob sie
  // noch läuft oder schon fertig ist.
  var istGestoppt: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _istGestoppt
  }
  private var fertigFehler: Error?
  private var fertigRueckrufe: [(Error?) -> Void] = []
  private var fertig = false
  private var startZeit = Date()
  private var stoppZeit: Date?
  private let maxSekunden: Double
  private var maxTimer: DispatchSourceTimer?
  // Capture-Clock-PTS des ersten geschriebenen Frames — der Nullpunkt der
  // Datei-Zeitachse: startSession(atSourceTime:) mappt genau diesen Moment
  // auf Movie-Zeit 0. Die Vorschau rechnet damit die Fenster-Puffer auf die
  // Datei-Zeit um (PTS − startPTS, SofortVorschauView.aufDateiZeit).
  private var _startPTS = CMTime.invalid
  var startPTS: CMTime {
    lock.lock()
    defer { lock.unlock() }
    return _startPTS
  }
  // Nur unter dem Lock anfassen; nach aussen geht ausschliesslich die Kopie
  // aus startFensterKopie().
  private var startFenster: [CMSampleBuffer] = []

  var dauerS: Double { (stoppZeit ?? Date()).timeIntervalSince(startZeit) }

  init(ziel: URL, maxSekunden: Double, mitTon: Bool) throws {
    self.ziel = ziel
    self.maxSekunden = maxSekunden
    writer = try AVAssetWriter(outputURL: ziel, fileType: .mov)
    videoEingang = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: 1080,
      AVVideoHeightKey: 1920,
    ])
    videoEingang.expectsMediaDataInRealTime = true
    writer.add(videoEingang)
    if mitTon {
      let eingang = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVNumberOfChannelsKey: 1,
        AVSampleRateKey: 44_100,
      ])
      eingang.expectsMediaDataInRealTime = true
      writer.add(eingang)
      tonEingang = eingang
    } else {
      tonEingang = nil
    }
    guard writer.startWriting() else { throw writer.error ?? NSError(domain: "reelive", code: 2) }
    startZeit = Date()
  }

  func schreibeVideo(_ puffer: CMSampleBuffer) {
    lock.lock()
    defer { lock.unlock() }
    guard !_istGestoppt, writer.status == .writing else { return }
    let zeit = CMSampleBufferGetPresentationTimeStamp(puffer)
    if !sessionGestartet {
      writer.startSession(atSourceTime: zeit)
      _startPTS = zeit
      sessionGestartet = true
      planeMaxStopp()
    }
    if videoEingang.isReadyForMoreMediaData {
      videoEingang.append(puffer)
      if startFenster.count < STARTFENSTER_FRAMES, let kopie = Self.tiefkopie(puffer) {
        startFenster.append(kopie)
      }
    }
  }

  // Tiefkopie eines Video-Puffers in eigenen Speicher. Warum das sein muss:
  // die Original-Puffer gehören dem endlichen Pool des VideoDataOutput —
  // behält man sie, verhungert die Lieferung nach ~10 Frames, und Datei wie
  // Fenster enden bei ~0,3 s (Gerätefund 2026-08-17: 46 verworfene Frames in
  // 2 s, bewiesen über die didDrop-Sonde). Die Kopie kostet ~3 MB memcpy pro
  // Frame, verteilt über die erste Sekunde — der Pool bekommt seinen Puffer
  // sofort zurück.
  private static func tiefkopie(_ puffer: CMSampleBuffer) -> CMSampleBuffer? {
    guard let quelle = CMSampleBufferGetImageBuffer(puffer) else { return nil }
    CVPixelBufferLockBaseAddress(quelle, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(quelle, .readOnly) }

    var kopie: CVPixelBuffer?
    let eigenschaften = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary
    guard
      CVPixelBufferCreate(
        nil,
        CVPixelBufferGetWidth(quelle),
        CVPixelBufferGetHeight(quelle),
        CVPixelBufferGetPixelFormatType(quelle),
        eigenschaften,
        &kopie
      ) == kCVReturnSuccess,
      let ziel = kopie
    else { return nil }

    CVPixelBufferLockBaseAddress(ziel, [])
    defer { CVPixelBufferUnlockBaseAddress(ziel, []) }
    if CVPixelBufferIsPlanar(quelle) {
      for ebene in 0..<CVPixelBufferGetPlaneCount(quelle) {
        guard
          let von = CVPixelBufferGetBaseAddressOfPlane(quelle, ebene),
          let nach = CVPixelBufferGetBaseAddressOfPlane(ziel, ebene)
        else { return nil }
        let vonZeile = CVPixelBufferGetBytesPerRowOfPlane(quelle, ebene)
        let nachZeile = CVPixelBufferGetBytesPerRowOfPlane(ziel, ebene)
        let hoehe = CVPixelBufferGetHeightOfPlane(quelle, ebene)
        if vonZeile == nachZeile {
          memcpy(nach, von, vonZeile * hoehe)
        } else {
          // Zeilenweise: die Puffer können unterschiedlich aufgerundete
          // Zeilenbreiten haben.
          for zeile in 0..<hoehe {
            memcpy(nach + zeile * nachZeile, von + zeile * vonZeile, min(vonZeile, nachZeile))
          }
        }
      }
    } else {
      guard
        let von = CVPixelBufferGetBaseAddress(quelle),
        let nach = CVPixelBufferGetBaseAddress(ziel)
      else { return nil }
      memcpy(nach, von, CVPixelBufferGetDataSize(quelle))
    }

    var beschreibung: CMVideoFormatDescription?
    guard
      CMVideoFormatDescriptionCreateForImageBuffer(
        allocator: nil, imageBuffer: ziel, formatDescriptionOut: &beschreibung
      ) == noErr,
      let format = beschreibung
    else { return nil }
    var timing = CMSampleTimingInfo()
    guard CMSampleBufferGetSampleTimingInfo(puffer, at: 0, timingInfoOut: &timing) == noErr else {
      return nil
    }
    var ergebnis: CMSampleBuffer?
    guard
      CMSampleBufferCreateReadyWithImageBuffer(
        allocator: nil,
        imageBuffer: ziel,
        formatDescription: format,
        sampleTiming: &timing,
        sampleBufferOut: &ergebnis
      ) == noErr
    else { return nil }
    return ergebnis
  }

  func schreibeTon(_ puffer: CMSampleBuffer) {
    lock.lock()
    defer { lock.unlock() }
    guard !_istGestoppt, sessionGestartet, writer.status == .writing else { return }
    // Vor dem ersten VIDEO-Frame keinen Ton annehmen: die Writer-Session
    // startet auf der Video-Zeitbasis, früherer Ton würde abgeschnitten.
    if let eingang = tonEingang, eingang.isReadyForMoreMediaData {
      eingang.append(puffer)
    }
  }

  func stoppen() {
    lock.lock()
    guard !_istGestoppt else {
      lock.unlock()
      return
    }
    _istGestoppt = true
    stoppZeit = Date()
    maxTimer?.cancel()
    maxTimer = nil
    let hatFrames = sessionGestartet
    if hatFrames {
      // Noch unter dem Lock: kein schreibeVideo/-Ton kann zwischen
      // istGestoppt und markAsFinished ein Append dazwischenschieben.
      videoEingang.markAsFinished()
      tonEingang?.markAsFinished()
    }
    lock.unlock()
    guard hatFrames else {
      // Kein einziger Frame kam an (z. B. toter Abgriff): finishWriting ohne
      // startSession wäre undefiniert — abbrechen und den Fehler über
      // dateiFertig sichtbar machen, statt still eine leere Datei zu melden.
      writer.cancelWriting()
      let fehler = NSError(domain: "reelive", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "Kein Frame angekommen — die Aufnahme blieb leer",
      ])
      DispatchQueue.main.async {
        self.fertig = true
        self.fertigFehler = fehler
        self.fertigRueckrufe.forEach { $0(fehler) }
        self.fertigRueckrufe = []
      }
      return
    }
    writer.finishWriting { [self] in
      let fehler = writer.status == .completed ? nil : (writer.error ?? NSError(domain: "reelive", code: 3))
      DispatchQueue.main.async {
        self.fertig = true
        self.fertigFehler = fehler
        self.fertigRueckrufe.forEach { $0(fehler) }
        self.fertigRueckrufe = []
      }
    }
  }

  func wennFertig(_ rueckruf: @escaping (Error?) -> Void) {
    if fertig { rueckruf(fertigFehler) } else { fertigRueckrufe.append(rueckruf) }
  }

  // Schnappschuss fürs Abspielen: das Array ist Copy-on-Write, der Aufrufer
  // hält damit eine vom Lock unabhängige Puffer-Liste.
  func startFensterKopie() -> [CMSampleBuffer] {
    lock.lock()
    defer { lock.unlock() }
    return startFenster
  }

  func startFensterFreigeben() {
    lock.lock()
    defer { lock.unlock() }
    startFenster = []
  }

  func verwerfen() {
    startFensterFreigeben()
    stoppen()
    wennFertig { _ in try? FileManager.default.removeItem(at: self.ziel) }
  }

  // Die Höchstdauer stoppt HART im Modul; der JS-Ring am Auslöser bleibt nur
  // die sichtbare Anzeige (Spec § Grenzfälle). Läuft UNTER dem Lock (Aufruf
  // aus schreibeVideo): maxTimer wird nur lock-geschützt angefasst, und weil
  // stoppen() istGestoppt zuerst setzt, entsteht nach dem Stopp kein Timer
  // mehr. Der Handler feuert auf Main.
  private func planeMaxStopp() {
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + maxSekunden)
    timer.setEventHandler { [weak self] in self?.stoppen() }
    timer.resume()
    maxTimer = timer
  }
}
