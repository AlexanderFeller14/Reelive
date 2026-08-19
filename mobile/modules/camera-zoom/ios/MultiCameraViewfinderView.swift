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

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Black instead of transparent: until the first frame stands (per the
    // probe, 300 to 400ms after start), the area is the screen's dark stage.
    backgroundColor = .black
    for name in MultiCameraModule.cameraNames {
      let previewLayer = AVCaptureVideoPreviewLayer()
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

  // Exactly one layer visible. Without implicit actions, otherwise
  // CoreAnimation would lay a cross-fade over every camera switch, and
  // that's exactly what this rebuild is meant to get rid of.
  func setVisible(_ active: String) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (name, previewLayer) in layers {
      previewLayer.isHidden = name != active
    }
    CATransaction.commit()
  }
}
