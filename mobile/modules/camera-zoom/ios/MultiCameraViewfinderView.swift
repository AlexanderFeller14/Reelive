import AVFoundation
import ExpoModulesCore
import UIKit

// The viewfinder area of the MultiCam path: one preview layer per camera,
// stacked on top of each other, exactly one is visible (spec §3). A camera
// switch only blends between them; the layers themselves stay connected and
// keep running.
//
// The layers come into being here WITHOUT a session binding. They get
// connected by the module that owns the session: it calls
// setSessionWithNoConnection and builds the manual AVCaptureConnection
// itself (MultiCam doesn't form automatic connections).
final class MultiCameraViewfinderView: ExpoView {
  private var layers: [String: AVCaptureVideoPreviewLayer] = [:]
  // Which camera's layer WOULD be visible; the curtain can still override it.
  private var activeName: String?
  // A preview layer keeps its last frame across stopRunning, and the screens
  // stay mounted while the tabs are swiped: without the curtain, swiping back
  // into the camera showed that stale frame standing for the 300-400ms the
  // restart takes (user finding 2026-08-28, "Standbild vom letzten Frame").
  // The module drops the curtain on stop and lifts it with the first FRESH
  // frame of the restarted session; in between the view is its black stage.
  private var curtainDown = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Black instead of transparent: until the first frame stands (per the
    // probe, 300 to 400ms after start), the area is the screen's dark stage.
    backgroundColor = .black
    for name in MultiCameraModule.cameraNames {
      let previewLayer = AVCaptureVideoPreviewLayer()
      // Fills its bounds, and the SCREEN gives it bounds of exactly the
      // capture's shape (capture/index.tsx): 1080x1920, hung at the top edge
      // of the tab bar. Filling the whole screen cost 18 % of the picture's
      // width on a tall device: the format carries 45,3 degrees across, only
      // 37,7 of them stood on the glass, and the selfie came out visibly
      // narrower than in Apple's camera app (user finding 2026-08-21,
      // measured on device). It went into the recording unseen too, because
      // the writer takes the FULL frame.
      previewLayer.videoGravity = .resizeAspectFill
      // Visibility is set by the module once it knows the active camera.
      previewLayer.isHidden = true
      layer.addSublayer(previewLayer)
      layers[name] = previewLayer
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Without implicit animation: a CALayer animates every frame change on
    // its own, and the viewfinder should stand still on every size change.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for previewLayer in layers.values {
      previewLayer.frame = bounds
    }
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      MultiCameraModule.unregisterViewfinder(self)
    } else {
      MultiCameraModule.registerViewfinder(self)
    }
  }

  func previewLayer(for name: String) -> AVCaptureVideoPreviewLayer? {
    layers[name]
  }

  func allLayers() -> [String: AVCaptureVideoPreviewLayer] {
    layers
  }

  // Exactly one layer visible, and none while the curtain is down.
  func setVisible(_ active: String) {
    activeName = active
    apply()
  }

  func setCurtain(_ down: Bool) {
    curtainDown = down
    apply()
  }

  // Without implicit actions, otherwise CoreAnimation would lay a cross-fade
  // over every camera switch, and that's exactly what this rebuild is meant
  // to get rid of.
  private func apply() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (name, previewLayer) in layers {
      previewLayer.isHidden = curtainDown || name != activeName
    }
    CATransaction.commit()
  }
}
