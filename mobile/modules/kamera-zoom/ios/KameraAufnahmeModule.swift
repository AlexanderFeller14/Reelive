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
      // ersetzt — das Freigeben ihres StartFensters kommt erst mit Task 7.
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
        let ziel = FileManager.default.temporaryDirectory
          .appendingPathComponent("reelive-\(UUID().uuidString).mov")
        let aufnahme = try Aufnahme(
          ziel: ziel, maxSekunden: maxSekunden, mitTon: Self.audioOutput != nil
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
  }

  private static func outputsAnhaengen(
    _ session: AVCaptureSession, layer: AVCaptureVideoPreviewLayer
  ) throws {
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
    // Kein Mikrofon (mute, Berechtigung fehlt): Aufnahme ohne Tonspur statt
    // Scheitern (Spec § Grenzfälle) — deshalb kein throw hier.
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
    if verbindung.isVideoOrientationSupported {
      verbindung.videoOrientation = sucherVerbindung.videoOrientation
    }
    if verbindung.isVideoMirroringSupported {
      verbindung.automaticallyAdjustsVideoMirroring = false
      verbindung.isVideoMirrored = sucherVerbindung.isVideoMirrored
    }
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
      KameraAufnahmeModule.aktuelle?.schreibeVideo(sampleBuffer)
    }
  }
}

// Eine Aufnahme: Writer, Zeiten, Fertig-Rückrufe. schreibeVideo läuft auf der
// videoQueue, schreibeTon auf der audioQueue (zwei Delegate-Queues); jeder
// AVAssetWriterInput wird nur von seiner eigenen Queue angefasst. Die
// gemeinsam gelesenen Flags (istGestoppt, sessionGestartet) sind einfache
// Bools — ein Lese-Wettlauf beim Start/Stopp verwirft im schlimmsten Fall
// einen einzelnen Puffer, was AVAssetWriter ohnehin toleriert.
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
  private var sessionGestartet = false
  // Öffentlich lesbar (nicht nur intern der Klasse): der Start-Guard in
  // aufnahmeStarten muss nach dem Stopp einer alten Aufnahme unterscheiden
  // können, ob sie noch läuft oder schon fertig ist.
  private(set) var istGestoppt = false
  private var fertigFehler: Error?
  private var fertigRueckrufe: [(Error?) -> Void] = []
  private var fertig = false
  private var startZeit = Date()
  private var stoppZeit: Date?
  private let maxSekunden: Double
  private var maxTimer: DispatchSourceTimer?
  // Nur von videoQueue gefüllt; auf Main entleert (Task 9) — Thread-Sicherheit beim Final-Review entscheiden.
  private(set) var startFenster: [CMSampleBuffer] = []

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
    guard !istGestoppt, writer.status == .writing else { return }
    let zeit = CMSampleBufferGetPresentationTimeStamp(puffer)
    if !sessionGestartet {
      writer.startSession(atSourceTime: zeit)
      sessionGestartet = true
      planeMaxStopp()
    }
    if videoEingang.isReadyForMoreMediaData {
      videoEingang.append(puffer)
      if startFenster.count < STARTFENSTER_FRAMES {
        startFenster.append(puffer)
      }
    }
  }

  func schreibeTon(_ puffer: CMSampleBuffer) {
    guard !istGestoppt, sessionGestartet, writer.status == .writing else { return }
    // Vor dem ersten VIDEO-Frame keinen Ton annehmen: die Writer-Session
    // startet auf der Video-Zeitbasis, früherer Ton würde abgeschnitten.
    if let eingang = tonEingang, eingang.isReadyForMoreMediaData {
      eingang.append(puffer)
    }
  }

  func stoppen() {
    guard !istGestoppt else { return }
    istGestoppt = true
    stoppZeit = Date()
    maxTimer?.cancel()
    videoEingang.markAsFinished()
    tonEingang?.markAsFinished()
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

  func startFensterFreigeben() {
    startFenster = []
  }

  func verwerfen() {
    startFensterFreigeben()
    stoppen()
    wennFertig { _ in try? FileManager.default.removeItem(at: self.ziel) }
  }

  // Die Höchstdauer stoppt HART im Modul; der JS-Ring am Auslöser bleibt nur
  // die sichtbare Anzeige (Spec § Grenzfälle).
  private func planeMaxStopp() {
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + maxSekunden)
    timer.setEventHandler { [weak self] in self?.stoppen() }
    timer.resume()
    maxTimer = timer
  }
}
