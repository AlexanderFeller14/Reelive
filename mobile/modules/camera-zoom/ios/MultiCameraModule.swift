import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit

// Our own MultiCam session (spec 2026-08-18): the front, wide-angle and
// ultra-wide-angle cameras run PERMANENTLY in parallel as long as the
// viewfinder stands. A camera switch then only toggles the visibility of the
// preview layers and the distributor's target (one frame), instead of
// swapping the device input as before and waiting for the sensor to spin up
// (300 to 900ms measured).
//
// The state lives static like in CameraCaptureModule: the session should
// outlive the individual view and the module lifecycle, and the distributor
// reaches directly into `CameraCaptureModule.current`.
//
// Setup, zoom and focus follow the proven patterns from MultiCamSondeModule
// (format choice, manual wiring) and CameraZoomModule (ramp, tap-to-focus).
public class MultiCameraModule: Module {
  // The three layers in a fixed order. Dictionaries are unordered, but the
  // build should stay reproducible (front first, so the pricier back side
  // lands on an already-standing budget).
  static let cameraNames = ["front", "wide", "ultrawide"]

  // How fast `setZoom(smooth:)` ramps in, in doublings per second. The same
  // value as in the CameraZoom module, so the tap onto a zoom step feels the
  // same on both paths.
  private static let rampRate: Float = 8.0

  // Everything that builds or spins up the session runs here: per the probe,
  // `startRunning` blocks for 300 to 400ms and has no business on Main.
  private static let sessionQueue = DispatchQueue(label: "reelive.multicamera.session")
  // ONE single queue for all three video outputs: this way the buffers
  // arrive serialized at the distributor, and a camera switch can't push two
  // streams into the same writer at once.
  private static let videoQueue = DispatchQueue(label: "reelive.multicamera.video")
  private static let audioQueue = DispatchQueue(label: "reelive.multicamera.audio")
  // Encoding and writing the photo run HERE, never on videoQueue: there,
  // every millisecond costs frames from all three streams. `userInitiated`,
  // because a pressed shutter is waiting at the other end.
  private static let photoQueue = DispatchQueue(
    label: "reelive.multicamera.photo", qos: .userInitiated
  )
  // A single context for all photos: building it is expensive (shaders,
  // buffers), and Apple says it's thread-safe.
  private static let photoContext = CIContext()

  // How long to wait after firing before grabbing: exposure trails the
  // light, a frame grabbed immediately would be as dark as one without
  // flash.
  private static let flashLeadMs = 150
  // Deadline for the grab. If no frame arrives within this time
  // (interrupted session, disabled connection), the promise rejects instead
  // of leaving the shutter stuck in the running cycle forever.
  private static let photoDeadlineMs = 1000

  private static var session: AVCaptureMultiCamSession?
  // Devices, inputs, outputs and connections are written EXCLUSIVELY on the
  // session queue: on setup and on teardown. Within the session queue they
  // can be read freely, the distributor does so per frame on the video
  // queue; it only runs once setup has committed, and teardown drains its
  // queue before it clears. What must NOT be relied on is who's looking in
  // from Main or the JS thread: the viewfinder accepts gestures right away,
  // the first setup takes 300-400ms, a double tap or zoom within that window
  // would hit the dictionaries mid-mutation (final review 2026-08-19,
  // Important 1). For these callers the rule is therefore: only read
  // `devices` and `session` via device(for:)/runningSession(): both check
  // the ready flag under stateLock, and the two fields' write sites take the
  // same lock.
  private static var devices: [String: AVCaptureDevice] = [:]
  private static var inputs: [String: AVCaptureDeviceInput] = [:]
  private static var videoOutputs: [String: AVCaptureVideoDataOutput] = [:]
  private static var outputConnections: [String: AVCaptureConnection] = [:]
  private static var previewConnections: [String: AVCaptureConnection] = [:]
  private static var audioInput: AVCaptureDeviceInput?
  private static var audioOutput: AVCaptureAudioDataOutput?
  // Reverse lookup for the distributor: which output belongs to which
  // camera. One dictionary access per frame instead of three object
  // comparisons.
  static var outputNames: [ObjectIdentifier: String] = [:]
  private static var distributor: MultiCameraDistributor?

  // The viewfinder view registers itself (didMoveToWindow). Weak, because it
  // belongs to React Native; the module outlives it.
  static weak var viewfinder: MultiCameraViewfinderView?

  // Whether the session SHOULD be running. Separates "just interrupted" from
  // "deliberately stopped": after an interruption it's only spun up again if
  // the viewfinder is even still open.
  private static var shouldRun = false

  private static var pressureObservation: NSKeyValueObservation?
  private static var interruptionEndObserver: NSObjectProtocol?
  private static weak var instance: MultiCameraModule?

  // The thermal safety circuit (spec §8) in three levels, as it also goes to
  // JavaScript via the event.
  enum PressureLevel: String {
    case nominal
    // Raw values pinned to the pre-existing wire strings on purpose: only
    // the Swift-side case identifiers move to English here, the actual
    // bytes sent over the bridge (`level.rawValue`, TS `PressureLevel =
    // 'nominal' | 'ernst' | 'kritisch'`) stay untouched, the other way
    // round from the `wide`/`ultrawide` camera names below (there the wire
    // value itself moves, here it deliberately doesn't).
    case serious = "ernst"
    case critical = "kritisch"
  }

  // Protects the state that several threads touch: the distributor reads
  // `activeCamera` per frame on the video queue, the switch writes it on
  // Main, `setZoom` comes from the JS thread.
  private static let stateLock = NSLock()
  private static var _activeCamera = "wide"
  private static var _lastBack = "wide"
  private static var _pressureLevel = PressureLevel.nominal
  // Whether the continuous light SHOULD be burning. The wish is kept
  // separate from the switching, because both arrive at different times and
  // on different queues: the wish comes from the JS thread, the cameras'
  // arrangement changes from the switch (see applyFlash).
  private static var _flashWanted = false
  // Whether the streams SHOULD be stabilized. Kept as a wish for the same
  // reason as _flashWanted: the call arrives on the JS thread, the
  // connections change on the session queue (attach), so the module holds
  // the wish and re-applies it on every session build.
  private static var _stabilizationWanted = true
  // Whether the session is delivering frames RIGHT NOW: set after
  // startRunning, cleared before stopRunning. Under the stateLock because
  // the distributor reads it per frame on the video queue while stop/start
  // write it on the session queue. Distinct from `shouldRun` (the wish,
  // session queue only) and from `ready` (the session is BUILT, which
  // survives a stop).
  private static var _sessionRunning = false
  // Whether the viewfinder is covered. A preview layer keeps its last frame
  // across stopRunning, and the screens stay mounted while the tabs are
  // swiped: without the curtain, swiping back into the camera showed that
  // stale frame standing for the 300-400ms the restart takes (user finding
  // 2026-08-28). Stop drops the curtain, the first FRESH frame of the
  // restarted session lifts it (liftCurtainOnFrame). The straggler guard is
  // `_sessionRunning`: a frame still in flight after stop must not lift the
  // curtain onto its own stale image. The flag deliberately survives
  // teardown, like the stabilization wish: it describes the VIEW, and the
  // view outlives the session.
  private static var _curtainDown = false
  // The open photo request (spec §6). It's placed by the JS call and
  // fulfilled by the distributor on the video queue, so it sits between two
  // threads: hence under the same stateLock as the other small shared
  // values. A lock of its own would be a second one with no second purpose;
  // it's held only for the assignment, never across the request being
  // called.
  //
  // Why it lives on the module and not the distributor: the distributor is
  // recreated on every session setup, a request parked there would silently
  // get lost on a rebuild. The number tells two requests apart so that a
  // late deadline doesn't sweep away the NEXT shutter's request.
  private static var _photoRequest: ((CMSampleBuffer) -> Void)?
  private static var _photoRequestNumber: UInt64 = 0

  // Whether the session is fully built and published. Set at the end of
  // ensureSession, taken on teardown and on a failed setup. As long as it's
  // missing, entries from Main and the JS thread reject (switchCamera) or
  // fizzle silently (zoom, focus), instead of reading half-built state.
  private static var _ready = false

  private static var ready: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return _ready
  }

  static var activeCamera: String {
    stateLock.lock()
    defer { stateLock.unlock() }
    return _activeCamera
  }

  // A layer's device for callers OUTSIDE the session queue (zoom from the JS
  // thread, focus on Main): under the lock and only once the session is
  // ready; an unguarded look into `devices` would otherwise run into the
  // setup's mutation. The session queue itself keeps reading directly.
  private static func device(for name: String) -> AVCaptureDevice? {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard _ready else { return nil }
    return devices[name]
  }

  // The published session for looks from outside the session queue, by the
  // same rule as device(for:).
  private static func runningSession() -> AVCaptureMultiCamSession? {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard _ready else { return nil }
    return session
  }

  // Whether the session has an audio connection, by the same rule:
  // startRecording asks on Main, audioOutput is written on the session queue
  // (setup before the ready flag, teardown after).
  private static func audioConnected() -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard _ready else { return false }
    return audioOutput?.connection(with: .audio) != nil
  }

  private static var flashWanted: Bool {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return _flashWanted
    }
    set {
      stateLock.lock()
      _flashWanted = newValue
      stateLock.unlock()
    }
  }

  private static var stabilizationWanted: Bool {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return _stabilizationWanted
    }
    set {
      stateLock.lock()
      _stabilizationWanted = newValue
      stateLock.unlock()
    }
  }

  private static var pressureLevel: PressureLevel {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return _pressureLevel
    }
    set {
      stateLock.lock()
      _pressureLevel = newValue
      stateLock.unlock()
    }
  }

  public func definition() -> ModuleDefinition {
    Name("MultiCamera")

    // The safety circuit reports to the screen through this: at 'serious'
    // the ultra-wide falls away, the screen pulls its zoom back to 1.
    Events("pressureChanged")

    OnCreate { [weak self] in
      MultiCameraModule.instance = self
    }

    // Module gone (app restart, Metro reload) means session gone: otherwise
    // an orphaned session would keep holding the cameras, and the rebuild
    // would never get them back. Only the registered instance may tear
    // down: on a reload the new one can already be standing before the old
    // one is destroyed, and it shouldn't have the fresh session pulled out
    // from under it.
    OnDestroy { [weak self] in
      guard MultiCameraModule.instance === self else { return }
      MultiCameraModule.instance = nil
      MultiCameraModule.tearDown()
    }

    // The JS side's switch. Synchronous, because the screen needs it
    // already on the first render (MultiCameraViewfinder or CameraView).
    Function("isAvailable") { () -> Bool in
      Self.isAvailable()
    }

    AsyncFunction("start") { (promise: Promise) in
      Self.sessionQueue.async {
        do {
          let session = try Self.ensureSession()
          Self.shouldRun = true
          if !session.isRunning {
            session.startRunning()
          }
          Self.markRunning()
          promise.resolve()
        } catch {
          // The JS side decides on the fallback (two misses in a row means
          // expo-camera for the rest of the session, spec §9).
          promise.reject("aufbau_gescheitert", "\(error)")
        }
      }
    }

    // Only stops the run. The session stays built, so the way back into the
    // viewfinder is just a plain startRunning, not a rebuild.
    AsyncFunction("stop") { (promise: Promise) in
      Self.sessionQueue.async {
        Self.shouldRun = false
        // Curtain BEFORE the halt, `_sessionRunning` in the same locked
        // step: a frame still in flight on the video queue then reads
        // "not running" and leaves the curtain down instead of lifting it
        // onto its own stale image (see _curtainDown).
        Self.stateLock.lock()
        Self._sessionRunning = false
        Self._curtainDown = true
        Self.stateLock.unlock()
        Self.onMain { Self.viewfinder?.setCurtain(true) }
        Self.session?.stopRunning()
        promise.resolve()
      }
    }

    // The double tap. No session rebuild, no input swap: just state,
    // visibility and the distributor target. On Main, because the preview
    // layers' visibility belongs there.
    AsyncFunction("switchCamera") { (promise: Promise) in
      // Within the setup window (the viewfinder accepts gestures right
      // away, the first setup takes 300-400ms) there's nothing to switch:
      // reject instead of promising a direction the session never actually
      // applied, the screen would believe the answer and then permanently
      // sit out of sync with the session, every further double tap would
      // keep the mismatch alive. The JS side turns the rejection into a
      // null and rolls its optimistic switch back.
      guard Self.ready else {
        promise.reject("no_session", "The MultiCam session is not up yet")
        return
      }
      let target = Self.switchTarget()
      Self.setActiveCamera(target)
      // What's resolved is the APPLIED state, not the target: if
      // setActiveCamera bails at its guard, the screen learns the real
      // situation instead of a promise.
      let applied = Self.activeCamera
      promise.resolve(applied == "front" ? "front" : "back")
    }.runOnQueue(.main)

    // `camera` is the target from multiCamTarget (front | wide | ultrawide).
    // If it's on the other BACK layer, that layer switches right along: the
    // crossing of the 1x boundary is the same event as a camera switch.
    Function("setZoom") { (camera: String, factor: Double, smooth: Bool) in
      Self.setZoom(camera: camera, factor: factor, smooth: smooth)
    }

    // Tap-to-focus on the ACTIVE device. The window-to-device conversion is
    // done by the matching preview layer itself (it knows orientation,
    // mirroring and its own gravity); unlike in the CameraZoom module
    // this needs no search through the view hierarchy, the module holds the
    // layers. Resetting after a scene change is handled by the existing
    // observer in CameraZoomModule, which listens globally for
    // AVCaptureDeviceSubjectAreaDidChange.
    AsyncFunction("focus") { (x: Double, y: Double) in
      let name = Self.activeCamera
      guard
        let device = Self.device(for: name),
        let viewfinder = Self.viewfinder,
        let previewLayer = viewfinder.previewLayer(for: name)
      else {
        return
      }
      let inViewfinder = viewfinder.convert(CGPoint(x: x, y: y), from: nil)
      let point = previewLayer.captureDevicePointConverted(fromLayerPoint: inViewfinder)

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
        // Exposure continuous, not one-shot: .autoExpose measures exactly
        // once and then holds it, a light change would stay stuck.
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        } else if device.isExposureModeSupported(.autoExpose) {
          device.exposureMode = .autoExpose
        }
        device.isSubjectAreaChangeMonitoringEnabled = true
      } catch {
        // As in the CameraZoom module: an unset focus is more harmless than
        // a crash, the next tap tries again.
      }
    }.runOnQueue(.main)

    // The video recording from THIS session. What's created is the same
    // `Capture` as in CameraCaptureModule.startRecording (same destination
    // in tmp, same writer) and it's hung off its `current`: the distributor
    // above fills it from the next frame on, and `awaitFile`, `discard` as
    // well as the instant preview view stay unchanged, because they all
    // hang off that exact reference. What's missing here compared to the
    // model is only the search for the expo-camera viewfinder: session,
    // outputs and connections belong to this module.
    //
    // On Main like the model, and for the same reason: `current` is READ by
    // both delegate queues per frame and must therefore only ever be
    // written from a single spot, otherwise two modules would write to the
    // same object reference from two queues. The session here is only read
    // (`isRunning`), not rebuilt; it comes in via runningSession() and the
    // audio connection via audioConnected(), both locked and only once
    // setup is done: the earlier direct look from Main into these fields
    // has been revoked since the setup-window gate (see above at `devices`).
    AsyncFunction("startRecording") { (maxSeconds: Double, promise: Promise) in
      // Rejects ONLY if a recording is running that hasn't been stopped
      // yet: a stopped one deliberately stays around (the preview is still
      // playing from its start window) and simply gets replaced here.
      if let existing = CameraCaptureModule.current, !existing.isStopped {
        promise.reject("already_running", "A recording is already running")
        return
      }
      guard let session = Self.runningSession(), session.isRunning else {
        promise.reject("no_session", "The MultiCam session is not running")
        return
      }
      do {
        let destination = FileManager.default.temporaryDirectory
          .appendingPathComponent("reelive-\(UUID().uuidString).mov")
        // withAudio hangs off the CONNECTION, not the output (pattern from
        // CameraCaptureModule): without microphone permission the output
        // stays attached but never delivers a buffer, and an empty audio
        // input would describe the file wrongly.
        let capture = try Capture(
          destination: destination, maxSeconds: maxSeconds,
          withAudio: Self.audioConnected()
        )
        CameraCaptureModule.current = capture
        promise.resolve()
      } catch {
        promise.reject("start_gescheitert", error.localizedDescription)
      }
    }.runOnQueue(.main)

    // Stops the same recording no matter who started it: there's only ever
    // one in the process (`CameraCaptureModule.current`). Also on Main, for
    // the reason above.
    AsyncFunction("stopRecording") { (promise: Promise) in
      guard let capture = CameraCaptureModule.current else {
        promise.reject("no_recording", "No recording is running")
        return
      }
      capture.stop()
      promise.resolve([
        "uri": capture.destination.absoluteString,
        "durationS": capture.durationS,
      ])
    }.runOnQueue(.main)

    // The photo for this path (spec §6): a grab from the running stream.
    // The session gets NO second output for it: an AVCapturePhotoOutput
    // would be extra hardware load with three streams already running, and
    // its own capture would bring back exactly the wait this path just
    // abolished. The image is therefore the next frame of the active
    // camera, which the distributor hands to the parked request.
    AsyncFunction("takePhoto") { (flash: Bool, promise: Promise) in
      Self.takePhoto(flash: flash, promise: promise)
    }

    // The continuous light for video (the `enableTorch` prop in the
    // expo-camera branch). Synchronous like `setZoom`: the call only notes
    // the WISH, the switching happens on the session queue (see
    // applyFlash).
    Function("flash") { (on: Bool) in
      Self.flashWanted = on
      Self.applyFlash()
    }

    // Video stabilization for all output connections; the photo path
    // inherits it, its image is a grab from the same stream. Synchronous
    // like `flash`: the call only notes the WISH, the switching happens on
    // the session queue (see applyStabilization).
    Function("stabilization") { (on: Bool) in
      Self.stabilizationWanted = on
      Self.applyStabilization()
    }

    View(MultiCameraViewfinderView.self) {
      ViewName("MultiCameraViewfinder")
    }
  }

  // MARK: - Availability

  static func isAvailable() -> Bool {
    guard AVCaptureMultiCamSession.isMultiCamSupported else { return false }
    let found = findDevices()
    return found["front"] != nil && found["wide"] != nil
  }

  // The ultra-wide is allowed to be missing (spec §9): then the session runs
  // with two cameras and the zoom limit sits at 1x.
  private static func findDevices() -> [String: AVCaptureDevice] {
    var found: [String: AVCaptureDevice] = [:]
    if let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) {
      found["front"] = front
    }
    if let wide = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) {
      found["wide"] = wide
    }
    if let ultraWide = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) {
      found["ultrawide"] = ultraWide
    }
    return found
  }

  // MARK: - Session setup

  // Builds on the first call, only looks up afterwards. Runs on the session
  // queue.
  private static func ensureSession() throws -> AVCaptureMultiCamSession {
    if let existing = session {
      return existing
    }
    guard AVCaptureMultiCamSession.isMultiCamSupported else {
      throw MultiCameraError(reason: "MultiCam is not supported on this device")
    }
    let found = findDevices()
    guard found["front"] != nil, found["wide"] != nil else {
      throw MultiCameraError(reason: "front or wide-angle camera is missing")
    }
    // Under the lock even though we're on the session queue: device(for:)
    // reads this same field from Main and the JS thread under exactly this
    // lock, an unlocked write here would run right past those readers.
    stateLock.lock()
    devices = found
    stateLock.unlock()
    distributor = MultiCameraDistributor()

    let newSession = AVCaptureMultiCamSession()
    do {
      try build(newSession)
    } catch {
      // Don't leave a half-built session standing: the next attempt should
      // start at zero, not keep building on leftovers.
      clearState()
      throw error
    }
    stateLock.lock()
    session = newSession
    stateLock.unlock()
    attachObservers(newSession)
    applyState(active: activeCamera)
    // Only now, with the session fully committed and the observers
    // attached, does the ready flag open the entries from Main and the JS
    // thread.
    stateLock.lock()
    _ready = true
    stateLock.unlock()
    return newSession
  }

  private static func build(_ session: AVCaptureMultiCamSession) throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    // Front and wide-angle are mandatory, without them there's no MultiCam
    // path.
    for name in ["front", "wide"] {
      guard let device = devices[name] else {
        throw MultiCameraError(reason: "\(name): camera is missing")
      }
      try attach(device, to: session, as: name)
    }
    // The ultra-wide is the bonus: on devices that only allow two
    // simultaneous streams, the third one is what fails. It then gets
    // cleanly detached again and the session keeps running with two (spec
    // §9).
    if let ultraWide = devices["ultrawide"] {
      do {
        try attach(ultraWide, to: session, as: "ultrawide")
      } catch {
        detach("ultrawide", from: session)
        stateLock.lock()
        devices["ultrawide"] = nil
        stateLock.unlock()
      }
    }

    connectPreview(session)
    attachMicrophone(session)
  }

  // Attaches one camera with its own video output and manual connection.
  // MultiCam sessions don't form connections automatically in a useful way,
  // Apple's pattern is addInputWithNoConnections / addOutputWithNoConnections
  // plus an explicit AVCaptureConnection (proven on-device in the phase-0
  // probe).
  private static func attach(
    _ device: AVCaptureDevice,
    to session: AVCaptureMultiCamSession,
    as name: String
  ) throws {
    guard let format = chooseFormat(device) else {
      throw MultiCameraError(reason: "\(name): no MultiCam format")
    }
    try device.lockForConfiguration()
    // Its own block with defer (the file's pattern, see focus and setZoom):
    // this way the camera doesn't stay locked even on an error partway
    // through, and the rest of the function works lock-free.
    do {
      defer { device.unlockForConfiguration() }
      device.activeFormat = format
      let fps = min(30.0, format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30.0)
      let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
      device.activeVideoMinFrameDuration = duration
      device.activeVideoMaxFrameDuration = duration
      // Baseline state of all three cameras (spec §7); a tap on a point
      // switches it later, the scene reset comes back here.
      if device.isFocusModeSupported(.continuousAutoFocus) {
        device.focusMode = .continuousAutoFocus
      }
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
    }

    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw MultiCameraError(reason: "\(name): input not allowed")
    }
    session.addInputWithNoConnections(input)
    inputs[name] = input

    let output = AVCaptureVideoDataOutput()
    output.setSampleBufferDelegate(distributor, queue: videoQueue)
    guard session.canAddOutput(output) else {
      throw MultiCameraError(reason: "\(name): output not allowed")
    }
    session.addOutputWithNoConnections(output)
    videoOutputs[name] = output
    outputNames[ObjectIdentifier(output)] = name

    guard let port = videoPort(input, device: device) else {
      throw MultiCameraError(reason: "\(name): no video port")
    }
    let connection = AVCaptureConnection(inputPorts: [port], output: output)
    guard session.canAddConnection(connection) else {
      throw MultiCameraError(reason: "\(name): connection not allowed")
    }
    session.addConnection(connection)
    // Attach first, then orient: on a connection that hasn't been added
    // yet, orientation and mirroring report "not supported".
    orient(connection, front: name == "front")
    // The current wish lands on the fresh connection right away: a session
    // rebuild (Metro reload, tab switch) must not lose it. AVFoundation's
    // default is .off, so only the ON case needs writing.
    if stabilizationWanted, connection.isVideoStabilizationSupported,
      device.activeFormat.isVideoStabilizationModeSupported(.standard)
    {
      connection.preferredVideoStabilizationMode = .standard
    }
    outputConnections[name] = connection
  }

  // Connects the viewfinder view's preview layers to the session. Called on
  // setup and again when the view arrives later (remount after a Metro
  // reload, tab switch). The caller brackets the session configuration.
  private static func connectPreview(_ session: AVCaptureMultiCamSession) {
    // Belongs on the session queue: the layer binding further below reaches
    // through to Main synchronously, a call FROM Main would hang on the
    // spot.
    precondition(
      !Thread.isMainThread, "connectPreview belongs on the session queue, never on Main"
    )
    for connection in previewConnections.values where session.connections.contains(connection) {
      session.removeConnection(connection)
    }
    previewConnections = [:]

    // CoreAnimation belongs to the main thread, so does the layers' session
    // binding therefore. Synchronous, because the connections come into
    // being right after; Main never waits on the session queue, so this
    // can't turn into a deadlock.
    let layers: [String: AVCaptureVideoPreviewLayer] = DispatchQueue.main.sync {
      guard let viewfinder = viewfinder else { return [:] }
      let found = viewfinder.allLayers()
      // Without this binding the session won't accept a manual preview
      // connection (Apple's MultiCam pattern).
      for previewLayer in found.values {
        previewLayer.setSessionWithNoConnection(session)
      }
      return found
    }

    for (name, previewLayer) in layers {
      guard
        let input = inputs[name],
        let device = devices[name],
        let port = videoPort(input, device: device)
      else {
        continue
      }
      let connection = AVCaptureConnection(inputPort: port, videoPreviewLayer: previewLayer)
      guard session.canAddConnection(connection) else { continue }
      session.addConnection(connection)
      orient(connection, front: name == "front")
      previewConnections[name] = connection
    }
  }

  // One microphone input, one audio output, one connection. The microphone
  // stays attached as long as the viewfinder stands (spec §3): this way the
  // recording start doesn't stutter through a session rebuild. Missing
  // permission means the session keeps running without audio instead of
  // failing (pattern from attachOutputs).
  private static func attachMicrophone(_ session: AVCaptureMultiCamSession) {
    guard
      let microphone = AVCaptureDevice.default(for: .audio),
      let input = try? AVCaptureDeviceInput(device: microphone),
      session.canAddInput(input)
    else {
      return
    }
    session.addInputWithNoConnections(input)
    audioInput = input

    let output = AVCaptureAudioDataOutput()
    output.setSampleBufferDelegate(distributor, queue: audioQueue)
    guard session.canAddOutput(output) else { return }
    session.addOutputWithNoConnections(output)
    // Noted from here on, not only after the connection: otherwise the
    // rollback paths below would leave an output with a set delegate
    // hanging in the session that teardown would never find. Without a
    // connection it never delivers a buffer, and whether there's audio at
    // all is decided by the connection anyway (pattern
    // CameraCaptureModule.startRecording, `withAudio`).
    audioOutput = output

    let ports = input.ports(
      for: .audio, sourceDeviceType: microphone.deviceType, sourceDevicePosition: .unspecified
    )
    guard let port = ports.first ?? input.ports.first else { return }
    let connection = AVCaptureConnection(inputPorts: [port], output: output)
    guard session.canAddConnection(connection) else { return }
    session.addConnection(connection)
  }

  // Detaches everything that's already hanging in the session for one
  // camera.
  private static func detach(_ name: String, from session: AVCaptureMultiCamSession) {
    if let connection = outputConnections.removeValue(forKey: name),
      session.connections.contains(connection)
    {
      session.removeConnection(connection)
    }
    if let connection = previewConnections.removeValue(forKey: name),
      session.connections.contains(connection)
    {
      session.removeConnection(connection)
    }
    if let output = videoOutputs.removeValue(forKey: name) {
      outputNames.removeValue(forKey: ObjectIdentifier(output))
      session.removeOutput(output)
    }
    if let input = inputs.removeValue(forKey: name) {
      session.removeInput(input)
    }
  }

  // Portrait fixed at the connection, front fixed mirrored (spec §3): this
  // way the viewfinder and the recording match without a per-frame align.
  // The portrait guard in the distributor stays as a second line.
  private static func orient(_ connection: AVCaptureConnection, front: Bool) {
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if front, connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = true
    }
  }

  private static func videoPort(
    _ input: AVCaptureDeviceInput, device: AVCaptureDevice
  ) -> AVCaptureInput.Port? {
    input.ports(
      for: .video, sourceDeviceType: device.deviceType, sourceDevicePosition: device.position
    ).first
  }

  // Prefers exactly 1080p30 (our recording format), otherwise the smallest
  // MultiCam format from 720p up. Small formats keep the hardware cost low,
  // and per the probe the budget with three streams is used up to 0.75.
  private static func chooseFormat(_ device: AVCaptureDevice) -> AVCaptureDevice.Format? {
    let multiCam = device.formats.filter { $0.isMultiCamSupported }
    if let exact = multiCam.first(where: { is1080p30($0) }) { return exact }
    return multiCam
      .filter { dimensions($0).height >= 720 }
      .min { area($0) < area($1) } ?? multiCam.first
  }

  private static func is1080p30(_ format: AVCaptureDevice.Format) -> Bool {
    let size = dimensions(format)
    let fps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
    return size.width == 1920 && size.height == 1080 && fps >= 30
  }

  private static func dimensions(_ format: AVCaptureDevice.Format) -> CMVideoDimensions {
    CMVideoFormatDescriptionGetDimensions(format.formatDescription)
  }

  private static func area(_ format: AVCaptureDevice.Format) -> Int {
    let size = dimensions(format)
    return Int(size.width) * Int(size.height)
  }

  // MARK: - Viewfinder view

  // The view registers itself in didMoveToWindow. If the session is already
  // standing, it gets its connections right away; otherwise setup picks
  // them up later.
  static func registerViewfinder(_ view: MultiCameraViewfinderView) {
    viewfinder = view
    sessionQueue.async {
      guard let session = session else { return }
      session.beginConfiguration()
      connectPreview(session)
      session.commitConfiguration()
      applyState(active: activeCamera)
    }
  }

  // When the view leaves the window, its connections go with it: a
  // connection to a layer that's just been released has no recipient left.
  // Only the view that's ACTUALLY registered unregisters itself; on a
  // remount the new view arrives first and mustn't have its fresh
  // connections taken away.
  static func unregisterViewfinder(_ view: MultiCameraViewfinderView) {
    guard viewfinder === view else { return }
    viewfinder = nil
    sessionQueue.async {
      guard let session = session else {
        previewConnections = [:]
        return
      }
      session.beginConfiguration()
      for connection in previewConnections.values where session.connections.contains(connection) {
        session.removeConnection(connection)
      }
      previewConnections = [:]
      session.commitConfiguration()
    }
  }

  // MARK: - Switch

  // Front to back goes back to the last used back layer, back to front
  // remembers it (in setActiveCamera).
  private static func switchTarget() -> String {
    stateLock.lock()
    defer { stateLock.unlock() }
    if _activeCamera == "front" {
      return devices[_lastBack] != nil ? _lastBack : "wide"
    }
    return "front"
  }

  // The whole switch: state, visibility, distributor target. NO
  // beginConfiguration, NO input rebuild, so it costs one frame.
  static func setActiveCamera(_ name: String) {
    stateLock.lock()
    guard _activeCamera != name, devices[name] != nil else {
      stateLock.unlock()
      return
    }
    if name == "front" {
      _lastBack = _activeCamera
    } else {
      _lastBack = name
    }
    _activeCamera = name
    stateLock.unlock()
    applyState(active: name)
    // The continuous light follows along: it hangs off a DEVICE, but only
    // this moment knows the new arrangement. Without this follow-up the
    // lamp would keep burning at the old layer after a switch (front films,
    // the back lights up) or stay off after switching back, until someone
    // touches the switch again.
    applyFlash()
  }

  // Visibility on Main, connection switching on the session queue: both
  // hang off the same question, "which camera is active". The name arrives
  // as a parameter instead of being read fresh here: two almost simultaneous
  // switches would otherwise queue up blocks with swapped values.
  private static func applyState(active: String) {
    onMain { viewfinder?.setVisible(active) }
    sessionQueue.async { applyConnections(active: active) }
  }

  private static func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async(execute: block)
    }
  }

  // MARK: - Zoom

  static func setZoom(camera: String, factor: Double, smooth: Bool) {
    var name = camera
    var target = factor
    // Without an ultra-wide (spec §9) and as long as the safety circuit has
    // switched it off (spec §8), the target silently falls back to the
    // wide-angle at factor 1, i.e. the 1x limit. device(for:) instead of a
    // direct look into `devices`: the call comes from the JS thread (or
    // from the pressure circuit on the session queue) and fizzles within
    // the setup window.
    if name == "ultrawide", device(for: "ultrawide") == nil || pressureLevel != .nominal {
      name = "wide"
      target = 1.0
    }
    guard let device = device(for: name) else { return }

    // Zooming across the 1x boundary switches the BACK layer right along.
    // Only the double tap switches between facing directions: a zoom on the
    // back must not switch a front viewfinder and vice versa.
    let active = activeCamera
    if name != active, name != "front", active != "front" {
      setActiveCamera(name)
    }

    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }

      let clamped = min(
        max(CGFloat(target), device.minAvailableVideoZoomFactor),
        device.maxAvailableVideoZoomFactor
      )
      // Ends a ramp that's still running. Without this a tap would keep
      // pulling while the finger is already pulling again.
      device.cancelVideoZoomRamp()
      if smooth {
        device.ramp(toVideoZoomFactor: clamped, withRate: rampRate)
      } else {
        device.videoZoomFactor = clamped
      }
    } catch {
      // The camera currently belongs to someone else (a call, another
      // app). A zoom that's stuck is more harmless than a crash.
    }
  }

  // MARK: - Flash

  // The LED physically sits on the back, but its switch hangs off the
  // individual device. It's therefore switched on at the ACTIVE back
  // device; if the front is on screen, there's nothing to switch on (the
  // light would fall away behind it), the wish just stays noted.
  //
  // It's switched off, however, at ALL back devices: switching to the front
  // and crossing the 0.5 boundary move the active camera while the light is
  // still hanging off the previously active device. A switch that only
  // found the now-active device would leave the lamp burning.
  //
  // Why this can't hang off the call from JS: `flash` arrives synchronously
  // on the JS thread, the switch runs on Main (`switchCamera`) or on the
  // session queue (`applyPressure`). The screen effect fires after the React
  // commit and can arrive here BEFORE `setActiveCamera` has recorded the
  // new camera: back to front would then still see "wide" and leave the
  // lamp burning while the front films, front to back would still see
  // "front" and leave it off, with no second trigger ever coming. That's
  // why the module holds the WISH and re-applies it itself on every switch
  // (setActiveCamera, applyPressure).
  //
  // Work happens on the session queue, following the pattern of
  // `applyState`: that's where `devices` and the rest of the session state
  // are written, so access from a foreign thread is ruled out entirely.
  // Unlike there, the active camera is read ONLY INSIDE THE BLOCK, not
  // passed in as a parameter: the lamp has no order of its own, it should
  // end up matching whatever was recorded last, and the last-enqueued block
  // sees exactly that. Every change (wish or switch) enqueues its own block
  // after it has written its state.
  private static func applyFlash() {
    sessionQueue.async {
      let active = activeCamera
      let fire = flashWanted && active != "front"
      // Fixed name list with subscript access instead of iterating the
      // dictionary: nothing runs over `cameraNames` that clearState could
      // rebuild at the same time (the same rule as at the top of the file).
      //
      // Turn off first, then fire: the back devices share ONE lamp, a
      // trailing switch-off on the inactive device would otherwise take the
      // light back away from the active one.
      for name in cameraNames where name != "front" && !(fire && name == active) {
        if let device = devices[name] {
          setTorch(device, .off)
        }
      }
      if fire, let device = devices[active] {
        setTorch(device, .on)
      }
    }
  }

  private static func setTorch(_ device: AVCaptureDevice, _ mode: AVCaptureDevice.TorchMode) {
    guard device.hasTorch, device.isTorchModeSupported(mode), device.torchMode != mode else {
      return
    }
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      device.torchMode = mode
    } catch {
      // As with zoom: the camera currently belongs to someone else (a call,
      // another app). A lamp that didn't switch is more harmless than a
      // crash.
    }
  }

  // MARK: - Stabilization

  // `.standard` only, never `.auto`: auto may pick a cinematic mode, and
  // those buffer frames up to about a second. Poison for this path, whose
  // photo is the NEXT frame of the stream and whose flash lead is
  // calibrated to 150 ms (takePhoto). `.standard` stabilizes in hardware
  // with minimal latency.
  //
  // All output connections are treated alike (the flash pattern, no case
  // per active camera). The preview connections stay untouched on
  // purpose: stabilizing them would cost extra budget, and Apple's own
  // camera app shows the same viewfinder-versus-recording discrepancy.
  // Work happens on the session queue, where the connections are written;
  // fixed name list with subscript access, the same rule as applyFlash.
  private static func applyStabilization() {
    sessionQueue.async {
      guard let session = session else { return }
      let wanted = stabilizationWanted
      // One bracket around all cameras: on a RUNNING session every mode
      // assignment triggers its own pipeline transition, and three serial
      // transitions showed up as serial stutter in the viewfinder on
      // device (2026-08-20). Bracketed, the session rebuilds once.
      session.beginConfiguration()
      defer { session.commitConfiguration() }
      for name in cameraNames {
        guard let connection = outputConnections[name],
          connection.isVideoStabilizationSupported,
          let device = devices[name],
          device.activeFormat.isVideoStabilizationModeSupported(.standard)
        else { continue }
        connection.preferredVideoStabilizationMode = wanted ? .standard : .off
      }
    }
  }

  // MARK: - Photo

  // The grab from the running stream. It runs across three queues, and
  // every step sits where its state belongs:
  //   Session queue: the lamp, session state and the wait for the light
  //     (the same rule as at the top of the file).
  //   Video queue (inside the request): ONLY take over the buffer, nothing
  //     else.
  //   Photo queue: encode and write, both low double-digit milliseconds.
  private static func takePhoto(flash: Bool, promise: Promise) {
    sessionQueue.async {
      guard let session = session, session.isRunning else {
        promise.reject("no_session", "The MultiCam session is not running")
        return
      }
      let active = activeCamera
      // The LED sits on the back: there's nothing to fire in front of the
      // front camera (the bright screen is deliberately not part of this
      // path). Without light there's also nothing to wait for, the grab
      // then starts right away.
      guard flash, active != "front", let device = devices[active], device.hasTorch else {
        requestPhoto(withLight: false, promise: promise)
        return
      }
      setTorch(device, .on)
      sessionQueue.asyncAfter(deadline: .now() + .milliseconds(flashLeadMs)) {
        requestPhoto(withLight: true, promise: promise)
      }
    }
  }

  // Places the request and the deadline. Both race against each other,
  // `request` ensures exactly ONE answer goes to the promise.
  private static func requestPhoto(withLight: Bool, promise: Promise) {
    let request = PhotoRequest()
    let number = setPhotoRequest { buffer in
      guard request.claim() else { return }
      guard let image = CMSampleBufferGetImageBuffer(buffer) else {
        restorePhotoLight(withLight)
        promise.reject("kein_bild", "Der Frame trug kein Bild")
        return
      }
      // On the video queue only TAKE OVER happens: the CIImage reference
      // holds the buffer, so it doesn't go back into the pool before the
      // photo queue has read it. The dimensions come along, then this spot
      // is done, any further line here would cost all three streams.
      //
      // The carrier instead of a plain CIImage: an image passed along
      // directly would hang off the closure context and hold the buffer
      // until the END of the block, i.e. across encoding and writing. The
      // rendering takes it out of the carrier and lets it go right away.
      let carrier = PhotoCarrier(CIImage(cvPixelBuffer: image))
      let width = CVPixelBufferGetWidth(image)
      let height = CVPixelBufferGetHeight(image)
      photoQueue.async {
        // Light first, then the work: the LED has served its purpose with
        // the grabbed frame and shouldn't keep burning through the
        // encoding and the writing.
        restorePhotoLight(withLight)
        savePhoto(carrier, width: width, height: height, promise: promise)
      }
    }
    // The deadline: an interrupted session (call, another app) or a
    // disabled connection (pressure level 'critical') never delivers a
    // frame. Without it the shutter would stay stuck in the running cycle
    // forever (photoRunning on the screen), with it it gets the error pill.
    photoQueue.asyncAfter(deadline: .now() + .milliseconds(photoDeadlineMs)) {
      guard request.claim() else { return }
      clearPhotoRequest(number)
      restorePhotoLight(withLight)
      promise.reject("no_frame", "The camera delivered no image")
    }
  }

  // After the grab, the light returns to the WISHED-for state, not hard
  // off: if a video with continuous light is running, a hard off would take
  // the lamp away from it mid-recording. `applyFlash` restores exactly the
  // state the screen last requested, for whichever camera is active by
  // then, so a switch in between is handled along with it.
  private static func restorePhotoLight(_ withLight: Bool) {
    guard withLight else { return }
    applyFlash()
  }

  // Encode and write, on the photo queue.
  private static func savePhoto(
    _ carrier: PhotoCarrier, width: Int, height: Int, promise: Promise
  ) {
    // The rendering sits in its own, tight scope: after it, NOTHING holds
    // the frame anymore, and the buffer goes back into the active camera's
    // pool. Otherwise it would be missing there across the encoding and the
    // writing, two to three frame intervals together, and the camera would
    // have to fall back to a different buffer during that time or drop
    // frames. The rendered CGImage carries its own pixels, it no longer
    // hangs off the buffer.
    //
    // No second mirroring and no rotation: portrait and the front's
    // mirroring are fixed at the connection (see `orient`), so the buffer
    // already arrives looking the way the image should.
    let rendered: CGImage? = {
      guard let source = carrier.take() else { return nil }
      return photoContext.createCGImage(source, from: source.extent)
    }()
    guard
      let image = rendered,
      let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.9)
    else {
      promise.reject("kein_jpeg", "Der Frame liess sich nicht als JPEG kodieren")
      return
    }
    let destination = FileManager.default.temporaryDirectory
      .appendingPathComponent("reelive-photo-\(UUID().uuidString).jpg")
    do {
      try data.write(to: destination, options: .atomic)
      // absoluteString like the video recording: the JS side gets file://
      // URIs throughout, never bare paths.
      promise.resolve(["uri": destination.absoluteString, "width": width, "height": height])
    } catch {
      promise.reject("nicht_gespeichert", error.localizedDescription)
    }
  }

  private static func setPhotoRequest(_ request: @escaping (CMSampleBuffer) -> Void) -> UInt64 {
    stateLock.lock()
    defer { stateLock.unlock() }
    _photoRequestNumber &+= 1
    _photoRequest = request
    return _photoRequestNumber
  }

  // Clears the request, but only if it's still THIS one: a late deadline
  // must not take away the next shutter's request.
  private static func clearPhotoRequest(_ number: UInt64) {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard _photoRequestNumber == number else { return }
    _photoRequest = nil
  }

  // Every startRunning site marks the run under the lock: the distributor
  // reads it per frame as the straggler guard for the curtain.
  private static func markRunning() {
    stateLock.lock()
    _sessionRunning = true
    stateLock.unlock()
  }

  // Called by the distributor per frame of the ACTIVE camera: the first
  // fresh frame after a restart lifts the curtain (see _curtainDown). With
  // the curtain up, this is a lock and two bool reads, nothing more.
  static func liftCurtainOnFrame() {
    stateLock.lock()
    guard _curtainDown, _sessionRunning else {
      stateLock.unlock()
      return
    }
    _curtainDown = false
    stateLock.unlock()
    onMain { viewfinder?.setCurtain(false) }
  }

  // Called by the distributor per frame of the ACTIVE camera: if a request
  // is parked, it gets exactly this frame and is thereby fulfilled. Called
  // outside the lock, the lock only carries the assignment.
  static func fulfillPhotoRequest(_ buffer: CMSampleBuffer) {
    stateLock.lock()
    let request = _photoRequest
    _photoRequest = nil
    stateLock.unlock()
    request?(buffer)
  }

  // MARK: - Observers

  private static func attachObservers(_ newSession: AVCaptureMultiCamSession) {
    // System pressure is measured on the wide-angle: it always runs, and
    // per the probe it saw 0.90 of the 1.0 budget with three streams. The
    // safety circuit is therefore a mandatory part (spec §8).
    if let wide = devices["wide"] {
      pressureObservation = wide.observe(
        \.systemPressureState, options: [.initial, .new]
      ) { _, change in
        guard let state = change.newValue else { return }
        let level = levelFrom(state.level)
        sessionQueue.async { applyPressure(level) }
      }
    }

    // Only the END of an interruption needs an observer of its own: a
    // running recording is already stopped by the global observer in
    // CameraCaptureModule (object: nil), which sees our session too.
    interruptionEndObserver = NotificationCenter.default.addObserver(
      forName: .AVCaptureSessionInterruptionEnded,
      object: newSession,
      queue: nil
    ) { _ in
      sessionQueue.async {
        // Only spin up again if the viewfinder is even still open: after a
        // tab switch into the background the camera should stay off.
        guard shouldRun, let session = session, !session.isRunning else { return }
        session.startRunning()
        markRunning()
      }
    }
  }

  private static func levelFrom(_ level: AVCaptureDevice.SystemPressureState.Level) -> PressureLevel {
    switch level {
    case .serious: return .serious
    case .critical, .shutdown: return .critical
    default: return .nominal
    }
  }

  // Runs on the session queue.
  private static func applyPressure(_ level: PressureLevel) {
    guard level != pressureLevel else { return }
    pressureLevel = level
    // From 'serious' on, the ultra-wide is off: if it was active, the
    // wide-angle at factor 1 takes its place (the viewfinder jumps from
    // 0.5x to 1x, spec §8).
    if level != .nominal, activeCamera == "ultrawide" {
      setActiveCamera("wide")
      setZoom(camera: "wide", factor: 1.0, smooth: false)
      // Second line and at no cost (setTorch only switches on a real
      // difference): the follow-up is already built into setActiveCamera,
      // which can, however, exit at its guard. Then the lamp would keep
      // hanging off the layer that this level is switching off right now.
      applyFlash()
    }
    applyConnections(active: activeCamera)
    onMain { instance?.sendEvent("pressureChanged", ["level": level.rawValue]) }
  }

  // Which streams are allowed to run. Switching off a connection needs no
  // session rebuild, but it costs system pressure right away (spec §8).
  // Runs on the session queue, where the connection dictionaries are also
  // written.
  private static func applyConnections(active: String) {
    let level = pressureLevel
    for name in cameraNames {
      var on = true
      // From 'serious' on, the ultra-wide falls away (it's the most
      // expensive stream and only visible under 1x anyway).
      if name == "ultrawide", level != .nominal {
        on = false
      }
      // From 'critical' on, additionally the whole inactive facing
      // direction: the switch then costs a sensor spin-up again, that's the
      // deliberate price for not throttling.
      if level == .critical, (name == "front") != (active == "front") {
        on = false
      }
      outputConnections[name]?.isEnabled = on
      previewConnections[name]?.isEnabled = on
    }
  }

  // MARK: - Teardown

  // The whole teardown sits on the session queue, not just the stop: it
  // writes the same dictionaries that the distributor reads per frame and
  // focus reads on Main. If cleared from Main (OnDestroy runs there), every
  // Metro reload would be a write/read race on a Swift dictionary, and that
  // doesn't end at a wrong value, it ends in corrupted memory.
  private static func tearDown() {
    sessionQueue.async {
      pressureObservation?.invalidate()
      pressureObservation = nil
      if let observer = interruptionEndObserver {
        NotificationCenter.default.removeObserver(observer)
        interruptionEndObserver = nil
      }

      // Flag first: from here on device(for:)/runningSession() answer with
      // nil, no new look from Main or JS lands inside the teardown anymore.
      // `_sessionRunning` goes along so a straggler frame can't lift the
      // curtain during the drain; `_curtainDown` itself survives, it
      // describes the view, and the view outlives the session.
      stateLock.lock()
      _ready = false
      _sessionRunning = false
      let old = session
      session = nil
      stateLock.unlock()
      shouldRun = false
      // stopRunning blocks until the streams have stopped: after the halt
      // no NEW captureOutput call can begin.
      old?.stopRunning()
      for output in videoOutputs.values {
        output.setSampleBufferDelegate(nil, queue: nil)
      }
      audioOutput?.setSampleBufferDelegate(nil, queue: nil)
      let oldDistributor = distributor

      // The order is the whole point: nil the delegates first (above), then
      // let the two delegate queues drain, ONLY THEN clear the shared
      // state. Neither `stopRunning` nor `setSampleBufferDelegate(nil, …)`
      // wait for a call that's already enqueued: it still reads
      // `outputNames` in the distributor and calls the distributor itself,
      // which AVFoundation only holds unowned(unsafe). One hop each over
      // the video and audio queue means every such call has gone through.
      // Clearing happens from there back on the session queue, since this
      // state is written there exclusively.
      videoQueue.async {
        audioQueue.async {
          withExtendedLifetime(oldDistributor) {}
          sessionQueue.async {
            // Only clear if no new session has come into being in the
            // meantime: between teardown and drain a new `start` call could
            // already have rebuilt, and its devices and outputs must not be
            // wiped out here along with it.
            guard session == nil else { return }
            clearState()
          }
        }
      }
    }
  }

  // Only call from the session queue (setup failure and teardown): clears
  // exactly the fields that are read elsewhere without a lock.
  private static func clearState() {
    inputs = [:]
    videoOutputs = [:]
    outputNames = [:]
    outputConnections = [:]
    previewConnections = [:]
    audioInput = nil
    audioOutput = nil
    distributor = nil
    stateLock.lock()
    // Inside the locked part, because device(for:) reads this field from
    // foreign threads under the same lock; the ready flag comes along too
    // (teardown has already taken it, a failed setup only gets it here).
    _ready = false
    devices = [:]
    _activeCamera = "wide"
    _lastBack = "wide"
    _pressureLevel = .nominal
    // The flash wish starts fresh too: a freshly built session shouldn't
    // inherit the lamp of a long-finished recording.
    _flashWanted = false
    // The stabilization wish intentionally survives teardown: the still-mounted
    // screen's effect won't re-fire on a session rebuild, so resetting here
    // would desync native state from the toggle; attach() re-applies the wish.
    // _stabilizationWanted is not reset.
    // An open photo request dies with the session: it's waiting for a frame
    // that's no longer coming. Its promise is resolved by the deadline
    // ("no_frame"), so nobody's left hanging.
    _photoRequest = nil
    stateLock.unlock()
  }

  // Whether this output belongs to the active camera. Called by the
  // distributor per frame, hence a dictionary access instead of a search.
  static func isActiveOutput(_ output: AVCaptureOutput) -> Bool {
    guard let name = outputNames[ObjectIdentifier(output)] else { return false }
    return name == activeCamera
  }
}

private struct MultiCameraError: Error, CustomStringConvertible {
  let reason: String
  var description: String { reason }
}

// Takes in the buffers of all three cameras and the microphone and hands on
// what's needed. All video outputs share one queue, so the calls arrive
// serialized.
//
// While no recording is running, both hand-offs are cheap no-ops on their
// own thanks to the optional `current`; the distributor stays attached
// regardless, because every attach and detach would be a session rebuild.
final class MultiCameraDistributor: NSObject,
  AVCaptureVideoDataOutputSampleBufferDelegate,
  AVCaptureAudioDataOutputSampleBufferDelegate
{
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if output is AVCaptureAudioDataOutput {
      // Audio runs through uninterrupted, even across a camera switch.
      CameraCaptureModule.current?.writeAudio(sampleBuffer)
      return
    }
    // The other two cameras keep running along but aren't on screen: their
    // buffers get dropped right away, so the pool gets them back.
    guard MultiCameraModule.isActiveOutput(output) else { return }
    // Portrait guard, taken over from BufferTap: orientation and mirroring
    // are fixed at the connection, but a landscape frame would still get
    // pressed distorted into the writer's 1080x1920 track. The app is
    // portrait-locked, every legitimate frame is taller than it is wide.
    if let image = CMSampleBufferGetImageBuffer(sampleBuffer),
      CVPixelBufferGetWidth(image) > CVPixelBufferGetHeight(image)
    {
      return
    }
    // A legitimate frame of the active camera: the first one after a restart
    // lifts the curtain off the preview layers (see _curtainDown).
    MultiCameraModule.liftCurtainOnFrame()
    // The photo grab (spec §6) gets the frame FIRST and is thereby done;
    // the running recording gets the same frame right after. Photo and
    // video therefore don't exclude each other: a photo mid-recording
    // doesn't tear a gap into the video. With no request parked, the call
    // is a lock and a nil comparison, nothing more.
    MultiCameraModule.fulfillPhotoRequest(sampleBuffer)
    CameraCaptureModule.current?.writeVideo(sampleBuffer)
  }
}

// Carries the grabbed frame from the video queue to the photo queue. A
// class, because the reference must be RELEASABLE: a CIImage passed along
// directly would hang off the closure context and hold the active camera's
// buffer out of its pool until the end of the block. It's touched by only
// one queue at a time (filled on the video queue, drained on the photo
// queue), the handoff between them is the `async` itself.
private final class PhotoCarrier {
  private var image: CIImage?

  init(_ image: CIImage) {
    self.image = image
  }

  // Hands out the frame and lets it go here: whoever takes it holds it
  // alone from now on and can end it along with its own scope.
  func take() -> CIImage? {
    defer { image = nil }
    return image
  }
}

// First come, first served: the grabbed frame and the deadline race against
// each other, but a promise only tolerates exactly ONE answer.
private final class PhotoRequest {
  private let lock = NSLock()
  private var open = true

  func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard open else { return false }
    open = false
    return true
  }
}
