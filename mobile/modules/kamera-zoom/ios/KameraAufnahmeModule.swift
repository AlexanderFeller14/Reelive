import AVFoundation
import ExpoModulesCore
import UIKit

// Eigene Video-Aufnahme (Spec 2026-08-14-instant-video-vorschau): greift die
// Puffer der laufenden expo-camera-Session ab, statt auf recordAsyncs Datei
// zu warten. Die Phase-0-Probe (Task 1) ist gelaufen: 64 Frames in 2 s neben
// dem untätigen MovieFileOutput — der Abgriff koexistiert, ein Entfernen-Zweig
// entfällt. Dieses Modul trägt jetzt den Aufnahme-Kern (noch ohne Ton — Task 4
// ergänzt den Audio-Eingang).
public class KameraAufnahmeModule: Module {
  // Die Outputs hängen EINMAL an der Session und bleiben (jedes An-/Abhängen
  // ist ein Session-Umbau und damit ein sichtbarer Sucher-Ruckler, Spec §
  // Session-Umbauten). `laufend` schaltet nur, ob Puffer verarbeitet werden.
  private static var videoOutput: AVCaptureVideoDataOutput?
  private static let videoQueue = DispatchQueue(label: "reelive.aufnahme.video")
  private static var abgriff: PufferAbgriff?

  // Genau eine Aufnahme zu jeder Zeit (Pendant zum laeuftFoto-Guard in JS).
  static var aktuelle: Aufnahme?

  public func definition() -> ModuleDefinition {
    Name("KameraAufnahme")

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
        try Self.outputsAnhaengen(session)
        let ziel = FileManager.default.temporaryDirectory
          .appendingPathComponent("reelive-\(UUID().uuidString).mov")
        let aufnahme = try Aufnahme(ziel: ziel, maxSekunden: maxSekunden)
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

  private static func outputsAnhaengen(_ session: AVCaptureSession) throws {
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
    // Orientierung und Spiegelung wie im Sucher (Task 5 verfeinert Front).
    if let verbindung = output.connection(with: .video) {
      verbindung.videoOrientation = .portrait
    }
    videoOutput = output
    self.abgriff = abgriff
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
final class PufferAbgriff: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    KameraAufnahmeModule.aktuelle?.schreibeVideo(sampleBuffer)
  }
}

// Eine Aufnahme: Writer, Zeiten, Fertig-Rückrufe. Alle Mitglieder laufen auf
// der videoQueue (die Delegate-Queue) oder sind davor/danach unveränderlich.
final class Aufnahme {
  let ziel: URL
  private let writer: AVAssetWriter
  private let videoEingang: AVAssetWriterInput
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

  var dauerS: Double { (stoppZeit ?? Date()).timeIntervalSince(startZeit) }

  init(ziel: URL, maxSekunden: Double) throws {
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
    }
  }

  func stoppen() {
    guard !istGestoppt else { return }
    istGestoppt = true
    stoppZeit = Date()
    maxTimer?.cancel()
    videoEingang.markAsFinished()
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

  func verwerfen() {
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
