import AVFoundation
import ExpoModulesCore

// Die Sofort-Vorschau (Spec 2026-08-14): zeigt die letzte Aufnahme, beginnend
// mit dem StartFenster aus dem Speicher — deshalb steht das bewegte Bild in
// ~0,1 s, statt ~0,8 s auf eine VideoView zu warten. Task 9 hängt die Datei
// und den Loop an.
final class SofortVorschauView: ExpoView {
  private let anzeige = AVSampleBufferDisplayLayer()
  private var zeitbasis: CMTimebase?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    anzeige.videoGravity = .resizeAspectFill
    layer.addSublayer(anzeige)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    anzeige.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, let aufnahme = KameraAufnahmeModule.aktuelle else { return }
    spieleStartFenster(aufnahme)
  }

  private func spieleStartFenster(_ aufnahme: Aufnahme) {
    let fenster = aufnahme.startFenster
    guard let erster = fenster.first else { return }
    // Echtzeit-Takt: die Layer spielt nach Puffer-Zeitstempeln, sobald ihre
    // Zeitbasis ab dem ersten Frame mit Rate 1 läuft.
    var basis: CMTimebase?
    CMTimebaseCreateWithSourceClock(allocator: nil, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &basis)
    if let basis {
      CMTimebaseSetTime(basis, time: CMSampleBufferGetPresentationTimeStamp(erster))
      CMTimebaseSetRate(basis, rate: 1.0)
      anzeige.controlTimebase = basis
      zeitbasis = basis
    }
    for puffer in fenster {
      anzeige.enqueue(puffer)
    }
  }
}
