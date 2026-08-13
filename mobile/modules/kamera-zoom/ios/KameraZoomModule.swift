import AVFoundation
import ExpoModulesCore

// Zoom-Stufen für den Sucher. Die JS-Seite steht in
// src/features/kamera/nativeZoom.ts, gerechnet wird in zoom.ts.
//
// Warum dieses Modul überhaupt existiert: `expo-camera` nimmt keinen
// Zoomfaktor entgegen. Sein `zoom`-Prop ist ein Regler von 0 bis 1, den es
// exponentiell auf das aktive Format bezieht:
//
//   device.videoZoomFactor = minZoom * pow(activeFormat.videoMaxZoomFactor / minZoom, zoom)
//   (expo-camera 57, ios/Current/CameraSessionManager.swift:221)
//
// `videoMaxZoomFactor` ist von JavaScript aus nicht lesbar und wechselt
// zwischen Foto- und Videoformat. Ein bestimmter Faktor ist über diesen Weg
// also nicht zu treffen, und unter 1,0 kommt man ohnehin nie (`minZoom = 1.0`
// steht dort fest). Deshalb setzt dieses Modul `videoZoomFactor` direkt.
public class KameraZoomModule: Module {
  // Wie schnell `setzeZoom(sanft:)` hineinfährt, in Verdopplungen pro Sekunde
  // (so misst AVFoundation die Rate). Ein Tipp von 1× auf 4× sind zwei
  // Verdopplungen, bei 8 also eine Viertelsekunde — im Bereich der
  // Bewegungsdauern aus DESIGN-LANGUAGE §5, und nah an dem, was die
  // Kamera-App tut.
  private static let rampenRate: Float = 8.0

  // Dieselbe Liste wie in expo-camera (ios/Common/DeviceDiscovery.swift:20-41),
  // und das ist keine Kosmetik: Die App wählt ihre Kamera über `selectedLens`,
  // expo-camera vergleicht dort `localizedName`. Was hier nicht gefunden wird,
  // lässt sich dort nicht auswählen — und umgekehrt.
  private static var geraeteTypen: [AVCaptureDevice.DeviceType] {
    var typen: [AVCaptureDevice.DeviceType] = [
      .builtInWideAngleCamera,
      .builtInTelephotoCamera,
      .builtInUltraWideCamera,
      .builtInTrueDepthCamera,
      .builtInTripleCamera,
      .builtInDualCamera,
      .builtInDualWideCamera
    ]
    if #available(iOS 15.4, *) {
      typen.append(.builtInLiDARDepthCamera)
    }
    return typen
  }

  public func definition() -> ModuleDefinition {
    Name("KameraZoom")

    // Alle Kameras einer Blickrichtung. Virtuelle Geräte (Dreifach-,
    // Zweifach-Kamera) tragen ihre Bestandteile und die Faktoren, bei denen
    // iOS von einer Linse auf die nächste wechselt — daraus entstehen die
    // Stufen der Reihe, siehe zoom.ts.
    Function("linsen") { (position: String) -> [[String: Any]] in
      Self.geraete(position: position).map { geraet in
        [
          "name": geraet.localizedName,
          "typ": Self.typ(geraet.deviceType),
          "bestandteile": geraet.constituentDevices.map { Self.typ($0.deviceType) },
          "umschaltpunkte": geraet.virtualDeviceSwitchOverVideoZoomFactors.map { $0.doubleValue }
        ]
      }
    }

    // Die tatsächlich zulässigen Grenzen des Geräts, in dessen eigener
    // Zählung: auf einer Kamera mit Ultraweitwinkel ist `min` = 1,0 das, was
    // die Oberfläche 0,5× nennt.
    Function("zoomGrenzen") { (name: String) -> [String: Double]? in
      guard let geraet = Self.geraet(name: name) else {
        return nil
      }
      return [
        "min": Double(geraet.minAvailableVideoZoomFactor),
        "max": Double(geraet.maxAvailableVideoZoomFactor)
      ]
    }

    // `sanft` fährt hinein wie die Kamera-App (für den Tipp auf eine Stufe),
    // sonst wird hart gesetzt — der Pinch soll dem Finger folgen und nicht
    // hinterherziehen.
    Function("setzeZoom") { (name: String, faktor: Double, sanft: Bool) in
      guard let geraet = Self.geraet(name: name) else {
        return
      }
      do {
        try geraet.lockForConfiguration()
        defer { geraet.unlockForConfiguration() }

        let ziel = min(
          max(CGFloat(faktor), geraet.minAvailableVideoZoomFactor),
          geraet.maxAvailableVideoZoomFactor
        )
        // Beendet eine noch laufende Rampe. Ohne das zöge ein Tipp weiter,
        // während der Finger schon wieder zieht.
        geraet.cancelVideoZoomRamp()
        if sanft {
          geraet.ramp(toVideoZoomFactor: ziel, withRate: Self.rampenRate)
        } else {
          geraet.videoZoomFactor = ziel
        }
      } catch {
        // Die Kamera gehört gerade jemand anderem (Anruf, andere App). Ein
        // stehengebliebener Zoom ist die harmlosere Folge als ein Absturz;
        // die nächste Bedienung setzt ihn ohnehin neu.
      }
    }
  }

  private static func geraete(position: String) -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: geraeteTypen,
      mediaType: .video,
      position: position == "front" ? .front : .back
    ).devices
  }

  // Sucht über denselben lokalisierten Namen, über den auch expo-camera seine
  // Linse wählt. AVFoundation gibt pro Kamera dasselbe Objekt heraus, wir
  // fassen also genau das Gerät an, das gerade in der Session läuft.
  private static func geraet(name: String) -> AVCaptureDevice? {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: geraeteTypen,
      mediaType: .video,
      position: .unspecified
    ).devices.first { $0.localizedName == name }
  }

  private static func typ(_ deviceType: AVCaptureDevice.DeviceType) -> String {
    switch deviceType {
    case .builtInUltraWideCamera: return "ultraWide"
    case .builtInWideAngleCamera: return "wide"
    case .builtInTelephotoCamera: return "telephoto"
    case .builtInTrueDepthCamera: return "trueDepth"
    case .builtInTripleCamera: return "triple"
    case .builtInDualCamera: return "dual"
    case .builtInDualWideCamera: return "dualWide"
    default: return "unbekannt"
    }
  }
}
