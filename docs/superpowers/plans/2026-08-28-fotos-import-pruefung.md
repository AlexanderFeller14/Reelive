# Fotos-Import: Vollbild-Prüfung mit Fortschritt, Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nach der Auswahl erscheint sofort ein Vollbild-Screen mit allen Elementen; jedes zulässige Element lässt sich per x abwählen; nach «Einsenden» zeigt jede Kachel ihren Fortschritt (Video-Umwandlung in Prozent, Vorbereiten, Häkchen, Warnsymbol), danach die Erfolgsanimation und zurück zur Kamera.

**Architektur:** Der Picker gibt Originale zurück (`Current`/`Passthrough`). Ein neues expo-Modul `VideoExport` (Swift, AVAssetExportSession) wandelt HEVC nach H.264, mit Fortschritts-Events, angesprochen über `features/moments/videoExport.ts`. `libraryImportSubmit` meldet je Element Events. Eine neue Stack-Route `app/import-review.tsx` (Muster `/preview`) übernimmt Vorschau, Abwahl, Batch und Animation; die Kamera füllt nur noch den Halter `importHandoff.ts` und pusht die Route. `ImportConfirmSheet` wird gelöscht.

**Tech Stack:** Expo SDK 57, expo-modules-core (Swift), AVFoundation, React Native, TypeScript strict, Jest + @testing-library/react-native, expo-image, expo-video-thumbnails, Lucide.

**Spec:** `docs/superpowers/specs/2026-08-28-fotos-import-pruefung-design.md` (Vorgänger: `docs/superpowers/specs/2026-08-27-fotos-import-design.md`).

**Branch:** `worktree-import-review` ab `main` (63a2945).

## Global Constraints

- Quellcode englisch (Bezeichner, Kommentare, Testtitel, Swift-Kommentare); sichtbare Texte deutsch in Du-Form, Schweizer «ss»; Vokabular «Moment», «einsenden», «Reise»; nie «Snap», «Galerie», «hochladen».
- Keine Em-Dashes (Gedankenstriche) in Code, Kommentaren, Tests, Commit-Nachrichten, Spec.
- Native Methoden- und Event-Namen (`VideoExport`, `videoCodec`, `exportH264`, `exportProgress`) werden per Name dispatcht und müssen in Swift und TypeScript exakt gleich lauten.
- Medien-Screens in Kino-Palette (`cinema`-Tokens), UI auf Bildern nur als translucente `Pill`, Lucide Outline `strokeWidth 1.75`, Radius nur 12/24/999, Abstände aus `spacing`, keine Hex-Werte.
- Elemente werden strikt nacheinander verarbeitet; ein scheiterndes kostet nur sich selbst; jede Kopie in tmp wird auf jedem Pfad genau einmal freigegeben (`discardFile` ist gegen Doppelaufruf gesichert).
- Jest-Pfadmuster sind Regex: die Kamera-Datei mit `npx jest camera.test.tsx` laufen lassen, `(tabs)` nie in ein Muster schreiben. `render` von @testing-library/react-native ist asynchron: immer `await render(...)`.
- Nach Code-Änderungen ganz `src/` linten (`npx eslint src --ext .ts,.tsx 2>&1 | tail -3`, 28 vorbestehende Fehler bleiben, keine neuen), `npx tsc --noEmit` still. Ausgaben mit `| tail -40` begrenzen.
- Alle Befehle laufen in `mobile/`. Commit-Nachrichten `typ(scope): deutscher Satz`; nur die genannten Dateien hinzufügen.

---

### Task 1: Native-Modul `VideoExport` und Bridge `videoExport.ts`

Swift hat kein Test-Target; die Verifikation ist der Build in Task 7 plus die Geräte-Prüfliste. Die TypeScript-Bridge wird mit gemocktem Modul getestet.

**Files:**
- Create: `mobile/modules/camera-zoom/ios/VideoExportModule.swift`
- Modify: `mobile/modules/camera-zoom/expo-module.config.json` (Modul registrieren)
- Create: `mobile/src/features/moments/videoExport.ts`
- Test: `mobile/src/features/moments/__tests__/videoExport.test.ts`

**Interfaces:**
- Produces (Task 3 nutzt es): `export function available(): boolean`, `export const H264 = 'avc1'`, `export type EnsureH264Result = { uri: string; converted: boolean }`, `export async function ensureH264(uri: string, onProgress: (progress: number) => void): Promise<EnsureH264Result>`.
- Native: `AsyncFunction("videoCodec")(uri) -> String?`, `AsyncFunction("exportH264")(uri, exportId) -> { uri }`, Event `exportProgress` `{ exportId: String, progress: Double }`.

- [ ] **Step 1: Fehlschlagende Bridge-Tests schreiben**

`mobile/src/features/moments/__tests__/videoExport.test.ts`:

```ts
// The native module is dispatched by name (VideoExportModule.swift); this
// test replaces it with a scripted double and checks what the bridge does
// around it: skip, export with progress, fallbacks.
let mockModule: Record<string, unknown> | null = null;
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => mockModule,
}));

import { available, ensureH264 } from '../videoExport';

type Listener = (event: { exportId: string; progress: number }) => void;

function scriptedModule(codec: string | null) {
  const listeners: Listener[] = [];
  const remove = jest.fn();
  const mod = {
    videoCodec: jest.fn(async () => codec),
    exportH264: jest.fn(async (_uri: string, exportId: string) => {
      listeners.forEach((l) => l({ exportId, progress: 0.4 }));
      listeners.forEach((l) => l({ exportId: 'someone-else', progress: 0.9 }));
      return { uri: `file:///tmp/reelive-export-${exportId}.mp4` };
    }),
    addListener: jest.fn((_name: string, listener: Listener) => {
      listeners.push(listener);
      return { remove };
    }),
  };
  return { mod, remove };
}

beforeEach(() => {
  jest.resetModules();
  mockModule = null;
});

test('without the native module the video passes through unchanged', async () => {
  const onProgress = jest.fn();
  expect(available()).toBe(false);
  await expect(ensureH264('file:///a.mov', onProgress)).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
  expect(onProgress).not.toHaveBeenCalled();
});

test('an H.264 video is left alone', async () => {
  const { mod } = scriptedModule('avc1');
  mockModule = mod;
  const onProgress = jest.fn();
  await expect(ensureH264('file:///a.mov', onProgress)).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
  expect(mod.exportH264).not.toHaveBeenCalled();
  expect(onProgress).not.toHaveBeenCalled();
});

test('an unreadable codec is left alone rather than exported blindly', async () => {
  const { mod } = scriptedModule(null);
  mockModule = mod;
  await expect(ensureH264('file:///a.mov', jest.fn())).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
  expect(mod.exportH264).not.toHaveBeenCalled();
});

test('an HEVC video is exported, only its own progress events are forwarded, and the listener is removed', async () => {
  const { mod, remove } = scriptedModule('hvc1');
  mockModule = mod;
  const onProgress = jest.fn();
  const result = await ensureH264('file:///a.mov', onProgress);
  expect(result.converted).toBe(true);
  expect(result.uri).toMatch(/^file:\/\/\/tmp\/reelive-export-.*\.mp4$/);
  expect(mod.exportH264).toHaveBeenCalledWith('file:///a.mov', expect.any(String));
  expect(onProgress.mock.calls.map(([p]) => p)).toEqual([0.4, 1]);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a failing export rejects and still removes the listener', async () => {
  const { mod, remove } = scriptedModule('hvc1');
  (mod.exportH264 as jest.Mock).mockRejectedValue(new Error('export failed'));
  mockModule = mod;
  await expect(ensureH264('file:///a.mov', jest.fn())).rejects.toThrow('export failed');
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a failing codec lookup passes the video through', async () => {
  const { mod } = scriptedModule('hvc1');
  (mod.videoCodec as jest.Mock).mockRejectedValue(new Error('no track'));
  mockModule = mod;
  await expect(ensureH264('file:///a.mov', jest.fn())).resolves.toEqual({
    uri: 'file:///a.mov',
    converted: false,
  });
});
```

Hinweis zum Modul-Cache: die Bridge merkt sich das Modul beim ersten Zugriff. Damit jeder Test frisch startet, importiert der Test die Bridge NICHT statisch, sondern holt sie je Test mit `jest.isolateModules`. Schreibe die Tests deshalb so, dass sie die Funktionen über einen Helfer laden:

```ts
function loadBridge(): typeof import('../videoExport') {
  let bridge: typeof import('../videoExport') | undefined;
  jest.isolateModules(() => {
    bridge = require('../videoExport');
  });
  if (!bridge) throw new Error('bridge did not load');
  return bridge;
}
```

und ersetze `available(...)`/`ensureH264(...)` in jedem Test durch `const { available, ensureH264 } = loadBridge();` als erste Zeile des Tests (den statischen Import oben entfernen).

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/videoExport.test.ts 2>&1 | tail -20`
Expected: FAIL mit `Cannot find module '../videoExport'`.

- [ ] **Step 3: Bridge schreiben**

`mobile/src/features/moments/videoExport.ts`:

```ts
// Access to the native `VideoExport` module (modules/camera-zoom, file
// VideoExportModule.swift). This file is the ONLY place that knows it, same
// pattern as camera/multiCamera.ts. If the module is missing (Android, web,
// Jest, an old build) a video passes through unchanged: that is the state
// the app shipped in before this module existed.
import { requireOptionalNativeModule } from 'expo-modules-core';

// Native contract: every method and event key below is dispatched by name
// against VideoExportModule.swift and must keep its exact spelling.
type NativeVideoExportModule = {
  videoCodec(uri: string): Promise<string | null>;
  exportH264(uri: string, exportId: string): Promise<{ uri: string }>;
  addListener(
    eventName: 'exportProgress',
    listener: (event: { exportId: string; progress: number }) => void
  ): { remove(): void };
};

// `undefined` means "not looked up yet", `null` means "not present here".
let nativeModule: NativeVideoExportModule | null | undefined;

function getNativeModule(): NativeVideoExportModule | null {
  if (nativeModule === undefined) {
    nativeModule = requireOptionalNativeModule<NativeVideoExportModule>('VideoExport');
  }
  return nativeModule;
}

export function available(): boolean {
  return getNativeModule() !== null;
}

// The four-character code AVFoundation reports for H.264 tracks. Camera
// clips (CameraCaptureModule) and older library videos carry it; modern
// iPhones record HEVC ("hvc1") by default.
export const H264 = 'avc1';

export type EnsureH264Result = { uri: string; converted: boolean };

let exportCounter = 0;

// Hands back an H.264 file for the video: the file itself when it already
// is H.264, when the codec cannot be read (the export would be a blind
// guess), or when the module is missing; otherwise a fresh export in tmp
// that the caller owns and releases. `onProgress` gets 0..1 during an
// export only, and ends on 1.
export async function ensureH264(
  uri: string,
  onProgress: (progress: number) => void
): Promise<EnsureH264Result> {
  const m = getNativeModule();
  if (!m) return { uri, converted: false };
  let codec: string | null;
  try {
    codec = await m.videoCodec(uri);
  } catch (error) {
    console.error('[videoExport] codec lookup failed', uri, error);
    return { uri, converted: false };
  }
  if (codec === null || codec === H264) return { uri, converted: false };
  exportCounter += 1;
  const exportId = `${Date.now()}-${exportCounter}`;
  // Several exports never run at once (the batch is sequential), but the
  // id keeps the events honest should that ever change.
  const subscription = m.addListener('exportProgress', (event) => {
    if (event.exportId === exportId) onProgress(Math.max(0, Math.min(1, event.progress)));
  });
  try {
    const result = await m.exportH264(uri, exportId);
    onProgress(1);
    return { uri: result.uri, converted: true };
  } finally {
    subscription.remove();
  }
}
```

- [ ] **Step 4: Bridge-Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/videoExport.test.ts 2>&1 | tail -20`
Expected: 6 Tests grün.

- [ ] **Step 5: Swift-Modul schreiben**

`mobile/modules/camera-zoom/ios/VideoExportModule.swift`:

```swift
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
```

`mobile/modules/camera-zoom/expo-module.config.json`, Liste `modules` um `"VideoExportModule"` ergänzen:

```json
{
  "platforms": ["apple"],
  "apple": {
    "modules": [
      "CameraZoomModule",
      "CameraCaptureModule",
      "MultiCameraModule",
      "VideoExportModule"
    ],
    "podspecPath": ["ios/CameraZoom.podspec"]
  }
}
```

Der Podspec nimmt `**/*.swift` automatisch mit; nichts weiter nötig. Ein Kompilat entsteht erst in Task 7 (Native-Build); wer Xcode zur Hand hat, kann schon jetzt `cd mobile && xcodebuild -workspace ios/Reelive.xcworkspace -scheme Reelive -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath ios/build build 2>&1 | grep -E "error:|BUILD" | tail -5` laufen lassen (dauert Minuten, `mobile/ios` muss existieren); Pflicht ist es in Task 7.

- [ ] **Step 6: Typen, Lint, Commit**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx 2>&1 | tail -3`

```bash
cd mobile
git add modules/camera-zoom/ios/VideoExportModule.swift modules/camera-zoom/expo-module.config.json src/features/moments/videoExport.ts src/features/moments/__tests__/videoExport.test.ts
git commit -m "feat(video): Native-Modul VideoExport wandelt HEVC nach H.264 mit Fortschritt, Bridge mit Durchreichen ohne Modul"
```

---

### Task 2: Der Picker gibt Originale zurück

**Files:**
- Modify: `mobile/src/features/moments/libraryPicker.ts` (`OPTIONS`, `pickFromLibrary`)
- Test: `mobile/src/features/moments/__tests__/libraryPicker.test.ts`

**Interfaces:** unverändert (`pickFromLibrary(): Promise<PickResult>`, `SELECTION_LIMIT`).

- [ ] **Step 1: Tests anpassen**

Im `jest.mock('expo-image-picker', …)` die Enums erweitern:

```ts
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (options: unknown) => mockLaunch(options),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible', Current: 'current' },
  VideoExportPreset: { H264_1920x1080: 7, Passthrough: 0 },
}));
```

Im Test «opens a multi-select picker …» die zwei Erwartungen ändern: `preferredAssetRepresentationMode: 'current'` und `videoExportPreset: 0`. Den Testtitel auf `opens a multi-select picker for photos and videos with EXIF that hands over the originals` ändern. Einen Test ergänzen:

```ts
test('library lookups run in parallel, not one after the other', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///a.jpg', type: 'image', assetId: 'A' },
      { uri: 'file:///b.jpg', type: 'image', assetId: 'B' },
    ],
  });
  const started: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockAssetInfo.mockImplementation(async (id: string) => {
    started.push(id);
    await gate;
    return { creationTime: 1, location: undefined };
  });
  const pending = pickFromLibrary();
  // A macrotask lets the permission check and the picker resolve; both
  // lookups are then in flight before either has answered.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual(['A', 'B']);
  release();
  await expect(pending).resolves.toMatchObject({ canceled: false });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryPicker.test.ts 2>&1 | tail -25`
Expected: der Optionen-Test scheitert (noch `compatible`/`7`), der Parallel-Test scheitert (`started` ist `['A']`), die anderen grün.

- [ ] **Step 3: Optionen und Parallelität umstellen**

`OPTIONS` in `libraryPicker.ts` ersetzen durch:

```ts
// Explicitly typed, not `as const` (same trap as in AvatarPicker.tsx). And
// NO `allowsEditing`: that swaps in the legacy UIImagePickerController,
// which loads the source fully into memory and dies silently on large
// images (bug of 2026-08-13).
//
// The originals, untouched (spec 2026-08-28-fotos-import-pruefung): with
// `Compatible` the picker decoded every HEIC into a UIImage and re-encoded
// it as JPEG, and with an H.264 preset it exported every video, all BEFORE
// launchImageLibraryAsync resolved, without any progress. Twenty large
// elements took minutes of nothing. `Current` copies the file as it is
// (EXIF is still read on that path, MediaHandler.swift handleImage), and
// `Passthrough` copies the video bytes. HEIC becomes JPEG in preparePhoto,
// HEVC becomes H.264 in the batch (videoExport.ts), both with progress on
// screen.
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images', 'videos'],
  allowsMultipleSelection: true,
  selectionLimit: SELECTION_LIMIT,
  orderedSelection: true,
  exif: true,
  quality: 1,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
};
```

Den Kommentar über `SELECTION_LIMIT` anpassen: «Upper bound per round: the picker copies every selected asset before it hands the list over. With the originals that is a file copy each; twenty keeps it in the seconds.»

`pickFromLibrary` ersetzen durch:

```ts
export async function pickFromLibrary(): Promise<PickResult> {
  await requestReadAccess();
  const result = await ImagePicker.launchImageLibraryAsync(OPTIONS);
  if (result.canceled) return { canceled: true };
  // The lookups are local PhotoKit reads; in parallel they cost one round
  // trip for the whole selection instead of one per element.
  const infos = await Promise.all(result.assets.map((asset) => libraryInfo(asset.assetId)));
  const media: PickedMedia[] = result.assets.map((asset, index) => ({
    uri: asset.uri,
    kind: asset.type === 'video' ? 'video' : 'photo',
    durationMs: asset.duration ?? null,
    exif: asset.exif ?? null,
    creationTime: infos[index].creationTime,
    location: infos[index].location,
  }));
  return { canceled: false, media };
}
```

- [ ] **Step 4: Tests, Typen, Lint, Commit**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryPicker.test.ts 2>&1 | tail -12 && npx tsc --noEmit && npx eslint src --ext .ts,.tsx 2>&1 | tail -3`

```bash
cd mobile
git add src/features/moments/libraryPicker.ts src/features/moments/__tests__/libraryPicker.test.ts
git commit -m "feat(moments): Foto-Picker gibt die Originale sofort zurück, Bibliotheks-Infos parallel"
```

---

### Task 3: Halter `importHandoff.ts` und Batch mit Events je Element

**Files:**
- Create: `mobile/src/features/moments/importHandoff.ts`
- Test: `mobile/src/features/moments/__tests__/importHandoff.test.ts`
- Modify: `mobile/src/features/moments/libraryImportSubmit.ts`
- Test: `mobile/src/features/moments/__tests__/libraryImportSubmit.test.ts`

**Interfaces:**
- Consumes: `ensureH264` (Task 1), `AcceptedMedia`/`RefusedMedia` (`@/features/moments/libraryImport`).
- Produces:

```ts
// importHandoff.ts
export type ImportHandoff = {
  tripId: string;
  tripName: string;
  authorId: string;
  period: ImportPeriod;        // { start_date, end_date } of the trip, for the refusal summary's wording
  maxVideoSeconds: number;     // the camera's MAX_VIDEO_SECONDS, same reason
  accepted: AcceptedMedia[];
  refused: RefusedMedia[];
  counterBefore: number | null;
};
export function setImport(handoff: ImportHandoff): void;
export function takeImport(): ImportHandoff | null;

// libraryImportSubmit.ts (bestehende Exporte bleiben)
export type ImportItemEvent =
  | { stage: 'converting'; progress: number }
  | { stage: 'preparing' }
  | { stage: 'done' }
  | { stage: 'failed' };
export type ImportItemListener = (index: number, event: ImportItemEvent) => void;
export async function submitImports(accepted, target, onProgress: ImportProgress, onItem?: ImportItemListener): Promise<ImportOutcome>;
```

- [ ] **Step 1: Halter-Test schreiben**

`mobile/src/features/moments/__tests__/importHandoff.test.ts`:

```ts
import { setImport, takeImport, type ImportHandoff } from '../importHandoff';

const handoff = (): ImportHandoff => ({
  tripId: 't1',
  tripName: 'Norwegen mit dem Camper',
  authorId: 'u1',
  period: { start_date: '2026-08-01', end_date: '2026-08-14' },
  maxVideoSeconds: 90,
  accepted: [],
  refused: [],
  counterBefore: 4,
});

test('hands over exactly once', () => {
  const h = handoff();
  setImport(h);
  expect(takeImport()).toBe(h);
  expect(takeImport()).toBeNull();
});

test('a newer handoff replaces an older one that nobody took', () => {
  setImport(handoff());
  const newer = { ...handoff(), tripId: 't2' };
  setImport(newer);
  expect(takeImport()).toBe(newer);
});
```

- [ ] **Step 2: Halter schreiben**

`mobile/src/features/moments/importHandoff.ts`:

```ts
import type { AcceptedMedia, ImportPeriod, RefusedMedia } from './libraryImport';

// The assessed selection travels from the camera screen to the review
// route through this holder, the same reasoning as camera/handoff.ts:
// router params are strings, a list of assessed elements with their
// picker copies is not. Exactly ONE handoff is ever pending.
export type ImportHandoff = {
  tripId: string;
  tripName: string;
  authorId: string;
  // The trip period and the video limit the elements were assessed
  // against: the review's refusal summary names them.
  period: ImportPeriod;
  maxVideoSeconds: number;
  accepted: AcceptedMedia[];
  refused: RefusedMedia[];
  // The trip counter before the batch, for the celebration's roll; null
  // when it was not known at the time.
  counterBefore: number | null;
};

let pending: ImportHandoff | null = null;

export function setImport(handoff: ImportHandoff): void {
  pending = handoff;
}

export function takeImport(): ImportHandoff | null {
  const handoff = pending;
  pending = null;
  return handoff;
}
```

Run: `cd mobile && npx jest src/features/moments/__tests__/importHandoff.test.ts 2>&1 | tail -8` → 2 Tests grün.

- [ ] **Step 3: Batch-Tests erweitern**

In `libraryImportSubmit.test.ts` ein Mock für die Bridge hinter dem `placeAndTime`-Mock ergänzen:

```ts
const mockEnsureH264 = jest.fn();
jest.mock('../videoExport', () => ({
  ensureH264: (uri: string, onProgress: (p: number) => void) => mockEnsureH264(uri, onProgress),
}));
```

Im `beforeEach` ergänzen: `mockEnsureH264.mockImplementation(async (uri: string) => ({ uri, converted: false }));`

Am Ende der Datei anfügen:

```ts
test('reports each element: photos prepare then land, videos convert with progress first', async () => {
  mockEnsureH264.mockImplementation(async (_uri: string, onProgress: (p: number) => void) => {
    onProgress(0.4);
    onProgress(1);
    return { uri: 'file:///tmp/reelive-export-1.mp4', converted: true };
  });
  const onItem = jest.fn();

  const outcome = await submitImports(
    [acceptedPhoto('file:///a.jpg'), acceptedVideo('file:///b.mov')],
    TARGET,
    jest.fn(),
    onItem
  );

  expect(outcome).toEqual({ submitted: 2, failed: 0 });
  expect(onItem.mock.calls).toEqual([
    [0, { stage: 'preparing' }],
    [0, { stage: 'done' }],
    [1, { stage: 'converting', progress: 0.4 }],
    [1, { stage: 'converting', progress: 1 }],
    [1, { stage: 'preparing' }],
    [1, { stage: 'done' }],
  ]);
  // The converted file is what gets prepared and shipped; the original is
  // released like every picker copy.
  expect(mockPrepareVideo).toHaveBeenCalledWith('file:///tmp/reelive-export-1.mp4');
  expect(mockEnqueueJob.mock.calls[1][0]).toMatchObject({ storage_key: 'trips/t1/m2.mp4' });
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///b.mov');
  expect(mockDiscardIntermediates).toHaveBeenCalledWith('file:///b.mov', {
    medium: 'file:///tmp/reelive-export-1.mp4',
    thumb: 'file:///tmp/reelive-export-1.mp4.thumb.jpg',
  });
});

test('a video that already is H.264 skips the conversion events', async () => {
  const onItem = jest.fn();
  await submitImports([acceptedVideo('file:///b.mov')], TARGET, jest.fn(), onItem);
  expect(onItem.mock.calls).toEqual([
    [0, { stage: 'preparing' }],
    [0, { stage: 'done' }],
  ]);
  expect(mockPrepareVideo).toHaveBeenCalledWith('file:///b.mov');
});

test('a failing conversion marks the element failed and releases the original', async () => {
  mockEnsureH264.mockRejectedValueOnce(new Error('export failed'));
  const onItem = jest.fn();
  const outcome = await submitImports([acceptedVideo('file:///b.mov')], TARGET, jest.fn(), onItem);
  expect(outcome).toEqual({ submitted: 0, failed: 1 });
  expect(onItem).toHaveBeenLastCalledWith(0, { stage: 'failed' });
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///b.mov');
  expect(mockEnqueueJob).not.toHaveBeenCalled();
});

test('a conversion that succeeded before a later failure is released too', async () => {
  mockEnsureH264.mockImplementation(async () => ({
    uri: 'file:///tmp/reelive-export-1.mp4',
    converted: true,
  }));
  mockPrepareVideo.mockRejectedValueOnce(new Error('no frame'));
  await submitImports([acceptedVideo('file:///b.mov')], TARGET, jest.fn(), jest.fn());
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///tmp/reelive-export-1.mp4');
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///b.mov');
});

test('the item listener is optional', async () => {
  await expect(submitImports([acceptedPhoto('file:///a.jpg')], TARGET, jest.fn())).resolves.toEqual({
    submitted: 1,
    failed: 0,
  });
});
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryImportSubmit.test.ts 2>&1 | tail -30`
Expected: die vier neuen Event-Tests scheitern (kein `onItem`, keine Konvertierung), «the item listener is optional» und die bestehenden Tests grün.

- [ ] **Step 5: Batch umbauen**

In `libraryImportSubmit.ts` die Imports und Typen ergänzen (nach `import { describePlace } from './placeAndTime';`):

```ts
import { ensureH264 } from './videoExport';
```

Nach `export type ImportProgress = …;`:

```ts
// What one element is doing right now, for the review screen's tiles
// (spec 2026-08-28-fotos-import-pruefung): the H.264 export with its
// progress, the local preparation, and the outcome.
export type ImportItemEvent =
  | { stage: 'converting'; progress: number }
  | { stage: 'preparing' }
  | { stage: 'done' }
  | { stage: 'failed' };
export type ImportItemListener = (index: number, event: ImportItemEvent) => void;
```

`submitImports` ersetzen durch:

```ts
export async function submitImports(
  accepted: AcceptedMedia[],
  target: ImportTarget,
  onProgress: ImportProgress,
  onItem: ImportItemListener = () => {}
): Promise<ImportOutcome> {
  let submitted = 0;
  let failed = 0;
  for (const [index, item] of accepted.entries()) {
    const ok = await submitOne(item, target, (event) => onItem(index, event));
    if (ok) submitted += 1;
    else failed += 1;
    onProgress(submitted + failed, accepted.length);
  }
  return { submitted, failed };
}
```

`submitOne` ersetzen durch:

```ts
async function submitOne(
  item: AcceptedMedia,
  target: ImportTarget,
  report: (event: ImportItemEvent) => void
): Promise<boolean> {
  const source = item.media.uri;
  const postId = media.newMomentId();
  let prepared: { medium: string; thumb: string } | null = null;
  // The H.264 export, when one happened: an intermediate the batch owns,
  // released with the other intermediates (success) or by hand (failure
  // before `prepared` exists).
  let converted: string | null = null;
  try {
    if (item.media.kind === 'video') {
      // Library videos arrive as the picker copied them (HEVC on modern
      // iPhones); the export makes them playable in the web player. Camera
      // clips and older videos are H.264 already and pass straight through.
      const result = await ensureH264(source, (progress) => report({ stage: 'converting', progress }));
      if (result.converted) converted = result.uri;
      report({ stage: 'preparing' });
      prepared = await media.prepareVideo(result.uri);
    } else {
      report({ stage: 'preparing' });
      prepared = await media.preparePhoto(source);
    }
    // Durable copy BEFORE enqueuing (Final-Review, Critical 2): the picker
    // copy sits in tmp, which iOS may empty, while the queue holds moments
    // for days.
    const durable = await media.persistDurably(postId, prepared);
    const extension = media.mediaExtension(item.media.kind, prepared.medium);
    // The place comes from the element's own coordinates, never from the
    // current position: the moment was taken somewhere else.
    const place_name =
      item.lat != null && item.lng != null ? await describePlace(item.lat, item.lng) : null;
    const job: QueueJob = {
      id: postId,
      post_id: postId,
      trip_id: target.tripId,
      author_id: target.authorId,
      typ: item.media.kind,
      medium_uri: durable.medium,
      thumb_uri: durable.thumb,
      storage_key: media.storageKey(target.tripId, postId, extension),
      thumb_key: media.thumbKey(target.tripId, postId),
      caption: null,
      captured_at: item.captured_at,
      captured_tz: item.captured_tz,
      lat: item.lat,
      lng: item.lng,
      place_name,
      duration_s: item.duration_s,
      zustand: 'wartet',
      versuche: 0,
      naechster_versuch: Date.now(),
      zeile_angelegt: false,
      medium_geladen: false,
      thumb_geladen: false,
    };
    await uploadWorker.enqueueJob(job);
    media.discardFile(source);
    // Releases the export and the still frame: both differ from `source`.
    media.discardIntermediates(source, prepared);
    report({ stage: 'done' });
    return true;
  } catch (error) {
    media.removeMomentFiles(postId);
    if (prepared) media.discardIntermediates(source, prepared);
    else if (converted) media.discardFile(converted);
    media.discardFile(source);
    console.error('[libraryImportSubmit] element failed', source, error);
    report({ stage: 'failed' });
    return false;
  }
}
```

Falls tsc `accepted.entries()` in der `for…of`-Schleife ablehnt (Downlevel-Iteration), stattdessen `for (let index = 0; index < accepted.length; index += 1) { const item = accepted[index]; … }` schreiben.

- [ ] **Step 6: Tests, Typen, Lint, Commit**

Run: `cd mobile && npx jest src/features/moments 2>&1 | tail -12 && npx tsc --noEmit && npx eslint src --ext .ts,.tsx 2>&1 | tail -3`
Expected: alle Moments-Suites grün (die Kamera ruft `submitImports` weiterhin mit drei Argumenten; das vierte ist optional).

```bash
cd mobile
git add src/features/moments/importHandoff.ts src/features/moments/__tests__/importHandoff.test.ts src/features/moments/libraryImportSubmit.ts src/features/moments/__tests__/libraryImportSubmit.test.ts
git commit -m "feat(moments): Übergabe-Halter für den Import und Batch-Events je Element mit H.264-Umwandlung"
```

---

### Task 4: `CinemaButton` deaktivierbar und die Kachel `ImportTile`

**Files:**
- Modify: `mobile/src/components/CinemaButton.tsx`
- Test: `mobile/src/components/__tests__/CinemaButton.test.tsx`
- Create: `mobile/src/components/ImportTile.tsx`
- Test: `mobile/src/components/__tests__/ImportTile.test.tsx`

**Interfaces:**
- Produces: `CinemaButton` bekommt `disabled?: boolean` (kein Press, `accessibilityState.disabled`, gedimmte Fläche `cinema['bg-1']` mit Text `cinema['text-2']`).
- Produces: `ImportTile` mit Props

```ts
export type TileStatus = 'ready' | 'converting' | 'preparing' | 'done' | 'failed';
type Props = {
  thumb: string | null;          // photo: the picker copy; video: the still frame once loaded
  kind: 'photo' | 'video';
  durationS: number | null;      // videos show "12 s"
  status: TileStatus;
  progress: number;              // 0..1 while converting
  reason: string | null;         // refused: dims the tile and shows the label, no x
  onRemove: (() => void) | null; // the x, only while removable
  size: number;                  // square edge in points
  testID?: string;
};
```

Test-IDs: `${testID}-image` (Bild), `${testID}-placeholder`, `${testID}-remove` (x), `${testID}-status` (Status-Pille), `${testID}-reason`.

- [ ] **Step 1: CinemaButton-Test ergänzen**

In `CinemaButton.test.tsx` anfügen:

```tsx
test('a disabled button reports its state, dims, and swallows the press', () => {
  const onPress = jest.fn();
  render(<CinemaButton label="Nichts zum Einsenden" onPress={onPress} disabled />);
  const button = screen.getByLabelText('Nichts zum Einsenden');
  expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
  const text = screen.getByText('Nichts zum Einsenden');
  const flat = Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean));
  expect(flat.color).toBe(cinema['text-2']);
});
```

(Die Datei rendert bereits mit `render(...)`; falls sie `await render` nutzt, den Test `async` schreiben.)

- [ ] **Step 2: ImportTile-Test schreiben**

`mobile/src/components/__tests__/ImportTile.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { ImportTile } from '../ImportTile';

const mockImageProps = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: Record<string, unknown>) => {
      mockImageProps(props);
      return ReactActual.createElement(View, props);
    },
  };
});

const base = {
  thumb: 'file:///a.jpg',
  kind: 'photo' as const,
  durationS: null,
  status: 'ready' as const,
  progress: 0,
  reason: null,
  onRemove: null,
  size: 100,
  testID: 'tile',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('a ready photo shows its picture and, when removable, the x', async () => {
  const onRemove = jest.fn();
  await render(<ImportTile {...base} onRemove={onRemove} />);
  expect(mockImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: { uri: 'file:///a.jpg' } }));
  fireEvent.press(screen.getByLabelText('Aus der Auswahl entfernen'));
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('tile-status')).toBeNull();
});

test('a video without its still frame yet shows a placeholder and its length', async () => {
  await render(<ImportTile {...base} thumb={null} kind="video" durationS={12} />);
  expect(screen.getByTestId('tile-placeholder')).toBeTruthy();
  expect(screen.getByText('12 s')).toBeTruthy();
  expect(mockImageProps).not.toHaveBeenCalled();
});

test('a refused tile is dimmed, names its reason, and has no x', async () => {
  await render(<ImportTile {...base} reason="Ausserhalb der Reise" onRemove={jest.fn()} />);
  expect(screen.getByText('Ausserhalb der Reise')).toBeTruthy();
  expect(screen.queryByLabelText('Aus der Auswahl entfernen')).toBeNull();
  expect(screen.getByTestId('tile-reason')).toBeTruthy();
});

test('converting shows the percentage, preparing a spinner, done a check, failed the warning', async () => {
  const { rerender } = await render(<ImportTile {...base} status="converting" progress={0.42} />);
  expect(screen.getByText('42 %')).toBeTruthy();
  expect(screen.queryByLabelText('Aus der Auswahl entfernen')).toBeNull();

  rerender(<ImportTile {...base} status="preparing" />);
  expect(screen.getByTestId('tile-status')).toBeTruthy();
  expect(screen.queryByText(/%$/)).toBeNull();

  rerender(<ImportTile {...base} status="done" />);
  expect(screen.getByLabelText('Eingesendet')).toBeTruthy();

  rerender(<ImportTile {...base} status="failed" />);
  expect(screen.getByText('Nicht gesichert')).toBeTruthy();
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest CinemaButton.test.tsx ImportTile.test.tsx 2>&1 | tail -20`
Expected: der neue CinemaButton-Test scheitert (kein `disabled`), die Kachel-Tests mit `Cannot find module '../ImportTile'`.

- [ ] **Step 4: CinemaButton erweitern**

`CinemaButton` in `CinemaButton.tsx` ersetzen durch:

```tsx
export function CinemaButton({
  label,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  // Keeps the button in place but inert (the review screen with nothing
  // left to submit): dimmed surface, no press, told to VoiceOver.
  disabled?: boolean;
}) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      onPress={() => {
        if (!disabled) onPress();
      }}
    >
      <View style={[styles.button, disabled && styles.buttonDisabled]}>
        <Text style={[type.bodyMedium, { color: disabled ? cinema['text-2'] : cinema['bg-0'] }]}>
          {label}
        </Text>
      </View>
    </PressScale>
  );
}
```

und in den Styles ergänzen: `buttonDisabled: { backgroundColor: cinema['bg-1'] },`.

- [ ] **Step 5: ImportTile schreiben**

`mobile/src/components/ImportTile.tsx`:

```tsx
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, Film, TriangleAlert, X } from 'lucide-react-native';
import { Pill } from './Pill';
import { PressScale } from './PressScale';
import { cinema, radius, spacing, type } from '@/theme/tokens';

export type TileStatus = 'ready' | 'converting' | 'preparing' | 'done' | 'failed';

type Props = {
  thumb: string | null;
  kind: 'photo' | 'video';
  durationS: number | null;
  status: TileStatus;
  progress: number;
  reason: string | null;
  onRemove: (() => void) | null;
  size: number;
  testID?: string;
};

const REMOVE_SIZE = 28;

// One element of the review grid (spec 2026-08-28-fotos-import-pruefung):
// the picture (or a placeholder while a video's still frame loads), the
// video badge, the x while the element can still be dropped, and the
// batch status once submitting has started. A refused element is dimmed
// and names its reason instead of offering the x.
export function ImportTile({ thumb, kind, durationS, status, progress, reason, onRemove, size, testID }: Props) {
  const refused = reason !== null;
  const removable = onRemove !== null && !refused && status === 'ready';
  const id = testID ?? 'import-tile';
  return (
    <View style={[styles.tile, { width: size, height: size }]} testID={id}>
      {thumb ? (
        <Image
          testID={`${id}-image`}
          accessible={false}
          source={{ uri: thumb }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      ) : (
        <View testID={`${id}-placeholder`} style={[StyleSheet.absoluteFill, styles.center]}>
          {kind === 'video' ? (
            <Film size={22} color={cinema['text-2']} strokeWidth={1.75} />
          ) : (
            <ActivityIndicator color={cinema['text-2']} />
          )}
        </View>
      )}
      {refused && <View style={[StyleSheet.absoluteFill, styles.dim]} />}
      {kind === 'video' && durationS != null && !refused && (
        <Pill style={styles.badge}>
          <Film size={12} color={cinema['text-1']} strokeWidth={1.75} />
          <Text style={[type.label, { color: cinema['text-1'] }]}>{`${durationS} s`}</Text>
        </Pill>
      )}
      {refused && (
        <Pill testID={`${id}-reason`} style={styles.badge}>
          <Text style={[type.label, { color: cinema['text-1'] }]}>{reason}</Text>
        </Pill>
      )}
      {removable && (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="Aus der Auswahl entfernen"
          testID={`${id}-remove`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.removeWrap}
          onPress={onRemove}
        >
          <Pill style={styles.remove}>
            <X size={16} color={cinema['text-1']} strokeWidth={1.75} />
          </Pill>
        </PressScale>
      )}
      {status === 'converting' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} style={styles.status}>
            <Text style={[type.label, { color: cinema['text-1'] }]}>{`${Math.round(progress * 100)} %`}</Text>
          </Pill>
        </View>
      )}
      {status === 'preparing' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} style={styles.status}>
            <ActivityIndicator color={cinema['text-1']} />
          </Pill>
        </View>
      )}
      {status === 'done' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} accessibilityLabel="Eingesendet" style={styles.status}>
            <Check size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </Pill>
        </View>
      )}
      {status === 'failed' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} style={styles.status}>
            <TriangleAlert size={16} color={cinema['text-1']} strokeWidth={1.75} />
            <Text style={[type.label, { color: cinema['text-1'] }]}>Nicht gesichert</Text>
          </Pill>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: cinema['bg-1'],
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  // A refused element steps back: the pill colour as a wash over the
  // picture, the same ink the pills are made of.
  dim: { backgroundColor: cinema['overlay-pill'] },
  badge: {
    position: 'absolute',
    left: spacing.s,
    bottom: spacing.s,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  removeWrap: { position: 'absolute', top: spacing.s, right: spacing.s },
  remove: {
    width: REMOVE_SIZE,
    height: REMOVE_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
});
```

`Pill` nimmt `testID` und `accessibilityLabel` bereits entgegen (Pill.tsx Props).

- [ ] **Step 6: Tests, Typen, Lint, Commit**

Run: `cd mobile && npx jest CinemaButton.test.tsx ImportTile.test.tsx ImportIntroSheet.test.tsx 2>&1 | tail -12 && npx tsc --noEmit && npx eslint src --ext .ts,.tsx 2>&1 | tail -3`

```bash
cd mobile
git add src/components/CinemaButton.tsx src/components/__tests__/CinemaButton.test.tsx src/components/ImportTile.tsx src/components/__tests__/ImportTile.test.tsx
git commit -m "feat(ui): Import-Kachel mit Vorschau, Abwahl-x, Status und Grund; CinemaButton deaktivierbar"
```

---

### Task 5: Die Route `/import-review`

**Files:**
- Create: `mobile/src/app/import-review.tsx`
- Test: `mobile/src/app/__tests__/import-review.test.tsx`
- Modify: `mobile/src/features/auth/guard.ts:41-43` (`isAreaForSignedIn`)
- Test: `mobile/src/features/auth/__tests__/guard.test.ts` (Tabelle bei Zeile 56)

**Interfaces:**
- Consumes: `takeImport` (Task 3), `submitImports(accepted, target, onProgress, onItem)` und `discardRefused` (Task 3), `ImportTile` (Task 4), `CinemaButton`/`CinemaTextLink`, `MomentSubmissionAnimation`, `refusalSummary(..., 'preview')`, `getThumbnailAsync` (expo-video-thumbnails), `media.discardFile`, `useTopInset`/`useBottomInset` (`@/theme/useTopInset`), `setStatusBarStyle`.
- Produces: Route `/import-review`; sichtbare Texte laut Spec.

- [ ] **Step 1: Guard erweitern (Test zuerst)**

In `guard.test.ts` die Tabelle von `isAreaForSignedIn` um die Zeile `['import-review', true],` ergänzen (neben `'preview'`). Run `npx jest guard.test.ts 2>&1 | tail -8` → der neue Fall scheitert. Dann in `guard.ts`:

```ts
export function isAreaForSignedIn(area: string | undefined): boolean {
  return area === '(tabs)' || area === 'preview' || area === 'import-review';
}
```

Den Kommentar in `_layout.tsx` Zeile 70 (`// '(auth)' | '(tabs)' | 'preview' | 'join' | 'share' | undefined`) um `'import-review'` ergänzen. Run `npx jest guard.test.ts 2>&1 | tail -6` → grün.

- [ ] **Step 2: Routen-Test schreiben**

`mobile/src/app/__tests__/import-review.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import type { AcceptedMedia, RefusedMedia } from '@/features/moments/libraryImport';
import { setImport, takeImport } from '@/features/moments/importHandoff';

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
const mockStackScreenOptions = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: jest.fn(), canGoBack: () => mockCanGoBack }),
  Stack: {
    Screen: (props: { options?: object }) => {
      mockStackScreenOptions(props.options);
      return null;
    },
  },
}));

jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));

const mockGetThumbnail = jest.fn();
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (uri: string, options: unknown) => mockGetThumbnail(uri, options),
}));

const mockSubmitImports = jest.fn();
const mockDiscardRefused = jest.fn();
jest.mock('@/features/moments/libraryImportSubmit', () => ({
  submitImports: (...args: unknown[]) => mockSubmitImports(...args),
  discardRefused: (refused: unknown[]) => mockDiscardRefused(refused),
}));

const mockDiscardFile = jest.fn();
jest.mock('@/features/moments/media', () => ({
  discardFile: (uri: string) => mockDiscardFile(uri),
}));

const mockAnimationProps = jest.fn();
let mockFinishAnimation: (() => void) | null = null;
jest.mock('@/components/MomentSubmissionAnimation', () => ({
  MomentSubmissionAnimation: (props: {
    visible: boolean;
    onFinished: () => void;
    counter?: number | null;
    added?: number;
  }) => {
    mockAnimationProps(props);
    mockFinishAnimation = props.visible ? props.onFinished : null;
    return null;
  },
}));

import ImportReviewScreen from '../import-review';

function accepted(uri: string, kind: 'photo' | 'video' = 'photo'): AcceptedMedia {
  return {
    accepted: true,
    media: { uri, kind, durationMs: kind === 'video' ? 12_000 : null, exif: null, creationTime: 1, location: null },
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    duration_s: kind === 'video' ? 12 : null,
    lat: null,
    lng: null,
  };
}

function refused(uri: string, reason: RefusedMedia['reason']): RefusedMedia {
  return {
    accepted: false,
    media: { uri, kind: 'photo', durationMs: null, exif: null, creationTime: null, location: null },
    reason,
  };
}

function handoff(over: Partial<Parameters<typeof setImport>[0]> = {}) {
  setImport({
    tripId: 't1',
    tripName: 'Norwegen mit dem Camper',
    authorId: 'u1',
    period: { start_date: '2026-08-01', end_date: '2026-08-14' },
    maxVideoSeconds: 90,
    accepted: [accepted('file:///a.jpg'), accepted('file:///b.mov', 'video'), accepted('file:///c.jpg')],
    refused: [refused('file:///old.jpg', 'outside_period')],
    counterBefore: 4,
    ...over,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  takeImport();
  mockCanGoBack = true;
  mockFinishAnimation = null;
  mockGetThumbnail.mockResolvedValue({ uri: 'file:///b.thumb.jpg', width: 100, height: 100 });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 0 });
});

test('without a handoff the screen hands back to the camera', async () => {
  await render(<ImportReviewScreen />);
  expect(mockReplace).toHaveBeenCalledWith('/capture');
});

test('shows every element, loads the video still frame, dims the refused one with its reason', async () => {
  handoff();
  await render(<ImportReviewScreen />);

  expect(screen.getByText('Einsenden?')).toBeTruthy();
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getAllByLabelText('Aus der Auswahl entfernen')).toHaveLength(3);
  expect(screen.getByText('Ausserhalb der Reise')).toBeTruthy();
  expect(screen.getByText('3 Momente passen in den Reisezeitraum')).toBeTruthy();
  expect(screen.getByLabelText('3 Momente einsenden')).toBeTruthy();
  // The refusal summary explains the refused element in the present tense.
  expect(
    screen.getByText('1 von 4 Momenten kommt nicht mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).')
  ).toBeTruthy();
  await act(async () => {});
  expect(mockGetThumbnail).toHaveBeenCalledWith('file:///b.mov', { time: 0 });
  expect(screen.getByTestId('import-tile-1-image')).toBeTruthy();
});

test('the x drops an element, releases its copy, and the count follows', async () => {
  handoff();
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getAllByLabelText('Aus der Auswahl entfernen')[0]);
  });

  expect(mockDiscardFile).toHaveBeenCalledWith('file:///a.jpg');
  expect(screen.getAllByLabelText('Aus der Auswahl entfernen')).toHaveLength(2);
  expect(screen.getByText('2 Momente passen in den Reisezeitraum')).toBeTruthy();
  expect(screen.getByLabelText('2 Momente einsenden')).toBeTruthy();
});

test('with everything dropped the button is disabled and the text says so', async () => {
  handoff({ accepted: [accepted('file:///a.jpg')], refused: [] });
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Aus der Auswahl entfernen'));
  });

  expect(screen.getByText('Nichts zum Einsenden')).toBeTruthy();
  // The inert button carries a plain label so the footer text stays the
  // only "Nichts zum Einsenden" on screen.
  const button = screen.getByLabelText('Einsenden');
  expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  fireEvent.press(button);
  expect(mockSubmitImports).not.toHaveBeenCalled();
});

test('Abbrechen releases every remaining copy and goes back', async () => {
  handoff();
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });

  expect(mockDiscardFile.mock.calls.map(([uri]) => uri).sort()).toEqual(
    ['file:///a.jpg', 'file:///b.mov', 'file:///c.jpg'].sort()
  );
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///old.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('Einsenden runs the batch with progress per tile, locks the way back, then celebrates and returns', async () => {
  handoff();
  let finish: (outcome: { submitted: number; failed: number }) => void = () => {};
  let onItem: (index: number, event: unknown) => void = () => {};
  let onProgress: (done: number, total: number) => void = () => {};
  mockSubmitImports.mockImplementation(
    (_accepted: unknown, _target: unknown, progress: typeof onProgress, item: typeof onItem) =>
      new Promise((resolve) => {
        onProgress = progress;
        onItem = item;
        finish = resolve;
      })
  );
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('3 Momente einsenden'));
  });

  expect(mockSubmitImports).toHaveBeenCalledWith(
    [
      expect.objectContaining({ media: expect.objectContaining({ uri: 'file:///a.jpg' }) }),
      expect.objectContaining({ media: expect.objectContaining({ uri: 'file:///b.mov' }) }),
      expect.objectContaining({ media: expect.objectContaining({ uri: 'file:///c.jpg' }) }),
    ],
    { tripId: 't1', authorId: 'u1' },
    expect.any(Function),
    expect.any(Function)
  );
  expect(screen.queryByLabelText('Abbrechen')).toBeNull();
  expect(screen.queryAllByLabelText('Aus der Auswahl entfernen')).toHaveLength(0);
  expect(mockStackScreenOptions).toHaveBeenLastCalledWith(expect.objectContaining({ gestureEnabled: false }));

  await act(async () => {
    onItem(1, { stage: 'converting', progress: 0.42 });
  });
  expect(screen.getByText('42 %')).toBeTruthy();

  await act(async () => {
    onItem(1, { stage: 'done' });
    onProgress(1, 3);
  });
  expect(screen.getByText('1 von 3 Momenten')).toBeTruthy();
  expect(screen.getByLabelText('Eingesendet')).toBeTruthy();

  await act(async () => {
    onItem(2, { stage: 'failed' });
    onProgress(2, 3);
    finish({ submitted: 2, failed: 1 });
  });

  expect(screen.getByText('Nicht gesichert')).toBeTruthy();
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///old.jpg' })]);
  expect(mockAnimationProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ visible: true, counter: 4, added: 2 })
  );

  await act(async () => {
    mockFinishAnimation?.();
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('when nothing was submitted the screen stays with an explanation and a way back', async () => {
  handoff({ accepted: [accepted('file:///a.jpg')], refused: [] });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 1 });
  await render(<ImportReviewScreen />);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });

  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(screen.getByText('Keiner der Momente liess sich sichern.')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Zurück'));
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('without a way back the screen replaces itself with the camera', async () => {
  handoff({ accepted: [accepted('file:///a.jpg')], refused: [] });
  mockCanGoBack = false;
  await render(<ImportReviewScreen />);
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });
  expect(mockReplace).toHaveBeenCalledWith('/capture');
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest import-review.test.tsx 2>&1 | tail -20`
Expected: FAIL mit `Cannot find module '../import-review'`.

- [ ] **Step 4: Route schreiben**

`mobile/src/app/import-review.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { CinemaButton, CinemaTextLink } from '@/components/CinemaButton';
import { ImportTile, type TileStatus } from '@/components/ImportTile';
import { MomentSubmissionAnimation } from '@/components/MomentSubmissionAnimation';
import { cinema, spacing, type } from '@/theme/tokens';
import { useBottomInset, useTopInset } from '@/theme/useTopInset';
import * as media from '@/features/moments/media';
import { takeImport } from '@/features/moments/importHandoff';
import { discardRefused, submitImports, type ImportItemEvent } from '@/features/moments/libraryImportSubmit';
import { refusalSummary, type AcceptedMedia, type RefusalReason } from '@/features/moments/libraryImport';

const COLUMNS = 3;

const REASON_LABEL: Record<RefusalReason, string> = {
  outside_period: 'Ausserhalb der Reise',
  too_long: 'Zu lang',
  unknown_length: 'Ohne Länge',
  unknown_date: 'Ohne Datum',
  failed: 'Nicht gesichert',
};

type Item = {
  key: string;
  accepted: AcceptedMedia | null;
  reason: RefusalReason | null;
  uri: string;
  kind: 'photo' | 'video';
  durationS: number | null;
  thumb: string | null;
  status: TileStatus;
  progress: number;
};

type Phase = 'review' | 'submitting' | 'celebrating' | 'nothing';

function momentsText(count: number): string {
  return count === 1 ? '1 Moment' : `${count} Momente`;
}

// The review of a library selection (spec 2026-08-28-fotos-import-pruefung):
// a full-screen stack route over the tabs, like /preview. It takes the
// assessed selection from the handoff, shows every element as a tile,
// lets accepted ones be dropped, runs the batch with progress per tile,
// celebrates, and goes back. Everything the camera screen used to do
// after the picker now lives here.
export default function ImportReviewScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const topInset = useTopInset(spacing.xl);
  const bottomInset = useBottomInset(spacing.xl);
  const [handoff] = useState(() => takeImport());
  const [items, setItems] = useState<Item[]>(() =>
    handoff
      ? [
          ...handoff.accepted.map<Item>((entry) => ({
            key: entry.media.uri,
            accepted: entry,
            reason: null,
            uri: entry.media.uri,
            kind: entry.media.kind,
            durationS: entry.duration_s,
            thumb: entry.media.kind === 'photo' ? entry.media.uri : null,
            status: 'ready',
            progress: 0,
          })),
          ...handoff.refused.map<Item>((entry) => ({
            key: entry.media.uri,
            accepted: null,
            reason: entry.reason,
            uri: entry.media.uri,
            kind: entry.media.kind,
            durationS: entry.media.durationMs != null ? Math.round(entry.media.durationMs / 1000) : null,
            thumb: entry.media.kind === 'photo' ? entry.media.uri : null,
            status: 'ready',
            progress: 0,
          })),
        ]
      : []
  );
  const [phase, setPhase] = useState<Phase>('review');
  const [done, setDone] = useState(0);
  const [submitted, setSubmitted] = useState(0);
  // Shields setState after unmount: the batch and the still frames run on
  // promises that outlive a screen someone navigated away from.
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // Cinema look while this screen stands, like the preview.
  useEffect(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []);

  // Without a handoff (deep link, a restart mid-way) there is nothing to
  // review: back to the camera, same as the preview without a source.
  useEffect(() => {
    if (!handoff) router.replace('/capture');
  }, [handoff, router]);

  // Video still frames load one after the other; each tile shows its
  // placeholder until its own frame is in.
  useEffect(() => {
    let cancelled = false;
    const videos = items.filter((item) => item.kind === 'video' && item.thumb === null);
    void (async () => {
      for (const video of videos) {
        try {
          const frame = await getThumbnailAsync(video.uri, { time: 0 });
          if (cancelled || !active.current) return;
          setItems((current) =>
            current.map((item) => (item.key === video.key ? { ...item, thumb: frame.uri } : item))
          );
        } catch (error) {
          console.error('[import-review] still frame failed', video.uri, error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only on mount: dropped tiles need no frame, and a frame that arrives
    // for a dropped tile is filtered by key anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptedItems = useMemo(() => items.filter((item) => item.accepted !== null), [items]);
  const refusedEntries = useMemo(() => handoff?.refused ?? [], [handoff]);

  const backToCamera = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/capture');
  }, [router]);

  const removeItem = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item || phase !== 'review') return;
    media.discardFile(item.uri);
    setItems((current) => current.filter((entry) => entry.key !== key));
  };

  // Abbrechen, or the back gesture while reviewing: nothing entered the
  // queue, so every remaining copy (accepted and refused alike) leaves tmp.
  const cancel = () => {
    if (phase !== 'review') return;
    for (const item of acceptedItems) media.discardFile(item.uri);
    discardRefused(refusedEntries.map((entry) => entry.media));
    backToCamera();
  };

  const submit = async () => {
    if (!handoff || phase !== 'review' || acceptedItems.length === 0) return;
    const batch = acceptedItems.map((item) => item.accepted as AcceptedMedia);
    setPhase('submitting');
    setDone(0);
    let outcome: { submitted: number; failed: number };
    try {
      outcome = await submitImports(
        batch,
        { tripId: handoff.tripId, authorId: handoff.authorId },
        (finished) => {
          if (active.current) setDone(finished);
        },
        (index, event: ImportItemEvent) => {
          if (!active.current) return;
          const key = batch[index].media.uri;
          setItems((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    ...item,
                    status: event.stage,
                    progress: event.stage === 'converting' ? event.progress : item.progress,
                  }
                : item
            )
          );
        }
      );
    } catch (error) {
      // submitImports catches per element; this is the queue itself failing
      // to initialize. Every element then counts as failed.
      console.error('[import-review] batch failed', error);
      outcome = { submitted: 0, failed: batch.length };
    }
    // The refused copies were only kept for their tiles.
    discardRefused(refusedEntries.map((entry) => entry.media));
    if (!active.current) return;
    setSubmitted(outcome.submitted);
    setPhase(outcome.submitted > 0 ? 'celebrating' : 'nothing');
  };

  if (!handoff) return null;

  const gap = spacing.s;
  const tileSize = Math.floor((width - spacing.screen * 2 - gap * (COLUMNS - 1)) / COLUMNS);
  const reviewing = phase === 'review';
  const submittingCount = acceptedItems.length;
  const summary = refusalSummary(
    refusedEntries.map((entry) => entry.reason),
    handoff.accepted.length + refusedEntries.length,
    handoff.period,
    handoff.maxVideoSeconds,
    'preview'
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ animation: 'none', gestureEnabled: reviewing }} />
      <View style={[styles.header, { paddingTop: topInset }]}>
        <View style={styles.headerTexts}>
          <Text style={[type.h2, { color: cinema['text-1'] }]}>
            {phase === 'submitting' ? `${done} von ${submittingCount} Momenten` : 'Einsenden?'}
          </Text>
          <Text numberOfLines={1} style={[type.secondary, { color: cinema['text-2'] }]}>
            {handoff.tripName}
          </Text>
        </View>
        {reviewing && <CinemaTextLink label="Abbrechen" onPress={cancel} />}
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={[styles.grid, { gap }]}
        renderItem={({ item, index }) => (
          <ImportTile
            testID={`import-tile-${index}`}
            thumb={item.thumb}
            kind={item.kind}
            durationS={item.durationS}
            status={item.status}
            progress={item.progress}
            reason={item.reason ? REASON_LABEL[item.reason] : null}
            onRemove={reviewing && item.accepted ? () => removeItem(item.key) : null}
            size={tileSize}
          />
        )}
        ListFooterComponent={
          summary ? (
            <Text style={[type.secondary, styles.summary, { color: cinema['text-2'] }]}>{summary}</Text>
          ) : null
        }
      />
      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        {phase === 'nothing' ? (
          <>
            <Text style={[type.body, { color: cinema['text-1'] }]}>Keiner der Momente liess sich sichern.</Text>
            <CinemaButton label="Zurück" onPress={backToCamera} />
          </>
        ) : (
          <>
            <Text style={[type.body, { color: cinema['text-1'] }]}>
              {acceptedItems.length === 0
                ? 'Nichts zum Einsenden'
                : acceptedItems.length === 1
                  ? '1 Moment passt in den Reisezeitraum'
                  : `${acceptedItems.length} Momente passen in den Reisezeitraum`}
            </Text>
            <CinemaButton
              label={acceptedItems.length === 0 ? 'Einsenden' : `${momentsText(acceptedItems.length)} einsenden`}
              onPress={() => void submit()}
              disabled={!reviewing || acceptedItems.length === 0}
            />
          </>
        )}
      </View>
      <MomentSubmissionAnimation
        visible={phase === 'celebrating'}
        onFinished={backToCamera}
        counter={handoff.counterBefore}
        added={submitted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  header: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.base,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.m,
  },
  headerTexts: { flexShrink: 1, gap: spacing.xs },
  grid: { paddingHorizontal: spacing.screen, paddingBottom: spacing.l },
  summary: { marginTop: spacing.base },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.base,
    gap: spacing.m,
    backgroundColor: cinema['bg-0'],
  },
});
```

Ein Punkt, den der Implementierer prüfen muss: `gestureEnabled` ist eine native-stack-Option von `Stack.Screen`; falls tsc sie im Options-Typ nicht kennt, prüfen, welchen Typ `Stack.Screen` in diesem Projekt trägt (`preview.tsx` setzt `animation`), und die Option so setzen, dass tsc sie ohne Cast akzeptiert.

- [ ] **Step 5: Tests, Typen, Lint**

Run: `cd mobile && npx jest import-review.test.tsx importHandoff.test.ts guard.test.ts 2>&1 | tail -20 && npx tsc --noEmit && npx eslint src --ext .ts,.tsx 2>&1 | tail -3`
Expected: alle grün; tsc still; Lint bei 28.

Stolpersteine: `FlatList` in Jest rendert alle Elemente (kein Virtualisierungsproblem bei vier Kacheln). `getAllByLabelText('Aus der Auswahl entfernen')[0]` ist die erste zulässige Kachel (`a.jpg`), weil die zulässigen vor den abgelehnten stehen.

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/app/import-review.tsx src/app/__tests__/import-review.test.tsx src/features/auth/guard.ts src/features/auth/__tests__/guard.test.ts src/app/_layout.tsx
git commit -m "feat(camera): Vollbild-Prüfung der Fotos-Auswahl mit Abwahl, Fortschritt je Kachel und Animation"
```

---

### Task 6: Die Kamera übergibt an die Route; Bestätigungs-Sheet entfällt

**Files:**
- Modify: `mobile/src/app/(tabs)/capture/index.tsx`
- Modify: `mobile/src/app/(tabs)/capture/__tests__/camera.test.tsx` (Mocks bei Zeile 276-312, Import-Block ab `// === Library import (spec 2026-08-27, confirmation 2026-08-27) ===` bis Dateiende)
- Delete: `mobile/src/components/ImportConfirmSheet.tsx`, `mobile/src/components/__tests__/ImportConfirmSheet.test.tsx`

**Interfaces:**
- Consumes: `setImport` (Task 3, mit `period`/`maxVideoSeconds` aus Task 5), Route `/import-review` (Task 5).

- [ ] **Step 1: Tests umschreiben**

In `camera.test.tsx`:
- Den Mock von `@/features/moments/libraryImportSubmit` auf `discardRefused` reduzieren (kein `submitImports` mehr), `mockSubmitImports` samt seiner `beforeEach`-Zeile entfernen.
- Den Mock von `@/components/MomentSubmissionAnimation` samt `mockAnimationProps`/`mockFinishAnimation` und der `beforeEach`-Zeile entfernen (die Kamera rendert die Animation nicht mehr).
- Import ergänzen: `import { takeImport } from '@/features/moments/importHandoff';` und im `beforeEach` `takeImport();` (leert einen Halter aus einem früheren Test).
- Den Block ab dem Marker-Kommentar bis zum Dateiende ersetzen durch:

```ts
// === Library import (spec 2026-08-27, review 2026-08-28) ===

test('the import button opens the intro sheet; Abbrechen closes it without touching the library', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(screen.getByText('Momente aus Fotos')).toBeTruthy();
  expect(screen.getByText('Nur Momente aus dem Reisezeitraum (1.–14. Aug 2026)')).toBeTruthy();
  expect(mockPickFromLibrary).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });

  expect(screen.queryByText('Momente aus Fotos')).toBeNull();
  expect(mockPickFromLibrary).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('"Fotos auswählen" opens the picker, and a canceled picker leaves the viewfinder untouched', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(mockPickFromLibrary).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
  expect(takeImport()).toBeNull();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
});

test('after the picker the assessed selection goes to the review route through the handoff', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockOwnCounter.mockImplementation(async () => 4);
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      pickedPhoto('file:///old.jpg', Date.UTC(2026, 6, 20, 12)),
    ],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await screen.findByText('4 Momente');

  await openLibrary();

  expect(mockPush).toHaveBeenCalledWith('/import-review');
  const handoff = takeImport();
  expect(handoff).toMatchObject({
    tripId: 't1',
    tripName: 'Norwegen mit dem Camper',
    authorId: 'u1',
    period: { start_date: '2026-08-01', end_date: '2026-08-14' },
    maxVideoSeconds: 90,
    counterBefore: 4,
  });
  expect(handoff?.accepted.map((item) => item.media.uri)).toEqual(['file:///a.jpg']);
  expect(handoff?.refused.map((item) => [item.media.uri, item.reason])).toEqual([
    ['file:///old.jpg', 'outside_period'],
  ]);
  // Refused copies are NOT released here any more: the review shows them.
  expect(mockDiscardRefused).not.toHaveBeenCalled();
});

test('a failing picker says so in the pill', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockRejectedValue(new Error('picker broke'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(screen.getByText('Deine Fotos liessen sich nicht öffnen. Probier es nochmal.')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

test('without a session the picked elements are released and the pill says so', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  mockAuth.userId = null;
  await refocusScreen();
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.getByText('Du bist nicht angemeldet. Melde dich an und probier es nochmal.')).toBeTruthy();
});

test('while the picker is pending the header button opens no second intro', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePicker: (result: { canceled: true }) => void = () => {};
  mockPickFromLibrary.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });
  expect(screen.queryByText('Momente aus Fotos')).toBeNull();

  await act(async () => {
    resolvePicker({ canceled: true });
  });
  expect(mockPickFromLibrary).toHaveBeenCalledTimes(1);
});

test('a blur while the picker is open releases the picked copies', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePicker: (result: { canceled: false; media: unknown[] }) => void = () => {};
  mockPickFromLibrary.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await blurScreen();

  await act(async () => {
    resolvePicker({
      canceled: false,
      media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
    });
  });

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockPush).not.toHaveBeenCalled();
});
```

Im bestehenden Kopfzeilen-Test bleibt die Zeile `expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();` unverändert.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest camera.test.tsx 2>&1 | tail -30`
Expected: «after the picker the assessed selection goes to the review route …» scheitert (`mockPush` nicht mit `/import-review` gerufen), evtl. weitere wegen des noch gerenderten Bestätigungs-Sheets; alle Nicht-Import-Tests grün.

- [ ] **Step 3: Kamera umbauen**

In `capture/index.tsx`:

1. Imports: `MomentSubmissionAnimation` und `ImportConfirmSheet` entfernen; aus `@/features/moments/libraryImportSubmit` nur noch `discardRefused` importieren; `refusalSummary` und `RefusalReason` aus dem `libraryImport`-Import entfernen, wenn danach ungenutzt (`assess`, `AcceptedMedia`, `PickedMedia`, `RefusedMedia` bleiben; `RefusedMedia` neu importieren); `ActivityIndicator` aus dem react-native-Import entfernen, falls nur die Fortschritts-Pille ihn nutzte (grep); neu: `import { setImport } from '@/features/moments/importHandoff';`.
2. State: `importing`, `importDone`, `heldSummary` samt Kommentaren löschen; `importStage` auf `{ kind: 'intro' } | null` verkürzen:

```ts
  // Whether the intro sheet stands (rules, "Fotos auswählen"). Everything
  // after the picker lives on the /import-review route now.
  const [importStage, setImportStage] = useState<{ kind: 'intro' } | null>(null);
```

3. Den Reise-Bindungs-Effekt (Kommentar «A confirmation sheet belongs to the trip …» bis `}, [trip?.id, importStage]);`) löschen.
4. Handler: `openImport` prüft nur noch `capturing || importRunning.current`; `cancelImport` wird `const cancelImport = () => setImportStage(null);`; `confirmImport` und `finishImport` löschen; in `pickAndAssess` den Schluss (ab `const deviceTz = …`) ersetzen durch:

```ts
      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const assessed = picked.media.map((item) => assess(item, trip, MAX_VIDEO_SECONDS, deviceTz));
      const accepted = assessed.filter((item): item is AcceptedMedia => item.accepted);
      const refused = assessed.filter((item): item is RefusedMedia => !item.accepted);
      // Refused copies stay for now: the review shows them dimmed with their
      // reason and releases them itself.
      setImport({
        tripId: trip.id,
        tripName: trip.name,
        authorId: userId,
        period: { start_date: trip.start_date, end_date: trip.end_date },
        maxVideoSeconds: MAX_VIDEO_SECONDS,
        accepted,
        refused,
        counterBefore: counter,
      });
      router.push('/import-review');
```

und den Kommentar über `openImport` auf die drei Züge anpassen (intro, pick and assess, hand over to the route).
5. Render: die Fortschritts-Pille (`{importing && (<Pill testID="import-progress" …>)}`), die Bedingung `{!importing && (` um den Auslöser (der Auslöser bleibt immer gerendert, wie vor dem Import), `<ImportConfirmSheet …/>` und `<MomentSubmissionAnimation …/>` entfernen; die Kopfzeilen-Bedingung wieder `{!capturing && (`. Den Style `importPill` löschen.
6. Konstanten `ERROR_MS_PER_CHARACTER`/`ERROR_MAX_MS` und die Haltezeit bleiben (Picker-Fehler und andere Pillen).
7. `ImportConfirmSheet.tsx` und seinen Test löschen (`git rm`).

- [ ] **Step 4: Tests, Typen, Lint**

Run: `cd mobile && npx jest camera.test.tsx 2>&1 | tail -12 && npx jest src/components 2>&1 | tail -6 && npx tsc --noEmit && npx eslint src --ext .ts,.tsx 2>&1 | tail -3`
Expected: Kamera-Datei grün; Komponenten grün; tsc still (ungenutzte Importe entfernen, bis Lint bei 28 steht).

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "src/app/(tabs)/capture/index.tsx" "src/app/(tabs)/capture/__tests__/camera.test.tsx"
git rm -q src/components/ImportConfirmSheet.tsx src/components/__tests__/ImportConfirmSheet.test.tsx
git commit -m "feat(camera): Fotos-Auswahl geht nach der Bewertung an die Vollbild-Prüfung, Bestätigungs-Sheet entfällt"
```

---

### Task 7: Spec-Verweis, Gesamtlauf, Native-Build

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-fotos-import-design.md` (Verweis)

- [ ] **Step 1: Verweis in der alten Spec**

Am Anfang des Abschnitts «## Ablauf in der Kamera» der Spec vom 27. August diesen Absatz einfügen: «Seit dem 28. August ersetzt `2026-08-28-fotos-import-pruefung-design.md` die Punkte 4 bis 8: der Picker gibt Originale zurück, die Bestätigung ist eine Vollbild-Route mit Abwahl und Fortschritt je Element, die Umwandlung der Videos passiert im Batch.»

- [ ] **Step 2: Gesamtlauf**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx 2>&1 | tail -3 && npm test 2>&1 | tail -8`
Expected: tsc still, Lint bei 28, Jest komplett grün.

- [ ] **Step 3: Native-Build (Pflicht, wegen des neuen Moduls)**

`mobile/ios` existiert (Prebuild vom 28. August). Das neue Swift-File nimmt der Podspec über `**/*.swift` automatisch mit, das Modul-Registry-File entsteht bei `pod install`:

Run: `cd mobile && npx pod-install 2>&1 | tail -3 && xcodebuild -workspace ios/Reelive.xcworkspace -scheme Reelive -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath ios/build -allowProvisioningUpdates build > /tmp/reelive-xcodebuild.log 2>&1; echo "exit $?"; grep -E "error:|BUILD SUCCEEDED|BUILD FAILED" /tmp/reelive-xcodebuild.log | tail -8`
Expected: `BUILD SUCCEEDED`, exit 0. Ein Swift-Fehler in `VideoExportModule.swift` wird hier sichtbar und in Task 1s Datei behoben (in diesem Task, mit eigenem Commit `fix(video): …`).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-fotos-import-design.md
git commit -m "docs(spec): Fotos-Import verweist auf die Vollbild-Prüfung vom 28. August"
```

- [ ] **Step 5: Geräte-Prüfliste (manuell)**

Nach Installation des neuen Builds: Picker-Rückgabe mit 20 grossen Elementen in Sekunden; Kacheln mit HEIC-Fotos und nachgeladenen Video-Standbildern; x entfernt und löscht (Metro-Log ohne `[media] file could not be removed`); Export eines HEVC-Clips mit Prozentanzeige, resultierendes `.mp4` spielt im Web-Player; Zurück-Geste während des Batches gesperrt; Animation und aktualisierter Zähler danach; Abbrechen löscht alle Kopien.
