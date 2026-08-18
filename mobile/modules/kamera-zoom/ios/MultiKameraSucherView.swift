import AVFoundation
import ExpoModulesCore
import UIKit

// Die Sucher-Fläche des MultiCam-Pfads: eine Preview-Ebene pro Kamera,
// übereinander gestapelt, sichtbar ist genau eine (Spec §3). Ein Kamerawechsel
// blendet nur um; die Ebenen selbst bleiben verbunden und laufen weiter.
//
// Die Ebenen entstehen hier OHNE Session-Bindung. Verbunden werden sie vom
// Modul, das die Session besitzt: es ruft setSessionWithNoConnection und legt
// die manuelle AVCaptureConnection an (MultiCam bildet keine automatischen
// Verbindungen).
final class MultiKameraSucherView: ExpoView {
  private var ebenen: [String: AVCaptureVideoPreviewLayer] = [:]

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Schwarz statt durchsichtig: bis der erste Frame steht (laut Sonde 300 bis
    // 400 ms nach dem Start), ist die Fläche die dunkle Bühne des Screens.
    backgroundColor = .black
    for name in MultiKameraModule.kameraNamen {
      let ebene = AVCaptureVideoPreviewLayer()
      ebene.videoGravity = .resizeAspectFill
      // Sichtbarkeit setzt das Modul, sobald es die aktive Kamera kennt.
      ebene.isHidden = true
      layer.addSublayer(ebene)
      ebenen[name] = ebene
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Ohne implizite Animation: eine CALayer animiert jede Frame-Änderung von
    // sich aus, und der Sucher soll bei jeder Grössenänderung sofort stehen.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for ebene in ebenen.values {
      ebene.frame = bounds
    }
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      MultiKameraModule.sucherAbmelden(self)
    } else {
      MultiKameraModule.sucherAnmelden(self)
    }
  }

  func ebene(fuer name: String) -> AVCaptureVideoPreviewLayer? {
    ebenen[name]
  }

  func alleEbenen() -> [String: AVCaptureVideoPreviewLayer] {
    ebenen
  }

  // Genau eine Ebene sichtbar. Ohne implizite Aktionen, sonst legte
  // CoreAnimation über jeden Kamerawechsel eine Blende, und genau die soll der
  // Umbau ja loswerden.
  func sichtbarSetzen(_ aktiv: String) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (name, ebene) in ebenen {
      ebene.isHidden = name != aktiv
    }
    CATransaction.commit()
  }
}
