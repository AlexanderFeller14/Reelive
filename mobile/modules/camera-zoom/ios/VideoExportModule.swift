import AVFoundation
import ExpoModulesCore

// Turns a library video into H.264 (spec 2026-08-28-fotos-import-pruefung):
// the picker hands over the original bytes now (HEVC on modern iPhones), and
// the web player of the share link cannot play HEVC in Chrome or Firefox.
// The export runs after the confirmation, inside the batch, so the wait is
// visible per element instead of hidden inside the picker.
public class VideoExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoExport")

    Events("exportProgress")

    // The four-character code of the first video track ("avc1" for H.264,
    // "hvc1" or "hev1" for HEVC), nil when the file has no readable video
    // track. The JS side skips the export for H.264 and for nil.
    AsyncFunction("videoCodec") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri) else {
        promise.resolve(nil)
        return
      }
      let asset = AVURLAsset(url: url)
      Task {
        do {
          let tracks = try await asset.loadTracks(withMediaType: .video)
          guard let track = tracks.first else {
            promise.resolve(nil)
            return
          }
          let descriptions = try await track.load(.formatDescriptions)
          guard let description = descriptions.first else {
            promise.resolve(nil)
            return
          }
          promise.resolve(Self.fourCharacterCode(CMFormatDescriptionGetMediaSubType(description)))
        } catch {
          NSLog("[VideoExport] codec lookup failed for %@: %@", uri, String(describing: error))
          promise.resolve(nil)
        }
      }
    }

    // Exports to H.264 1920x1080 in an .mp4 container, network-optimised
    // (moov atom in front), into tmp. Progress goes out as an event every
    // quarter second so the JS side can show it per element; the promise
    // resolves with the file's uri or rejects with the session's error.
    AsyncFunction("exportH264") { (uri: String, exportId: String, promise: Promise) in
      guard let url = URL(string: uri) else {
        promise.reject("E_VIDEO_EXPORT_URI", "not a file uri: \(uri)")
        return
      }
      let asset = AVURLAsset(url: url)
      guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1920x1080) else {
        promise.reject("E_VIDEO_EXPORT_SESSION", "no export session for this asset")
        return
      }
      let output = FileManager.default.temporaryDirectory
        .appendingPathComponent("reelive-export-\(exportId).mp4")
      try? FileManager.default.removeItem(at: output)
      session.outputURL = output
      session.outputFileType = .mp4
      session.shouldOptimizeForNetworkUse = true

      // Progress is polled: AVAssetExportSession offers no callback for it.
      // The loop ends by itself once the status leaves the running states.
      Task { [weak self] in
        while session.status == .unknown || session.status == .waiting || session.status == .exporting {
          try? await Task.sleep(nanoseconds: 250_000_000)
          self?.sendEvent("exportProgress", ["exportId": exportId, "progress": Double(session.progress)])
        }
      }

      session.exportAsynchronously {
        switch session.status {
        case .completed:
          promise.resolve(["uri": output.absoluteString])
        default:
          // A failed or cancelled session leaves a partial file behind that
          // the JS side never learns the uri of, so nothing else can remove it.
          try? FileManager.default.removeItem(at: output)
          promise.reject(
            "E_VIDEO_EXPORT_FAILED",
            session.error?.localizedDescription ?? "export ended with status \(session.status.rawValue)"
          )
        }
      }
    }
  }

  private static func fourCharacterCode(_ code: FourCharCode) -> String {
    let bytes: [UInt8] = [
      UInt8((code >> 24) & 0xFF),
      UInt8((code >> 16) & 0xFF),
      UInt8((code >> 8) & 0xFF),
      UInt8(code & 0xFF),
    ]
    return String(bytes: bytes, encoding: .ascii) ?? "????"
  }
}
