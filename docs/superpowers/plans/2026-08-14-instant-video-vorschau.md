# Instant-Video-Vorschau (AVFoundation-Pipeline) — Implementationsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nach dem Loslassen des Auslösers läuft in ≤ ~0,15 s das bewegte, stumme, loopende Video in der Vorschau; die Datei entsteht im Hintergrund.

**Architecture:** Eigenes Expo-Modul `KameraAufnahme` (im bestehenden Pod `modules/kamera-zoom`) greift Video- und Ton-Puffer an der laufenden expo-camera-Session ab (`AVCaptureVideoDataOutput`/`AVCaptureAudioDataOutput`), schreibt per `AVAssetWriter` die .mov und hält die ersten ~0,8 s Frames im Speicher. Eine native View `SofortVorschau` (`AVSampleBufferDisplayLayer`) spielt beim Loslassen sofort aus dem Speicher und liest dann nahtlos aus der fertigen Datei (Loop). JS bekommt eine Weiche: neue Pipeline, sonst der heutige Weg (recordAsync + Poster) als Rückfallebene.

**Tech Stack:** Swift/expo-modules-core (AsyncFunction, ExpoView), AVFoundation (AVCaptureVideoDataOutput, AVCaptureAudioDataOutput, AVAssetWriter, AVSampleBufferDisplayLayer, AVAssetReader), TypeScript strict, Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-14-instant-video-vorschau-design.md`

## Global Constraints

- Alle Shell-Befehle (jest, tsc, eslint, expo) aus `/Users/lx/PycharmProjects/Reelive/mobile` heraus (cwd resettet zwischen Bash-Aufrufen).
- Jest-Pfade mit Klammern nie als Pattern übergeben: `npx jest kamera.test.tsx` statt des vollen `(tabs)`-Pfads.
- UI-Sprache Deutsch (Du-Form), Bezeichner/Kommentare deutsch wie im Bestand; Kommentare erklären Constraints, nicht Zeilen.
- TypeScript strict; `npx tsc --noEmit` muss nach jedem JS-Task leer sein.
- TDD für alles in `src/`; Swift hat kein Testtarget — dort ersetzt der Geräte-Build + Gerätelauf den Testzyklus. Jest sieht NICHTS Natives.
- Native Änderungen brauchen einen Geräte-Build: `npx expo run:ios --device 00008150-001904342EF0401C` (klassische UDID; die devicectl-UUID `38320061-3B47-5C9E-BF44-9DF5AEB25255` ist NUR für `xcrun devicectl device process launch --terminate-existing --device … com.reelive.app`). Metro-Reload genügt nur für reine TS/TSX-Tasks.
- Geräte-Schritte laufen mit dem User zusammen: App bedient der User, Logs liest der Executor im Metro-Task-Output (Monitor auf `dbg-`-Zeilen). Metro gehört dieser Session; falls er nicht läuft: `npx expo start` als Hintergrund-Task.
- Der heutige Video-Weg (recordAsync + createVideoPlayer + Poster, Commit 918e185) bleibt in jedem Task lauffähig — er ist die Rückfallebene der Spec.
- Commits nach jedem Task, Nachricht deutsch im Stil des Repos, mit `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Modul-Gerüst `KameraAufnahme` + Phase-0-Probe (Machbarkeits-Weiche)

**Files:**
- Create: `mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift`
- Modify: `mobile/modules/kamera-zoom/expo-module.config.json`
- Modify (temporär, Probe): `mobile/src/app/(tabs)/aufnehmen/index.tsx`

**Interfaces:**
- Produces: Modul-Name `"KameraAufnahme"`; AsyncFunction `abgriffProbe(sekunden: Double) -> Int` (temporär, fliegt in Task 3); statische Helfer `sucherView()`/`session()` (Wiederverwendung des Suchwegs aus KameraZoomModule).

- [ ] **Step 1: Modul-Klasse mit Probe schreiben**

```swift
// mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift
import AVFoundation
import ExpoModulesCore
import UIKit

// Eigene Video-Aufnahme (Spec 2026-08-14-instant-video-vorschau): greift die
// Puffer der laufenden expo-camera-Session ab, statt auf recordAsyncs Datei
// zu warten. Dieses Gerüst trägt zuerst nur die Phase-0-Probe: bekommt ein
// VideoDataOutput NEBEN dem untätigen MovieFileOutput überhaupt Frames?
public class KameraAufnahmeModule: Module {
  private static var probeOutput: AVCaptureVideoDataOutput?
  private static let probeQueue = DispatchQueue(label: "reelive.aufnahme.probe")
  private static var probeDelegate: ProbeZaehler?

  public func definition() -> ModuleDefinition {
    Name("KameraAufnahme")

    // Zählt `sekunden` lang die eintreffenden Frames. > 0 heisst: der Abgriff
    // koexistiert mit dem angehängten MovieFileOutput, kein Entfernen nötig.
    AsyncFunction("abgriffProbe") { (sekunden: Double, promise: Promise) in
      guard
        let sucher = Self.sucherView(),
        let layer = sucher.layer as? AVCaptureVideoPreviewLayer,
        let session = layer.session
      else {
        promise.reject("keine_session", "Keine laufende Kamera-Session gefunden")
        return
      }
      let output = AVCaptureVideoDataOutput()
      let zaehler = ProbeZaehler()
      output.setSampleBufferDelegate(zaehler, queue: Self.probeQueue)
      session.beginConfiguration()
      guard session.canAddOutput(output) else {
        session.commitConfiguration()
        promise.resolve(-1) // -1: Session lehnt den Output ab (Weiche: Zweig B)
        return
      }
      session.addOutput(output)
      session.commitConfiguration()
      Self.probeOutput = output
      Self.probeDelegate = zaehler
      DispatchQueue.main.asyncAfter(deadline: .now() + sekunden) {
        session.beginConfiguration()
        session.removeOutput(output)
        session.commitConfiguration()
        Self.probeOutput = nil
        let anzahl = zaehler.anzahl
        Self.probeDelegate = nil
        promise.resolve(anzahl)
      }
    }.runOnQueue(.main)
  }

  // Gleicher Suchweg wie KameraZoomModule.sucherView(): die View, deren Layer
  // die Kamera-Vorschau IST. Bewusst dupliziert statt geteilt — die beiden
  // Module bleiben unabhängig voneinander lebensfähig.
  private static func sucherView() -> UIView? {
    let fenster = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    for einzelnes in fenster {
      if let treffer = sucherView(in: einzelnes) { return treffer }
    }
    return nil
  }

  private static func sucherView(in view: UIView) -> UIView? {
    if view.layer is AVCaptureVideoPreviewLayer { return view }
    for kind in view.subviews {
      if let treffer = sucherView(in: kind) { return treffer }
    }
    return nil
  }
}

private final class ProbeZaehler: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private(set) var anzahl = 0
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    anzahl += 1
  }
}
```

- [ ] **Step 2: Modul registrieren**

```json
{
  "platforms": ["apple"],
  "apple": {
    "modules": ["KameraZoomModule", "KameraAufnahmeModule"],
    "podspecPath": ["ios/KameraZoom.podspec"]
  }
}
```

- [ ] **Step 3: Temporäre Probe-Auslösung in den Kamera-Screen**

In `index.tsx` (direkt nach den bestehenden Hooks, klar als temporär markiert):

```tsx
// [dbg] Phase-0-Probe (Task 1, fliegt in Task 3 wieder raus): zählt 2 s lang
// Frames des Abgriffs neben dem untätigen MovieFileOutput.
useEffect(() => {
  const t = setTimeout(() => {
    const modul = requireOptionalNativeModule<{ abgriffProbe(s: number): Promise<number> }>('KameraAufnahme');
    void modul?.abgriffProbe(2).then((n) => console.log('[dbg-probe] Frames in 2 s:', n));
  }, 3000);
  return () => clearTimeout(t);
}, []);
```

(Import oben ergänzen: `import { requireOptionalNativeModule } from 'expo-modules-core';`)

- [ ] **Step 4: Build aufs Gerät, Probe lesen**

Run: `npx expo run:ios --device 00008150-001904342EF0401C` (Hintergrund-Task, Monitor auf «Build Succeeded|error:»). Danach User: Kamera-Tab öffnen, 5 s warten. Executor liest `[dbg-probe] Frames in 2 s: N` im Metro-Log.
Expected: Build 0 Fehler; N ≈ 50–60 → **Weiche: Koexistenz OK, weiter mit Task 2 wie geplant.** N ≤ 0 oder −1 → **STOPP: dem User berichten; die Folgetasks brauchen dann zuerst den Entfernen-Zweig** (MovieFileOutput per `session.removeOutput(session.outputs.first { $0 is AVCaptureMovieFileOutput })` im `aufnahmeStarten` entfernen und nach `AVCaptureSessionDidStartRunning`/Mute-Umbauten erneut prüfen — als eigener, dann einzuplanender Task vor Task 3).

- [ ] **Step 5: Commit**

```bash
git add modules/kamera-zoom/ios/KameraAufnahmeModule.swift modules/kamera-zoom/expo-module.config.json "src/app/(tabs)/aufnehmen/index.tsx"
git commit -m "feat(kamera): KameraAufnahme-Gerüst mit Phase-0-Probe des Frame-Abgriffs"
```

---

### Task 2: JS-Zugriffspunkt `nativeAufnahme.ts`

**Files:**
- Create: `mobile/src/features/kamera/nativeAufnahme.ts`
- Test: `mobile/src/features/kamera/__tests__/nativeAufnahme.test.ts`

**Interfaces:**
- Consumes: natives Modul `"KameraAufnahme"` (Task 1; die hier getippten Funktionen entstehen nativ in Task 3/6).
- Produces (für Tasks 10–12): `verfuegbar(): boolean` · `aufnahmeStarten(maxSekunden: number): Promise<boolean>` · `aufnahmeStoppen(): Promise<{ uri: string; dauerS: number } | null>` · `dateiFertig(): Promise<void>` · `verwerfen(): void` · `SofortVorschau` (native View-Komponente).

- [ ] **Step 1: Rote Tests schreiben**

```ts
// mobile/src/features/kamera/__tests__/nativeAufnahme.test.ts
// Der Zugriffspunkt kapselt das native Modul: fehlt es (Android, Simulator,
// alter Build), antwortet er mit false/null statt zu werfen — die Kamera
// fällt dann auf den recordAsync-Weg zurück (Spec: Rückfallebene).
const mockModul = {
  aufnahmeStarten: jest.fn(async (_s: number) => {}),
  aufnahmeStoppen: jest.fn(async () => ({ uri: 'file://a.mov', dauerS: 3.2 })),
  dateiAbwarten: jest.fn(async () => {}),
  verwerfen: jest.fn(async () => {}),
};
let mockVorhanden = true;
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => (mockVorhanden ? mockModul : null),
  requireNativeViewManager: () => () => null,
}));

import * as nativeAufnahme from '../nativeAufnahme';

beforeEach(() => {
  jest.clearAllMocks();
  mockVorhanden = true;
});

test('aufnahmeStarten meldet true, wenn das Modul startet', async () => {
  await expect(nativeAufnahme.aufnahmeStarten(90)).resolves.toBe(true);
  expect(mockModul.aufnahmeStarten).toHaveBeenCalledWith(90);
});

test('ohne Modul meldet aufnahmeStarten false statt zu werfen', async () => {
  mockVorhanden = false;
  await expect(nativeAufnahme.aufnahmeStarten(90)).resolves.toBe(false);
});

test('ein nativer Startfehler wird zu false (Rückfallebene), nicht zum Absturz', async () => {
  mockModul.aufnahmeStarten.mockRejectedValueOnce(new Error('läuft schon'));
  await expect(nativeAufnahme.aufnahmeStarten(90)).resolves.toBe(false);
});

test('aufnahmeStoppen reicht uri und dauerS durch', async () => {
  await expect(nativeAufnahme.aufnahmeStoppen()).resolves.toEqual({
    uri: 'file://a.mov',
    dauerS: 3.2,
  });
});

test('scheitert das Stoppen, kommt null (die Kamera zeigt dann den Fehlerweg)', async () => {
  mockModul.aufnahmeStoppen.mockRejectedValueOnce(new Error('kein writer'));
  await expect(nativeAufnahme.aufnahmeStoppen()).resolves.toBeNull();
});

test('dateiFertig reicht die Ablehnung des Schreibens unverändert weiter', async () => {
  const fehler = new Error('voller Speicher');
  mockModul.dateiAbwarten.mockRejectedValueOnce(fehler);
  await expect(nativeAufnahme.dateiFertig()).rejects.toBe(fehler);
});
```

*Hinweis Modul-Cache:* `nativeAufnahme.ts` merkt sich das Modul wie `nativeZoom.ts` (`undefined`/`null`); der `mockVorhanden=false`-Test braucht deshalb `jest.isolateModules` ODER der Cache wird pro Aufruf neu befragt — Entscheid: **kein Cache über `undefined` hinweg für `null`** ist hier falsch; nimm `jest.resetModules()` + dynamisches `require` im Test, exakt wie unten gezeigt, falls der obige direkte Import den Cache teilt:

```ts
function frisch(): typeof import('../nativeAufnahme') {
  let m: typeof import('../nativeAufnahme');
  jest.isolateModules(() => {
    m = require('../nativeAufnahme');
  });
  return m!;
}
```

(Dann in jedem Test `const nativeAufnahme = frisch();` statt des Top-Level-Imports.)

- [ ] **Step 2: Rot laufen lassen**

Run: `npx jest nativeAufnahme.test.ts`
Expected: FAIL — Modul `../nativeAufnahme` existiert nicht.

- [ ] **Step 3: Zugriffspunkt implementieren**

```ts
// mobile/src/features/kamera/nativeAufnahme.ts
// Zugang zum nativen Modul `KameraAufnahme` (modules/kamera-zoom, Datei
// KameraAufnahmeModule.swift). Diese Datei ist die EINZIGE Stelle, die es
// kennt — dasselbe Muster wie nativeZoom.ts. Fehlt das Modul (Android,
// Simulator, alter Build) oder scheitert der Start, antworten die Helfer mit
// false/null: die Kamera nimmt dann den recordAsync-Weg (Rückfallebene der
// Spec 2026-08-14-instant-video-vorschau).
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

type NativesAufnahmeModul = {
  aufnahmeStarten(maxSekunden: number): Promise<void>;
  aufnahmeStoppen(): Promise<{ uri: string; dauerS: number }>;
  dateiAbwarten(): Promise<void>;
  verwerfen(): Promise<void>;
};

let modul: NativesAufnahmeModul | null | undefined;

function nativesModul(): NativesAufnahmeModul | null {
  if (modul === undefined) {
    modul = requireOptionalNativeModule<NativesAufnahmeModul>('KameraAufnahme');
  }
  return modul;
}

export function verfuegbar(): boolean {
  return nativesModul() !== null;
}

export async function aufnahmeStarten(maxSekunden: number): Promise<boolean> {
  const m = nativesModul();
  if (!m) return false;
  try {
    await m.aufnahmeStarten(maxSekunden);
    return true;
  } catch {
    return false;
  }
}

export async function aufnahmeStoppen(): Promise<{ uri: string; dauerS: number } | null> {
  const m = nativesModul();
  if (!m) return null;
  try {
    return await m.aufnahmeStoppen();
  } catch {
    return null;
  }
}

// Löst, wenn finishWriting durch ist — das Gegenstück zu foto.datei beim
// Instant-Foto. Ablehnungen (voller Speicher) erreichen den Aufrufer
// unverändert, der Einsenden-catch zeigt sie an.
export function dateiFertig(): Promise<void> {
  const m = nativesModul();
  if (!m) return Promise.resolve();
  return m.dateiAbwarten();
}

export function verwerfen(): void {
  void nativesModul()?.verwerfen().catch(() => {});
}

// Die native Sofort-Vorschau (AVSampleBufferDisplayLayer): spielt Ringpuffer,
// dann Datei, loopt. Entsteht nativ in Task 8/9.
export const SofortVorschau = requireNativeViewManager('KameraAufnahme');
```

- [ ] **Step 4: Grün laufen lassen**

Run: `npx jest nativeAufnahme.test.ts && npx tsc --noEmit`
Expected: PASS, tsc leer.

- [ ] **Step 5: Commit**

```bash
git add src/features/kamera/nativeAufnahme.ts src/features/kamera/__tests__/nativeAufnahme.test.ts
git commit -m "feat(kamera): JS-Zugriffspunkt für die native Aufnahme"
```

---

### Task 3: AufnahmeSchreiber — Video in die Datei (noch ohne Ton)

**Files:**
- Modify: `mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift` (Probe raus, Aufnahme rein)
- Modify: `mobile/src/app/(tabs)/aufnehmen/index.tsx` (Probe-Effekt raus)

**Interfaces:**
- Produces (nativ): `aufnahmeStarten(maxSekunden)`, `aufnahmeStoppen() -> { uri, dauerS }`, `dateiAbwarten()`, `verwerfen()` — exakt die Signaturen, die Task 2 tippt. Interner Bestand `Aufnahme` (Writer, Start-Zeit, Ziel-URL) als statischer Zustand des Moduls.

- [ ] **Step 1: Probe entfernen, Aufnahme-Kern schreiben**

`abgriffProbe` samt `ProbeZaehler` und der `[dbg]`-Effekt in `index.tsx` fliegen raus. Der Kern (ersetzt den Modul-Inhalt; `sucherView()` bleibt):

```swift
public class KameraAufnahmeModule: Module {
  // Die Outputs hängen EINMAL an der Session und bleiben (jedes An-/Abhängen
  // ist ein Session-Umbau und damit ein sichtbarer Sucher-Ruckler, Spec §
  // Session-Umbauten). `laufend` schaltet nur, ob Puffer verarbeitet werden.
  private static var videoOutput: AVCaptureVideoDataOutput?
  private static let videoQueue = DispatchQueue(label: "reelive.aufnahme.video")
  private static var abgriff: PufferAbgriff?

  // Genau eine Aufnahme zu jeder Zeit (Pendant zum laeuftFoto-Guard in JS).
  static var aktuelle: Aufnahme?

  public func definition() -> ModuleDefinition {
    Name("KameraAufnahme")

    AsyncFunction("aufnahmeStarten") { (maxSekunden: Double, promise: Promise) in
      guard Self.aktuelle == nil else {
        promise.reject("laeuft_schon", "Es läuft bereits eine Aufnahme")
        return
      }
      guard
        let sucher = Self.sucherView(),
        let layer = sucher.layer as? AVCaptureVideoPreviewLayer,
        let session = layer.session
      else {
        promise.reject("keine_session", "Keine laufende Kamera-Session")
        return
      }
      do {
        try Self.outputsAnhaengen(session)
        let ziel = FileManager.default.temporaryDirectory
          .appendingPathComponent("reelive-\(UUID().uuidString).mov")
        let aufnahme = try Aufnahme(ziel: ziel, maxSekunden: maxSekunden)
        Self.aktuelle = aufnahme
        promise.resolve()
      } catch {
        promise.reject("start_gescheitert", error.localizedDescription)
      }
    }.runOnQueue(.main)

    AsyncFunction("aufnahmeStoppen") { (promise: Promise) in
      guard let aufnahme = Self.aktuelle else {
        promise.reject("keine_aufnahme", "Es läuft keine Aufnahme")
        return
      }
      aufnahme.stoppen()
      promise.resolve([
        "uri": aufnahme.ziel.absoluteString,
        "dauerS": aufnahme.dauerS,
      ])
    }.runOnQueue(.main)

    // Löst erst, wenn finishWriting durch ist — oder lehnt ab (voller
    // Speicher, Writer-Fehler). Das JS-dateiFertig-Promise hängt hieran.
    AsyncFunction("dateiAbwarten") { (promise: Promise) in
      guard let aufnahme = Self.aktuelle else {
        promise.resolve()
        return
      }
      aufnahme.wennFertig { fehler in
        if let fehler {
          promise.reject("schreiben_gescheitert", fehler.localizedDescription)
        } else {
          promise.resolve()
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("verwerfen") { (promise: Promise) in
      Self.aktuelle?.verwerfen()
      Self.aktuelle = nil
      promise.resolve()
    }.runOnQueue(.main)
  }

  private static func outputsAnhaengen(_ session: AVCaptureSession) throws {
    guard videoOutput == nil else { return }
    let output = AVCaptureVideoDataOutput()
    let abgriff = PufferAbgriff()
    output.setSampleBufferDelegate(abgriff, queue: videoQueue)
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    guard session.canAddOutput(output) else {
      throw NSError(domain: "reelive", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Session nimmt den Video-Abgriff nicht an",
      ])
    }
    session.addOutput(output)
    // Orientierung und Spiegelung wie im Sucher (Task 5 verfeinert Front).
    if let verbindung = output.connection(with: .video) {
      verbindung.videoOrientation = .portrait
    }
    videoOutput = output
    self.abgriff = abgriff
  }
  // sucherView()/sucherView(in:) wie in Task 1.
}

// Nimmt die Puffer entgegen und reicht sie an die laufende Aufnahme weiter.
final class PufferAbgriff: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    KameraAufnahmeModule.aktuelle?.schreibeVideo(sampleBuffer)
  }
}

// Eine Aufnahme: Writer, Zeiten, Fertig-Rückrufe. Alle Mitglieder laufen auf
// der videoQueue (die Delegate-Queue) oder sind davor/danach unveränderlich.
final class Aufnahme {
  let ziel: URL
  private let writer: AVAssetWriter
  private let videoEingang: AVAssetWriterInput
  private var sessionGestartet = false
  private var gestoppt = false
  private var fertigFehler: Error?
  private var fertigRueckrufe: [(Error?) -> Void] = []
  private var fertig = false
  private var startZeit = Date()
  private var stoppZeit: Date?
  private let maxSekunden: Double
  private var maxTimer: DispatchSourceTimer?

  var dauerS: Double { (stoppZeit ?? Date()).timeIntervalSince(startZeit) }

  init(ziel: URL, maxSekunden: Double) throws {
    self.ziel = ziel
    self.maxSekunden = maxSekunden
    writer = try AVAssetWriter(outputURL: ziel, fileType: .mov)
    videoEingang = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: 1080,
      AVVideoHeightKey: 1920,
    ])
    videoEingang.expectsMediaDataInRealTime = true
    writer.add(videoEingang)
    guard writer.startWriting() else { throw writer.error ?? NSError(domain: "reelive", code: 2) }
    startZeit = Date()
  }

  func schreibeVideo(_ puffer: CMSampleBuffer) {
    guard !gestoppt, writer.status == .writing else { return }
    let zeit = CMSampleBufferGetPresentationTimeStamp(puffer)
    if !sessionGestartet {
      writer.startSession(atSourceTime: zeit)
      sessionGestartet = true
      planeMaxStopp()
    }
    if videoEingang.isReadyForMoreMediaData {
      videoEingang.append(puffer)
    }
  }

  func stoppen() {
    guard !gestoppt else { return }
    gestoppt = true
    stoppZeit = Date()
    maxTimer?.cancel()
    videoEingang.markAsFinished()
    writer.finishWriting { [self] in
      let fehler = writer.status == .completed ? nil : (writer.error ?? NSError(domain: "reelive", code: 3))
      DispatchQueue.main.async {
        self.fertig = true
        self.fertigFehler = fehler
        self.fertigRueckrufe.forEach { $0(fehler) }
        self.fertigRueckrufe = []
      }
    }
  }

  func wennFertig(_ rueckruf: @escaping (Error?) -> Void) {
    if fertig { rueckruf(fertigFehler) } else { fertigRueckrufe.append(rueckruf) }
  }

  func verwerfen() {
    stoppen()
    wennFertig { _ in try? FileManager.default.removeItem(at: self.ziel) }
  }

  // Die Höchstdauer stoppt HART im Modul; der JS-Ring am Auslöser bleibt nur
  // die sichtbare Anzeige (Spec § Grenzfälle).
  private func planeMaxStopp() {
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + maxSekunden)
    timer.setEventHandler { [weak self] in self?.stoppen() }
    timer.resume()
    maxTimer = timer
  }
}
```

- [ ] **Step 2: Build aufs Gerät**

Run: `npx expo run:ios --device 00008150-001904342EF0401C`
Expected: Build Succeeded, 0 Fehler.

- [ ] **Step 3: Rohprobe am Gerät (temporär über die JS-Konsole der Kamera)**

Temporär in `index.tsx` (klar markiert, fliegt in Step 5 wieder raus):

```tsx
// [dbg] Task-3-Rohprobe: 3 s aufnehmen, Datei prüfen. Fliegt nach dem Lauf.
useEffect(() => {
  const t = setTimeout(async () => {
    const ok = await nativeAufnahme.aufnahmeStarten(90);
    console.log('[dbg-t3] start', ok);
    setTimeout(async () => {
      const e = await nativeAufnahme.aufnahmeStoppen();
      console.log('[dbg-t3] stopp', e);
      await nativeAufnahme.dateiFertig().then(
        () => console.log('[dbg-t3] datei fertig'),
        (f) => console.log('[dbg-t3] datei FEHLER', f)
      );
    }, 3000);
  }, 3000);
  return () => clearTimeout(t);
}, []);
```

User: Kamera-Tab öffnen, 8 s warten. Executor prüft im Metro-Log: `start true`, `stopp {uri…, dauerS≈3}`, `datei fertig`.
Expected: alle drei Zeilen; die dauerS liegt bei ~3.

- [ ] **Step 4: Sichtprüfung der Datei**

User: nichts. Executor: uri aus dem Log notieren — die eigentliche Sichtprüfung (spielt die .mov?) kommt in Task 12 über die App selbst; hier genügt `datei fertig` ohne Fehler.

- [ ] **Step 5: Rohprobe entfernen, committen**

```bash
git add modules/kamera-zoom/ios/KameraAufnahmeModule.swift "src/app/(tabs)/aufnehmen/index.tsx"
git commit -m "feat(kamera): eigener AVAssetWriter schreibt die Video-Aufnahme (noch ohne Ton)"
```

---

### Task 4: Tonspur (AudioDataOutput → AAC)

**Files:**
- Modify: `mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift`

**Interfaces:**
- Consumes: `Aufnahme` aus Task 3.
- Produces: `Aufnahme.schreibeTon(_:)`; Audio-Output am Session-Abgriff.

- [ ] **Step 1: Audio-Output und -Eingang ergänzen**

In `outputsAnhaengen` zusätzlich (eigene Queue `reelive.aufnahme.ton`):

```swift
private static var audioOutput: AVCaptureAudioDataOutput?
private static let audioQueue = DispatchQueue(label: "reelive.aufnahme.ton")
// … in outputsAnhaengen, nach dem Video-Output:
let ton = AVCaptureAudioDataOutput()
ton.setSampleBufferDelegate(abgriff, queue: audioQueue)
if session.canAddOutput(ton) {
  session.addOutput(ton)
  audioOutput = ton
}
// Kein Mikrofon (mute, Berechtigung fehlt): Aufnahme ohne Tonspur statt
// Scheitern (Spec § Grenzfälle) — deshalb kein throw hier.
```

`PufferAbgriff` unterscheidet die Quelle:

```swift
func captureOutput(
  _ output: AVCaptureOutput,
  didOutput sampleBuffer: CMSampleBuffer,
  from connection: AVCaptureConnection
) {
  if output is AVCaptureAudioDataOutput {
    KameraAufnahmeModule.aktuelle?.schreibeTon(sampleBuffer)
  } else {
    KameraAufnahmeModule.aktuelle?.schreibeVideo(sampleBuffer)
  }
}
```

`Aufnahme` bekommt den Ton-Eingang (im init, nur wenn die Session einen
Audio-Output hat — Parameter `mitTon: Bool` vom Modul beim Erzeugen):

```swift
private let tonEingang: AVAssetWriterInput?
// init:
if mitTon {
  let eingang = AVAssetWriterInput(mediaType: .audio, outputSettings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC,
    AVNumberOfChannelsKey: 1,
    AVSampleRateKey: 44_100,
  ])
  eingang.expectsMediaDataInRealTime = true
  writer.add(eingang)
  tonEingang = eingang
} else {
  tonEingang = nil
}

func schreibeTon(_ puffer: CMSampleBuffer) {
  guard !gestoppt, sessionGestartet, writer.status == .writing else { return }
  // Vor dem ersten VIDEO-Frame keinen Ton annehmen: die Writer-Session
  // startet auf der Video-Zeitbasis, früherer Ton würde abgeschnitten.
  if let eingang = tonEingang, eingang.isReadyForMoreMediaData {
    eingang.append(puffer)
  }
}
// stoppen(): zusätzlich tonEingang?.markAsFinished()
```

- [ ] **Step 2: Build + Gerätelauf**

Run: Build wie Task 3. Danach dieselbe Rohprobe-Technik (3-s-Aufnahme mit Sprechen), Log muss `datei fertig` zeigen.
Expected: keine Writer-Fehler; Sync-Sichtprüfung folgt in Task 13 über die App.

- [ ] **Step 3: Commit**

```bash
git add modules/kamera-zoom/ios/KameraAufnahmeModule.swift
git commit -m "feat(kamera): die eigene Aufnahme bekommt ihre Tonspur"
```

---

### Task 5: Orientierung und Spiegelung

**Files:**
- Modify: `mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift`

- [ ] **Step 1: Verbindung wie der Sucher konfigurieren**

In `outputsAnhaengen`, statt des festen `.portrait`:

```swift
if let verbindung = output.connection(with: .video),
   let sucherVerbindung = layer.connection {
  // Exakt wie der Sucher: gleiche Rotation, Front gespiegelt. Damit stimmen
  // Datei und Wahrnehmung überein (Spec: «wie man es im Sucher sieht»).
  if verbindung.isVideoOrientationSupported {
    verbindung.videoOrientation = sucherVerbindung.videoOrientation
  }
  if verbindung.isVideoMirroringSupported {
    verbindung.automaticallyAdjustsVideoMirroring = false
    verbindung.isVideoMirrored = sucherVerbindung.isVideoMirrored
  }
}
```

`outputsAnhaengen` braucht dafür die `layer` als Parameter (Signatur:
`outputsAnhaengen(_ session: AVCaptureSession, layer: AVCaptureVideoPreviewLayer)`).
Beim Kamerawechsel (Front/Back ausserhalb einer Aufnahme) ändert sich die
Verbindung — deshalb werden diese Zeilen zusätzlich in `aufnahmeStarten` vor
dem Erzeugen der `Aufnahme` erneut ausgeführt (idempotent).

- [ ] **Step 2: Build + Gerätelauf**

Rohprobe je einmal Back und Front (User wechselt per Doppeltipp), Hoch- und Querformat-Motiv filmen. Sichtprüfung der Ausrichtung folgt in Task 12/13 in der App; hier zählt: Build sauber, `datei fertig` in beiden Fällen.

- [ ] **Step 3: Commit**

```bash
git add modules/kamera-zoom/ios/KameraAufnahmeModule.swift
git commit -m "feat(kamera): eigene Aufnahme übernimmt Rotation und Spiegelung vom Sucher"
```

---

### Task 6: Unterbrechungen (Hintergrund/Anruf) sauber beenden

**Files:**
- Modify: `mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift`

- [ ] **Step 1: Beobachter in OnCreate/OnDestroy**

```swift
private static var unterbrechungsBeobachter: NSObjectProtocol?
// OnCreate:
Self.unterbrechungsBeobachter = NotificationCenter.default.addObserver(
  forName: .AVCaptureSessionWasInterrupted, object: nil, queue: .main
) { _ in
  // Anruf, Hintergrund, Split-View: das bis hierher Gefilmte bleibt eine
  // gültige Datei (Spec § Grenzfälle); der JS-Stopp läuft über den
  // Auslöser-Pfad, weil iOS die Berührungen ohnehin cancelt.
  Self.aktuelle?.stoppen()
}
// OnDestroy: Beobachter entfernen (Muster wie szenenBeobachter im Zoom-Modul).
```

- [ ] **Step 2: Build + Commit**

```bash
git add modules/kamera-zoom/ios/KameraAufnahmeModule.swift
git commit -m "feat(kamera): Unterbrechungen beenden die eigene Aufnahme sauber"
```

---

### Task 7: StartFenster — Ringpuffer der ersten Sekunde

**Files:**
- Modify: `mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift`

**Interfaces:**
- Produces: `Aufnahme.startFenster: [CMSampleBuffer]` (die ersten `STARTFENSTER_FRAMES` Video-Puffer, chronologisch) + `startFensterFreigeben()`.

- [ ] **Step 1: Fenster sammeln**

```swift
// Wie viele Frames die Sofort-Vorschau aus dem Speicher spielen kann, bevor
// die Datei übernimmt. 24 Frames ≈ 0,8 s bei 30 fps ≈ ~70 MB bei 1080p —
// nur für Sekunden im Speicher; wird nach Übernahme oder Verwerfen
// freigegeben. Am Gerät kalibrieren (Spec § Offene Kalibrierungen).
private let STARTFENSTER_FRAMES = 24

private(set) var startFenster: [CMSampleBuffer] = []

// in schreibeVideo, nach dem append:
if startFenster.count < STARTFENSTER_FRAMES {
  startFenster.append(puffer)
}

func startFensterFreigeben() {
  startFenster = []
}
// verwerfen(): zusätzlich startFensterFreigeben()
```

- [ ] **Step 2: Build + Commit**

```bash
git add modules/kamera-zoom/ios/KameraAufnahmeModule.swift
git commit -m "feat(kamera): das StartFenster hält die erste Sekunde im Speicher"
```

---

### Task 8: SofortVorschau-View — Abspielen aus dem Speicher

**Files:**
- Create: `mobile/modules/kamera-zoom/ios/SofortVorschauView.swift`
- Modify: `mobile/modules/kamera-zoom/ios/KameraAufnahmeModule.swift` (View registrieren)

**Interfaces:**
- Produces: Expo-View `"SofortVorschau"` (ohne Props; sie zeigt `KameraAufnahmeModule.aktuelle`).

- [ ] **Step 1: View mit Speicher-Wiedergabe**

```swift
// mobile/modules/kamera-zoom/ios/SofortVorschauView.swift
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
```

Registrierung im Modul (in `definition()`):

```swift
View(SofortVorschauView.self) {
  Name("SofortVorschau")
}
```

- [ ] **Step 2: Build + Commit**

```bash
git add modules/kamera-zoom/ios/SofortVorschauView.swift modules/kamera-zoom/ios/KameraAufnahmeModule.swift
git commit -m "feat(kamera): SofortVorschau spielt das StartFenster aus dem Speicher"
```

---

### Task 9: SofortVorschau — nahtlos in die Datei, dann Loop

**Files:**
- Modify: `mobile/modules/kamera-zoom/ios/SofortVorschauView.swift`

- [ ] **Step 1: Datei-Fortsetzung und Endlos-Loop**

```swift
private var leser: AVAssetReader?
private var leserAusgabe: AVAssetReaderTrackOutput?
private var naechsteStartZeit = CMTime.zero

// Nach spieleStartFenster: sobald die Datei fertig ist, ab der Position NACH
// dem Fenster aus der Datei weiterlesen; am Ende von vorn (Loop). Freigabe
// des Fensters, sobald die Datei übernommen hat (Spec § Speicherhaushalt).
private func dateiUebernimmt(_ aufnahme: Aufnahme) {
  aufnahme.wennFertig { [weak self] fehler in
    guard fehler == nil else { return } // Fenster loopen ist der Notnagel
    aufnahme.startFensterFreigeben()
    self?.leseDatei(ab: self?.fensterEnde(aufnahme) ?? .zero, aufnahme: aufnahme)
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
  anzeige.requestMediaDataWhenReady(on: DispatchQueue(label: "reelive.vorschau.lesen")) { [weak self] in
    guard let self, let ausgabe = self.leserAusgabe else { return }
    while self.anzeige.isReadyForMoreMediaData {
      if let puffer = ausgabe.copyNextSampleBuffer() {
        self.anzeige.enqueue(puffer)
      } else {
        // Dateiende: Loop — Anzeige leeren, Zeitbasis neu auf den Anfang,
        // Leser von vorn.
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
```

`didMoveToWindow` ruft nach `spieleStartFenster` zusätzlich `dateiUebernimmt(aufnahme)`. Beim Entfernen aus dem Fenster (`window == nil`): `leser?.cancelReading()`, `anzeige.flush()`, `anzeige.stopRequestingMediaData()`.

- [ ] **Step 2: Build + Gerätelauf**

Rohprobe-Technik: nach `aufnahmeStoppen` temporär die View einblenden ist hier unhandlich — die echte Sichtprüfung übernimmt Task 12 in der App. Hier: Build 0 Fehler.

- [ ] **Step 3: Commit**

```bash
git add modules/kamera-zoom/ios/SofortVorschauView.swift
git commit -m "feat(kamera): SofortVorschau wechselt nahtlos in die Datei und loopt"
```

---

### Task 10: Holder-Union in `uebergabe.ts`

**Files:**
- Modify: `mobile/src/features/kamera/uebergabe.ts`
- Test: `mobile/src/features/kamera/__tests__/uebergabe.test.ts`

**Interfaces:**
- Produces: `type VideoUebergabe = { art: 'nativ'; dateiFertig: Promise<void> } | { art: 'player'; player: VideoPlayer; poster: string | null }` — `videoUebergeben`/`videoAbholen` unverändert benannt.

- [ ] **Step 1: Rote Tests (bestehende anpassen + neue Form)**

Bestehende Video-Tests: `videoUebergeben({ player, poster })` wird zu `videoUebergeben({ art: 'player', player, poster })`; die Release-Erwartung bleibt. Neu dazu:

```ts
test('die native Form trägt das dateiFertig-Promise und braucht kein release', () => {
  const fertig = Promise.resolve();
  videoUebergeben({ art: 'nativ', dateiFertig: fertig });
  const geholt = videoAbholen();
  expect(geholt?.art).toBe('nativ');
  expect(geholt && geholt.art === 'nativ' ? geholt.dateiFertig : null).toBe(fertig);
});

test('eine native Übergabe ersetzt eine liegengebliebene Player-Übergabe und gibt deren Player frei', () => {
  const alt = fakePlayer();
  videoUebergeben({ art: 'player', player: alt, poster: null });
  videoUebergeben({ art: 'nativ', dateiFertig: Promise.resolve() });
  expect((alt as unknown as { release: jest.Mock }).release).toHaveBeenCalled();
});
```

Wie beim Foto gilt: an `dateiFertig` hängt sofort ein leerer catch-Zweig, damit eine frühe Ablehnung ohne Abholer keine «Unhandled rejection» wird (Muster `uebergeben()`).

- [ ] **Step 2: Rot laufen lassen** — `npx jest uebergabe.test.ts` → FAIL (art unbekannt).

- [ ] **Step 3: Union implementieren**

```ts
export type VideoUebergabe =
  | {
      /** Die eigene Pipeline: Datei entsteht im Hintergrund, die Vorschau
       *  spielt nativ (SofortVorschau). uri und Dauer reisen als Params. */
      art: 'nativ';
      dateiFertig: Promise<void>;
    }
  | {
      /** Rückfallebene (Commit 918e185): vorgewärmter expo-video-Player. */
      art: 'player';
      player: VideoPlayer;
      poster: string | null;
    };

export function videoUebergeben(uebergabe: VideoUebergabe): void {
  if (videoLiegt?.art === 'player') videoLiegt.player.release();
  if (uebergabe.art === 'nativ') void uebergabe.dateiFertig.catch(() => {});
  videoLiegt = uebergabe;
}
```

- [ ] **Step 4: Grün + tsc** — `npx jest uebergabe.test.ts && npx tsc --noEmit`. (tsc meldet jetzt die Aufruf-Stellen in `index.tsx` — die fixt Task 11; bis dahin dort `{ art: 'player', player, poster }` einsetzen, das ist Teil DIESES Tasks, damit der Baum grün bleibt.)

- [ ] **Step 5: Commit**

```bash
git add src/features/kamera/uebergabe.ts src/features/kamera/__tests__/uebergabe.test.ts "src/app/(tabs)/aufnehmen/index.tsx" src/app/vorschau.tsx src/app/__tests__/vorschau.test.tsx "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"
git commit -m "feat(kamera): die Video-Übergabe kennt die native und die Player-Form"
```

---

### Task 11: Kamera-Screen-Weiche (Start/Stopp nativ, sonst Fallback)

**Files:**
- Modify: `mobile/src/app/(tabs)/aufnehmen/index.tsx`
- Test: `mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx`

**Interfaces:**
- Consumes: `nativeAufnahme` (Task 2), Holder-Union (Task 10).
- Produces: Ref `nutztNativeAufnahme` im Screen; Navigation ≤ einen Tick nach `aufnahmeStoppen()`.

- [ ] **Step 1: Rote Tests**

Mock oben bei den anderen: 

```ts
const mockNativeAufnahme = {
  aufnahmeStarten: jest.fn(async (_s: number) => true),
  aufnahmeStoppen: jest.fn(async () => ({ uri: 'file://nativ.mov', dauerS: 3.4 })),
  dateiFertig: jest.fn(() => Promise.resolve()),
  verwerfen: jest.fn(),
  verfuegbar: jest.fn(() => true),
  SofortVorschau: () => null,
};
jest.mock('@/features/kamera/nativeAufnahme', () => mockNativeAufnahme);
```

Tests (nutzen den bestehenden `videoGestoppt`-Helfer):

```ts
test('mit nativer Pipeline navigiert der Stopp sofort, ohne recordAsync und ohne Vorwärmen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  await videoGestoppt(() => {});
  expect(mockNativeAufnahme.aufnahmeStarten).toHaveBeenCalledWith(90);
  expect(mockRecordAsync).not.toHaveBeenCalled();
  expect(mockCreateVideoPlayer).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalled();
  const geholt = uebergabe.videoAbholen();
  expect(geholt?.art).toBe('nativ');
  // dauer kommt vom Modul, gerundet.
  expect(mockPush.mock.calls[0][0]).toMatchObject({ params: expect.objectContaining({ dauer: '3', uri: 'file://nativ.mov' }) });
});

test('startet die native Aufnahme nicht, läuft alles über den bisherigen Weg', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(geladen([reise()]));
  mockNativeAufnahme.aufnahmeStarten.mockResolvedValueOnce(false);
  let recordAufloesen: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(() => new Promise((r) => { recordAufloesen = r; }));
  await videoGestoppt((v) => recordAufloesen(v));
  expect(mockRecordAsync).toHaveBeenCalled();
  expect(uebergabe.videoAbholen()?.art).toBe('player');
});
```

(Der bestehende `videoGestoppt`-Helfer löst recordAsync auf — im Nativ-Test ist das ein Leerlauf, der Parameter bleibt `() => {}`.)

- [ ] **Step 2: Rot laufen lassen** — `npx jest kamera.test.tsx` → die zwei neuen FAIL.

- [ ] **Step 3: Weiche implementieren**

`handleVideoStart` (vor der recordAsync-Schleife):

```tsx
const nutztNativeAufnahme = useRef(false);
// in handleVideoStart, statt sofort videoPromise.current = starten():
void (async () => {
  nutztNativeAufnahme.current = await nativeAufnahme.aufnahmeStarten(MAX_VIDEO_SEKUNDEN);
  if (!nutztNativeAufnahme.current) videoPromise.current = starten();
})();
```

`handleVideoStop`, VOR dem bisherigen Ablauf:

```tsx
if (nutztNativeAufnahme.current) {
  nutztNativeAufnahme.current = false;
  const ergebnis = await nativeAufnahme.aufnahmeStoppen();
  setNimmtAuf(false);
  aufnahmeSperre.sperren(false);
  if (!ergebnis) {
    setAufnahmeFehler(FEHLER_TEXT);
    return;
  }
  uebergabe.videoUebergeben({ art: 'nativ', dateiFertig: nativeAufnahme.dateiFertig() });
  zurPreview({
    uri: ergebnis.uri,
    typ: 'video',
    dauer: String(Math.round(ergebnis.dauerS)),
    tripId: reise.id,
  });
  return;
}
// … danach unverändert der bisherige recordAsync/Vorwärm-Weg.
```

Import ergänzen: `import * as nativeAufnahme from '@/features/kamera/nativeAufnahme';`

- [ ] **Step 4: Grün + Gesamtlauf** — `npx jest kamera.test.tsx && npx tsc --noEmit`; alle Alt-Tests müssen grün bleiben (der Mock startet nativ per Default — Alt-Tests, die recordAsync erwarten, bekommen im `beforeEach` `mockNativeAufnahme.aufnahmeStarten.mockResolvedValue(false)`? **Nein — Entscheid:** Default im `beforeEach` ist `false` (Fallback), nur die Nativ-Tests stellen `true`. So bleiben alle bestehenden Tests unverändert gültig.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(tabs)/aufnehmen/index.tsx" "src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx"
git commit -m "feat(kamera): der Video-Stopp navigiert mit der nativen Pipeline sofort"
```

---

### Task 12: Vorschau-Weiche (SofortVorschau, Einsenden, Verwerfen)

**Files:**
- Modify: `mobile/src/app/vorschau.tsx`
- Test: `mobile/src/app/__tests__/vorschau.test.tsx`

**Interfaces:**
- Consumes: Holder-Union (Task 10), `nativeAufnahme.SofortVorschau`/`verwerfen` (Task 2).

- [ ] **Step 1: Rote Tests**

Mock: `jest.mock('@/features/kamera/nativeAufnahme', () => ({ verwerfen: jest.fn(), SofortVorschau: (props: { testID?: string }) => { const R = require('react'); const { View } = require('react-native'); return R.createElement(View, { testID: props.testID }); } }))` (Mock-Konstanten oben, wie bei den anderen).

```ts
test('eine native Übergabe zeigt die SofortVorschau statt der VideoView', async () => {
  mockParams = { uri: 'file://nativ.mov', typ: 'video', dauer: '3', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  uebergabe.videoUebergeben({ art: 'nativ', dateiFertig: Promise.resolve() });
  await render(<PreviewScreen />);
  expect(screen.getByTestId('sofort-vorschau')).toBeTruthy();
  expect(screen.queryByTestId('video-vorschau')).toBeNull();
});

test('Einsenden wartet bei nativer Übergabe auf dateiFertig', async () => {
  mockParams = { uri: 'file://nativ.mov', typ: 'video', dauer: '3', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  let aufloesen: () => void = () => {};
  uebergabe.videoUebergeben({ art: 'nativ', dateiFertig: new Promise((r) => { aufloesen = r; }) });
  await render(<PreviewScreen />);
  await act(async () => { await fireEvent.press(screen.getByText('Einsenden')); });
  expect(mockJobEinreihen).not.toHaveBeenCalled();
  await act(async () => { aufloesen(); });
  expect(mockJobEinreihen).toHaveBeenCalled();
  expect(mockVideoAufbereiten).toHaveBeenCalledWith('file://nativ.mov');
});

test('scheitert das Hintergrund-Schreiben, zeigt Einsenden den bestehenden Fehlerweg', async () => {
  mockParams = { uri: 'file://nativ.mov', typ: 'video', dauer: '3', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  uebergabe.videoUebergeben({ art: 'nativ', dateiFertig: Promise.reject(new Error('voll')) });
  await render(<PreviewScreen />);
  await act(async () => { await fireEvent.press(screen.getByText('Einsenden')); });
  expect(mockJobEinreihen).not.toHaveBeenCalled();
  expect(screen.getByText(/konnte nicht gesichert werden/)).toBeTruthy();
});

test('Verwerfen räumt bei nativer Übergabe über das Modul', async () => {
  mockParams = { uri: 'file://nativ.mov', typ: 'video', dauer: '3', tripId: 't1' };
  mockOrtBestimmen.mockResolvedValue({ lat: null, lng: null, place_name: null });
  uebergabe.videoUebergeben({ art: 'nativ', dateiFertig: Promise.resolve() });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('verwerfen-knopf'));
  expect(mockNativVerwerfen).toHaveBeenCalled();
  expect(mockDateiVerwerfen).not.toHaveBeenCalled();
});
```

Bestehende Player-Form-Tests: `videoUebergeben({...})` auf `art: 'player'` umstellen (Task 10 hat das eingeleitet).

- [ ] **Step 2: Rot laufen lassen** — `npx jest src/app/__tests__/vorschau.test.tsx`.

- [ ] **Step 3: Weiche implementieren**

- `vorbereitet` bleibt; Zugriffe werden art-bewusst: `const player = vorbereitet?.art === 'player' ? vorbereitet.player : eigenerPlayer;`
- Render (Video-Zweig): `vorbereitet?.art === 'nativ'` → `<SofortVorschau testID="sofort-vorschau" style={StyleSheet.absoluteFill} />`; sonst der heutige VideoView+Poster-Block.
- `absenden`: `quelle`-Zeile wird zu

```tsx
if (vorbereitet?.art === 'nativ') await vorbereitet.dateiFertig;
quelle = foto ? (await foto.datei).uri : (uri ?? null);
```

- `verwerfen`: vor den bestehenden Zweigen `if (vorbereitet?.art === 'nativ') { nativeAufnahme.verwerfen(); zurueckZurKamera(); return; }`
- Release-/Poster-Cleanup-Effekt: nur noch für `art === 'player'`.
- Import: `import * as nativeAufnahme from '@/features/kamera/nativeAufnahme';` und `const { SofortVorschau } = nativeAufnahme;`

- [ ] **Step 4: Grün + Gesamtlauf** — `npx jest src/app/__tests__/vorschau.test.tsx kamera.test.tsx uebergabe.test.ts nativeAufnahme.test.ts && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/vorschau.tsx src/app/__tests__/vorschau.test.tsx
git commit -m "feat(vorschau): native Übergabe spielt sofort, Einsenden wartet aufs Hintergrund-Schreiben"
```

---

### Task 13: Geräte-Messrunde und Abnahme

**Files:**
- Modify (temporär): `mobile/src/app/(tabs)/aufnehmen/index.tsx`, `mobile/src/app/vorschau.tsx` (Zeitstempel-Sonden, danach wieder raus)

- [ ] **Step 1: Sonden setzen** — `console.log('[dbg-stop] …', Date.now())` beim Loslassen; `console.log('[dbg-vorschau] montiert', Date.now())` beim Mount (Muster der Poster-Runde).
- [ ] **Step 2: Build aufs Gerät** (native Tasks 3–9 sind sonst nicht drauf): `npx expo run:ios --device 00008150-001904342EF0401C`.
- [ ] **Step 3: Messlauf mit dem User** — mehrere Videos (kurz/lang, Front/Back). Ziel: Loslassen → Vorschau montiert ≤ ~150 ms UND bewegtes Bild sichtbar (User-Urteil).
- [ ] **Step 4: Checkliste mit dem User (aus der Spec):** Ton-Bild-Sync im Recap · Orientierung/Spiegelung Front/Back · nahtloser Wechsel Speicher → Datei · sauberer Loop · 90-s-Stopp · Verwerfen räumt (Datei weg) · Hintergrund/Anruf während Aufnahme · voller Upload-Durchlauf mit echtem .mov (Einsenden → Recap).
- [ ] **Step 5: Sonden entfernen, Gesamtlauf** — `npx jest && npx tsc --noEmit && npx eslint src/`.
- [ ] **Step 6: Commit + Push (nur nach User-Freigabe)**

```bash
git add -A src/ modules/
git commit -m "feat(kamera): Instant-Video-Vorschau — Messrunde bestanden, Sonden entfernt"
```

---

## Self-Review (durchgeführt)

- **Spec-Abdeckung:** Erlebnis-Vertrag (T11+T12+T13), vier native Bausteine (T3–T9), Modul-API (T2/T3), Phase 0 (T1), Holder-Union (T10), Fehler-/Grenzfälle (T3 Guard, T4 ohne-Ton, T6 Unterbrechung, T12 Fehlerweg), Speicherhaushalt (T7/T9), Tests (alle JS-Tasks TDD, Geräte-Checkliste T13). Keine Lücke gefunden.
- **Platzhalter:** keine „TBD“/„später“; alle Code-Schritte tragen echten Code. Bewusst offen NUR die in der Spec deklarierten Kalibrierungen (STARTFENSTER_FRAMES, Bitrate).
- **Typ-Konsistenz:** `aufnahmeStarten/aufnahmeStoppen/dateiAbwarten/verwerfen` in T2 (JS-Typ) = T3 (Swift-API); Holder-Union T10 = Verwendung T11/T12; `SofortVorschau`-Name T2 = T8-Registrierung.
