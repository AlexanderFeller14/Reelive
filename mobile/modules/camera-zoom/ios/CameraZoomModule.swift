import AVFoundation
import ExpoModulesCore
import UIKit

// Zoom steps for the viewfinder. The JS side lives in
// src/features/camera/nativeZoom.ts, the calculation itself in zoom.ts.
//
// Why this module exists at all: `expo-camera` doesn't take a zoom factor.
// Its `zoom` prop is a slider from 0 to 1, which it maps exponentially onto
// the active format:
//
//   device.videoZoomFactor = minZoom * pow(activeFormat.videoMaxZoomFactor / minZoom, zoom)
//   (expo-camera 57, ios/Current/CameraSessionManager.swift:221)
//
// `videoMaxZoomFactor` isn't readable from JavaScript and changes between
// photo and video format. A specific factor can't be hit this way, and below
// 1.0 is never reached at all (`minZoom = 1.0` is fixed there). That's why
// this module sets `videoZoomFactor` directly instead.
public class CameraZoomModule: Module {
  // How fast `setZoom(smooth:)` ramps in, in doublings per second (that's how
  // AVFoundation measures the rate). A tap from 1x to 4x is two doublings, at
  // 8 that's a quarter second, within the range of motion durations from
  // DESIGN-LANGUAGE §5, and close to what the Camera app does.
  private static let rampRate: Float = 8.0

  // The same list as in expo-camera (ios/Common/DeviceDiscovery.swift:20-41),
  // and that's not cosmetic: the app picks its camera via `selectedLens`,
  // expo-camera compares `localizedName` there. What isn't found here can't
  // be selected there, and the other way round.
  private static var deviceTypes: [AVCaptureDevice.DeviceType] {
    var types: [AVCaptureDevice.DeviceType] = [
      .builtInWideAngleCamera,
      .builtInTelephotoCamera,
      .builtInUltraWideCamera,
      .builtInTrueDepthCamera,
      .builtInTripleCamera,
      .builtInDualCamera,
      .builtInDualWideCamera
    ]
    if #available(iOS 15.4, *) {
      types.append(.builtInLiDARDepthCamera)
    }
    return types
  }

  // The observer for resetting focus (see `focus` below). Static because the
  // module's helper functions are static; there is at most one of it,
  // OnCreate/OnDestroy keep it balanced.
  private static var sceneObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("CameraZoom")

    // Tap-to-focus needs its way back: after a set point, focus stays there
    // until the scene changes noticeably, then AVFoundation reports in
    // (subject-area monitoring is switched on in `focus`) and it goes back to
    // continuous over the center. That's the pattern from Apple's AVCam
    // sample and the Camera app.
    OnCreate {
      Self.sceneObserver = NotificationCenter.default.addObserver(
        forName: .AVCaptureDeviceSubjectAreaDidChange,
        object: nil,
        queue: .main
      ) { notification in
        guard let device = notification.object as? AVCaptureDevice else {
          return
        }
        Self.resetFocus(device)
      }
    }

    OnDestroy {
      if let observer = Self.sceneObserver {
        NotificationCenter.default.removeObserver(observer)
        Self.sceneObserver = nil
      }
    }

    // All cameras of one facing direction. Virtual devices (triple, dual
    // camera) carry their parts and the factors at which iOS switches from
    // one lens to the next, from which the steps of the row arise, see
    // zoom.ts.
    Function("lenses") { (position: String) -> [[String: Any]] in
      Self.devices(position: position).map { device in
        [
          "name": device.localizedName,
          "type": Self.type(device.deviceType),
          "parts": device.constituentDevices.map { Self.type($0.deviceType) },
          "switchPoints": device.virtualDeviceSwitchOverVideoZoomFactors.map { $0.doubleValue }
        ]
      }
    }

    // The device's actual allowed bounds, in its own counting: on a camera
    // with an ultra-wide lens, `min` = 1.0 is what the UI calls 0.5x.
    Function("zoomLimits") { (name: String) -> [String: Double]? in
      guard let device = Self.device(name: name) else {
        return nil
      }
      return [
        "min": Double(device.minAvailableVideoZoomFactor),
        "max": Double(device.maxAvailableVideoZoomFactor)
      ]
    }

    // `smooth` ramps in like the Camera app (for a tap on a step), otherwise
    // it's set hard: the pinch should follow the finger, not trail behind it.
    Function("setZoom") { (name: String, factor: Double, smooth: Bool) in
      guard let device = Self.device(name: name) else {
        return
      }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }

        let target = min(
          max(CGFloat(factor), device.minAvailableVideoZoomFactor),
          device.maxAvailableVideoZoomFactor
        )
        // Ends a ramp that's still running. Without this a tap would keep
        // pulling while the finger is already pulling again.
        device.cancelVideoZoomRamp()
        if smooth {
          device.ramp(toVideoZoomFactor: target, withRate: Self.rampRate)
        } else {
          device.videoZoomFactor = target
        }
      } catch {
        // The camera currently belongs to someone else (a call, another
        // app). A zoom that's stuck is the more harmless outcome compared to
        // a crash; the next interaction sets it again anyway.
      }
    }

    // Tap-to-focus: focus once, exposure continuously on the point, in
    // window points (pageX/pageY). Why this lives here too: expo-camera only
    // knows the global autoFocus mode, no focus point.
    //
    // The conversion into device coordinates is done by the preview layer
    // itself (captureDevicePointConverted knows orientation, mirroring and
    // the aspect-fill crop, recomputing it by hand would make each of these
    // three spots its own bug candidate). The layer belongs to expo-camera:
    // its CameraView IS its preview layer (layerClass), found via the view
    // hierarchy, the app has at most one viewfinder. Main queue, because the
    // UIKit hierarchy and layer geometry live there.
    AsyncFunction("focus") { (x: Double, y: Double) in
      guard
        let viewfinder = Self.viewfinderView(),
        let layer = viewfinder.layer as? AVCaptureVideoPreviewLayer,
        let device = layer.session?.inputs
          .compactMap({ ($0 as? AVCaptureDeviceInput)?.device })
          .first(where: { $0.hasMediaType(.video) })
      else {
        return
      }
      let inViewfinder = viewfinder.convert(CGPoint(x: x, y: y), from: nil)
      let point = layer.captureDevicePointConverted(fromLayerPoint: inViewfinder)

      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        // The point MUST be set before the mode: the mode switch kicks off
        // the measurement, and it should already see the new point.
        if device.isFocusPointOfInterestSupported {
          device.focusPointOfInterest = point
        }
        if device.isFocusModeSupported(.autoFocus) {
          device.focusMode = .autoFocus
        }
        if device.isExposurePointOfInterestSupported {
          device.exposurePointOfInterest = point
        }
        // Unlike focus, continuous rather than one-shot: .autoExpose
        // measures exactly once and then holds the exposure. If the light
        // then changes (especially in video), the image stays wrongly
        // exposed until the scene reset kicks in. The Camera app keeps
        // measuring on the point after a tap.
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        } else if device.isExposureModeSupported(.autoExpose) {
          device.exposureMode = .autoExpose
        }
        // From here on the scene reports in when it changes, the observer
        // in OnCreate then resets to continuous.
        device.isSubjectAreaChangeMonitoringEnabled = true
      } catch {
        // As with zoom: an unset focus is more harmless than a crash, the
        // next tap tries again.
      }
    }.runOnQueue(.main)
  }

  // Back to what applied before the tap: continuous focus and continuous
  // exposure over the image center, monitoring off again.
  private static func resetFocus(_ device: AVCaptureDevice) {
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      let center = CGPoint(x: 0.5, y: 0.5)
      if device.isFocusPointOfInterestSupported {
        device.focusPointOfInterest = center
      }
      if device.isFocusModeSupported(.continuousAutoFocus) {
        device.focusMode = .continuousAutoFocus
      }
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = center
      }
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
      device.isSubjectAreaChangeMonitoringEnabled = false
    } catch {
      // See above: a stuck focus beats a crash.
    }
  }

  // The view whose layer draws the camera preview (expo-camera's
  // CameraView). Searched across all windows, not just the key window:
  // during a system dialog another window is in front.
  private static func viewfinderView() -> UIView? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    for window in windows {
      if let match = viewfinderView(in: window) {
        return match
      }
    }
    return nil
  }

  private static func viewfinderView(in view: UIView) -> UIView? {
    if view.layer is AVCaptureVideoPreviewLayer {
      return view
    }
    for child in view.subviews {
      if let match = viewfinderView(in: child) {
        return match
      }
    }
    return nil
  }

  private static func devices(position: String) -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: deviceTypes,
      mediaType: .video,
      position: position == "front" ? .front : .back
    ).devices
  }

  // Looks up by the same localized name expo-camera uses to pick its lens.
  // AVFoundation hands out the same object per camera, so this reaches
  // exactly the device that's currently running in the session.
  private static func device(name: String) -> AVCaptureDevice? {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: deviceTypes,
      mediaType: .video,
      position: .unspecified
    ).devices.first { $0.localizedName == name }
  }

  private static func type(_ deviceType: AVCaptureDevice.DeviceType) -> String {
    switch deviceType {
    case .builtInUltraWideCamera: return "ultraWide"
    case .builtInWideAngleCamera: return "wide"
    case .builtInTelephotoCamera: return "telephoto"
    case .builtInTrueDepthCamera: return "trueDepth"
    case .builtInTripleCamera: return "triple"
    case .builtInDualCamera: return "dual"
    case .builtInDualWideCamera: return "dualWide"
    default: return "unknown"
    }
  }
}
