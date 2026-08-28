# Reise-Cover beim Anlegen: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wer eine Reise anlegt, wählt optional ein Foto als Cover; es liegt im Bucket `covers`, hängt an `trips.cover_key` und ersetzt auf der Reise-Seite das Platzhalterbild.

**Architecture:** Der Screen «Neue Reise» bekommt eine Cover-Fläche (`TripCoverPicker`, Vorschlag A «Bühne»). Der Ablauf ist Reise anlegen → Foto mittig auf 3:2 beschneiden und verkleinern → per `File.upload` in den öffentlichen Supabase-Bucket `covers` → `cover_key` setzen. Eine Migration bindet `cover_key` an `trips/<id>/` und legt Bucket plus Storage-Policies an; `TripCover` bekommt an drei Stellen die öffentliche URL.

**Tech Stack:** Expo SDK 57 / React Native, TypeScript strict, expo-image-picker, expo-image-manipulator, expo-file-system (`File.upload`), Supabase (Postgres RLS, Storage), pgTAP, Deno (Edge Function `delete-account`), Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-08-28-reise-cover-design.md`

## Global Constraints

- Quellcode englisch (Bezeichner, Kommentare, Testbeschreibungen), sichtbare UI-Texte deutsch in Du-Form (CLAUDE.md). Vokabular DESIGN-LANGUAGE §6: «Cover», «Reise»; «hochladen» kommt in keinem sichtbaren Text vor.
- Keine Gedankenstriche (Em-Dash) in Texten, Kommentaren, Commits (Memory «Keine Em-Dashes»); Bis-Strich in Bereichen bleibt.
- DESIGN-LANGUAGE v2: nur Tokens (`colors[...]`, `spacing`, `radius`, `type`), Radius 12/24/999, Lucide-Icons Stroke 1.75, genau ein Primär-Button pro Screen, Press = `PressScale`.
- Schema-Änderungen nur über `supabase/migrations/`, jede Policy mit pgTAP in `supabase/tests/` (CLAUDE.md).
- Kein `allowsEditing` im Image-Picker (iOS-Bug vom 2026-08-13, Kommentar in `AvatarPicker.tsx`).
- Jest: Pfade mit `(tabs)` sind Regex, in Anführungszeichen mit `\(tabs\)` aufrufen. RNTL `render` ist async (`await`).
- Lint-Baseline: 28 vorbestehende ESLint-Fehler in `mobile/src`; neue Dateien müssen fehlerfrei sein (`npx expo lint` im Ordner `mobile`).
- Alle Befehle für die App laufen im Ordner `mobile/`, die Supabase-Befehle im Repo-Root.

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `mobile/src/features/trips/cover.ts` (neu) | Bucket-Name, Schlüsselschema `trips/<id>/<32 hex>.jpg`, öffentliche URL |
| `mobile/src/lib/pickImage.ts` (neu) | Ein Bild aus Fotos wählen, vier Ausgänge |
| `mobile/src/features/trips/coverApi.ts` (neu) | Zuschnitt 3:2, Upload, `cover_key` setzen, Aufräumen bei Fehler |
| `supabase/migrations/20260828120000_trip_cover.sql` (neu) | Bucket `covers`, Pfadbindung auf `trips`, Storage-Policies |
| `supabase/config.toml` | Bucket-Deklaration für die lokale CLI |
| `supabase/tests/23_trip_cover_test.sql` (neu) | pgTAP für alle Policies |
| `mobile/src/features/trips/types.ts`, `tripsApi.ts` | `cover_key` lesen |
| `mobile/src/components/TripHeroCard.tsx`, `TripGridCard.tsx`, `mobile/src/app/(tabs)/trip/[id]/index.tsx` | `coverUrl` an `TripCover` |
| `mobile/src/components/TripCoverPicker.tsx` (neu) | Cover-Fläche (leer/gewählt/Fehler) und Sheet-Inhalt «Cover» |
| `mobile/src/components/DateRangeField.tsx` | `disabled`-Prop |
| `mobile/src/app/(tabs)/trip/new.tsx` | ScrollView, Cover-Zustand, Ablauf, Fehlerpfad |
| `supabase/functions/delete-account/store.ts`, `index.ts` | Cover-Objekte aus `covers` löschen |

---

### Task 1: Schlüssel und URL (`cover.ts`)

**Files:**
- Create: `mobile/src/features/trips/cover.ts`
- Test: `mobile/src/features/trips/__tests__/cover.test.ts`

**Interfaces:**
- Produces: `COVER_BUCKET = 'covers'`, `newCoverKey(tripId: string): string`, `coverUrl(coverKey: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/features/trips/__tests__/cover.test.ts

// expo-crypto's jest-expo mock returns undefined from randomUUID(); the
// format has to be a real UUID so replace(/-/g, '') leaves 32 hex chars.
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    const c = mockUuidCounter;
    mockUuidCounter += 1;
    const hex = c.toString(16).padStart(8, '0');
    return `${hex}-0000-4000-8000-000000000000`;
  }),
}));

import { COVER_BUCKET, coverUrl, newCoverKey } from '../cover';

const TRIP = '11111111-2222-3333-4444-555555555555';

// The prefix is agreed upon with delete-account/index.ts, which only ever
// deletes cover paths under `trips/<own trip id>/`.
test('the key lives under the trip folder', () => {
  expect(newCoverKey(TRIP)).toMatch(new RegExp(`^trips/${TRIP}/[0-9a-f]{32}\\.jpg$`));
});

test('two keys of the same trip differ', () => {
  expect(newCoverKey(TRIP)).not.toBe(newCoverKey(TRIP));
});

test('coverUrl appends the key to the public bucket path', () => {
  expect(coverUrl(`trips/${TRIP}/abc.jpg`)).toBe(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${COVER_BUCKET}/trips/${TRIP}/abc.jpg`
  );
});

test('without a key there is no URL, the caller shows the placeholder', () => {
  expect(coverUrl(null)).toBeNull();
  expect(coverUrl(undefined)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/features/trips/__tests__/cover.test.ts`
Expected: FAIL with "Cannot find module '../cover'"

- [ ] **Step 3: Write minimal implementation**

```ts
// mobile/src/features/trips/cover.ts
import * as Crypto from 'expo-crypto';
import { supabaseBaseUrl } from '@/lib/supabaseUrl';

// Same name locally and in production (created in
// 20260828120000_trip_cover.sql, declared in supabase/config.toml), hence a
// constant, exactly like AVATAR_BUCKET in features/auth/avatar.ts.
export const COVER_BUCKET = 'covers';

// The prefix `trips/<trip_id>/` is AGREED UPON, not freely chosen:
// delete-account/index.ts allows exactly this prefix for the person's own
// trips (guard pathBelongsToUs in delete-account/process.ts), and the trips
// policies (20260828120000_trip_cover.sql) reject any other value in
// cover_key. The random part makes the URL unguessable and gives every new
// cover a new URL, so the image cache needs no cache-buster.
export function newCoverKey(tripId: string): string {
  const random = Crypto.randomUUID().replace(/-/g, '');
  return `trips/${tripId}/${random}.jpg`;
}

// The ONE place that knows what a cover URL looks like. Public bucket path,
// no signing: a cover is not a sealed moment (Spec §2).
export function coverUrl(coverKey: string | null | undefined): string | null {
  if (!coverKey) return null;
  const base = supabaseBaseUrl;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${COVER_BUCKET}/${coverKey}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/features/trips/__tests__/cover.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/trips/cover.ts mobile/src/features/trips/__tests__/cover.test.ts
git commit -m "feat(trips): cover key scheme and public cover URL"
```

---

### Task 2: Ein Bild aus Fotos wählen (`pickImage.ts`)

**Files:**
- Create: `mobile/src/lib/pickImage.ts`
- Test: `mobile/src/lib/__tests__/pickImage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PickResult =
    | { status: 'picked'; uri: string; width: number; height: number }
    | { status: 'canceled' }
    | { status: 'denied' }
    | { status: 'failed' };
  export async function pickImageFromLibrary(): Promise<PickResult>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/lib/__tests__/pickImage.test.ts

// "mock" prefix: babel-plugin-jest-hoist hoists jest.mock() above these
// consts and only lets variables through whose name starts with "mock"
// (same trap as in AvatarPicker.test.tsx).
const mockLaunch = jest.fn();
const mockPermission = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockLaunch(...a),
  requestMediaLibraryPermissionsAsync: () => mockPermission(),
}));

import { pickImageFromLibrary } from '../pickImage';

beforeEach(() => {
  mockLaunch.mockReset();
  mockPermission.mockReset();
  mockPermission.mockResolvedValue({ granted: true });
});

test('a chosen image comes back with its uri and dimensions', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///pick.jpg', width: 4000, height: 3000 }],
  });
  await expect(pickImageFromLibrary()).resolves.toEqual({
    status: 'picked', uri: 'file:///pick.jpg', width: 4000, height: 3000,
  });
});

// No `allowsEditing`: on iOS it forces the old UIImagePickerController,
// which dies on large originals with an indistinguishable `canceled`
// (2026-08-13). This test nails the option list so nobody adds it back.
test('the picker opens for images only, at full quality, without the system crop', async () => {
  mockLaunch.mockResolvedValue({ canceled: true, assets: null });
  await pickImageFromLibrary();
  expect(mockLaunch).toHaveBeenCalledWith({ mediaTypes: 'images', quality: 1 });
});

test('a cancel is a cancel, not an error', async () => {
  mockLaunch.mockResolvedValue({ canceled: true, assets: null });
  await expect(pickImageFromLibrary()).resolves.toEqual({ status: 'canceled' });
});

test('an empty asset list counts as a cancel', async () => {
  mockLaunch.mockResolvedValue({ canceled: false, assets: [] });
  await expect(pickImageFromLibrary()).resolves.toEqual({ status: 'canceled' });
});

test('without library permission nothing opens', async () => {
  mockPermission.mockResolvedValue({ granted: false });
  await expect(pickImageFromLibrary()).resolves.toEqual({ status: 'denied' });
  expect(mockLaunch).not.toHaveBeenCalled();
});

test('a thrown picker is reported as failed, not as a cancel', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockLaunch.mockRejectedValue(new Error('boom'));
  await expect(pickImageFromLibrary()).resolves.toEqual({ status: 'failed' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/lib/__tests__/pickImage.test.ts`
Expected: FAIL with "Cannot find module '../pickImage'"

- [ ] **Step 3: Write minimal implementation**

```ts
// mobile/src/lib/pickImage.ts
import * as ImagePicker from 'expo-image-picker';

export type PickResult =
  | { status: 'picked'; uri: string; width: number; height: number }
  | { status: 'canceled' }
  | { status: 'denied' }
  | { status: 'failed' };

// Deliberately WITHOUT `allowsEditing`: on iOS it forces the old
// UIImagePickerController, which the system tears down on large originals,
// and the app then only sees `canceled: true` (debugged 2026-08-13, see the
// OPTIONS comment in components/AvatarPicker.tsx). Cropping is the caller's
// job (features/trips/coverApi.ts). `quality: 1`, because the caller
// downsizes anyway and a second lossy stage before that only costs quality.
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  quality: 1,
};

// One image from the photo library, lifted out of AvatarSheetContent so the
// cover picker doesn't inherit the profile-picture wording. The four outcomes
// are the caller's whole vocabulary: `denied` and `failed` each get their own
// message, `canceled` none at all.
export async function pickImageFromLibrary(): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { status: 'denied' };

  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync(OPTIONS);
  } catch (error) {
    console.error('[pickImage] image picker threw', error);
    return { status: 'failed' };
  }
  // A FAILED picker reports itself exactly like a cancel (`canceled: true`,
  // no exception); the two can't be told apart here, which is why a cancel
  // never carries a message.
  if (result.canceled || !result.assets?.[0]) return { status: 'canceled' };
  const asset = result.assets[0];
  return { status: 'picked', uri: asset.uri, width: asset.width, height: asset.height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/lib/__tests__/pickImage.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/pickImage.ts mobile/src/lib/__tests__/pickImage.test.ts
git commit -m "feat(lib): pick a single image from the photo library"
```

---

### Task 3: Zuschnitt, Upload, `cover_key` setzen (`coverApi.ts`)

**Files:**
- Create: `mobile/src/features/trips/coverApi.ts`
- Test: `mobile/src/features/trips/__tests__/coverApi.test.ts`

**Interfaces:**
- Consumes: `COVER_BUCKET`, `newCoverKey` (Task 1)
- Produces:
  ```ts
  export const COVER_SAVE_ERROR: string;
  export type CoverCrop = { originX: number; originY: number; width: number; height: number };
  export function coverCrop(width: number, height: number): CoverCrop;
  export function coverSize(crop: CoverCrop): { width: number; height: number };
  export async function setTripCover(tripId: string, localUri: string): Promise<{ coverKey: string | null; error: string | null }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/features/trips/__tests__/coverApi.test.ts
import { COVER_SAVE_ERROR, coverCrop, coverSize, setTripCover } from '../coverApi';

const TRIP = '11111111-2222-3333-4444-555555555555';

// "mock" prefix: see avatarApi.test.ts, the factories below are hoisted.
const mockUploaded = jest.fn();
const mockRemoved = jest.fn();
const mockUpdated = jest.fn();
const mockCrop = jest.fn();
const mockResize = jest.fn();
let mockUploadStatus = 200;
let mockUpdateResult: { data: { id: string }[] | null; error: unknown } = { data: [{ id: TRIP }], error: null };
let mockSourceWidth = 4000;
let mockSourceHeight = 3000;

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    const c = mockUuidCounter;
    mockUuidCounter += 1;
    return `${c.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
  },
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      crop: (...a: unknown[]) => mockCrop(...a),
      resize: (...a: unknown[]) => mockResize(...a),
      renderAsync: async () => ({
        get width() { return mockSourceWidth; },
        get height() { return mockSourceHeight; },
        saveAsync: async () => ({ uri: 'file:///cache/cover.jpg' }),
        release: jest.fn(),
      }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    upload = (...args: unknown[]) => {
      mockUploaded(...args);
      return Promise.resolve({ status: mockUploadStatus });
    };
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({
      update: (values: unknown) => ({
        eq: () => ({
          select: async () => {
            mockUpdated(values);
            return mockUpdateResult;
          },
        }),
      }),
    }),
    storage: {
      from: () => ({
        remove: async (keys: string[]) => { mockRemoved(keys); return { error: null }; },
      }),
    },
  },
}));

beforeEach(() => {
  mockUploaded.mockReset();
  mockRemoved.mockReset();
  mockUpdated.mockReset();
  mockCrop.mockReset();
  mockResize.mockReset();
  mockUploadStatus = 200;
  mockUpdateResult = { data: [{ id: TRIP }], error: null };
  mockSourceWidth = 4000;
  mockSourceHeight = 3000;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// --- the crop arithmetic, pure ------------------------------------------

test('a wider-than-3:2 image loses width on both sides', () => {
  expect(coverCrop(4000, 2000)).toEqual({ originX: 500, originY: 0, width: 3000, height: 2000 });
});

test('a taller-than-3:2 image loses height top and bottom', () => {
  expect(coverCrop(3000, 3000)).toEqual({ originX: 0, originY: 500, width: 3000, height: 2000 });
});

test('an exact 3:2 image keeps everything', () => {
  expect(coverCrop(3000, 2000)).toEqual({ originX: 0, originY: 0, width: 3000, height: 2000 });
});

test('a large crop shrinks to 1200 x 800', () => {
  expect(coverSize({ originX: 0, originY: 0, width: 3000, height: 2000 })).toEqual({ width: 1200, height: 800 });
});

test('a small crop is never enlarged', () => {
  expect(coverSize({ originX: 0, originY: 0, width: 900, height: 600 })).toEqual({ width: 900, height: 600 });
});

// --- the whole chain ------------------------------------------------------

test('crop first, then resize, then upload as JPEG into the covers bucket', async () => {
  const order: string[] = [];
  mockCrop.mockImplementation(() => order.push('crop'));
  mockResize.mockImplementation(() => order.push('resize'));
  mockUploaded.mockImplementation(() => order.push('upload'));
  const result = await setTripCover(TRIP, 'file:///pick.jpg');
  expect(order).toEqual(['crop', 'resize', 'upload']);
  // 4000 x 3000 is taller than 3:2: 4000 x 2667, centered vertically.
  expect(mockCrop).toHaveBeenCalledWith({ originX: 0, originY: 167, width: 4000, height: 2667 });
  expect(mockResize).toHaveBeenCalledWith({ width: 1200, height: 800 });
  expect(mockUploaded).toHaveBeenCalledWith(
    expect.stringMatching(new RegExp(`/storage/v1/object/covers/trips/${TRIP}/[0-9a-f]{32}\\.jpg$`)),
    expect.objectContaining({
      httpMethod: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'image/jpeg' },
    })
  );
  expect(result.error).toBeNull();
  expect(result.coverKey).toMatch(new RegExp(`^trips/${TRIP}/[0-9a-f]{32}\\.jpg$`));
});

test('a small original is not resized', async () => {
  mockSourceWidth = 900;
  mockSourceHeight = 600;
  await setTripCover(TRIP, 'file:///small.jpg');
  expect(mockResize).not.toHaveBeenCalled();
});

test('the column gets the same key that was uploaded', async () => {
  const result = await setTripCover(TRIP, 'file:///pick.jpg');
  expect(mockUpdated).toHaveBeenCalledWith({ cover_key: result.coverKey });
});

// File.upload() does NOT throw on 4xx/5xx; without the status check a
// rejected upload (413 over the bucket limit, 403 on a violated policy)
// would leave cover_key pointing at nothing.
test('a rejected upload sets no column and reports the save error', async () => {
  mockUploadStatus = 413;
  const result = await setTripCover(TRIP, 'file:///big.jpg');
  expect(mockUpdated).not.toHaveBeenCalled();
  expect(result).toEqual({ coverKey: null, error: COVER_SAVE_ERROR });
});

test('a failed column update removes the fresh object again', async () => {
  mockUpdateResult = { data: null, error: { message: 'nope' } };
  const result = await setTripCover(TRIP, 'file:///pick.jpg');
  expect(mockRemoved).toHaveBeenCalledWith([expect.stringMatching(/^trips\//)]);
  expect(result).toEqual({ coverKey: null, error: COVER_SAVE_ERROR });
});

// RLS rejects silently: UPDATE 0 rows, no error. The attached select makes
// that visible (same row-proof as tripsApi.updateTrip).
test('an update that hits no row counts as failure too', async () => {
  mockUpdateResult = { data: [], error: null };
  const result = await setTripCover(TRIP, 'file:///pick.jpg');
  expect(mockRemoved).toHaveBeenCalled();
  expect(result.error).toBe(COVER_SAVE_ERROR);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/features/trips/__tests__/coverApi.test.ts`
Expected: FAIL with "Cannot find module '../coverApi'"

- [ ] **Step 3: Write minimal implementation**

```ts
// mobile/src/features/trips/coverApi.ts
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { supabaseBaseUrl } from '@/lib/supabaseUrl';
import { COVER_BUCKET, newCoverKey } from './cover';

// The largest display spot is the hero card, 342 x 228 on a 3x display,
// so 1026 x 684; 1200 x 800 carries that with headroom. At quality 0.8
// that's roughly 150 to 250 KB, far below the bucket's 2 MiB.
export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 800;
const RATIO = 3 / 2;
const JPEG_QUALITY = 0.8;

export const COVER_SAVE_ERROR =
  'Das Cover konnte nicht gespeichert werden. Probier es nochmal oder geh ohne Cover weiter.';

export type CoverCrop = { originX: number; originY: number; width: number; height: number };

// Centered crop to 3:2, pure so the arithmetic is testable without the
// manipulator: a wider image loses width on both sides, a taller one loses
// height top and bottom. Integers, because the manipulator wants pixels.
export function coverCrop(width: number, height: number): CoverCrop {
  if (width / height > RATIO) {
    const cropWidth = Math.round(height * RATIO);
    return { originX: Math.round((width - cropWidth) / 2), originY: 0, width: cropWidth, height };
  }
  const cropHeight = Math.round(width / RATIO);
  return { originX: 0, originY: Math.round((height - cropHeight) / 2), width, height: cropHeight };
}

// Shrink to at most 1200 x 800, never enlarge: a smaller crop stays as it
// is, upscaling would only add blur.
export function coverSize(crop: CoverCrop): { width: number; height: number } {
  if (crop.width <= COVER_WIDTH) return { width: crop.width, height: crop.height };
  return { width: COVER_WIDTH, height: COVER_HEIGHT };
}

// Same context-based pattern as asSquareJpeg in features/auth/avatarApi.ts,
// including release() in finally so the SharedObjects are freed in the
// error case too. The system crop (`allowsEditing`) is gone since
// 2026-08-13, so the app crops itself, here, where the image runs through
// anyway.
async function asCoverJpeg(uri: string): Promise<string> {
  // The context API only knows the dimensions after renderAsync(), so
  // load once unchanged, measure, and start over with the real work.
  const measureContext = ImageManipulator.manipulate(uri);
  let width: number;
  let height: number;
  try {
    const original = await measureContext.renderAsync();
    try {
      width = original.width;
      height = original.height;
    } finally {
      original.release();
    }
  } finally {
    measureContext.release();
  }

  const crop = coverCrop(width, height);
  const size = coverSize(crop);
  const context = ImageManipulator.manipulate(uri);
  try {
    // Crop first, then scale: the other way around would scale the full
    // image and the crop would no longer fit afterwards.
    context.crop(crop);
    if (size.width !== crop.width) context.resize(size);
    const rendered = await context.renderAsync();
    try {
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
      return result.uri;
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

// NOT supabase.storage.from().upload(): the storage client expects a Blob,
// unreliable under React Native. Same File.upload() pattern as avatarApi.ts
// and features/moments/uploadWorker.ts.
async function upload(key: string, uri: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Nicht angemeldet.');
  const base = supabaseBaseUrl;
  if (!base) throw new Error('Supabase-URL fehlt.');

  const response = await new File(uri).upload(
    `${base}/storage/v1/object/${COVER_BUCKET}/${key}`,
    {
      httpMethod: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    }
  );
  // upload() does NOT throw on 4xx/5xx, it returns the response. Without
  // this check a rejected upload would pass as done and the column would
  // point at nothing.
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Upload abgelehnt (${response.status}).`);
  }
}

// Deliberately without surfacing an error: a leftover object costs a few
// hundred KB, the person in front of the screen already has their answer.
async function removeObject(key: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(COVER_BUCKET).remove([key]);
    if (error) console.error('[coverApi] object left behind', error);
  } catch (error) {
    console.error('[coverApi] object left behind', error);
  }
}

// Order (Spec §7.2): upload -> set column. The trip must already exist: the
// storage policy checks ownership through public.trips. If the column can't
// be set, the fresh object goes away again, so nothing sits in the bucket
// without a pointer. `.select('id')`: RLS rejects silently with UPDATE 0,
// only the attached select makes that visible (see tripsApi.updateTrip).
export async function setTripCover(
  tripId: string,
  localUri: string,
): Promise<{ coverKey: string | null; error: string | null }> {
  const key = newCoverKey(tripId);
  try {
    const preparedUri = await asCoverJpeg(localUri);
    await upload(key, preparedUri);
  } catch (error) {
    console.error('[coverApi] upload failed', error);
    return { coverKey: null, error: COVER_SAVE_ERROR };
  }

  const { data, error } = await supabase
    .from('trips')
    .update({ cover_key: key })
    .eq('id', tripId)
    .select('id');
  if (error || !data || data.length === 0) {
    console.error('[coverApi] cover_key set failed', error);
    await removeObject(key);
    return { coverKey: null, error: COVER_SAVE_ERROR };
  }
  return { coverKey: key, error: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/features/trips/__tests__/coverApi.test.ts`
Expected: PASS, 11 tests. Falls «originY: 167» nicht passt: `Math.round((3000 - 2667) / 2)` = 167 (166.5 rundet auf), die Erwartung im Test stimmt.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/trips/coverApi.ts mobile/src/features/trips/__tests__/coverApi.test.ts
git commit -m "feat(trips): crop, upload and set a trip cover"
```

---

### Task 4: Migration, Bucket, Pfadbindung, pgTAP

**Files:**
- Create: `supabase/migrations/20260828120000_trip_cover.sql`
- Modify: `supabase/config.toml` (nach dem Block `[storage.buckets.avatare]`)
- Test: `supabase/tests/23_trip_cover_test.sql`

**Interfaces:**
- Produces: Bucket `covers`; Policies `trips_insert_owner`, `trips_update_owner` mit Pfadbindung; Storage-Policies `covers_insert_owner`, `covers_update_owner`, `covers_delete_owner`, `covers_select_authenticated`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/23_trip_cover_test.sql
-- Reise-Cover (Spec docs/superpowers/specs/2026-08-28-reise-cover-design.md, §6).
--
-- Zwei Policy-Gruppen, ein Test: die Pfadbindung von trips.cover_key und die
-- Ordnerbindung auf storage.objects im Bucket covers. Beide sagen dasselbe
-- («nur unter der eigenen Reise»), einmal in der Reisezeile und einmal am
-- Objekt. Ohne die erste liesse sich ein fremdes Cover als eigenes führen,
-- ohne die zweite ein fremdes überschreiben.
create extension if not exists pgtap with schema extensions;
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben');

-- Anna besitzt Lissabon, Ben ist dort Mitglied; Ben besitzt Porto.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('33333333-3333-3333-3333-333333333333', 'Porto',
          '2026-09-01', '2026-09-05', '00000000-0000-0000-0000-00000000000b');
select pg_temp.as_service();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- --- Grants bleiben ---------------------------------------------------------
select is(
  has_column_privilege('authenticated', 'public.trips', 'cover_key', 'UPDATE'),
  true, 'authenticated darf cover_key weiterhin schreiben (UPDATE)');
select is(
  has_column_privilege('authenticated', 'public.trips', 'cover_key', 'INSERT'),
  true, 'authenticated darf cover_key weiterhin schreiben (INSERT)');

-- --- trips.cover_key per UPDATE -------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$update public.trips
      set cover_key = 'trips/11111111-1111-1111-1111-111111111111/abc123.jpg'
      where id = '11111111-1111-1111-1111-111111111111'$$,
  'eigener Pfad unter der eigenen Reise geht'
);
select is(
  (select cover_key from public.trips where id = '11111111-1111-1111-1111-111111111111'),
  'trips/11111111-1111-1111-1111-111111111111/abc123.jpg',
  'der Wert steht danach in der Zeile'
);

-- Der wichtigste Fall: der Ordner einer ANDEREN Reise in der eigenen Zeile.
select throws_ok(
  $$update public.trips
      set cover_key = 'trips/33333333-3333-3333-3333-333333333333/abc123.jpg'
      where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'Pfad einer fremden Reise im eigenen cover_key scheitert'
);

select throws_ok(
  $$update public.trips
      set cover_key = 'covers/norwegen.jpg'
      where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'Pfad ohne trips/<id>/-Praefix scheitert'
);

select lives_ok(
  $$update public.trips set cover_key = null
      where id = '11111111-1111-1111-1111-111111111111'$$,
  'cover_key auf null zuruecksetzen geht (Cover entfernen)'
);

-- Ben ist Mitglied, nicht Owner: das UPDATE trifft keine Zeile, kein Fehler.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
with attempted as (
  update public.trips
    set cover_key = 'trips/11111111-1111-1111-1111-111111111111/ben.jpg'
    where id = '11111111-1111-1111-1111-111111111111'
    returning 1
)
select is((select count(*)::int from attempted), 0,
  'ein Mitglied ohne Owner-Rolle trifft mit dem Update keine Zeile');
select is(
  (select cover_key from public.trips where id = '11111111-1111-1111-1111-111111111111'),
  null::text, 'der Wert blieb nach dem verweigerten Update unveraendert (null)'
);

-- --- trips.cover_key per INSERT -------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$insert into public.trips (id, name, start_date, end_date, owner_id, cover_key)
      values ('22222222-2222-2222-2222-222222222222', 'Madeira',
              '2026-10-01', '2026-10-05', '00000000-0000-0000-0000-00000000000a',
              'trips/22222222-2222-2222-2222-222222222222/abc123.jpg')$$,
  'Insert mit cover_key unter der eigenen, neuen Trip-ID geht'
);

-- Auch Annas EIGENE andere Reise ist der falsche Ordner: der Pfad muss zur
-- Zeile gehoeren, nicht bloss zur Person.
select throws_ok(
  $$insert into public.trips (id, name, start_date, end_date, owner_id, cover_key)
      values ('44444444-4444-4444-4444-444444444444', 'Azoren',
              '2026-11-01', '2026-11-05', '00000000-0000-0000-0000-00000000000a',
              'trips/11111111-1111-1111-1111-111111111111/abc123.jpg')$$,
  '42501', null, 'Insert mit dem Pfad einer anderen Reise scheitert'
);

-- --- storage.objects im Bucket covers ---------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
      values ('covers',
              'trips/11111111-1111-1111-1111-111111111111/abc123.jpg',
              '00000000-0000-0000-0000-00000000000a')$$,
  'Objekt unter der eigenen Reise anlegen geht'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
      values ('covers',
              'trips/33333333-3333-3333-3333-333333333333/fremd.jpg',
              '00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'Objekt unter einer fremden Reise anlegen scheitert'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
      values ('covers',
              'profiles/00000000-0000-0000-0000-00000000000a/abc123.jpg',
              '00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'falscher Namensraum im covers-Bucket scheitert'
);

-- Der media-Bucket bleibt zu (dieselbe Zusage wie in 20_avatar_test.sql).
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
      values ('media',
              'trips/11111111-1111-1111-1111-111111111111/moment.jpg',
              '00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'Schreiben in den media-Bucket bleibt auch fuer authenticated verwehrt'
);

-- Ben (Mitglied) darf Annas Cover-Objekt weder umbenennen noch loeschen.
-- Geprueft wird die ANZAHL: ohne passende Policy trifft die Anweisung null
-- Zeilen, sie wirft nicht.
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
with renamed as (
  update storage.objects
    set name = 'trips/11111111-1111-1111-1111-111111111111/pwned.jpg'
    where bucket_id = 'covers'
      and name = 'trips/11111111-1111-1111-1111-111111111111/abc123.jpg'
    returning 1
)
select is((select count(*)::int from renamed), 0,
  'fremdes Cover-Objekt umbenennen trifft keine Zeile');
with removed as (
  delete from storage.objects
    where bucket_id = 'covers'
      and name = 'trips/11111111-1111-1111-1111-111111111111/abc123.jpg'
    returning 1
)
select is((select count(*)::int from removed), 0,
  'fremdes Cover-Objekt loeschen trifft keine Zeile');

select pg_temp.as_anon();
select is(
  (select count(*)::int from storage.objects where bucket_id = 'covers'),
  0, 'anon liest keine Zeile, kann covers also nicht auflisten'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
with removed as (
  delete from storage.objects
    where bucket_id = 'covers'
      and name = 'trips/11111111-1111-1111-1111-111111111111/abc123.jpg'
    returning 1
)
select is((select count(*)::int from removed), 1,
  'eigenes Cover-Objekt loeschen geht (Cover wechseln)');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run (Repo-Root): `supabase test db 2>&1 | tail -30`
Expected: `23_trip_cover_test.sql` scheitert: `trips/<fremde id>` wird heute angenommen (kein `with check`), Objekte im Bucket `covers` scheitern schon am fehlenden Bucket/den fehlenden Policies. Die übrigen 22 Dateien bleiben grün.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260828120000_trip_cover.sql
-- Reise-Cover (Spec docs/superpowers/specs/2026-08-28-reise-cover-design.md).
--
-- trips.cover_key gibt es seit 20260803090000_core_tables.sql, beschreibbar
-- per Spalten-Grant seit 20260803090200_membership_rls.sql. Geschrieben hat
-- sie bisher kein Codepfad. Diese Migration bindet sie an den Ordner der
-- eigenen Reise und legt den Bucket an, in dem die Bytes liegen. Dasselbe
-- Muster wie 20260812130000_avatar_bild.sql fuer das Profilbild.

-- ---------------------------------------------------------------------------
-- 1. Der Bucket
-- ---------------------------------------------------------------------------
-- Auch in supabase/config.toml deklariert, hier trotzdem ein Insert:
-- config.toml wirkt nur ueber die lokale CLI, in der Produktion entsteht der
-- Bucket allein durch diese Migration, und die pgTAP-Tests brauchen ihn
-- ebenfalls. Limits und MIME-Typ stehen mit drin, weil der Bucket oeffentlich
-- ist und direkt vom Client beschrieben wird. `do update`, damit ein bereits
-- vorhandener Bucket auf diese Limits kommt.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('covers', 'covers', true, 2097152, array['image/jpeg'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. cover_key an die eigene Reise binden
-- ---------------------------------------------------------------------------
-- Bisher pruefen beide Policies nur owner_id. Ohne with check auf den Pfad
-- koennte jemand den Ordner einer fremden Reise in sein cover_key schreiben
-- und deren Bild als eigenes fuehren, und delete-account muesste sich weiter
-- allein auf seinen Guard verlassen (pathBelongsToUs). `owner_id = auth.uid()`
-- steht im with check MIT drin, sonst pruefte die neue Zeile nur den Pfad.
-- Gebunden wird an die ZEILE (id), nicht an die Person: auch eine andere
-- eigene Reise ist der falsche Ordner.
drop policy if exists trips_insert_owner on public.trips;
create policy trips_insert_owner on public.trips
  for insert with check (
    owner_id = auth.uid()
    and (cover_key is null or cover_key like 'trips/' || id::text || '/%')
  );

drop policy if exists trips_update_owner on public.trips;
create policy trips_update_owner on public.trips
  for update
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (cover_key is null or cover_key like 'trips/' || id::text || '/%')
  );

-- ---------------------------------------------------------------------------
-- 3. RLS auf den Objekten
-- ---------------------------------------------------------------------------
-- storage.foldername('trips/<id>/abc.jpg') liefert {trips,<id>}: [1] ist der
-- feste Namensraum, [2] die Reise. Die Eigentuemerschaft kommt aus
-- public.trips, gelesen unter RLS als authenticated: der Owner sieht seine
-- eigene Reise (20260812120000_owner_sieht_eigene_reise.sql), auch direkt
-- nach dem Insert. Darum muss die Reise VOR dem Upload existieren.
create policy covers_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = 'trips'
    and exists (
      select 1 from public.trips t
      where t.id::text = (storage.foldername(name))[2]
        and t.owner_id = auth.uid()
    )
  );

create policy covers_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = 'trips'
    and exists (
      select 1 from public.trips t
      where t.id::text = (storage.foldername(name))[2]
        and t.owner_id = auth.uid()
    )
  );

create policy covers_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = 'trips'
    and exists (
      select 1 from public.trips t
      where t.id::text = (storage.foldername(name))[2]
        and t.owner_id = auth.uid()
    )
  );

-- Lesen NUR fuer authenticated, nicht fuer anon: der oeffentliche Lesepfad
-- der Storage-API braucht diese Zeilen nicht, ein select waere ein Listing
-- aller Schluessel (Begruendung in 20260812130000_avatar_bild.sql).
create policy covers_select_authenticated on storage.objects
  for select to authenticated
  using (bucket_id = 'covers');
```

In `supabase/config.toml` direkt nach dem Block `[storage.buckets.avatare]` (nach der Zeile `allowed_mime_types = ["image/jpeg"]`):

```toml

# Reise-Cover (20260828120000_trip_cover.sql). Öffentlich wie die Avatare:
# das Cover ist kein versiegelter Moment, der Schutz liegt im unratbaren
# Schlüssel unter trips/<trip_id>/. Nur JPEG, der Client rechnet nach JPEG
# (features/trips/coverApi.ts).
[storage.buckets.covers]
public = true
file_size_limit = "2MiB"
allowed_mime_types = ["image/jpeg"]
```

- [ ] **Step 4: Apply and run the tests**

Run (Repo-Root): `supabase db reset 2>&1 | tail -5 && supabase test db 2>&1 | tail -30`
Expected: alle 23 Dateien grün, `23_trip_cover_test.sql` mit 19/19. Falls `storage.foldername` fehlt, siehe Hinweis im Profilbild-Plan: `split_part(name, '/', 1)` und `split_part(name, '/', 2)` haben dieselbe Semantik.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260828120000_trip_cover.sql supabase/config.toml supabase/tests/23_trip_cover_test.sql
git commit -m "feat(db): covers bucket, cover_key bound to the trip folder, storage policies with pgTAP"
```

---

### Task 5: `cover_key` lesen und an `TripCover` durchreichen

**Files:**
- Modify: `mobile/src/features/trips/types.ts` (Typ `Trip`)
- Modify: `mobile/src/features/trips/tripsApi.ts:18` (`COLUMNS`) und `toTrip`
- Modify: `mobile/src/components/TripHeroCard.tsx:45`, `mobile/src/components/TripGridCard.tsx:26`, `mobile/src/app/(tabs)/trip/[id]/index.tsx:491`
- Modify: `mobile/src/features/trips/placeholderCover.ts` (Kommentar)
- Modify: alle `Trip`-Literale, die `tsc` meldet (Testfixtures)
- Test: `mobile/src/components/__tests__/TripHeroCard.test.tsx`, `TripGridCard.test.tsx`, `mobile/src/app/(tabs)/trip/__tests__/detail.test.tsx`, `mobile/src/features/trips/__tests__/tripsApi.test.ts`

**Interfaces:**
- Consumes: `coverUrl` (Task 1)
- Produces: `Trip.cover_key: string | null`

- [ ] **Step 1: Write the failing tests**

In `TripHeroCard.test.tsx` das Fixture um `cover_key: null` ergänzen und anhängen:

```tsx
test('a trip with its own cover shows it instead of the placeholder', async () => {
  await wrap(
    <TripHeroCard
      trip={{ ...trip, cover_key: 'trips/t1/abc.jpg' }}
      today={TODAY}
      onPress={jest.fn()}
    />
  );
  expect(screen.getByTestId('trip-cover').props.source).toEqual({
    uri: `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/trips/t1/abc.jpg`,
  });
});

test('without a cover the placeholder image stays', async () => {
  await wrap(<TripHeroCard trip={trip} today={TODAY} onPress={jest.fn()} />);
  expect(screen.getByTestId('trip-cover').props.source).not.toHaveProperty('uri');
});
```

In `TripGridCard.test.tsx` (Fixture ebenfalls `cover_key: null`):

```tsx
test('a trip with its own cover shows it instead of the placeholder', async () => {
  await wrap(<TripGridCard trip={{ ...trip, cover_key: 'trips/t3/abc.jpg' }} onPress={jest.fn()} />);
  expect(screen.getByTestId('trip-cover').props.source).toEqual({
    uri: `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/trips/t3/abc.jpg`,
  });
});
```

In `detail.test.tsx`: das `tripOk`-Fixture (siehe `(fetchTrip as jest.Mock).mockResolvedValue(tripOk)` um Zeile 193) bekommt `cover_key: null`; dazu ein Test, der `fetchTrip` einmal mit `cover_key: 'trips/t1/abc.jpg'` auflöst und dieselbe `source`-Erwartung an `trip-cover` stellt wie oben. Prüfe zuerst, ob der Detail-Test `expo-image` mockt (Zeile 1 bis 60); falls ja, trägt der Mock die Props durch, sonst denselben Mock wie in `TripHeroCard.test.tsx` einfügen.

In `tripsApi.test.ts`: dort, wo der `select`-String der Lesefunktionen geprüft wird (grep `'id, name, start_date'`), `cover_key` in die erwartete Spaltenliste aufnehmen; die Fixture-Zeilen bekommen `cover_key: null`, und ein Fixture `cover_key: 'trips/t1/abc.jpg'` erwartet denselben Wert im `Trip`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest src/components/__tests__/TripHeroCard.test.tsx src/components/__tests__/TripGridCard.test.tsx`
Expected: FAIL, `source` ist die Platzhalter-Ressource (eine Zahl aus `require`), keine `uri`.

- [ ] **Step 3: Implement**

`types.ts`:

```ts
export type Trip = {
  id: string;
  name: string;
  start_date: string; // ISO, 'YYYY-MM-DD'
  end_date: string;
  status: TripStatus;
  owner_id: string;
  // Storage key of the trip's own cover in the `covers` bucket
  // (features/trips/cover.ts), null while the trip still wears the
  // placeholder.
  cover_key: string | null;
  members: Face[]; // faces for the overlapping avatars on the card
  member_count: number;
  my_post_count: number;
};
```

`tripsApi.ts`:

```ts
const COLUMNS = 'id, name, start_date, end_date, status, owner_id, cover_key';
```

und in `toTrip` nach `owner_id: row.owner_id,` die Zeile `cover_key: row.cover_key ?? null,`.

`TripHeroCard.tsx`: Import `import { coverUrl } from '@/features/trips/cover';`, Zeile 45 wird `<TripCover position={position} coverUrl={coverUrl(trip.cover_key)}>`.

`TripGridCard.tsx`: gleicher Import, Zeile 26 wird `<TripCover position={position} coverUrl={coverUrl(trip.cover_key)} />`.

`trip/[id]/index.tsx`: gleicher Import, Zeile 491 wird `<TripCover position={coverPosition} coverUrl={coverUrl(trip.cover_key)}>`.

`placeholderCover.ts`, letzter Absatz des Kommentars ersetzen:

```ts
// Both are the reason this stays a placeholder: since trips carry their own
// cover (trips.cover_key, features/trips/cover.ts), the image belongs to the
// trip wherever one was chosen. This file only covers the trips without one.
```

Dann `cd mobile && npx tsc --noEmit` laufen lassen und JEDES gemeldete `Trip`-Literal um `cover_key: null,` ergänzen (nach der `owner_id`-Zeile). Betroffen sind voraussichtlich `src/components/__tests__/TripHeroCard.test.tsx`, `TripGridCard.test.tsx`, `TripCard.test.tsx`, `TripRow.test.tsx`, `src/app/(tabs)/trip/__tests__/list.test.tsx`, `detail.test.tsx`, `form.test.tsx`, `src/app/(tabs)/recap/__tests__/*.test.tsx`, `src/app/(tabs)/capture/__tests__/camera.test.tsx`, `src/features/trips/__tests__/tripsApi.test.ts`, `tripsCache.test.ts`. Literale, die nur ein `jest.fn()`-Mock zurückgibt und die kein `Trip`-Typ annotiert, meldet `tsc` nicht; sie brauchen den Wert nur, wenn ein Test darauf zugreift.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd mobile && npx tsc --noEmit && npx jest src/components src/features/trips "src/app/\(tabs\)/trip"`
Expected: tsc ohne Fehler; alle Suites grün.

- [ ] **Step 5: Commit**

```bash
git add -A mobile/src
git commit -m "feat(trips): read cover_key and show the trip's own cover on the trip tab and detail"
```

---

### Task 6: `disabled` für `DateRangeField`

**Files:**
- Modify: `mobile/src/components/DateRangeField.tsx:14-23,50-56`
- Test: `mobile/src/components/__tests__/DateRangeField.test.tsx` (existiert)

**Interfaces:**
- Produces: Prop `disabled?: boolean` auf `DateRangeField`

- [ ] **Step 1: Write the failing test**

An die bestehende Datei anhängen, mit deren `wrap`-Helfer (`render` in `ThemeProvider`); fehlt einer, wie in `form.test.tsx` anlegen:

```tsx
test('a disabled field does not open the calendar', async () => {
  await wrap(
    <DateRangeField value={{ start: null, end: null }} onChange={jest.fn()} disabled />
  );
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  expect(screen.queryByLabelText('Übernehmen')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/components/__tests__/DateRangeField.test.tsx`
Expected: FAIL, «Übernehmen» ist sichtbar (der Kalender öffnet).

- [ ] **Step 3: Implement**

In `Props` ergänzen:

```ts
  // The create form locks the field once the trip exists but its cover
  // didn't make it (Spec §7.3): the values are already saved, a change here
  // would be a lie.
  disabled?: boolean;
```

Signatur: `export function DateRangeField({ value, onChange, error, today, disabled = false }: Props)`.

Am Feld-`PressScale`: `disabled={disabled}` und `accessibilityState={{ disabled }}` ergänzen (PressScale reicht `PressableProps` durch, ein deaktiviertes Pressable feuert kein `onPress`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/components/__tests__/DateRangeField.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/DateRangeField.tsx mobile/src/components/__tests__/DateRangeField.test.tsx
git commit -m "feat(ui): DateRangeField can be disabled"
```

---

### Task 7: Die Cover-Fläche (`TripCoverPicker`)

**Files:**
- Create: `mobile/src/components/TripCoverPicker.tsx`
- Test: `mobile/src/components/__tests__/TripCoverPicker.test.tsx`

**Interfaces:**
- Consumes: `TripCover`, `ReliefBadge`, `PressScale`, Tokens
- Produces:
  ```tsx
  export function TripCoverPicker(props: {
    uri: string | null;        // local file uri of the chosen image, null = empty
    error: string | null;      // line under the surface, danger
    onChoose: () => void;      // empty surface tapped
    onChange: () => void;      // «Ändern» badge tapped (the screen opens the sheet)
  }): JSX.Element;
  export function TripCoverSheetContent(props: {
    onChoose: () => void; onRemove: () => void; onClose: () => void;
  }): JSX.Element;
  ```

Warum das Sheet nicht in der Komponente wohnt: `Sheet` positioniert sich mit `absoluteFill` relativ zum Elternelement (Kommentar in `DateRangeField.tsx`). Inmitten einer ScrollView läge es an der Stelle der Fläche. Der Screen rendert es darum auf Wurzelhöhe, wie das Reise-Detail seine Sheets, und nimmt nur den Inhalt von hier.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/components/__tests__/TripCoverPicker.test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

// expo-image is a native view; a pass-through placeholder is enough (same
// pattern as TripHeroCard.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

import { TripCoverPicker, TripCoverSheetContent } from '../TripCoverPicker';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('empty: plus, invitation and "Optional", the whole surface is the button', async () => {
  const onChoose = jest.fn();
  await wrap(<TripCoverPicker uri={null} error={null} onChoose={onChoose} onChange={jest.fn()} />);
  expect(screen.getByText('Cover wählen')).toBeTruthy();
  expect(screen.getByText('Optional')).toBeTruthy();
  expect(screen.queryByTestId('trip-cover')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Cover wählen'));
  expect(onChoose).toHaveBeenCalledTimes(1);
});

test('chosen: the photo fills the cover and only the badge is a button', async () => {
  const onChange = jest.fn();
  const onChoose = jest.fn();
  await wrap(
    <TripCoverPicker uri="file:///pick.jpg" error={null} onChoose={onChoose} onChange={onChange} />
  );
  expect(screen.getByTestId('trip-cover').props.source).toEqual({ uri: 'file:///pick.jpg' });
  expect(screen.queryByText('Cover wählen')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Cover ändern'));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChoose).not.toHaveBeenCalled();
});

test('an error stands under the surface', async () => {
  await wrap(
    <TripCoverPicker uri={null} error="Ohne Zugriff auf deine Fotos geht es nicht." onChoose={jest.fn()} onChange={jest.fn()} />
  );
  expect(screen.getByText('Ohne Zugriff auf deine Fotos geht es nicht.')).toBeTruthy();
});

test('the sheet entries close the sheet and report the choice', async () => {
  const onChoose = jest.fn();
  const onRemove = jest.fn();
  const onClose = jest.fn();
  await wrap(<TripCoverSheetContent onChoose={onChoose} onRemove={onRemove} onClose={onClose} />);
  await fireEvent.press(screen.getByText('Anderes Foto wählen'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onChoose).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText('Cover entfernen'));
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onRemove).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/components/__tests__/TripCoverPicker.test.tsx`
Expected: FAIL with "Cannot find module '../TripCoverPicker'"

- [ ] **Step 3: Implement**

```tsx
// mobile/src/components/TripCoverPicker.tsx
import { StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { ReliefBadge } from '@/components/ReliefBadge';
import { TripCover } from '@/components/TripCover';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// The cover surface on «Neue Reise» (Spec §3.1, proposal A «Bühne»): the
// same 3:2 shape the trip page wears, empty a bg-1 surface with a plus in
// the middle, chosen the photo itself with the raised «Ändern» badge.
//
// Empty deliberately WITHOUT TripCover: TripCover always paints an image
// (placeholder when there's no coverUrl), and the empty state must be
// genuinely empty, not a placeholder that looks like a preselection.
//
// The sheet behind «Ändern» is NOT rendered here: `Sheet` positions itself
// with absoluteFill relative to its parent (see DateRangeField.tsx), inside
// the form's ScrollView it would appear at the surface's position. The
// screen renders it at root level and takes only TripCoverSheetContent.
export function TripCoverPicker({
  uri, error, onChoose, onChange,
}: {
  uri: string | null;
  error: string | null;
  onChoose: () => void;
  onChange: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.s }}>
      {uri ? (
        <TripCover coverUrl={uri}>
          <View style={styles.coverFill}>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="Cover ändern"
              style={styles.badgeAnchor}
              onPress={onChange}
            >
              <ReliefBadge>
                <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Ändern</Text>
              </ReliefBadge>
            </PressScale>
          </View>
        </TripCover>
      ) : (
        <PressScale
          scaleTo={0.98}
          accessibilityRole="button"
          accessibilityLabel="Cover wählen"
          onPress={onChoose}
        >
          <View style={[styles.empty, { backgroundColor: colors['bg-1'] }]}>
            <View style={[styles.plus, { backgroundColor: colors['bg-0'] }]}>
              <Plus size={24} color={colors['text-1']} strokeWidth={1.75} />
            </View>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Cover wählen</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>Optional</Text>
          </View>
        </PressScale>
      )}
      {error ? (
        <Text testID="cover-error" style={[type.secondary, { color: colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

// Belongs inside a `<Sheet title="Cover">` of the screen, same split as
// AvatarSheetContent: only the entries live here.
export function TripCoverSheetContent({
  onChoose, onRemove, onClose,
}: {
  onChoose: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <>
      <PressScale accessibilityRole="button" onPress={() => { onClose(); onChoose(); }}>
        <Text style={[type.bodyMedium, styles.entry, { color: colors['text-1'] }]}>
          Anderes Foto wählen
        </Text>
      </PressScale>
      <PressScale accessibilityRole="button" onPress={() => { onClose(); onRemove(); }}>
        <Text style={[type.bodyMedium, styles.entry, { color: colors.danger }]}>
          Cover entfernen
        </Text>
      </PressScale>
    </>
  );
}

const PLUS_SIZE = 48;

const styles = StyleSheet.create({
  // The same shape as TripCover's surface (3:2, card radius), minus the image.
  empty: {
    aspectRatio: 3 / 2,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  plus: {
    width: PLUS_SIZE,
    height: PLUS_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
  },
  // TripCover's overlay aligns children flex-start/flex-end; stretching
  // restores the full area so the badge can sit in the top right corner.
  coverFill: { flex: 1, alignSelf: 'stretch' },
  badgeAnchor: { position: 'absolute', top: 0, right: 0 },
  entry: { paddingVertical: spacing.m },
});
```

Hinweis: `TripCover` legt sein Overlay mit `padding: spacing.m` (12 px) an, das Badge steht mit `top: 0, right: 0` im Overlay also 12 px vom Rand, wie in der Spec.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/components/__tests__/TripCoverPicker.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Lint the new file and commit**

Run: `cd mobile && npx expo lint 2>&1 | grep -c 'error' ` → Zahl darf die Baseline (28) nicht übersteigen; `npx expo lint src/components/TripCoverPicker.tsx` muss leer sein.

```bash
git add mobile/src/components/TripCoverPicker.tsx mobile/src/components/__tests__/TripCoverPicker.test.tsx
git commit -m "feat(ui): TripCoverPicker, the cover surface for the create form"
```

---

### Task 8: «Neue Reise» mit Cover-Ablauf

**Files:**
- Modify: `mobile/src/app/(tabs)/trip/new.tsx` (ganze Datei)
- Test: `mobile/src/app/(tabs)/trip/__tests__/form.test.tsx`

**Interfaces:**
- Consumes: `pickImageFromLibrary` (Task 2), `setTripCover`, `COVER_SAVE_ERROR` (Task 3), `TripCoverPicker`, `TripCoverSheetContent` (Task 7), `DateRangeField.disabled` (Task 6)

- [ ] **Step 1: Write the failing tests**

In `form.test.tsx` die Mocks erweitern (nach dem `tripsApi`-Mock):

```tsx
const mockPick = jest.fn();
jest.mock('@/lib/pickImage', () => ({ pickImageFromLibrary: () => mockPick() }));
const mockSetTripCover = jest.fn();
jest.mock('@/features/trips/coverApi', () => ({
  ...jest.requireActual('@/features/trips/coverApi'),
  setTripCover: (...a: unknown[]) => mockSetTripCover(...a),
}));
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});
```

(`jest.requireActual` für `coverApi`, damit `COVER_SAVE_ERROR` echt bleibt; das zieht `expo-image-manipulator` und `expo-file-system` mit, beide sind in jest-expo gemockt. Sollte der Import trotzdem scheitern, statt `requireActual` die Konstante im Mock wörtlich setzen: `COVER_SAVE_ERROR: 'Das Cover konnte nicht gespeichert werden. Probier es nochmal oder geh ohne Cover weiter.'`.)

Im `beforeEach`: `mockPick.mockReset(); mockSetTripCover.mockReset(); mockSetTripCover.mockResolvedValue({ coverKey: 'trips/new-1/abc.jpg', error: null });`

Neue Tests, hinter `'valid input creates the trip and moves straight on to inviting'`:

```tsx
const fillForm = async () => {
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await selectDateRange('1. August 2026', '14. August 2026');
};

test('without a cover nothing is uploaded', async () => {
  await wrap(<NewTrip />);
  await fillForm();
  await fireEvent.press(screen.getByText('Reise anlegen'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/trip/new-1'));
  expect(mockSetTripCover).not.toHaveBeenCalled();
});

test('a chosen cover shows on the surface and is saved after the trip exists', async () => {
  mockPick.mockResolvedValue({ status: 'picked', uri: 'file:///pick.jpg', width: 4000, height: 3000 });
  await wrap(<NewTrip />);
  await fireEvent.press(screen.getByLabelText('Cover wählen'));
  expect((await screen.findByTestId('trip-cover')).props.source).toEqual({ uri: 'file:///pick.jpg' });
  await fillForm();
  await fireEvent.press(screen.getByText('Reise anlegen'));
  await waitFor(() => expect(mockSetTripCover).toHaveBeenCalledWith('new-1', 'file:///pick.jpg'));
  // Trip first, cover second: the storage policy needs the trip to exist.
  expect((createTrip as jest.Mock).mock.invocationCallOrder[0])
    .toBeLessThan(mockSetTripCover.mock.invocationCallOrder[0]);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/trip/new-1'));
  expect(mockPush).toHaveBeenCalledWith('/trip/new-1/invite');
});

test('denied photo access is explained under the surface', async () => {
  mockPick.mockResolvedValue({ status: 'denied' });
  await wrap(<NewTrip />);
  await fireEvent.press(screen.getByLabelText('Cover wählen'));
  expect(await screen.findByText(
    'Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.'
  )).toBeTruthy();
});

test('a cancelled picker says nothing', async () => {
  mockPick.mockResolvedValue({ status: 'canceled' });
  await wrap(<NewTrip />);
  await fireEvent.press(screen.getByLabelText('Cover wählen'));
  expect(screen.queryByTestId('cover-error')).toBeNull();
  expect(screen.getByText('Cover wählen')).toBeTruthy();
});

test('a failed upload keeps the trip, offers a retry and a way on without cover', async () => {
  mockPick.mockResolvedValue({ status: 'picked', uri: 'file:///pick.jpg', width: 4000, height: 3000 });
  mockSetTripCover.mockResolvedValueOnce({
    coverKey: null,
    error: 'Das Cover konnte nicht gespeichert werden. Probier es nochmal oder geh ohne Cover weiter.',
  });
  await wrap(<NewTrip />);
  await fireEvent.press(screen.getByLabelText('Cover wählen'));
  await screen.findByTestId('trip-cover');
  await fillForm();
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText(
    'Das Cover konnte nicht gespeichert werden. Probier es nochmal oder geh ohne Cover weiter.'
  )).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
  // The values are saved with the trip: locked, not editable.
  expect(screen.getByLabelText('Name der Reise').props.editable).toBe(false);
  // Retry uploads again for the SAME trip, no second insert.
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  await waitFor(() => expect(mockSetTripCover).toHaveBeenCalledTimes(2));
  expect(createTrip).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/trip/new-1'));
});

test('after a failed upload the text link goes on without the cover', async () => {
  mockPick.mockResolvedValue({ status: 'picked', uri: 'file:///pick.jpg', width: 4000, height: 3000 });
  mockSetTripCover.mockResolvedValue({
    coverKey: null,
    error: 'Das Cover konnte nicht gespeichert werden. Probier es nochmal oder geh ohne Cover weiter.',
  });
  await wrap(<NewTrip />);
  await fireEvent.press(screen.getByLabelText('Cover wählen'));
  await screen.findByTestId('trip-cover');
  await fillForm();
  await fireEvent.press(screen.getByText('Reise anlegen'));
  await fireEvent.press(await screen.findByText('Ohne Cover weiter'));
  expect(mockReplace).toHaveBeenCalledWith('/trip/new-1');
  expect(mockPush).toHaveBeenCalledWith('/trip/new-1/invite');
  expect(mockSetTripCover).toHaveBeenCalledTimes(1);
});

test('removing the cover after a failed upload turns the primary button into the way on', async () => {
  mockPick.mockResolvedValue({ status: 'picked', uri: 'file:///pick.jpg', width: 4000, height: 3000 });
  mockSetTripCover.mockResolvedValue({
    coverKey: null,
    error: 'Das Cover konnte nicht gespeichert werden. Probier es nochmal oder geh ohne Cover weiter.',
  });
  await wrap(<NewTrip />);
  await fireEvent.press(screen.getByLabelText('Cover wählen'));
  await screen.findByTestId('trip-cover');
  await fillForm();
  await fireEvent.press(screen.getByText('Reise anlegen'));
  await screen.findByText('Nochmal versuchen');
  await fireEvent.press(screen.getByLabelText('Cover ändern'));
  await fireEvent.press(await screen.findByText('Cover entfernen'));
  expect(screen.queryByText('Nochmal versuchen')).toBeNull();
  expect(screen.queryByTestId('cover-error')).toBeNull();
  await fireEvent.press(screen.getByText('Ohne Cover weiter'));
  expect(mockReplace).toHaveBeenCalledWith('/trip/new-1');
  expect(mockSetTripCover).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest "src/app/\(tabs\)/trip/__tests__/form.test.tsx"`
Expected: die neuen Tests scheitern (kein «Cover wählen» auf dem Screen), die alten bleiben grün.

- [ ] **Step 3: Implement (ganze Datei)**

```tsx
// mobile/src/app/(tabs)/trip/new.tsx
import { useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { DateRangeField } from '@/components/DateRangeField';
import { Sheet } from '@/components/Sheet';
import { StatusBarCover } from '@/components/StatusBarCover';
import { TripCoverPicker, TripCoverSheetContent } from '@/components/TripCoverPicker';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { createTrip } from '@/features/trips/tripsApi';
import { setTripCover } from '@/features/trips/coverApi';
import { validateDateRange } from '@/features/trips/tripDay';
import { pickImageFromLibrary } from '@/lib/pickImage';
import type { Selection } from '@/features/trips/calendar';

const PICK_DENIED =
  'Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.';
const PICK_FAILED = 'Das Bild liess sich nicht öffnen. Probier es nochmal oder nimm ein anderes.';

export default function NewTrip() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xxl);
  const router = useRouter();
  const { userId } = useAuth();
  const [name, setName] = useState('');
  const [dateRange, setDateRange] = useState<Selection>({ start: null, end: null });
  const [nameError, setNameError] = useState<string | undefined>();
  const [dateRangeError, setDateRangeError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  // The cover lives only locally until the trip exists (Spec §7): the
  // storage policy checks ownership through the trip row, so the upload
  // has to wait for createTrip.
  const [cover, setCover] = useState<{ uri: string } | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverSheetVisible, setCoverSheetVisible] = useState(false);
  // Set once the trip exists but its cover didn't make it (Spec §7.3). From
  // then on the form is no longer a "create" form: no second insert, the
  // fields are locked, the button retries the cover only.
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);
  const coverFailed = createdTripId !== null;

  const chooseCover = async () => {
    // The name field has autofocus; without this the keyboard stands
    // behind the system picker and springs back afterwards.
    Keyboard.dismiss();
    setCoverError(null);
    const result = await pickImageFromLibrary();
    if (result.status === 'picked') setCover({ uri: result.uri });
    else if (result.status === 'denied') setCoverError(PICK_DENIED);
    else if (result.status === 'failed') setCoverError(PICK_FAILED);
    // 'canceled' says nothing: it can't be told apart from a died picker.
  };

  const removeCover = () => {
    setCover(null);
    setCoverError(null);
  };

  // The detail slides UNDER the invite screen on purpose: "Später" up there
  // is then a plain back() with a return animation, and a back from the
  // detail lands on the list, never on this form again.
  const leave = (id: string) => {
    router.replace(`/trip/${id}`);
    router.push(`/trip/${id}/invite`);
  };

  const submit = async () => {
    let tripId = createdTripId;
    if (!tripId) {
      const nextNameError = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
      const { start, end } = dateRange;
      // The calendar hands over either both ends or neither, and it cannot
      // produce an end before the start. `validateDateRange` stays in front
      // as the last check anyway: it costs nothing and keeps the case
      // covered should the date range ever come from another source.
      const nextRangeError = !start || !end ? 'Trag den Zeitraum ein.' : validateDateRange(start, end);
      setNameError(nextNameError ?? undefined);
      setDateRangeError(nextRangeError ?? undefined);
      if (nextNameError || nextRangeError || !start || !end || !userId) return;

      setLoading(true);
      const { id, error } = await createTrip({
        name, startDate: start, endDate: end, ownerId: userId,
      });
      if (error || !id) {
        setLoading(false);
        return setNameError(error ?? undefined);
      }
      tripId = id;
    }

    if (cover) {
      setLoading(true);
      const { error } = await setTripCover(tripId, cover.uri);
      setLoading(false);
      if (error) {
        setCreatedTripId(tripId);
        setCoverError(error);
        return;
      }
    }
    leave(tripId);
  };

  // After a failed upload the button only retries the cover; without a
  // cover left to retry, it IS the way on (Spec §7.3).
  const primaryLabel = !coverFailed ? 'Reise anlegen' : cover ? 'Nochmal versuchen' : 'Ohne Cover weiter';

  return (
    // Since the button sticks to the bottom, the screen needs keyboard
    // avoidance: the name field has `autoFocus`, so the keyboard stands right
    // away and used to cover it. Same pattern as preview.tsx: `padding` on
    // iOS, Android handles it through windowSoftInputMode on the window.
    //
    // The spacing sits on the ScrollView's content, not on the
    // KeyboardAvoidingView: with `behavior="padding"` that one sets its own
    // `paddingBottom` and thereby overwrote the screen margin as soon as no
    // keyboard stood. The button then stuck directly to the tab bar.
    //
    // A ScrollView since the cover surface: title, 228 px of cover, two
    // fields and the button no longer fit above the keyboard. `flexGrow: 1`
    // keeps the filler pushing the button to the bottom edge while there is
    // room; taps on the surface close the keyboard and still land.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors['bg-0'] }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.screen, { paddingTop: topInset }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={[type.h1, { color: colors['text-1'] }]}>Neue Reise</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          Name und Zeitraum reichen, ein Cover ist optional. Freunde lädst du gleich danach ein.
        </Text>
        <TripCoverPicker
          uri={cover?.uri ?? null}
          error={coverError}
          onChoose={() => void chooseCover()}
          onChange={() => setCoverSheetVisible(true)}
        />
        <Input
          label="Name der Reise"
          value={name}
          onChangeText={setName}
          error={nameError}
          placeholder="Norwegen mit dem Camper"
          autoFocus
          editable={!coverFailed}
        />
        <DateRangeField
          value={dateRange}
          onChange={setDateRange}
          error={dateRangeError}
          disabled={coverFailed}
        />
        {/* Pushes the button to the bottom edge, within thumb reach, instead
            of letting it stick in the middle of the picture. The fields stay
            at the top where the reading axis begins: with centred content the
            whole block would jump as soon as an error message appears under
            one field. */}
        <View style={styles.filler} />
        <Button variant="primary" label={primaryLabel} onPress={submit} loading={loading} />
        {coverFailed && cover && createdTripId && (
          <Button variant="text" label="Ohne Cover weiter" onPress={() => leave(createdTripId)} />
        )}
      </ScrollView>
      {/* Inside the KeyboardAvoidingView, whose box stays the full screen:
          only the inner view shrinks when the keyboard pads it, so the strip
          keeps sitting at the very top while the form slides up under it. */}
      <StatusBarCover />
      {/* At root level, not inside the picker: Sheet positions itself
          relative to its parent (see DateRangeField.tsx), inside the
          ScrollView it would open at the surface's position. */}
      <Sheet visible={coverSheetVisible} title="Cover" onClose={() => setCoverSheetVisible(false)}>
        <TripCoverSheetContent
          onChoose={() => void chooseCover()}
          onRemove={removeCover}
          onClose={() => setCoverSheetVisible(false)}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  filler: { flex: 1 },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest "src/app/\(tabs\)/trip/__tests__/form.test.tsx"`
Expected: PASS, alle alten und die 7 neuen Tests. Falls `editable` am `Input` nicht ankommt: `Input` reicht `...rest` an `TextInput` durch, `screen.getByLabelText('Name der Reise')` ist dieses `TextInput`.

- [ ] **Step 5: Commit**

```bash
git add "mobile/src/app/(tabs)/trip/new.tsx" "mobile/src/app/(tabs)/trip/__tests__/form.test.tsx"
git commit -m "feat(trip): choose a cover while creating a trip"
```

---

### Task 9: Kontolöschung räumt Cover aus dem Bucket `covers`

**Files:**
- Modify: `supabase/functions/delete-account/store.ts` (Interface um Zeile 103, Implementierung neben `deleteAvatar` um Zeile 346)
- Modify: `supabase/functions/delete-account/index.ts:283-310`
- Test: `supabase/functions/delete-account/process_test.ts` (Schrittfolge), `store_test.ts`

**Interfaces:**
- Produces: `AccountStore.deleteCovers(keys: string[]): Promise<{ error: unknown }>`; Storage-Schritt `storage-covers`

- [ ] **Step 1: Write the failing test**

In `process_test.ts` neben dem Test `'all storage steps run before the database'` (Zeile ~162) einen dritten Schritt aufnehmen:

```ts
Deno.test('three storage locations, all before the database, in order', async () => {
  const order: string[] = [];
  const result = await performDeletion(
    [
      { name: 'media', run: async () => { order.push('media'); return { error: null }; } },
      { name: 'avatar', run: async () => { order.push('avatar'); return { error: null }; } },
      { name: 'covers', run: async () => { order.push('covers'); return { error: null }; } },
    ],
    [{ name: 'db', run: async () => { order.push('db'); return { error: null }; } }],
  );
  assertEquals(result.ok, true);
  assertEquals(order, ['media', 'avatar', 'covers', 'db']);
});
```

(Signatur und Imports wie in den bestehenden Tests derselben Datei.)

Dazu in `store_test.ts` ein Test für die neue Store-Funktion über einen gefälschten Admin-Client. Falls `createAccountStore` dort bisher nicht getestet wird, den Test so anlegen:

```ts
Deno.test('deleteCovers removes the keys from the covers bucket and skips an empty list', async () => {
  const removed: { bucket: string; keys: string[] }[] = [];
  const fakeAdmin = {
    storage: {
      from: (bucket: string) => ({
        remove: async (keys: string[]) => { removed.push({ bucket, keys }); return { error: null }; },
      }),
    },
  };
  const store = createAccountStore(fakeAdmin as never, {} as never, async () => ({ ok: true, status: 204 }));
  await store.deleteCovers([]);
  assertEquals(removed, []);
  await store.deleteCovers(['trips/t1/a.jpg', 'trips/t1/b.jpg']);
  assertEquals(removed, [{ bucket: 'covers', keys: ['trips/t1/a.jpg', 'trips/t1/b.jpg'] }]);
});
```

`createAccountStore(supabaseAdmin, personClient, deleteOne)` (store.ts:204); nur der Admin-Client wird für `deleteCovers` berührt. Import in `store_test.ts` erweitern: `import { createAccountStore, createS3Deleter, type DeleteOneResult, deleteObjectsInBlocks } from './store.ts';`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd supabase/functions/delete-account && deno test --allow-all 2>&1 | tail -15`
Expected: `deleteCovers` existiert nicht (TypeScript-Fehler), der Reihenfolge-Test läuft bereits durch (er prüft nur `performDeletion`), bleibt aber als Dokumentation.

- [ ] **Step 3: Implement**

`store.ts`, Interface nach `deleteAvatar`:

```ts
  // Cover objects of the person's own trips, `covers` bucket (Spec
  // 2026-08-28-reise-cover §9). Own storage location like the avatar, not
  // the moments' S3 bucket, where cover paths used to be thrown before the
  // feature existed.
  deleteCovers(keys: string[]): Promise<{ error: unknown }>;
```

`store.ts`, Implementierung nach `deleteAvatar`:

```ts
    async deleteCovers(keys: string[]): Promise<{ error: unknown }> {
      if (keys.length === 0) return { error: null };
      const { error } = await supabaseAdmin.storage.from(COVER_BUCKET).remove(keys);
      return { error };
    },
```

und oben bei `AVATAR_BUCKET` die Konstante `const COVER_BUCKET = 'covers';` (mit dem Hinweis, dass der Name mit `mobile/src/features/trips/cover.ts` und `20260828120000_trip_cover.sql` übereinstimmen muss).

`index.ts`: die Schleife über `trips.map((t) => t.cover_key)` (um Zeile 283) sammelt in eine eigene Liste statt in `keys`:

```ts
  // Cover paths belong to the `covers` bucket (Supabase storage), not to
  // the moments' S3 bucket; the guard decides unchanged whether a path
  // belongs to this deletion, only the target differs, same as the avatar.
  const coversToDelete: string[] = [];
  for (const candidate of trips.map((t) => t.cover_key)) {
    if (candidate === null || candidate === undefined || candidate.length === 0) continue;
    if (pathBelongsToUs(candidate, allowedPrefixes)) coversToDelete.push(candidate);
    else unresolvedPaths.push(candidate);
  }
```

und in der `storage`-Liste nach `storage-avatar`:

```ts
    { name: 'storage-covers', run: () => store.deleteCovers(coversToDelete) },
```

Den Kommentar über `allowedPrefixes` (Zeile ~247) anpassen: `cover_key` hat seit `20260828120000_trip_cover.sql` ein eigentümergebundenes Schema, die Löschung greift.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd supabase/functions/delete-account && deno test --allow-all 2>&1 | tail -15`
Expected: alle Tests grün. Falls die Integrationstests einen laufenden Stack brauchen und ihn nicht finden, nur `process_test.ts` und `store_test.ts` gezielt laufen lassen: `deno test --allow-all process_test.ts store_test.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/delete-account/store.ts supabase/functions/delete-account/index.ts supabase/functions/delete-account/process_test.ts supabase/functions/delete-account/store_test.ts
git commit -m "feat(delete-account): remove trip covers from the covers bucket"
```

---

### Task 10: Gesamtlauf und Abschluss

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-reise-cover-design.md` nur, falls die Umsetzung von der Spec abweicht (dann die Abweichung dort nachziehen)

- [ ] **Step 1: Volle Jest-Suite**

Run: `cd mobile && npx jest 2>&1 | tail -8`
Expected: alle Suites grün (Baseline vor dieser Arbeit: 129 Suites / 2208 Tests, jetzt mehr).

- [ ] **Step 2: Typecheck und Lint**

Run: `cd mobile && npx tsc --noEmit && npx expo lint 2>&1 | tail -3`
Expected: tsc ohne Ausgabe; ESLint höchstens die 28 vorbestehenden Fehler, keiner davon in den neuen oder geänderten Dateien.

- [ ] **Step 3: Datenbank**

Run (Repo-Root): `supabase db reset 2>&1 | tail -3 && supabase test db 2>&1 | tail -5`
Expected: 23 Dateien grün.

- [ ] **Step 4: Sichtprüfung im Simulator oder am Gerät**

Run (Ordner `mobile`, Metro läuft bereits): App neu starten, Reise-Tab, «Neue Reise»: leere Fläche mit Plus, Tipp öffnet Fotos, gewähltes Bild füllt die Fläche, «Ändern»-Badge oben rechts, Sheet mit zwei Einträgen unten am Screen (nicht in der Mitte); Tastatur: Cover rutscht scrollbar unter den Titel; nach «Reise anlegen» zeigt das Detail das Foto, der Reise-Tab ebenso.
Expected: wie beschrieben; Abweichungen notieren und beheben, bevor gemergt wird.

- [ ] **Step 5: Commit offener Rest**

```bash
git status --short
git add -A docs mobile supabase
git commit -m "chore(cover): final pass after full test run"
```

(Nur, falls Schritt 1 bis 4 Änderungen hinterlassen haben; sonst entfällt der Commit.)
