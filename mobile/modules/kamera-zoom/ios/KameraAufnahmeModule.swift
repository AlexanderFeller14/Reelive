import AVFoundation
import ExpoModulesCore
import UIKit

// Eigene Video-Aufnahme (Spec 2026-08-14-instant-video-vorschau): greift die
// Puffer der laufenden expo-camera-Session ab, statt auf recordAsyncs Datei
// zu warten. Dieses Gerüst trägt zuerst nur die Phase-0-Probe: bekommt ein
// VideoDataOutput NEBEN dem untätigen MovieFileOutput überhaupt Frames?
public class KameraAufnahmeModule: Module {
  private static var probeOutput: AVCaptureVideoDataOutput?
  private static let probeQueue = DispatchQueue(label: "reelive.aufnahme.probe")
  private static var probeDelegate: ProbeZaehler?

  public func definition() -> ModuleDefinition {
    Name("KameraAufnahme")

    // Zählt `sekunden` lang die eintreffenden Frames. > 0 heisst: der Abgriff
    // koexistiert mit dem angehängten MovieFileOutput, kein Entfernen nötig.
    AsyncFunction("abgriffProbe") { (sekunden: Double, promise: Promise) in
      guard
        let sucher = Self.sucherView(),
        let layer = sucher.layer as? AVCaptureVideoPreviewLayer,
        let session = layer.session
      else {
        promise.reject("keine_session", "Keine laufende Kamera-Session gefunden")
        return
      }
      let output = AVCaptureVideoDataOutput()
      let zaehler = ProbeZaehler()
      output.setSampleBufferDelegate(zaehler, queue: Self.probeQueue)
      session.beginConfiguration()
      guard session.canAddOutput(output) else {
        session.commitConfiguration()
        promise.resolve(-1) // -1: Session lehnt den Output ab (Weiche: Zweig B)
        return
      }
      session.addOutput(output)
      session.commitConfiguration()
      Self.probeOutput = output
      Self.probeDelegate = zaehler
      DispatchQueue.main.asyncAfter(deadline: .now() + sekunden) {
        session.beginConfiguration()
        session.removeOutput(output)
        session.commitConfiguration()
        Self.probeOutput = nil
        let anzahl = zaehler.anzahl
        Self.probeDelegate = nil
        promise.resolve(anzahl)
      }
    }.runOnQueue(.main)
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

private final class ProbeZaehler: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private(set) var anzahl = 0
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    anzahl += 1
  }
}
