import AVFoundation
import ExpoModulesCore

// Die Sofort-Vorschau (Spec 2026-08-14): zeigt die letzte Aufnahme, beginnend
// mit dem StartFenster aus dem Speicher — deshalb steht das bewegte Bild in
// ~0,1 s, statt ~0,8 s auf eine VideoView zu warten. Sobald die Datei fertig
// ist, übernimmt die Wiedergabe nahtlos ab dem Ende des Fensters; am
// Dateiende loopt sie von vorn (Task 9).
final class SofortVorschauView: ExpoView {
  private let anzeige = AVSampleBufferDisplayLayer()
  private var zeitbasis: CMTimebase?
  private var leser: AVAssetReader?
  private var leserAusgabe: AVAssetReaderTrackOutput?
  // Eine Queue, wiederverwendet über alle Loop-Runden hinweg — nicht pro
  // leseDatei-Aufruf neu angelegt.
  private let leseQueue = DispatchQueue(label: "reelive.vorschau.lesen")

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
    guard window != nil else {
      leser?.cancelReading()
      anzeige.stopRequestingMediaData()
      anzeige.flush()
      return
    }
    guard let aufnahme = KameraAufnahmeModule.aktuelle else { return }
    spieleStartFenster(aufnahme)
    dateiUebernimmt(aufnahme)
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

  // Nach spieleStartFenster: sobald die Datei fertig ist, ab der Position NACH
  // dem Fenster aus der Datei weiterlesen; am Ende von vorn (Loop). Freigabe
  // des Fensters, sobald die Datei übernommen hat (Spec § Speicherhaushalt).
  private func dateiUebernimmt(_ aufnahme: Aufnahme) {
    aufnahme.wennFertig { [weak self] fehler in
      guard fehler == nil else { return } // Fenster loopen ist der Notnagel
      // ERST den PTS des letzten Fenster-Frames lesen, DANN freigeben — nach
      // startFensterFreigeben() ist startFenster leer und .last liefert nil.
      let ende = self?.fensterEnde(aufnahme) ?? .zero
      aufnahme.startFensterFreigeben()
      self?.leseDatei(ab: ende, aufnahme: aufnahme)
    }
  }

  private func fensterEnde(_ aufnahme: Aufnahme) -> CMTime {
    guard let letzter = aufnahme.startFenster.last else { return .zero }
    return CMSampleBufferGetPresentationTimeStamp(letzter)
  }

  private func leseDatei(ab start: CMTime, aufnahme: Aufnahme) {
    let asset = AVURLAsset(url: aufnahme.ziel)
    guard
      let spur = asset.tracks(withMediaType: .video).first,
      let leser = try? AVAssetReader(asset: asset)
    else { return }
    let ausgabe = AVAssetReaderTrackOutput(track: spur, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    leser.add(ausgabe)
    leser.timeRange = CMTimeRange(start: start, duration: .positiveInfinity)
    leser.startReading()
    self.leser = leser
    self.leserAusgabe = ausgabe
    anzeige.requestMediaDataWhenReady(on: leseQueue) { [weak self] in
      guard let self, let ausgabe = self.leserAusgabe else { return }
      while self.anzeige.isReadyForMoreMediaData {
        if let puffer = ausgabe.copyNextSampleBuffer() {
          self.anzeige.enqueue(puffer)
        } else {
          // Dateiende: Loop — Anzeige leeren, Zeitbasis neu auf den Anfang,
          // Leser von vorn (je Runde neu erzeugt).
          self.anzeige.stopRequestingMediaData()
          DispatchQueue.main.async {
            self.anzeige.flush()
            if let basis = self.zeitbasis {
              CMTimebaseSetTime(basis, time: .zero)
            }
            self.leseDatei(ab: .zero, aufnahme: aufnahme)
          }
          return
        }
      }
    }
  }
}
