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
  // Die umgestempelte Fenster-Kopie (Datei-Zeitachse). Die View hält sie
  // selbst: startFenster der Aufnahme gibt es nach aussen nur als Kopie unter
  // deren Lock, und fensterEnde() braucht das Ende auch NACH der Freigabe.
  private var fensterKopie: [CMSampleBuffer] = []
  // Genau EINE wennFertig-Registrierung pro View: didMoveToWindow feuert bei
  // jedem Fenster-Wechsel erneut, zwei Registrierungen hiessen zwei
  // konkurrierende Leser auf derselben Anzeige.
  private var uebernahmeLaeuft = false
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
      // Referenzen nillen: ein gecancelter Leser darf beim nächsten Einhängen
      // nicht wieder als Quelle dienen (requestMediaDataWhenReady liest über
      // leserAusgabe weiter, solange sie gesetzt ist).
      leser = nil
      leserAusgabe = nil
      anzeige.stopRequestingMediaData()
      anzeige.flush()
      return
    }
    guard let aufnahme = KameraAufnahmeModule.aktuelle else { return }
    spieleStartFenster(aufnahme)
    dateiUebernimmt(aufnahme)
  }

  private func spieleStartFenster(_ aufnahme: Aufnahme) {
    // Die Fenster-Puffer tragen Capture-Clock-PTS (Host-Uhr, zählt seit dem
    // Boot); die Datei beginnt aber bei ~0, weil startSession(atSourceTime:)
    // den Aufnahme-Start auf Movie-Zeit 0 mappt. Deshalb hier JEDEN Puffer
    // auf die Datei-Zeitachse umstempeln (PTS − startPTS): Fenster und Datei
    // teilen so dieselbe Achse, und leseDatei(ab: fensterEnde) setzt nahtlos
    // an, statt mit Capture-Zeiten sofort «hinter dem Dateiende» zu liegen.
    let nullpunkt = aufnahme.startPTS
    fensterKopie = aufnahme.startFensterKopie()
      .compactMap { Self.aufDateiZeit($0, nullpunkt: nullpunkt) }
    guard let erster = fensterKopie.first else { return }
    // Echtzeit-Takt: die Layer spielt nach Puffer-Zeitstempeln, sobald ihre
    // Zeitbasis ab dem ersten Frame (≈0 auf der Datei-Zeitachse) mit Rate 1
    // läuft.
    var basis: CMTimebase?
    CMTimebaseCreateWithSourceClock(allocator: nil, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &basis)
    if let basis {
      CMTimebaseSetTime(basis, time: CMSampleBufferGetPresentationTimeStamp(erster))
      CMTimebaseSetRate(basis, rate: 1.0)
      anzeige.controlTimebase = basis
      zeitbasis = basis
    }
    for puffer in fensterKopie {
      anzeige.enqueue(puffer)
    }
  }

  // Nach spieleStartFenster: sobald die Datei fertig ist, ab der Position NACH
  // dem Fenster aus der Datei weiterlesen; am Ende von vorn (Loop). Freigabe
  // des Fensters, sobald die Datei übernommen hat (Spec § Speicherhaushalt).
  private func dateiUebernimmt(_ aufnahme: Aufnahme) {
    guard !uebernahmeLaeuft else { return }
    uebernahmeLaeuft = true
    aufnahme.wennFertig { [weak self] fehler in
      // Schreibfehler: das letzte Fenster-Bild bleibt stehen; Einsenden
      // scheitert sichtbar über dateiFertig (Entscheid Final-Review).
      guard fehler == nil, let self else { return }
      // ERST das Fenster-Ende lesen, DANN die Kopie freigeben — danach ist
      // fensterKopie leer und .last liefert nil.
      let ende = self.fensterEnde()
      self.fensterKopie = []
      aufnahme.startFensterFreigeben()
      self.leseDatei(ab: ende, aufnahme: aufnahme)
    }
  }

  // Ende des Fensters auf der DATEI-Zeitachse (fensterKopie ist umgestempelt).
  private func fensterEnde() -> CMTime {
    guard let letzter = fensterKopie.last else { return .zero }
    return CMSampleBufferGetPresentationTimeStamp(letzter)
  }

  // Stempelt einen Fenster-Puffer von der Capture-Clock auf die
  // Datei-Zeitachse um: PTS − Nullpunkt, dito fürs Decode-TS. nil (Puffer
  // fällt aus dem Fenster) nur, wenn Timing-Infos fehlen oder der Nullpunkt
  // nie gesetzt wurde — dann gab es ohnehin keinen geschriebenen Frame.
  private static func aufDateiZeit(_ puffer: CMSampleBuffer, nullpunkt: CMTime) -> CMSampleBuffer? {
    guard nullpunkt.isValid else { return nil }
    var anzahl: CMItemCount = 0
    guard CMSampleBufferGetSampleTimingInfoArray(
      puffer, entryCount: 0, arrayToFill: nil, entriesNeededOut: &anzahl
    ) == noErr, anzahl > 0 else { return nil }
    var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: anzahl)
    guard CMSampleBufferGetSampleTimingInfoArray(
      puffer, entryCount: anzahl, arrayToFill: &timing, entriesNeededOut: &anzahl
    ) == noErr else { return nil }
    for index in timing.indices {
      timing[index].presentationTimeStamp =
        CMTimeSubtract(timing[index].presentationTimeStamp, nullpunkt)
      if timing[index].decodeTimeStamp.isValid {
        timing[index].decodeTimeStamp =
          CMTimeSubtract(timing[index].decodeTimeStamp, nullpunkt)
      }
    }
    var kopie: CMSampleBuffer?
    guard CMSampleBufferCreateCopyWithNewTiming(
      allocator: nil,
      sampleBuffer: puffer,
      sampleTimingEntryCount: anzahl,
      sampleTimingArray: &timing,
      sampleBufferOut: &kopie
    ) == noErr else { return nil }
    return kopie
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
