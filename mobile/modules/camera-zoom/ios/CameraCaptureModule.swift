import AVFoundation
import ExpoModulesCore
import UIKit

// Our own video recording (spec 2026-08-14-instant-video-vorschau): taps the
// buffers of the running expo-camera session instead of waiting for
// recordAsync's file. The phase-0 probe (Task 1) has run: 64 frames in 2s
// next to the idle MovieFileOutput, the tap coexists, a removal branch is
// unnecessary. This module carries the recording core including the audio
// track (AAC over AVCaptureAudioDataOutput, Task 4).
public class CameraCaptureModule: Module {
  // The outputs are attached to the session ONCE and stay (every attach/
  // detach is a session rebuild and thus a visible viewfinder stutter, spec §
  // session rebuilds). `running` only switches whether buffers get
  // processed.
  private static var videoOutput: AVCaptureVideoDataOutput?
  private static let videoQueue = DispatchQueue(label: "reelive.capture.video")
  private static var audioOutput: AVCaptureAudioDataOutput?
  private static let audioQueue = DispatchQueue(label: "reelive.capture.audio")
  private static var tap: BufferTap?

  // Exactly one recording at any time (counterpart to the photoRunning guard
  // in JS).
  static var current: Capture?

  // The viewfinder of the running recording (set in startRecording): the
  // buffer tap compares, per frame, the orientation of its connection against
  // the viewfinder's, because a camera switch MID-RECORDING (double tap)
  // recreates the output connection, which would otherwise sit at the
  // default orientation instead of the viewfinder's. Weak: the view belongs
  // to expo-camera, this only looks in.
  static weak var viewfinderLayer: AVCaptureVideoPreviewLayer?

  // The observer for interruptions (call, background, split view). Static
  // because the module's helper functions are static; there is at most one
  // of it, OnCreate/OnDestroy keep it balanced.
  private static var interruptionObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("CameraCapture")

    // A call, background, or split view can interrupt the session: what's
    // been filmed up to that point stays a valid file (spec § edge cases);
    // the JS stop runs through the shutter path anyway, since iOS cancels the
    // touches regardless.
    OnCreate {
      Self.interruptionObserver = NotificationCenter.default.addObserver(
        forName: .AVCaptureSessionWasInterrupted,
        object: nil,
        queue: .main
      ) { _ in
        Self.current?.stop()
      }
    }

    OnDestroy {
      if let observer = Self.interruptionObserver {
        NotificationCenter.default.removeObserver(observer)
        Self.interruptionObserver = nil
      }
    }

    AsyncFunction("startRecording") { (maxSeconds: Double, promise: Promise) in
      // Rejects ONLY if a recording is running that hasn't been stopped yet.
      // A stopped `current` deliberately stays around (the preview from
      // Task 8 needs it) and simply gets replaced here, its start window
      // needs no explicit release: the replaced reference falls to ARC along
      // with the whole recording. Explicit release (releaseStartWindow) is
      // only needed by continuing the SAME recording (taking it over into
      // the file preview, or discarding it, Task 9).
      if let existing = Self.current, !existing.isStopped {
        promise.reject("already_running", "A recording is already running")
        return
      }
      guard
        let viewfinder = Self.viewfinderView(),
        let layer = viewfinder.layer as? AVCaptureVideoPreviewLayer,
        let session = layer.session
      else {
        promise.reject("no_session", "No running camera session")
        return
      }
      do {
        try Self.attachOutputs(session, layer: layer)
        // A front/back camera switch between two recordings changes the
        // viewfinder connection; the outputs stay attached though (reason
        // above) and attachOutputs then doesn't create them anew. So align
        // again here, idempotently, regardless of whether it was just newly
        // created or not.
        if let videoOutput = Self.videoOutput {
          Self.alignConnection(output: videoOutput, layer: layer)
        }
        Self.viewfinderLayer = layer
        let destination = FileManager.default.temporaryDirectory
          .appendingPathComponent("reelive-\(UUID().uuidString).mov")
        // withAudio hangs off the CONNECTION, not the output: an output
        // without an audio connection (no microphone) stays attached but
        // never delivers buffers, an audio input that stayed empty would
        // describe the file wrongly.
        let capture = try Capture(
          destination: destination, maxSeconds: maxSeconds,
          withAudio: Self.audioOutput?.connection(with: .audio) != nil
        )
        Self.current = capture
        promise.resolve()
      } catch {
        promise.reject("start_gescheitert", error.localizedDescription)
      }
    }.runOnQueue(.main)

    AsyncFunction("stopRecording") { (promise: Promise) in
      guard let capture = Self.current else {
        promise.reject("no_recording", "No recording is running")
        return
      }
      capture.stop()
      promise.resolve([
        "uri": capture.destination.absoluteString,
        "durationS": capture.durationS,
      ])
    }.runOnQueue(.main)

    // Resolves only once finishWriting is done, or rejects (storage full,
    // writer error). The JS awaitFile promise hangs off this.
    AsyncFunction("awaitFile") { (promise: Promise) in
      guard let capture = Self.current else {
        promise.resolve()
        return
      }
      capture.whenFinished { error in
        if let error {
          promise.reject("schreiben_gescheitert", error.localizedDescription)
        } else {
          promise.resolve()
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("discard") { (promise: Promise) in
      Self.current?.discard()
      Self.current = nil
      promise.resolve()
    }.runOnQueue(.main)

    View(InstantPreviewView.self) {
      ViewName("InstantPreview")
    }
  }

  private static func attachOutputs(
    _ session: AVCaptureSession, layer: AVCaptureVideoPreviewLayer
  ) throws {
    // expo-camera builds the session PER CameraView: after a Metro reload or
    // remount, remembered outputs hang off the OLD, dead session, no buffer
    // would ever arrive again. If the output doesn't belong to THIS session,
    // discard it and attach it fresh the regular way.
    if let existing = videoOutput, !session.outputs.contains(existing) {
      videoOutput = nil
      audioOutput = nil
      tap = nil
    }
    guard videoOutput == nil else { return }
    let output = AVCaptureVideoDataOutput()
    let tap = BufferTap()
    output.setSampleBufferDelegate(tap, queue: videoQueue)
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    guard session.canAddOutput(output) else {
      throw NSError(domain: "reelive", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Session nimmt den Video-Abgriff nicht an",
      ])
    }
    session.addOutput(output)
    alignConnection(output: output, layer: layer)
    videoOutput = output
    self.tap = tap

    let audio = AVCaptureAudioDataOutput()
    audio.setSampleBufferDelegate(tap, queue: audioQueue)
    // canAddOutput does NOT depend on the microphone input: attaching
    // succeeds even without a microphone (muted, missing permission), only
    // no audio connection comes into being then and the track would stay
    // empty, which is why startRecording checks the connection, not the
    // output. Without audio, recording proceeds without an audio track
    // instead of failing (spec § edge cases), hence no throw here.
    if session.canAddOutput(audio) {
      session.addOutput(audio)
      audioOutput = audio
    }
  }

  // Takes over rotation and mirroring 1:1 from the viewfinder onto the video
  // tap. Called on attach AND again before every recording start
  // (idempotent): the outputs stay attached across camera switches (comment
  // above at videoOutput), but their connection must follow whichever
  // viewfinder is CURRENT, otherwise a front recording wouldn't mirror even
  // though the viewfinder does (spec: "as seen in the viewfinder").
  private static func alignConnection(
    output: AVCaptureVideoDataOutput, layer: AVCaptureVideoPreviewLayer
  ) {
    guard
      let connection = output.connection(with: .video),
      let viewfinderConnection = layer.connection
    else { return }
    alignConnection(connection, to: viewfinderConnection)
  }

  static func alignConnection(
    _ connection: AVCaptureConnection, to viewfinder: AVCaptureConnection
  ) {
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = viewfinder.videoOrientation
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = viewfinder.isVideoMirrored
    }
  }

  // Whether the output connection differs from the viewfinder's: after a
  // camera switch mid-recording it's freshly created and still sits at
  // default values.
  static func connectionDiffers(
    _ connection: AVCaptureConnection, from viewfinder: AVCaptureConnection
  ) -> Bool {
    connection.videoOrientation != viewfinder.videoOrientation
      || connection.isVideoMirrored != viewfinder.isVideoMirrored
  }

  // Same lookup path as CameraZoomModule.viewfinderView(): the view whose
  // layer IS the camera preview. Deliberately duplicated instead of shared:
  // the two modules stay independently viable.
  private static func viewfinderView() -> UIView? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    for window in windows {
      if let match = viewfinderView(in: window) { return match }
    }
    return nil
  }

  private static func viewfinderView(in view: UIView) -> UIView? {
    if view.layer is AVCaptureVideoPreviewLayer { return view }
    for child in view.subviews {
      if let match = viewfinderView(in: child) { return match }
    }
    return nil
  }
}

// Takes in the buffers and hands them on to the running recording. Serves
// both video AND audio output (two delegate protocols, one instance), the
// source tells them apart, deciding where the buffer goes.
final class BufferTap: NSObject,
  AVCaptureVideoDataOutputSampleBufferDelegate,
  AVCaptureAudioDataOutputSampleBufferDelegate
{
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if output is AVCaptureAudioDataOutput {
      CameraCaptureModule.current?.writeAudio(sampleBuffer)
    } else {
      // Camera switch DURING recording (double tap): expo-camera swaps the
      // device input of the same session, which recreates this connection,
      // at default orientation instead of the viewfinder's. Checked and
      // aligned per frame; the diverging frame itself still carries the old
      // orientation and stays out. In the normal case that costs two
      // property comparisons per frame.
      if let viewfinder = CameraCaptureModule.viewfinderLayer?.connection,
        CameraCaptureModule.connectionDiffers(connection, from: viewfinder)
      {
        CameraCaptureModule.alignConnection(connection, to: viewfinder)
        return
      }
      // Stragglers of the switch: individual frames can still be in transit
      // with the OLD orientation even though the connection is already
      // correct, landscape instead of portrait. The writer would press them
      // distorted into its 1080x1920 track, so they stay out too (the app is
      // portrait-locked, every legitimate frame is taller than it is wide).
      if let image = CMSampleBufferGetImageBuffer(sampleBuffer),
        CVPixelBufferGetWidth(image) > CVPixelBufferGetHeight(image)
      {
        return
      }
      CameraCaptureModule.current?.writeVideo(sampleBuffer)
    }
  }
}

// One recording: writer, times, finish callbacks. writeVideo runs on
// videoQueue, writeAudio on audioQueue (two delegate queues), stop and
// window access on Main; each AVAssetWriterInput is only ever fed by its own
// queue. The lock makes the state transition (setting isStopped +
// markAsFinished) and every append atomic WITH EACH OTHER: an append after
// markAsFinished is an NSException, not a tolerated buffer loss.
final class Capture {
  // How many frames the instant preview can play from memory before the
  // file takes over. 24 frames ~ 0.8s at 30fps ~ ~70MB at 1080p, only held in
  // memory for seconds; released after takeover or discard. Calibrate on
  // device (spec § open calibrations).
  private let START_WINDOW_FRAMES = 24

  let destination: URL
  private let writer: AVAssetWriter
  private let videoInput: AVAssetWriterInput
  private let audioInput: AVAssetWriterInput?
  // Protects everything that delegate queues AND Main touch together:
  // _isStopped, sessionStarted, _startPTS, startWindow, maxTimer.
  private let lock = NSLock()
  private var sessionStarted = false
  private var _isStopped = false
  // Publicly readable (lock-guarded): the start guard in startRecording
  // needs to tell, after stopping an old recording, whether it's still
  // running or already finished.
  var isStopped: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _isStopped
  }
  private var finishError: Error?
  private var finishCallbacks: [(Error?) -> Void] = []
  private var finished = false
  private var startTime = Date()
  private var stopTime: Date?
  private let maxSeconds: Double
  private var maxTimer: DispatchSourceTimer?
  // Capture-clock PTS of the first written frame, the zero point of the
  // file's timeline: startSession(atSourceTime:) maps exactly this moment
  // onto movie time 0. The preview uses it to convert the window buffers to
  // file time (PTS - startPTS, InstantPreviewView.toFileTime).
  private var _startPTS = CMTime.invalid
  var startPTS: CMTime {
    lock.lock()
    defer { lock.unlock() }
    return _startPTS
  }
  // Only touch under the lock; only the copy from startWindowCopy() ever
  // leaves.
  private var startWindow: [CMSampleBuffer] = []

  var durationS: Double { (stopTime ?? Date()).timeIntervalSince(startTime) }

  init(destination: URL, maxSeconds: Double, withAudio: Bool) throws {
    self.destination = destination
    self.maxSeconds = maxSeconds
    writer = try AVAssetWriter(outputURL: destination, fileType: .mov)
    videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: 1080,
      AVVideoHeightKey: 1920,
    ])
    videoInput.expectsMediaDataInRealTime = true
    writer.add(videoInput)
    if withAudio {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVNumberOfChannelsKey: 1,
        AVSampleRateKey: 44_100,
      ])
      input.expectsMediaDataInRealTime = true
      writer.add(input)
      audioInput = input
    } else {
      audioInput = nil
    }
    guard writer.startWriting() else { throw writer.error ?? NSError(domain: "reelive", code: 2) }
    startTime = Date()
  }

  func writeVideo(_ buffer: CMSampleBuffer) {
    lock.lock()
    defer { lock.unlock() }
    guard !_isStopped, writer.status == .writing else { return }
    let time = CMSampleBufferGetPresentationTimeStamp(buffer)
    if !sessionStarted {
      writer.startSession(atSourceTime: time)
      _startPTS = time
      sessionStarted = true
      scheduleMaxStop()
    }
    if videoInput.isReadyForMoreMediaData {
      videoInput.append(buffer)
      if startWindow.count < START_WINDOW_FRAMES, let copy = Self.deepCopy(buffer) {
        startWindow.append(copy)
      }
    }
  }

  // Deep-copies a video buffer into its own memory. Why this has to happen:
  // the original buffers belong to VideoDataOutput's finite pool, holding
  // onto them starves delivery after ~10 frames, and both the file and the
  // window end up around ~0.3s (device finding 2026-08-17: 46 dropped frames
  // in 2s, proven via the didDrop probe). The copy costs ~3MB memcpy per
  // frame, spread over the first second, the pool gets its buffer back right
  // away.
  private static func deepCopy(_ buffer: CMSampleBuffer) -> CMSampleBuffer? {
    guard let source = CMSampleBufferGetImageBuffer(buffer) else { return nil }
    CVPixelBufferLockBaseAddress(source, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(source, .readOnly) }

    var copy: CVPixelBuffer?
    let properties = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary
    guard
      CVPixelBufferCreate(
        nil,
        CVPixelBufferGetWidth(source),
        CVPixelBufferGetHeight(source),
        CVPixelBufferGetPixelFormatType(source),
        properties,
        &copy
      ) == kCVReturnSuccess,
      let destination = copy
    else { return nil }

    CVPixelBufferLockBaseAddress(destination, [])
    defer { CVPixelBufferUnlockBaseAddress(destination, []) }
    if CVPixelBufferIsPlanar(source) {
      for plane in 0..<CVPixelBufferGetPlaneCount(source) {
        guard
          let sourceAddress = CVPixelBufferGetBaseAddressOfPlane(source, plane),
          let destAddress = CVPixelBufferGetBaseAddressOfPlane(destination, plane)
        else { return nil }
        let sourceStride = CVPixelBufferGetBytesPerRowOfPlane(source, plane)
        let destStride = CVPixelBufferGetBytesPerRowOfPlane(destination, plane)
        let height = CVPixelBufferGetHeightOfPlane(source, plane)
        if sourceStride == destStride {
          memcpy(destAddress, sourceAddress, sourceStride * height)
        } else {
          // Row by row: the buffers can have differently rounded row
          // widths.
          for row in 0..<height {
            memcpy(
              destAddress + row * destStride, sourceAddress + row * sourceStride,
              min(sourceStride, destStride)
            )
          }
        }
      }
    } else {
      guard
        let sourceAddress = CVPixelBufferGetBaseAddress(source),
        let destAddress = CVPixelBufferGetBaseAddress(destination)
      else { return nil }
      memcpy(destAddress, sourceAddress, CVPixelBufferGetDataSize(source))
    }

    var description: CMVideoFormatDescription?
    guard
      CMVideoFormatDescriptionCreateForImageBuffer(
        allocator: nil, imageBuffer: destination, formatDescriptionOut: &description
      ) == noErr,
      let format = description
    else { return nil }
    var timing = CMSampleTimingInfo()
    guard CMSampleBufferGetSampleTimingInfo(buffer, at: 0, timingInfoOut: &timing) == noErr else {
      return nil
    }
    var result: CMSampleBuffer?
    guard
      CMSampleBufferCreateReadyWithImageBuffer(
        allocator: nil,
        imageBuffer: destination,
        formatDescription: format,
        sampleTiming: &timing,
        sampleBufferOut: &result
      ) == noErr
    else { return nil }
    return result
  }

  func writeAudio(_ buffer: CMSampleBuffer) {
    lock.lock()
    defer { lock.unlock() }
    guard !_isStopped, sessionStarted, writer.status == .writing else { return }
    // Don't accept audio before the first VIDEO frame: the writer session
    // starts on the video time base, earlier audio would be cut off.
    if let input = audioInput, input.isReadyForMoreMediaData {
      input.append(buffer)
    }
  }

  func stop() {
    lock.lock()
    guard !_isStopped else {
      lock.unlock()
      return
    }
    _isStopped = true
    stopTime = Date()
    maxTimer?.cancel()
    maxTimer = nil
    let hasFrames = sessionStarted
    if hasFrames {
      // Still under the lock: no writeVideo/writeAudio can slip an append in
      // between isStopped and markAsFinished.
      videoInput.markAsFinished()
      audioInput?.markAsFinished()
    }
    lock.unlock()
    guard hasFrames else {
      // Not a single frame arrived (e.g. a dead tap): finishWriting without
      // startSession would be undefined, abort and surface the error via
      // awaitFile instead of silently reporting an empty file.
      writer.cancelWriting()
      let error = NSError(domain: "reelive", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "No frame arrived, the recording stayed empty",
      ])
      DispatchQueue.main.async {
        self.finished = true
        self.finishError = error
        self.finishCallbacks.forEach { $0(error) }
        self.finishCallbacks = []
      }
      return
    }
    writer.finishWriting { [self] in
      let error = writer.status == .completed ? nil : (writer.error ?? NSError(domain: "reelive", code: 3))
      DispatchQueue.main.async {
        self.finished = true
        self.finishError = error
        self.finishCallbacks.forEach { $0(error) }
        self.finishCallbacks = []
      }
    }
  }

  func whenFinished(_ callback: @escaping (Error?) -> Void) {
    if finished { callback(finishError) } else { finishCallbacks.append(callback) }
  }

  // Snapshot for playback: the array is copy-on-write, the caller thus holds
  // a buffer list independent of the lock.
  func startWindowCopy() -> [CMSampleBuffer] {
    lock.lock()
    defer { lock.unlock() }
    return startWindow
  }

  func releaseStartWindow() {
    lock.lock()
    defer { lock.unlock() }
    startWindow = []
  }

  func discard() {
    releaseStartWindow()
    stop()
    whenFinished { _ in try? FileManager.default.removeItem(at: self.destination) }
  }

  // The max duration stops HARD inside the module; the JS ring at the
  // shutter stays only the visible display (spec § edge cases). Runs UNDER
  // the lock (called from writeVideo): maxTimer is only touched lock-guarded,
  // and because stop() sets isStopped first, no timer comes into being after
  // the stop anymore. The handler fires on Main.
  private func scheduleMaxStop() {
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + maxSeconds)
    timer.setEventHandler { [weak self] in self?.stop() }
    timer.resume()
    maxTimer = timer
  }
}
