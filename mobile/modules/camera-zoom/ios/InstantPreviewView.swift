import AVFoundation
import ExpoModulesCore

// The instant preview (spec 2026-08-14): shows the last recording, starting
// with the start window from memory, which is why the moving image stands in
// ~0.1s instead of waiting ~0.8s for a VideoView. Once the file is done,
// playback takes over seamlessly from the end of the window; at the end of
// the file it loops from the start (Task 9).
final class InstantPreviewView: ExpoView {
  private let display = AVSampleBufferDisplayLayer()
  private var timebase: CMTimebase?
  private var reader: AVAssetReader?
  private var readerOutput: AVAssetReaderTrackOutput?
  // The restamped window copy (file timeline). The view holds it itself:
  // the recording's startWindow only exists externally as a copy under its
  // own lock, and windowEnd() needs the end even AFTER the release.
  private var windowCopy: [CMSampleBuffer] = []
  // Exactly ONE whenFinished registration per view: didMoveToWindow fires
  // again on every window change, two registrations would mean two
  // competing readers on the same display.
  private var takeoverRunning = false
  // A queue, reused across all loop rounds, not recreated per readFile call.
  private let readQueue = DispatchQueue(label: "reelive.preview.read")

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    display.videoGravity = .resizeAspectFill
    layer.addSublayer(display)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    display.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else {
      reader?.cancelReading()
      // Nil the references: a cancelled reader must not serve as a source
      // again on the next mount (requestMediaDataWhenReady keeps reading via
      // readerOutput as long as it's set).
      reader = nil
      readerOutput = nil
      display.stopRequestingMediaData()
      display.flush()
      return
    }
    guard let capture = CameraCaptureModule.current else { return }
    playStartWindow(capture)
    fileTakesOver(capture)
  }

  private func playStartWindow(_ capture: Capture) {
    // The window buffers carry capture-clock PTS (host clock, counts since
    // boot); the file, however, starts near 0, because
    // startSession(atSourceTime:) maps the recording start onto movie time
    // 0. That's why every buffer gets restamped onto the file timeline here
    // (PTS - startPTS): the window and the file thus share the same axis,
    // and readFile(from: windowEnd) picks up seamlessly instead of
    // immediately sitting "past the end of the file" with capture times.
    let zeroPoint = capture.startPTS
    windowCopy = capture.startWindowCopy()
      .compactMap { Self.toFileTime($0, zeroPoint: zeroPoint) }
    guard let first = windowCopy.first else { return }
    // Real-time pace: the layer plays by buffer timestamps once its
    // timebase runs at rate 1 starting from the first frame (~0 on the file
    // timeline).
    var base: CMTimebase?
    CMTimebaseCreateWithSourceClock(allocator: nil, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &base)
    if let base {
      CMTimebaseSetTime(base, time: CMSampleBufferGetPresentationTimeStamp(first))
      CMTimebaseSetRate(base, rate: 1.0)
      display.controlTimebase = base
      timebase = base
    }
    for buffer in windowCopy {
      display.enqueue(buffer)
    }
  }

  // After playStartWindow: once the file is done, keep reading from the
  // file starting at the position AFTER the window; loop from the start at
  // the end. Releases the window as soon as the file has taken over (spec §
  // memory budget).
  private func fileTakesOver(_ capture: Capture) {
    guard !takeoverRunning else { return }
    takeoverRunning = true
    capture.whenFinished { [weak self] error in
      // Write error: the last window image stays put; submitting fails
      // visibly via awaitFile (final review decision).
      guard error == nil, let self else { return }
      // Read the window end FIRST, THEN release the copy: afterwards
      // windowCopy is empty and .last returns nil.
      let end = self.windowEnd()
      self.windowCopy = []
      capture.releaseStartWindow()
      self.readFile(from: end, capture: capture)
    }
  }

  // End of the window on the FILE timeline (windowCopy is restamped).
  private func windowEnd() -> CMTime {
    guard let last = windowCopy.last else { return .zero }
    return CMSampleBufferGetPresentationTimeStamp(last)
  }

  // Restamps a window buffer from the capture clock onto the file timeline:
  // PTS - zero point, likewise for the decode timestamp. nil (the buffer
  // falls out of the window) only if timing info is missing or the zero
  // point was never set, in which case there was no written frame anyway.
  private static func toFileTime(_ buffer: CMSampleBuffer, zeroPoint: CMTime) -> CMSampleBuffer? {
    guard zeroPoint.isValid else { return nil }
    var count: CMItemCount = 0
    guard CMSampleBufferGetSampleTimingInfoArray(
      buffer, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count
    ) == noErr, count > 0 else { return nil }
    var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
    guard CMSampleBufferGetSampleTimingInfoArray(
      buffer, entryCount: count, arrayToFill: &timing, entriesNeededOut: &count
    ) == noErr else { return nil }
    for index in timing.indices {
      timing[index].presentationTimeStamp =
        CMTimeSubtract(timing[index].presentationTimeStamp, zeroPoint)
      if timing[index].decodeTimeStamp.isValid {
        timing[index].decodeTimeStamp =
          CMTimeSubtract(timing[index].decodeTimeStamp, zeroPoint)
      }
    }
    var copy: CMSampleBuffer?
    guard CMSampleBufferCreateCopyWithNewTiming(
      allocator: nil,
      sampleBuffer: buffer,
      sampleTimingEntryCount: count,
      sampleTimingArray: &timing,
      sampleBufferOut: &copy
    ) == noErr else { return nil }
    return copy
  }

  private func readFile(from start: CMTime, capture: Capture) {
    let asset = AVURLAsset(url: capture.destination)
    guard
      let track = asset.tracks(withMediaType: .video).first,
      let reader = try? AVAssetReader(asset: asset)
    else { return }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    reader.add(output)
    reader.timeRange = CMTimeRange(start: start, duration: .positiveInfinity)
    reader.startReading()
    self.reader = reader
    self.readerOutput = output
    display.requestMediaDataWhenReady(on: readQueue) { [weak self] in
      guard let self, let output = self.readerOutput else { return }
      while self.display.isReadyForMoreMediaData {
        if let buffer = output.copyNextSampleBuffer() {
          self.display.enqueue(buffer)
        } else {
          // End of file: loop, clear the display, reset the timebase to the
          // start, reader from the top (recreated each round).
          self.display.stopRequestingMediaData()
          DispatchQueue.main.async {
            self.display.flush()
            if let base = self.timebase {
              CMTimebaseSetTime(base, time: .zero)
            }
            self.readFile(from: .zero, capture: capture)
          }
          return
        }
      }
    }
  }
}
