import AVFoundation
import ExpoModulesCore
import UIKit

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

  // Der Beobachter fürs Zurückstellen des Fokus (siehe «fokussiere» unten).
  // Statisch, weil die Hilfsfunktionen des Moduls statisch sind; es gibt ihn
  // höchstens einmal, OnCreate/OnDestroy halten ihn im Gleichgewicht.
  private static var szenenBeobachter: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("KameraZoom")

    // Tap-to-Focus braucht seinen Rückweg: nach einem gesetzten Punkt bleibt
    // der Fokus dort stehen, bis sich die Szene merklich ändert — dann meldet
    // sich AVFoundation (Subject-Area-Monitoring wird in «fokussiere»
    // eingeschaltet) und es geht zurück zu kontinuierlich über die Mitte.
    // Das ist das Muster aus Apples AVCam-Beispiel und der Kamera-App.
    OnCreate {
      Self.szenenBeobachter = NotificationCenter.default.addObserver(
        forName: .AVCaptureDeviceSubjectAreaDidChange,
        object: nil,
        queue: .main
      ) { mitteilung in
        guard let geraet = mitteilung.object as? AVCaptureDevice else {
          return
        }
        Self.fokusZuruecksetzen(geraet)
      }
    }

    OnDestroy {
      if let beobachter = Self.szenenBeobachter {
        NotificationCenter.default.removeObserver(beobachter)
        Self.szenenBeobachter = nil
      }
    }

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

    // Tap-to-Focus: Fokus einmalig, Belichtung kontinuierlich auf den Punkt,
    // in Fenster-Punkten (pageX/pageY). Warum auch das hier liegt: expo-camera
    // kennt nur den globalen autoFocus-Modus, keinen Fokus-Punkt.
    //
    // Die Umrechnung in Geräte-Koordinaten macht die Preview-Layer selbst
    // (captureDevicePointConverted kennt Orientierung, Spiegelung und den
    // Aspect-Fill-Beschnitt — von Hand nachgerechnet wäre jede dieser drei
    // Stellen ein eigener Fehlerkandidat). Die Layer gehört expo-camera:
    // dessen CameraView IST seine Preview-Layer (layerClass), gefunden wird
    // sie über die View-Hierarchie — die App hat höchstens einen Sucher.
    // Main-Queue, weil UIKit-Hierarchie und Layer-Geometrie dort wohnen.
    AsyncFunction("fokussiere") { (x: Double, y: Double) in
      guard
        let sucher = Self.sucherView(),
        let layer = sucher.layer as? AVCaptureVideoPreviewLayer,
        let geraet = layer.session?.inputs
          .compactMap({ ($0 as? AVCaptureDeviceInput)?.device })
          .first(where: { $0.hasMediaType(.video) })
      else {
        return
      }
      let imSucher = sucher.convert(CGPoint(x: x, y: y), from: nil)
      let punkt = layer.captureDevicePointConverted(fromLayerPoint: imSucher)

      do {
        try geraet.lockForConfiguration()
        defer { geraet.unlockForConfiguration() }
        // Der Punkt MUSS vor dem Modus gesetzt werden: der Moduswechsel
        // stösst die Messung an, und die soll den neuen Punkt schon sehen.
        if geraet.isFocusPointOfInterestSupported {
          geraet.focusPointOfInterest = punkt
        }
        if geraet.isFocusModeSupported(.autoFocus) {
          geraet.focusMode = .autoFocus
        }
        if geraet.isExposurePointOfInterestSupported {
          geraet.exposurePointOfInterest = punkt
        }
        // Anders als der Fokus kontinuierlich, nicht einmalig: .autoExpose
        // misst genau einmal und stellt die Belichtung danach fest — ändert
        // sich dann das Licht (gerade im Video), bleibt das Bild falsch
        // belichtet, bis die Szenen-Rückstellung greift. Die Kamera-App misst
        // nach einem Tipp dauerhaft auf den Punkt.
        if geraet.isExposureModeSupported(.continuousAutoExposure) {
          geraet.exposureMode = .continuousAutoExposure
        } else if geraet.isExposureModeSupported(.autoExpose) {
          geraet.exposureMode = .autoExpose
        }
        // Ab jetzt meldet sich die Szene, wenn sie sich ändert — der
        // Beobachter in OnCreate stellt dann auf kontinuierlich zurück.
        geraet.isSubjectAreaChangeMonitoringEnabled = true
      } catch {
        // Wie beim Zoom: ein nicht gesetzter Fokus ist harmloser als ein
        // Absturz, der nächste Tipp versucht es neu.
      }
    }.runOnQueue(.main)
  }

  // Zurück zu dem, was vor dem Tipp galt: kontinuierlicher Fokus und
  // kontinuierliche Belichtung über die Bildmitte, Monitoring wieder aus.
  private static func fokusZuruecksetzen(_ geraet: AVCaptureDevice) {
    do {
      try geraet.lockForConfiguration()
      defer { geraet.unlockForConfiguration() }
      let mitte = CGPoint(x: 0.5, y: 0.5)
      if geraet.isFocusPointOfInterestSupported {
        geraet.focusPointOfInterest = mitte
      }
      if geraet.isFocusModeSupported(.continuousAutoFocus) {
        geraet.focusMode = .continuousAutoFocus
      }
      if geraet.isExposurePointOfInterestSupported {
        geraet.exposurePointOfInterest = mitte
      }
      if geraet.isExposureModeSupported(.continuousAutoExposure) {
        geraet.exposureMode = .continuousAutoExposure
      }
      geraet.isSubjectAreaChangeMonitoringEnabled = false
    } catch {
      // Siehe oben: lieber ein stehengebliebener Fokus als ein Absturz.
    }
  }

  // Die View, deren Layer die Kamera-Vorschau zeichnet (expo-cameras
  // CameraView). Über alle Fenster gesucht, nicht nur das Schlüsselfenster:
  // während eines Systemdialogs ist ein anderes Fenster vorn.
  private static func sucherView() -> UIView? {
    let fenster = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    for einzelnes in fenster {
      if let treffer = sucherView(in: einzelnes) {
        return treffer
      }
    }
    return nil
  }

  private static func sucherView(in view: UIView) -> UIView? {
    if view.layer is AVCaptureVideoPreviewLayer {
      return view
    }
    for kind in view.subviews {
      if let treffer = sucherView(in: kind) {
        return treffer
      }
    }
    return nil
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
