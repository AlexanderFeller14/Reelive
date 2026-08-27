# Momente aus Fotos einsenden: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus der Kamera-Ansicht lassen sich mehrere Fotos und Videos aus der Fotomediathek auf einmal in die laufende Reise einsenden, ohne Caption, nur mit Aufnahmedatum im Reisezeitraum, über denselben Queue-Pfad wie die Live-Aufnahme.

**Architektur:** Drei kleine Module unter `features/moments/`: die puren Regeln (`libraryImport.ts`), der Picker mit Bibliotheks-Metadaten (`libraryPicker.ts`) und das sequenzielle Batch-Einsenden (`libraryImportSubmit.ts`). Der Kamera-Screen orchestriert: Knopf, Fortschritts-Pille statt Auslöser, Erfolgsanimation mit `added = N`, Zusammenfassung der Ablehnungen in der bestehenden Fehler-Pille. `MomentSubmissionAnimation` lernt die Batchgrösse, `placeAndTime` gibt die Ortsbenennung als eigene Funktion frei.

**Tech Stack:** Expo SDK 57 (expo-image-picker, expo-media-library/legacy, expo-location), React Native, TypeScript strict, Jest + @testing-library/react-native, Lucide.

**Spec:** `docs/superpowers/specs/2026-08-27-fotos-import-design.md`

**Branch:** `feat/library-import` ab `main`. Achtung: der Arbeitsbaum auf `main` trägt gerade ungespeicherte Änderungen einer anderen Baustelle (Siegel-Brief, SealPeel). Nicht mitcommitten; am besten in einem eigenen Worktree arbeiten (`superpowers:using-git-worktrees`).

## Global Constraints

- Import nur, wenn der Kalendertag der Aufnahme (Gerätezone) in `[start_date, end_date]` der gewählten Reise liegt; ohne ermittelbares Datum wird abgelehnt.
- Videos länger als `MAX_VIDEO_SECONDS` (heute `90`, Konstante in `capture/index.tsx`) werden abgelehnt, nicht gekürzt. Die Regeln bekommen den Wert als Parameter.
- Höchstens 20 Elemente pro Picker-Runde (`SELECTION_LIMIT`).
- Ort ausschliesslich aus dem Element (Bibliothek oder EXIF), nie vom aktuellen Standort.
- Picker ohne `allowsEditing` (Avatar-Bug 2026-08-13), mit `preferredAssetRepresentationMode: Compatible`, `exif: true`, `quality: 1`.
- `expo-media-library` nur über den Legacy-Einstieg `expo-media-library/legacy` (Begründung in `exportApi.ts`).
- Quellcode englisch (Bezeichner, Kommentare, Testtitel), sichtbare UI-Texte deutsch in Du-Form nach DESIGN-LANGUAGE.md §6; keine Em-Dashes in Texten, Kommentaren und Commit-Nachrichten. Vokabular: «Moment», «einsenden», nie «Snap», «Galerie», «hochladen».
- UI nach DESIGN-LANGUAGE.md: auf dem Sucher nur translucente Pillen (`Pill`), Lucide Outline, Stroke 1.75, Tokens statt Hex-Werte.
- Nach Code-Änderungen immer ganz `src/` linten (`npx eslint src --ext .ts,.tsx`), nicht nur die eigene Datei; 29 vorbestehende Fehler sind bekannt und bleiben.
- Alle Befehle laufen in `mobile/`.
- Commit-Nachrichten: `typ(scope): deutscher Satz`, Scopes wie im Log (`camera`, `moments`, `ui`, `ios`).

---

### Task 1: `describePlace` aus `determinePlace` herauslösen

Der Import bringt eigene Koordinaten mit (Bibliothek oder EXIF) und braucht nur die Ortsbenennung, nicht die Positionsbestimmung. Heute stecken beide in `determinePlace()`.

**Files:**
- Modify: `mobile/src/features/moments/placeAndTime.ts:32-61`
- Test: `mobile/src/features/moments/__tests__/placeAndTime.test.ts`

**Interfaces:**
- Produces: `export async function describePlace(latitude: number, longitude: number): Promise<string | null>` (Task 4 ruft sie auf). `determinePlace()` behält Signatur und Verhalten.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

In `placeAndTime.test.ts` die Import-Zeile erweitern:

```ts
import { now, determinePlace, describePlace } from '../placeAndTime';
```

Und am Ende der Datei anhängen:

```ts
test('describePlace turns coordinates into a city name', async () => {
  await expect(describePlace(47.05, 8.31)).resolves.toBe('Luzern');
  expect(Location.reverseGeocodeAsync).toHaveBeenCalledWith({ latitude: 47.05, longitude: 8.31 });
});

test('describePlace answers null when geocoding fails, without throwing', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(describePlace(47.05, 8.31)).resolves.toBeNull();
});

test('describePlace answers null when geocoding hangs past the timeout', async () => {
  jest.useFakeTimers();
  (Location.reverseGeocodeAsync as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
  const pending = describePlace(47.05, 8.31);
  await jest.advanceTimersByTimeAsync(8_000);
  await expect(pending).resolves.toBeNull();
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/placeAndTime.test.ts`
Expected: die drei neuen Tests scheitern mit `TypeError: (0 , _placeAndTime.describePlace) is not a function`, die bestehenden bleiben grün.

- [ ] **Step 3: `describePlace` herauslösen**

In `placeAndTime.ts` den Geocoding-Block in `determinePlace` (die Zeilen von `let place_name: string | null = null;` bis zum schliessenden `}` des `catch`) ersetzen durch:

```ts
  const place_name = await describePlace(latitude, longitude);
```

so dass die Funktion endet mit:

```ts
  const place_name = await describePlace(latitude, longitude);

  return { lat: latitude, lng: longitude, place_name };
}
```

Danach als neue Funktion am Ende der Datei anfügen:

```ts
// Reverse-geocodes coordinates to a city name; null when the lookup fails or
// times out. Shared by the live capture (determinePlace) and the library
// import (libraryImportSubmit), which brings its own coordinates from the
// asset instead of the current position.
export async function describePlace(latitude: number, longitude: number): Promise<string | null> {
  try {
    const [geocoded] = await withTimeout(
      Location.reverseGeocodeAsync({ latitude, longitude }),
      TIMEOUT_MS
    );
    return geocoded?.city ?? null;
  } catch (error) {
    console.error('[placeAndTime] geocoding failed', error);
    return null;
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/placeAndTime.test.ts`
Expected: alle Tests grün, inklusive der bestehenden vier zu `determinePlace`.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add src/features/moments/placeAndTime.ts src/features/moments/__tests__/placeAndTime.test.ts
git commit -m "refactor(moments): Ortsname aus Koordinaten als eigene Funktion describePlace"
```

---

### Task 2: Die puren Import-Regeln (`libraryImport.ts`)

Aufnahmezeit auflösen, Ort auflösen, ein Element bewerten, Ablehnungen zusammenfassen. Keine I/O, alles testbar ohne Mocks.

**Files:**
- Create: `mobile/src/features/moments/libraryImport.ts`
- Test: `mobile/src/features/moments/__tests__/libraryImport.test.ts`

**Interfaces:**
- Consumes: `todaysCalendarDay(now: Date): string` und `formatRange(startIso, endIso): string` aus `@/features/trips/tripDay`.
- Produces (Task 3, 4 und 6 bauen darauf):

```ts
export type PickedMedia = {
  uri: string;
  kind: 'photo' | 'video';
  durationMs: number | null;
  exif: Record<string, unknown> | null;
  creationTime: number | null;
  location: { latitude: number; longitude: number } | null;
};
export type ImportPeriod = { start_date: string; end_date: string };
export type RefusalReason = 'outside_period' | 'too_long' | 'unknown_date' | 'failed';
export type AcceptedMedia = {
  accepted: true; media: PickedMedia; captured_at: string; captured_tz: string;
  duration_s: number | null; lat: number | null; lng: number | null;
};
export type RefusedMedia = { accepted: false; media: PickedMedia; reason: RefusalReason };
export type Assessed = AcceptedMedia | RefusedMedia;
export function resolveCaptureTime(media: Pick<PickedMedia, 'exif' | 'creationTime'>, deviceTz: string): { captured_at: string; captured_tz: string } | null;
export function resolveLocation(media: Pick<PickedMedia, 'exif' | 'location'>): { lat: number; lng: number } | null;
export function assess(media: PickedMedia, period: ImportPeriod, maxVideoSeconds: number, deviceTz: string): Assessed;
export function refusalSummary(reasons: RefusalReason[], total: number, period: ImportPeriod, maxVideoSeconds: number): string | null;
```

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`mobile/src/features/moments/__tests__/libraryImport.test.ts`:

```ts
import {
  assess,
  refusalSummary,
  resolveCaptureTime,
  resolveLocation,
  type PickedMedia,
} from '../libraryImport';

const TZ = 'Europe/Zurich';
const PERIOD = { start_date: '2026-08-01', end_date: '2026-08-14' };
const MAX_SECONDS = 90;

const media = (over: Partial<PickedMedia> = {}): PickedMedia => ({
  uri: 'file:///picked.jpg',
  kind: 'photo',
  durationMs: null,
  exif: null,
  creationTime: null,
  location: null,
  ...over,
});

describe('resolveCaptureTime', () => {
  test('reads DateTimeOriginal with its offset as an exact instant', () => {
    const result = resolveCaptureTime(
      {
        exif: { DateTimeOriginal: '2026:08:05 14:32:11', OffsetTimeOriginal: '+02:00' },
        creationTime: null,
      },
      TZ
    );
    expect(result).toEqual({ captured_at: '2026-08-05T12:32:11.000Z', captured_tz: TZ });
  });

  test('a negative offset moves the instant the other way', () => {
    const result = resolveCaptureTime(
      {
        exif: { DateTimeOriginal: '2026:08:05 08:00:00', OffsetTimeOriginal: '-05:30' },
        creationTime: null,
      },
      TZ
    );
    expect(result?.captured_at).toBe('2026-08-05T13:30:00.000Z');
  });

  test('reads DateTimeOriginal without an offset as device-local time', () => {
    const result = resolveCaptureTime(
      { exif: { DateTimeOriginal: '2026:08:05 14:32:11' }, creationTime: null },
      TZ
    );
    expect(result?.captured_at).toBe(new Date(2026, 7, 5, 14, 32, 11).toISOString());
    expect(result?.captured_tz).toBe(TZ);
  });

  test('falls back to the library creation time', () => {
    const result = resolveCaptureTime(
      { exif: null, creationTime: Date.UTC(2026, 7, 5, 9, 0, 0) },
      TZ
    );
    expect(result).toEqual({ captured_at: '2026-08-05T09:00:00.000Z', captured_tz: TZ });
  });

  test('prefers EXIF over the creation time', () => {
    const result = resolveCaptureTime(
      {
        exif: { DateTimeOriginal: '2026:08:05 14:32:11', OffsetTimeOriginal: '+02:00' },
        creationTime: Date.UTC(2026, 7, 9),
      },
      TZ
    );
    expect(result?.captured_at).toBe('2026-08-05T12:32:11.000Z');
  });

  test('ignores a malformed EXIF date and answers null without any source', () => {
    expect(
      resolveCaptureTime({ exif: { DateTimeOriginal: 'gestern' }, creationTime: null }, TZ)
    ).toBeNull();
    expect(resolveCaptureTime({ exif: { DateTimeOriginal: 42 }, creationTime: null }, TZ)).toBeNull();
    expect(resolveCaptureTime({ exif: null, creationTime: null }, TZ)).toBeNull();
  });
});

describe('resolveLocation', () => {
  test('prefers the library location over EXIF', () => {
    expect(
      resolveLocation({
        exif: { GPSLatitude: 1, GPSLongitude: 1 },
        location: { latitude: 47.05, longitude: 8.31 },
      })
    ).toEqual({ lat: 47.05, lng: 8.31 });
  });

  test('reads EXIF GPS with its hemisphere references', () => {
    expect(
      resolveLocation({
        exif: { GPSLatitude: 33.86, GPSLatitudeRef: 'S', GPSLongitude: 151.2, GPSLongitudeRef: 'E' },
        location: null,
      })
    ).toEqual({ lat: -33.86, lng: 151.2 });
    expect(
      resolveLocation({
        exif: { GPSLatitude: 40.7, GPSLatitudeRef: 'N', GPSLongitude: 74.0, GPSLongitudeRef: 'W' },
        location: null,
      })
    ).toEqual({ lat: 40.7, lng: -74.0 });
  });

  test('answers null without a complete coordinate pair', () => {
    expect(resolveLocation({ exif: { GPSLatitude: 47.05 }, location: null })).toBeNull();
    expect(resolveLocation({ exif: { GPSLatitude: 'nord', GPSLongitude: 8 }, location: null })).toBeNull();
    expect(resolveLocation({ exif: null, location: null })).toBeNull();
  });
});

describe('assess', () => {
  test('accepts a photo captured inside the trip period, with its time and place', () => {
    const result = assess(
      media({ creationTime: Date.UTC(2026, 7, 5, 12), location: { latitude: 47.05, longitude: 8.31 } }),
      PERIOD,
      MAX_SECONDS,
      TZ
    );
    expect(result).toEqual({
      accepted: true,
      media: expect.objectContaining({ uri: 'file:///picked.jpg' }),
      captured_at: '2026-08-05T12:00:00.000Z',
      captured_tz: TZ,
      duration_s: null,
      lat: 47.05,
      lng: 8.31,
    });
  });

  test('a photo without coordinates is accepted without a place', () => {
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 5, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: true,
      lat: null,
      lng: null,
    });
  });

  test('refuses a photo from outside the trip period, on either side', () => {
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 20, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: false,
      reason: 'outside_period',
    });
    expect(assess(media({ creationTime: Date.UTC(2026, 6, 31, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: false,
      reason: 'outside_period',
    });
  });

  test('the first and the last day of the trip still count as inside', () => {
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 1, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: true,
    });
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 14, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: true,
    });
  });

  test('refuses a video longer than the limit and rounds an accepted length to seconds', () => {
    const long = media({
      kind: 'video',
      uri: 'file:///long.mov',
      durationMs: 90_400,
      creationTime: Date.UTC(2026, 7, 5, 12),
    });
    expect(assess(long, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: false, reason: 'too_long' });

    const short = media({
      kind: 'video',
      uri: 'file:///short.mov',
      durationMs: 12_400,
      creationTime: Date.UTC(2026, 7, 5, 12),
    });
    expect(assess(short, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: true, duration_s: 12 });
  });

  test('a video without a known length is accepted without duration', () => {
    const unknown = media({ kind: 'video', uri: 'file:///x.mov', creationTime: Date.UTC(2026, 7, 5, 12) });
    expect(assess(unknown, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: true, duration_s: null });
  });

  test('refuses media without any capture date', () => {
    expect(assess(media(), PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: false, reason: 'unknown_date' });
  });

  test('the period rule wins over the length rule when both fail', () => {
    const both = media({
      kind: 'video',
      uri: 'file:///old-long.mov',
      durationMs: 200_000,
      creationTime: Date.UTC(2026, 6, 1, 12),
    });
    expect(assess(both, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: false, reason: 'outside_period' });
  });
});

describe('refusalSummary', () => {
  test('nothing refused, no summary', () => {
    expect(refusalSummary([], 3, PERIOD, MAX_SECONDS)).toBeNull();
  });

  test('a single element speaks of "der Moment"', () => {
    expect(refusalSummary(['outside_period'], 1, PERIOD, MAX_SECONDS)).toBe(
      'Der Moment wurde nicht eingesendet: ausserhalb des Reisezeitraums (1.–14. Aug 2026).'
    );
  });

  test('a partial batch counts the refused against the total', () => {
    expect(refusalSummary(['outside_period', 'outside_period'], 5, PERIOD, MAX_SECONDS)).toBe(
      '2 von 5 Momenten wurden nicht eingesendet: ausserhalb des Reisezeitraums (1.–14. Aug 2026).'
    );
  });

  test('a fully refused batch says so, and mixed reasons carry their counts', () => {
    expect(refusalSummary(['too_long', 'unknown_date'], 2, PERIOD, MAX_SECONDS)).toBe(
      'Keiner der 2 Momente wurde eingesendet: 1 Video länger als 90 Sekunden, 1 Aufnahmedatum unbekannt. Mit Zugriff auf deine Fotos kommt das Aufnahmedatum meist mit.'
    );
  });

  test('several long videos use the plural, a single reason carries no count', () => {
    expect(refusalSummary(['too_long', 'too_long'], 4, PERIOD, MAX_SECONDS)).toBe(
      '2 von 4 Momenten wurden nicht eingesendet: Videos länger als 90 Sekunden.'
    );
  });

  test('failed submissions read as "beim Sichern gescheitert"', () => {
    expect(refusalSummary(['failed'], 1, PERIOD, MAX_SECONDS)).toBe(
      'Der Moment wurde nicht eingesendet: beim Sichern gescheitert.'
    );
    expect(refusalSummary(['too_long', 'failed'], 3, PERIOD, MAX_SECONDS)).toBe(
      '2 von 3 Momenten wurden nicht eingesendet: 1 Video länger als 90 Sekunden, 1 beim Sichern gescheitert.'
    );
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryImport.test.ts`
Expected: FAIL mit `Cannot find module '../libraryImport'`.

- [ ] **Step 3: Modul schreiben**

`mobile/src/features/moments/libraryImport.ts`:

```ts
import { formatRange, todaysCalendarDay } from '@/features/trips/tripDay';

// One element as the picker hands it over, normalized so the rules below
// need to know nothing about expo-image-picker or expo-media-library.
export type PickedMedia = {
  uri: string;
  kind: 'photo' | 'video';
  // Length in milliseconds; null for photos and for videos without a known
  // length.
  durationMs: number | null;
  // EXIF tags as flat key/value pairs. expo-image-picker flattens the {GPS}
  // dictionary into GPS* keys (ImageUtils.swift, readExifFrom).
  exif: Record<string, unknown> | null;
  // Creation time from the photo library in ms since epoch; null without
  // library access or without an asset id.
  creationTime: number | null;
  location: { latitude: number; longitude: number } | null;
};

export type ImportPeriod = { start_date: string; end_date: string };

export type RefusalReason = 'outside_period' | 'too_long' | 'unknown_date' | 'failed';

export type AcceptedMedia = {
  accepted: true;
  media: PickedMedia;
  captured_at: string;
  captured_tz: string;
  duration_s: number | null;
  lat: number | null;
  lng: number | null;
};

export type RefusedMedia = { accepted: false; media: PickedMedia; reason: RefusalReason };

export type Assessed = AcceptedMedia | RefusedMedia;

// EXIF writes 'YYYY:MM:DD HH:MM:SS' (colons in the date, no zone), the zone
// arrives separately as OffsetTimeOriginal '+02:00' on iOS 13+ cameras.
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function exifCaptureTime(exif: Record<string, unknown> | null): Date | null {
  const raw = exif?.DateTimeOriginal;
  if (typeof raw !== 'string') return null;
  const match = EXIF_DATE.exec(raw);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  const rawOffset = exif?.OffsetTimeOriginal;
  const offset = typeof rawOffset === 'string' ? EXIF_OFFSET.exec(rawOffset) : null;
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1;
    const offsetMinutes = sign * (Number(offset[2]) * 60 + Number(offset[3]));
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60_000);
  }
  // Without an offset the EXIF clock is read as the device's local time, the
  // same assumption the live capture makes with placeAndTime.now().
  const local = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(local.getTime()) ? null : local;
}

// The capture instant, first choice EXIF (the camera's own clock), second
// choice the library's creation time (which for app-saved media is the save
// time). captured_tz is always the device zone: an EXIF offset alone does not
// name an IANA zone.
export function resolveCaptureTime(
  media: Pick<PickedMedia, 'exif' | 'creationTime'>,
  deviceTz: string
): { captured_at: string; captured_tz: string } | null {
  const fromExif = exifCaptureTime(media.exif);
  if (fromExif) return { captured_at: fromExif.toISOString(), captured_tz: deviceTz };
  if (media.creationTime != null && Number.isFinite(media.creationTime)) {
    return { captured_at: new Date(media.creationTime).toISOString(), captured_tz: deviceTz };
  }
  return null;
}

// iOS hands GPS degrees as positive numbers, the hemisphere sits in the
// *Ref tag ('N'/'S', 'E'/'W').
function gpsDegrees(value: unknown, ref: unknown, negativeRef: 'S' | 'W'): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  return ref === negativeRef ? -magnitude : magnitude;
}

export function resolveLocation(
  media: Pick<PickedMedia, 'exif' | 'location'>
): { lat: number; lng: number } | null {
  if (media.location) return { lat: media.location.latitude, lng: media.location.longitude };
  const exif = media.exif;
  if (!exif) return null;
  const lat = gpsDegrees(exif.GPSLatitude, exif.GPSLatitudeRef, 'S');
  const lng = gpsDegrees(exif.GPSLongitude, exif.GPSLongitudeRef, 'W');
  return lat != null && lng != null ? { lat, lng } : null;
}

// The import rules, in the order the refusal is reported: no date, then
// outside the trip period, then too long. The calendar day is formed in the
// device zone, like everything else about captured_at on this device.
export function assess(
  media: PickedMedia,
  period: ImportPeriod,
  maxVideoSeconds: number,
  deviceTz: string
): Assessed {
  const time = resolveCaptureTime(media, deviceTz);
  if (!time) return { accepted: false, media, reason: 'unknown_date' };
  const day = todaysCalendarDay(new Date(time.captured_at));
  if (day < period.start_date || day > period.end_date) {
    return { accepted: false, media, reason: 'outside_period' };
  }
  if (media.kind === 'video' && media.durationMs != null && media.durationMs > maxVideoSeconds * 1000) {
    return { accepted: false, media, reason: 'too_long' };
  }
  const location = resolveLocation(media);
  return {
    accepted: true,
    media,
    captured_at: time.captured_at,
    captured_tz: time.captured_tz,
    duration_s:
      media.kind === 'video' && media.durationMs != null ? Math.round(media.durationMs / 1000) : null,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
  };
}

const REASON_ORDER: RefusalReason[] = ['outside_period', 'too_long', 'unknown_date', 'failed'];
const DATE_HINT = 'Mit Zugriff auf deine Fotos kommt das Aufnahmedatum meist mit.';

function reasonText(
  reason: RefusalReason,
  count: number,
  period: ImportPeriod,
  maxVideoSeconds: number
): string {
  switch (reason) {
    case 'outside_period':
      return `ausserhalb des Reisezeitraums (${formatRange(period.start_date, period.end_date)})`;
    case 'too_long':
      return count === 1
        ? `Video länger als ${maxVideoSeconds} Sekunden`
        : `Videos länger als ${maxVideoSeconds} Sekunden`;
    case 'unknown_date':
      return 'Aufnahmedatum unbekannt';
    case 'failed':
      return 'beim Sichern gescheitert';
  }
}

// One sentence for the error pill: how many of the batch stayed out and why.
// With mixed reasons each one carries its count; a single reason stands
// alone. null when nothing was refused.
export function refusalSummary(
  reasons: RefusalReason[],
  total: number,
  period: ImportPeriod,
  maxVideoSeconds: number
): string | null {
  const refused = reasons.length;
  if (refused === 0) return null;
  const counts = new Map<RefusalReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const mixed = counts.size > 1;
  const parts = REASON_ORDER.filter((reason) => counts.has(reason)).map((reason) => {
    const count = counts.get(reason) ?? 0;
    const text = reasonText(reason, count, period, maxVideoSeconds);
    return mixed ? `${count} ${text}` : text;
  });
  const lead =
    total === 1
      ? 'Der Moment wurde nicht eingesendet'
      : refused === total
        ? `Keiner der ${total} Momente wurde eingesendet`
        : `${refused} von ${total} Momenten wurden nicht eingesendet`;
  const hint = counts.has('unknown_date') ? ` ${DATE_HINT}` : '';
  return `${lead}: ${parts.join(', ')}.${hint}`;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryImport.test.ts`
Expected: alle Tests grün.

- [ ] **Step 5: Typen und Lint prüfen**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: tsc ohne Ausgabe; eslint zeigt nur die 29 bekannten, vorbestehenden Fehler, keinen in `libraryImport.ts` oder seinem Test.

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/features/moments/libraryImport.ts src/features/moments/__tests__/libraryImport.test.ts
git commit -m "feat(moments): Import-Regeln: Aufnahmezeit, Ort, Reisezeitraum, Videolänge, Zusammenfassung"
```

---

### Task 3: Der Picker mit Bibliotheks-Metadaten (`libraryPicker.ts`)

Dünne I/O-Schicht: Leseberechtigung anfragen, Picker öffnen, jedes Element in `PickedMedia` normalisieren und, wo eine `assetId` da ist, `creationTime` und `location` aus der Bibliothek nachladen.

**Files:**
- Create: `mobile/src/features/moments/libraryPicker.ts`
- Test: `mobile/src/features/moments/__tests__/libraryPicker.test.ts`

**Interfaces:**
- Consumes: `PickedMedia` aus Task 2.
- Produces (Task 6 ruft es auf):

```ts
export const SELECTION_LIMIT = 20;
export type PickResult = { canceled: true } | { canceled: false; media: PickedMedia[] };
export async function pickFromLibrary(): Promise<PickResult>; // wirft, wenn der Picker selbst scheitert
```

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`mobile/src/features/moments/__tests__/libraryPicker.test.ts`:

```ts
const mockLaunch = jest.fn();
// The representation mode is a string enum at runtime; the module reads it
// from the package, so the mock has to carry it.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (options: unknown) => mockLaunch(options),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockAssetInfo = jest.fn();
jest.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  getAssetInfoAsync: (id: string) => mockAssetInfo(id),
}));

import { pickFromLibrary, SELECTION_LIMIT } from '../libraryPicker';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
  mockLaunch.mockResolvedValue({ canceled: true, assets: null });
});

test('opens a multi-select picker for photos and videos with EXIF and compatible representations', async () => {
  await pickFromLibrary();
  expect(mockLaunch).toHaveBeenCalledWith(
    expect.objectContaining({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: SELECTION_LIMIT,
      orderedSelection: true,
      exif: true,
      quality: 1,
      preferredAssetRepresentationMode: 'compatible',
    })
  );
  // The avatar bug of 2026-08-13: allowsEditing swaps in the legacy picker.
  expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty('allowsEditing');
});

test('a cancel comes back as canceled', async () => {
  await expect(pickFromLibrary()).resolves.toEqual({ canceled: true });
  expect(mockAssetInfo).not.toHaveBeenCalled();
});

test('normalizes photos and videos and enriches them from the library', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///a.jpg',
        type: 'image',
        assetId: 'A',
        exif: { DateTimeOriginal: '2026:08:05 14:32:11' },
        duration: null,
      },
      { uri: 'file:///b.mov', type: 'video', assetId: 'B', duration: 12_400 },
    ],
  });
  mockAssetInfo.mockImplementation(async (id: string) =>
    id === 'A'
      ? { creationTime: 1_000, location: { latitude: 47.05, longitude: 8.31 } }
      : { creationTime: 2_000, location: undefined }
  );

  await expect(pickFromLibrary()).resolves.toEqual({
    canceled: false,
    media: [
      {
        uri: 'file:///a.jpg',
        kind: 'photo',
        durationMs: null,
        exif: { DateTimeOriginal: '2026:08:05 14:32:11' },
        creationTime: 1_000,
        location: { latitude: 47.05, longitude: 8.31 },
      },
      {
        uri: 'file:///b.mov',
        kind: 'video',
        durationMs: 12_400,
        exif: null,
        creationTime: 2_000,
        location: null,
      },
    ],
  });
});

test('a live photo counts as a photo', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///live.jpg', type: 'livePhoto', assetId: null }],
  });
  await expect(pickFromLibrary()).resolves.toMatchObject({ media: [{ kind: 'photo' }] });
});

test('without an asset id or with a failing lookup the element keeps null for time and place', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///a.jpg', type: 'image', assetId: null },
      { uri: 'file:///b.jpg', type: 'image', assetId: 'B' },
    ],
  });
  mockAssetInfo.mockRejectedValue(new Error('no access'));

  await expect(pickFromLibrary()).resolves.toMatchObject({
    canceled: false,
    media: [
      { uri: 'file:///a.jpg', creationTime: null, location: null },
      { uri: 'file:///b.jpg', creationTime: null, location: null },
    ],
  });
  expect(mockAssetInfo).toHaveBeenCalledTimes(1);
  expect(mockAssetInfo).toHaveBeenCalledWith('B');
});

test('asks for read access before the picker, and a refusal does not stop the picker', async () => {
  mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
  mockRequestPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
  await pickFromLibrary();
  expect(mockGetPermissions).toHaveBeenCalledWith(false);
  expect(mockRequestPermissions).toHaveBeenCalledWith(false);
  expect(mockLaunch).toHaveBeenCalledTimes(1);
});

test('does not ask again when access is granted or can no longer be asked for', async () => {
  await pickFromLibrary();
  expect(mockRequestPermissions).not.toHaveBeenCalled();

  mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
  await pickFromLibrary();
  expect(mockRequestPermissions).not.toHaveBeenCalled();
  expect(mockLaunch).toHaveBeenCalledTimes(2);
});

test('a failing permission check still opens the picker', async () => {
  mockGetPermissions.mockRejectedValue(new Error('kaputt'));
  await expect(pickFromLibrary()).resolves.toEqual({ canceled: true });
  expect(mockLaunch).toHaveBeenCalledTimes(1);
});

test('a picker failure propagates to the caller', async () => {
  mockLaunch.mockRejectedValue(new Error('picker broke'));
  await expect(pickFromLibrary()).rejects.toThrow('picker broke');
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryPicker.test.ts`
Expected: FAIL mit `Cannot find module '../libraryPicker'`.

- [ ] **Step 3: Modul schreiben**

`mobile/src/features/moments/libraryPicker.ts`:

```ts
import * as ImagePicker from 'expo-image-picker';
// The legacy entry point for the same reason as in recap/exportApi.ts: the
// modern class-based API breaks the web bundle at module load.
import * as MediaLibrary from 'expo-media-library/legacy';
import type { PickedMedia } from './libraryImport';

// Upper bound per round: the picker copies (and in 'compatible' mode
// transcodes) every selected asset before it hands the list over, without
// any progress of its own. Twenty keeps that wait in the seconds.
export const SELECTION_LIMIT = 20;

export type PickResult = { canceled: true } | { canceled: false; media: PickedMedia[] };

// Explicitly typed, not `as const` (same trap as in AvatarPicker.tsx). And
// NO `allowsEditing`: that swaps in the legacy UIImagePickerController,
// which loads the source fully into memory and dies silently on large
// images (bug of 2026-08-13).
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images', 'videos'],
  allowsMultipleSelection: true,
  selectionLimit: SELECTION_LIMIT,
  orderedSelection: true,
  exif: true,
  quality: 1,
  // HEIC becomes JPEG and HEVC becomes H.264 on the way out of the picker,
  // so the web player can play what the camera roll delivered.
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

// Read access to the library is what makes the picker hand over asset ids;
// without it creationTime and location stay out of reach. A refusal is not
// an error: the picker itself works without any permission, and a failing
// check must not stand between the person and their photos.
async function requestReadAccess(): Promise<void> {
  try {
    const current = await MediaLibrary.getPermissionsAsync(false);
    if (current.granted || !current.canAskAgain) return;
    await MediaLibrary.requestPermissionsAsync(false);
  } catch (error) {
    console.error('[libraryPicker] permission request failed', error);
  }
}

async function libraryInfo(
  assetId: string | null | undefined
): Promise<Pick<PickedMedia, 'creationTime' | 'location'>> {
  if (!assetId) return { creationTime: null, location: null };
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    return { creationTime: info.creationTime ?? null, location: info.location ?? null };
  } catch (error) {
    console.error('[libraryPicker] asset info failed', assetId, error);
    return { creationTime: null, location: null };
  }
}

export async function pickFromLibrary(): Promise<PickResult> {
  await requestReadAccess();
  const result = await ImagePicker.launchImageLibraryAsync(OPTIONS);
  if (result.canceled) return { canceled: true };
  const media: PickedMedia[] = [];
  for (const asset of result.assets) {
    const info = await libraryInfo(asset.assetId);
    media.push({
      uri: asset.uri,
      kind: asset.type === 'video' ? 'video' : 'photo',
      durationMs: asset.duration ?? null,
      exif: asset.exif ?? null,
      creationTime: info.creationTime,
      location: info.location,
    });
  }
  return { canceled: false, media };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryPicker.test.ts`
Expected: alle Tests grün.

- [ ] **Step 5: Typen und Lint prüfen**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: tsc ohne Ausgabe; eslint nur die bekannten 29.

Falls tsc über `asset.exif` klagt (`Record<string, any>` gegen `Record<string, unknown>`): `any` ist zuweisbar, das sollte nicht passieren. Falls `info.location` als `Location | undefined` nicht zu `{ latitude; longitude } | null` passt, hilft `info.location ? { latitude: info.location.latitude, longitude: info.location.longitude } : null`.

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/features/moments/libraryPicker.ts src/features/moments/__tests__/libraryPicker.test.ts
git commit -m "feat(moments): Foto-Picker mit Mehrfachauswahl und Bibliotheks-Metadaten"
```

---

### Task 4: Das Batch-Einsenden (`libraryImportSubmit.ts`)

Der Queue-Pfad aus `preview.tsx` (prepare → persistDurably → Job → enqueueJob → aufräumen), einmal je akzeptiertem Element, strikt nacheinander. Ein scheiterndes Element kostet nur sich selbst.

**Files:**
- Create: `mobile/src/features/moments/libraryImportSubmit.ts`
- Test: `mobile/src/features/moments/__tests__/libraryImportSubmit.test.ts`

**Interfaces:**
- Consumes: `AcceptedMedia`, `PickedMedia` (Task 2); `describePlace` (Task 1); `media.*` und `uploadWorker.enqueueJob` (bestehend).
- Produces (Task 6 ruft es auf):

```ts
export type ImportTarget = { tripId: string; authorId: string };
export type ImportOutcome = { submitted: number; failed: number };
export type ImportProgress = (done: number, total: number) => void;
export async function submitImports(accepted: AcceptedMedia[], target: ImportTarget, onProgress: ImportProgress): Promise<ImportOutcome>;
export function discardRefused(refused: PickedMedia[]): void;
```

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`mobile/src/features/moments/__tests__/libraryImportSubmit.test.ts`:

```ts
// The same doubles as preview.test.tsx: the file operations are native, the
// test checks what the module hands them and what it cleans up.
const mockNewMomentId = jest.fn();
const mockPreparePhoto = jest.fn();
const mockPrepareVideo = jest.fn();
const mockPersistDurably = jest.fn();
const mockRemoveMomentFiles = jest.fn();
const mockDiscardFile = jest.fn();
const mockDiscardIntermediates = jest.fn();
jest.mock('../media', () => ({
  newMomentId: () => mockNewMomentId(),
  preparePhoto: (uri: string) => mockPreparePhoto(uri),
  prepareVideo: (uri: string) => mockPrepareVideo(uri),
  persistDurably: (postId: string, files: unknown) => mockPersistDurably(postId, files),
  removeMomentFiles: (postId: string) => mockRemoveMomentFiles(postId),
  discardFile: (uri: string) => mockDiscardFile(uri),
  discardIntermediates: (raw: string, prepared: unknown) => mockDiscardIntermediates(raw, prepared),
  storageKey: (tripId: string, postId: string, extension: string) =>
    `trips/${tripId}/${postId}.${extension}`,
  mediaExtension: (mediaType: string, uri: string) =>
    mediaType === 'video' ? (uri.endsWith('.mov') ? 'mov' : 'mp4') : 'jpg',
  thumbKey: (tripId: string, postId: string) => `trips/${tripId}/${postId}_t.jpg`,
}));

const mockEnqueueJob = jest.fn();
jest.mock('../uploadWorker', () => ({ enqueueJob: (job: unknown) => mockEnqueueJob(job) }));

const mockDescribePlace = jest.fn();
jest.mock('../placeAndTime', () => ({
  describePlace: (lat: number, lng: number) => mockDescribePlace(lat, lng),
}));

import { discardRefused, submitImports } from '../libraryImportSubmit';
import type { AcceptedMedia } from '../libraryImport';

const TARGET = { tripId: 't1', authorId: 'u1' };

function acceptedPhoto(uri: string, over: Partial<AcceptedMedia> = {}): AcceptedMedia {
  return {
    accepted: true,
    media: { uri, kind: 'photo', durationMs: null, exif: null, creationTime: null, location: null },
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    duration_s: null,
    lat: null,
    lng: null,
    ...over,
  };
}

function acceptedVideo(uri: string): AcceptedMedia {
  return {
    ...acceptedPhoto(uri),
    media: { uri, kind: 'video', durationMs: 12_400, exif: null, creationTime: null, location: null },
    duration_s: 12,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  mockNewMomentId.mockImplementation(() => {
    n += 1;
    return `m${n}`;
  });
  mockPreparePhoto.mockImplementation(async (uri: string) => ({
    medium: `${uri}.medium.jpg`,
    thumb: `${uri}.thumb.jpg`,
  }));
  mockPrepareVideo.mockImplementation(async (uri: string) => ({ medium: uri, thumb: `${uri}.thumb.jpg` }));
  mockPersistDurably.mockImplementation(
    async (postId: string, files: { medium: string; thumb: string }) => ({
      medium: `file:///documents/momente/${postId}/medium.${files.medium.endsWith('.mov') ? 'mov' : 'jpg'}`,
      thumb: `file:///documents/momente/${postId}/thumb.jpg`,
    })
  );
  mockEnqueueJob.mockResolvedValue(undefined);
  mockDescribePlace.mockResolvedValue('Luzern');
});

test('enqueues one job per element with the assessed time, no caption, and reports progress', async () => {
  const progress = jest.fn();
  const outcome = await submitImports(
    [acceptedPhoto('file:///a.jpg', { lat: 47.05, lng: 8.31 }), acceptedVideo('file:///b.mov')],
    TARGET,
    progress
  );

  expect(outcome).toEqual({ submitted: 2, failed: 0 });
  expect(progress.mock.calls).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(mockEnqueueJob).toHaveBeenCalledTimes(2);
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({
    id: 'm1',
    post_id: 'm1',
    trip_id: 't1',
    author_id: 'u1',
    typ: 'photo',
    medium_uri: 'file:///documents/momente/m1/medium.jpg',
    thumb_uri: 'file:///documents/momente/m1/thumb.jpg',
    storage_key: 'trips/t1/m1.jpg',
    thumb_key: 'trips/t1/m1_t.jpg',
    caption: null,
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    lat: 47.05,
    lng: 8.31,
    place_name: 'Luzern',
    duration_s: null,
    zustand: 'wartet',
    versuche: 0,
    zeile_angelegt: false,
    medium_geladen: false,
    thumb_geladen: false,
  });
  expect(mockEnqueueJob.mock.calls[1][0]).toMatchObject({
    id: 'm2',
    typ: 'video',
    medium_uri: 'file:///documents/momente/m2/medium.mov',
    storage_key: 'trips/t1/m2.mov',
    duration_s: 12,
    lat: null,
    lng: null,
    place_name: null,
  });
  // Only the element with coordinates asks for a place name.
  expect(mockDescribePlace).toHaveBeenCalledTimes(1);
  expect(mockDescribePlace).toHaveBeenCalledWith(47.05, 8.31);
});

test('the elements run strictly one after the other', async () => {
  const order: string[] = [];
  mockPreparePhoto.mockImplementation(async (uri: string) => {
    order.push(`prepare ${uri}`);
    return { medium: `${uri}.medium.jpg`, thumb: `${uri}.thumb.jpg` };
  });
  mockEnqueueJob.mockImplementation(async (job: { medium_uri: string }) => {
    order.push(`enqueue ${job.medium_uri}`);
  });

  await submitImports([acceptedPhoto('file:///a.jpg'), acceptedPhoto('file:///b.jpg')], TARGET, jest.fn());

  expect(order).toEqual([
    'prepare file:///a.jpg',
    'enqueue file:///documents/momente/m1/medium.jpg',
    'prepare file:///b.jpg',
    'enqueue file:///documents/momente/m2/medium.jpg',
  ]);
});

test('releases the picker copy and the intermediates after enqueuing', async () => {
  await submitImports([acceptedPhoto('file:///a.jpg')], TARGET, jest.fn());
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///a.jpg');
  expect(mockDiscardIntermediates).toHaveBeenCalledWith('file:///a.jpg', {
    medium: 'file:///a.jpg.medium.jpg',
    thumb: 'file:///a.jpg.thumb.jpg',
  });
  expect(mockRemoveMomentFiles).not.toHaveBeenCalled();
});

test('a failing element is cleaned up and counted, the others still go through', async () => {
  mockPersistDurably.mockRejectedValueOnce(new Error('disk full'));
  const progress = jest.fn();

  const outcome = await submitImports(
    [acceptedPhoto('file:///a.jpg'), acceptedPhoto('file:///b.jpg')],
    TARGET,
    progress
  );

  expect(outcome).toEqual({ submitted: 1, failed: 1 });
  expect(progress.mock.calls).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(mockRemoveMomentFiles).toHaveBeenCalledWith('m1');
  expect(mockDiscardIntermediates).toHaveBeenCalledWith('file:///a.jpg', {
    medium: 'file:///a.jpg.medium.jpg',
    thumb: 'file:///a.jpg.thumb.jpg',
  });
  expect(mockDiscardFile).toHaveBeenCalledWith('file:///a.jpg');
  expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({ id: 'm2' });
});

test('a failing place lookup does not cost the element', async () => {
  mockDescribePlace.mockResolvedValue(null);
  const outcome = await submitImports([acceptedPhoto('file:///a.jpg', { lat: 1, lng: 2 })], TARGET, jest.fn());
  expect(outcome).toEqual({ submitted: 1, failed: 0 });
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({ lat: 1, lng: 2, place_name: null });
});

test('an empty list submits nothing and reports no progress', async () => {
  const progress = jest.fn();
  await expect(submitImports([], TARGET, progress)).resolves.toEqual({ submitted: 0, failed: 0 });
  expect(progress).not.toHaveBeenCalled();
  expect(mockEnqueueJob).not.toHaveBeenCalled();
});

test('discardRefused releases every refused picker copy', () => {
  discardRefused([acceptedPhoto('file:///x.jpg').media, acceptedPhoto('file:///y.jpg').media]);
  expect(mockDiscardFile.mock.calls.map(([uri]) => uri)).toEqual(['file:///x.jpg', 'file:///y.jpg']);
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryImportSubmit.test.ts`
Expected: FAIL mit `Cannot find module '../libraryImportSubmit'`.

- [ ] **Step 3: Modul schreiben**

`mobile/src/features/moments/libraryImportSubmit.ts`:

```ts
import * as media from './media';
import * as uploadWorker from './uploadWorker';
import { describePlace } from './placeAndTime';
import type { AcceptedMedia, PickedMedia } from './libraryImport';
import type { QueueJob } from './types';

export type ImportTarget = { tripId: string; authorId: string };
export type ImportOutcome = { submitted: number; failed: number };
export type ImportProgress = (done: number, total: number) => void;

// The queue path of preview.tsx, once per accepted element and strictly one
// after the other (memory: a photo prepare holds two re-encodes, a batch in
// parallel would stack them). A failing element costs only itself; the rest
// carries on, and the caller gets the counts for its summary.
export async function submitImports(
  accepted: AcceptedMedia[],
  target: ImportTarget,
  onProgress: ImportProgress
): Promise<ImportOutcome> {
  let submitted = 0;
  let failed = 0;
  for (const item of accepted) {
    if (await submitOne(item, target)) submitted += 1;
    else failed += 1;
    onProgress(submitted + failed, accepted.length);
  }
  return { submitted, failed };
}

async function submitOne(item: AcceptedMedia, target: ImportTarget): Promise<boolean> {
  const source = item.media.uri;
  const postId = media.newMomentId();
  let prepared: { medium: string; thumb: string } | null = null;
  try {
    prepared =
      item.media.kind === 'video' ? await media.prepareVideo(source) : await media.preparePhoto(source);
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
    media.discardIntermediates(source, prepared);
    return true;
  } catch (error) {
    media.removeMomentFiles(postId);
    if (prepared) media.discardIntermediates(source, prepared);
    media.discardFile(source);
    console.error('[libraryImportSubmit] element failed', source, error);
    return false;
  }
}

// Refused elements never enter the queue, but their picker copies sit in
// tmp all the same.
export function discardRefused(refused: PickedMedia[]): void {
  for (const item of refused) media.discardFile(item.uri);
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryImportSubmit.test.ts`
Expected: alle Tests grün.

- [ ] **Step 5: Typen und Lint prüfen**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: tsc ohne Ausgabe; eslint nur die bekannten 29.

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/features/moments/libraryImportSubmit.ts src/features/moments/__tests__/libraryImportSubmit.test.ts
git commit -m "feat(moments): Batch-Einsenden aus Fotos über den Queue-Pfad der Preview"
```

---

### Task 5: `MomentSubmissionAnimation` lernt die Batchgrösse

Der Zähler rollt heute fest um `+1`, Titel und Vorlese-Text stehen im Singular. Ein optionaler Prop `added` (Default 1) macht beides batchfähig; die Preview bleibt unverändert.

**Files:**
- Modify: `mobile/src/components/MomentSubmissionAnimation.tsx:142-166, 415-419, 456-476`
- Test: `mobile/src/components/__tests__/MomentSubmissionAnimation.test.tsx`

**Interfaces:**
- Produces: `MomentSubmissionAnimationProps` erhält `added?: number` (Task 6 übergibt `added={N}`).

- [ ] **Step 1: Fehlschlagende Tests schreiben**

In `MomentSubmissionAnimation.test.tsx` hinter dem Test `"rolls the counter up one digit when the trip's count is available"` einfügen:

```ts
test('rolls the counter up by the batch size and speaks in the plural', async () => {
  const { getByTestId, getByText, getByLabelText, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={jest.fn()} counter={11} added={3} />
  );
  // 11 → 14: the tens digit stays fixed, the ones digit rolls 1 → 4.
  expect(getByTestId('counter-digit-fixed-0').props.children).toBe('1');
  expect(getByTestId('counter-digit-old-1').props.children).toBe('1');
  expect(getByTestId('counter-digit-new-1').props.children).toBe('4');
  expect(getByText('Momente eingesendet')).toBeTruthy();
  expect(getByText('Deine Momente sind unterwegs und bleiben bis zum Recap versiegelt.')).toBeTruthy();
  expect(getByLabelText('Momente erfolgreich eingesendet')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});

test('with reduced motion the batch total stands still', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const { getByText, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={jest.fn()} counter={11} added={3} />
  );
  expect(getByText('14')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});

test('an added of one keeps the singular copy', async () => {
  const { getByText, getByLabelText, unmount } = await render(
    <MomentSubmissionAnimation visible={true} onFinished={jest.fn()} counter={11} added={1} />
  );
  expect(getByText('Moment eingesendet')).toBeTruthy();
  expect(getByLabelText('Moment erfolgreich eingesendet')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(TOTAL);
  });
  await unmount();
});
```

`TOTAL` ist die Konstante, die die bestehenden Tests dieser Datei schon verwenden.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/components/__tests__/MomentSubmissionAnimation.test.tsx`
Expected: die drei neuen Tests scheitern (`counter-digit-new-1` ist `'2'`, «Momente eingesendet» wird nicht gefunden); die bestehenden bleiben grün.

- [ ] **Step 3: Prop und Plural einbauen**

Den Props-Typ erweitern:

```ts
export type MomentSubmissionAnimationProps = {
  visible: boolean;
  onFinished: () => void;
  // Counter value of the trip BEFORE this moment; the animation rolls up
  // to +added. null/undefined: the value just isn't available right now, the
  // number is omitted, everything else runs unchanged.
  counter?: number | null;
  // How many moments this run stands for: the counter rolls up by exactly
  // this much and the copy switches to the plural. Default 1, the live
  // capture; the library import passes its batch size.
  added?: number;
};
```

Die Funktionssignatur:

```ts
export function MomentSubmissionAnimation({
  visible,
  onFinished,
  counter,
  added = 1,
}: MomentSubmissionAnimationProps) {
```

Direkt vor dem `return (` des Renders (nach `const polaroidHeight = ...`):

```ts
  const plural = added > 1;
```

Den Vorlese-Text des Covers:

```tsx
      accessibilityLabel={plural ? 'Momente erfolgreich eingesendet' : 'Moment erfolgreich eingesendet'}
```

Die beiden `counter + 1` im Zählerblock werden zu `counter + added`:

```tsx
            {reducedMotion ? (
              <Text style={styles.staticNumber}>{String(counter + added)}</Text>
            ) : (
              <CounterRoll
                from={counter}
                to={counter + added}
                progress={rollProgress}
                progressWindow={COUNTER_WINDOW}
              />
            )}
```

Titel und Untertitel:

```tsx
        <Animated.Text style={[styles.title, titleStyle]}>
          {plural ? 'Momente eingesendet' : 'Moment eingesendet'}
        </Animated.Text>
        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          {plural
            ? 'Deine Momente sind unterwegs und bleiben bis zum Recap versiegelt.'
            : 'Dein Moment ist unterwegs und bleibt bis zum Recap versiegelt.'}
        </Animated.Text>
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/components/__tests__/MomentSubmissionAnimation.test.tsx src/app/__tests__/preview.test.tsx`
Expected: alle grün; die Preview-Tests beweisen, dass der Default `1` nichts verändert.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add src/components/MomentSubmissionAnimation.tsx src/components/__tests__/MomentSubmissionAnimation.test.tsx
git commit -m "feat(ui): Einsenden-Animation rollt um die Batchgrösse und spricht im Plural"
```

---

### Task 6: Der Kamera-Screen: Knopf, Batch, Fortschritt, Animation, Zusammenfassung

Die Orchestrierung. Neuer Pill-Knopf in der Steuerspalte, während des Batches sind Kopfzeile und Auslöser entfernt (wie bei `capturing`), unten steht die Fortschritts-Pille, danach spielt die Animation über dem Sucher, danach kommt die zurückgehaltene Zusammenfassung in die Fehler-Pille.

**Files:**
- Modify: `mobile/src/app/(tabs)/capture/index.tsx` (Imports Zeile 1-57, Konstanten nach Zeile 130, State nach Zeile 536, Handler nach `goToPreview` bei Zeile 1153, Render ab Zeile 1759, Styles ab Zeile 1937)
- Test: `mobile/src/app/(tabs)/capture/__tests__/camera.test.tsx`

**Interfaces:**
- Consumes: `pickFromLibrary` (Task 3); `assess`, `refusalSummary`, Typen `AcceptedMedia`, `PickedMedia`, `RefusalReason` (Task 2); `submitImports`, `discardRefused`, `ImportOutcome` (Task 4); `MomentSubmissionAnimation` mit `added` (Task 5); bestehend: `captureLock.lock`, `Pill`, `PillButton`, `errorBottom`, `setCaptureError`, `setFocusState`, `active`, `counter`, `trip`, `userId`, `MAX_VIDEO_SECONDS`.
- Produces: sichtbarer Knopf mit `accessibilityLabel="Momente aus Fotos einsenden"`, Fortschritts-Pille mit `testID="import-progress"`.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

In `camera.test.tsx` vor der Zeile `import CaptureScreen from '../index';` die Doubles anlegen:

```ts
// The library import (spec 2026-08-27): picker and batch submission are
// native I/O with their own tests; here only the orchestration counts.
const mockPickFromLibrary = jest.fn();
jest.mock('@/features/moments/libraryPicker', () => ({
  pickFromLibrary: () => mockPickFromLibrary(),
}));

const mockSubmitImports = jest.fn();
const mockDiscardRefused = jest.fn();
jest.mock('@/features/moments/libraryImportSubmit', () => ({
  submitImports: (...args: unknown[]) => mockSubmitImports(...args),
  discardRefused: (refused: unknown[]) => mockDiscardRefused(refused),
}));

// The success cover is a Reanimated choreography with its own test; the
// screen only hands it props and waits for "finished", which the tests
// trigger by hand through mockFinishAnimation.
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
```

Im `beforeEach` (hinter `mockMultiCamera.onPressureChange.mockImplementation(() => () => {});`) ergänzen:

```ts
  mockPickFromLibrary.mockResolvedValue({ canceled: true });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 0 });
  mockFinishAnimation = null;
```

Hinter der Definition von `loaded` einen Fixture-Helfer:

```ts
const pickedPhoto = (uri: string, creationTime: number) => ({
  uri,
  kind: 'photo' as const,
  durationMs: null,
  exif: null,
  creationTime,
  location: null,
});
```

Im bestehenden Test `'during a running capture the controls in the head disappear'` neben `expect(screen.queryByLabelText('Blitz einschalten')).toBeNull();` eine Zeile ergänzen:

```ts
  expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();
```

Und am Ende der Datei die neuen Tests:

```ts
// === Library import (spec 2026-08-27) ===

test('the import button offers the library, and a canceled picker leaves the viewfinder untouched', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(mockPickFromLibrary).toHaveBeenCalledTimes(1);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockDiscardRefused).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(screen.queryByTestId('import-progress')).toBeNull();
  expect(captureLock.isLocked()).toBe(false);
});

test('elements outside the trip period are refused with the period in the pill, nothing is submitted', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///old.jpg', Date.UTC(2026, 6, 20, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///old.jpg' })]);
  expect(
    screen.getByText('Der Moment wurde nicht eingesendet: ausserhalb des Reisezeitraums (1.–14. Aug 2026).')
  ).toBeTruthy();
  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
});

test('accepted elements go through submitImports for the trip; meanwhile the shutter yields to the progress pill', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockOwnCounter.mockImplementation(async () => 4);
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      pickedPhoto('file:///b.jpg', Date.UTC(2026, 7, 6, 12)),
    ],
  });
  let finishSubmit: (outcome: { submitted: number; failed: number }) => void = () => {};
  mockSubmitImports.mockImplementation(
    (_accepted: unknown, _target: unknown, onProgress: (done: number, total: number) => void) =>
      new Promise<{ submitted: number; failed: number }>((resolve) => {
        onProgress(1, 2);
        finishSubmit = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await screen.findByText('4 Momente');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(mockSubmitImports).toHaveBeenCalledWith(
    [
      expect.objectContaining({ accepted: true, captured_at: '2026-08-05T12:00:00.000Z' }),
      expect.objectContaining({ accepted: true, captured_at: '2026-08-06T12:00:00.000Z' }),
    ],
    { tripId: 't1', authorId: 'u1' },
    expect.any(Function)
  );
  expect(mockDiscardRefused).toHaveBeenCalledWith([]);
  // During the batch: no shutter, no header, no tab switch, a progress pill.
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
  expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();
  expect(screen.queryByLabelText('Reise wechseln, Norwegen mit dem Camper')).toBeNull();
  expect(screen.getByTestId('import-progress')).toBeTruthy();
  expect(screen.getByText('1 von 2 Momenten eingesendet')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(true);

  await act(async () => {
    finishSubmit({ submitted: 2, failed: 0 });
  });

  expect(captureLock.isLocked()).toBe(false);
  expect(screen.queryByTestId('import-progress')).toBeNull();
  // The animation rolls from the count BEFORE the batch by the batch size.
  expect(mockAnimationProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ visible: true, counter: 4, added: 2 })
  );

  mockOwnCounter.mockImplementation(async () => 6);
  await act(async () => {
    mockFinishAnimation?.();
  });

  expect(mockAnimationProps).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(screen.getByLabelText('Momente aus Fotos einsenden')).toBeTruthy();
  // The counter is fetched afresh after the batch.
  await screen.findByText('6 Momente');
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();
});

test('a partial batch plays the animation first and explains the refusals afterwards', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      {
        uri: 'file:///long.mov',
        kind: 'video' as const,
        durationMs: 120_000,
        exif: null,
        creationTime: Date.UTC(2026, 7, 5, 12),
        location: null,
      },
      pickedPhoto('file:///c.jpg', Date.UTC(2026, 7, 5, 12)),
    ],
  });
  mockSubmitImports.mockResolvedValue({ submitted: 1, failed: 1 });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///long.mov' })]);
  expect(mockSubmitImports.mock.calls[0][0]).toHaveLength(2);
  expect(mockAnimationProps).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, added: 1 }));
  // The summary waits until the cover is gone.
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();

  await act(async () => {
    mockFinishAnimation?.();
  });

  expect(
    screen.getByText(
      '2 von 3 Momenten wurden nicht eingesendet: 1 Video länger als 90 Sekunden, 1 beim Sichern gescheitert.'
    )
  ).toBeTruthy();
});

test('when every accepted element fails there is no animation, only the summary', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 1 });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(screen.getByText('Der Moment wurde nicht eingesendet: beim Sichern gescheitert.')).toBeTruthy();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(false);
});

test('a failing picker says so in the pill', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockRejectedValue(new Error('picker broke'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(screen.getByText('Deine Fotos liessen sich nicht öffnen. Probier es nochmal.')).toBeTruthy();
  expect(mockSubmitImports).not.toHaveBeenCalled();
});

test('without a session the picked elements are released and the pill says so', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  // The session goes away AFTER the viewfinder stands (a screen without a
  // session would not load its trips); the refocus re-renders the screen so
  // the handler closes over the missing user id.
  mockAuth.userId = null;
  await refocusScreen();
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(screen.getByText('Du bist nicht angemeldet. Melde dich an und probier es nochmal.')).toBeTruthy();
});
```

`refocusScreen()` ist der Helfer am Dateianfang; `mockAuth.userId` wird im `beforeEach` bereits auf `'u1'` zurückgesetzt.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest "src/app/(tabs)/capture/__tests__/camera.test.tsx"`
Expected: die sieben neuen Tests scheitern mit `Unable to find an element with accessibilityLabel: Momente aus Fotos einsenden`; alle bestehenden Tests bleiben grün, auch der erweiterte Header-Test (das Label fehlt ja noch überall).

- [ ] **Step 3: Imports und Konstanten**

Im `react-native`-Import `ActivityIndicator` ergänzen (alphabetisch vor `Animated`):

```ts
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  useWindowDimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
```

Den Lucide-Import erweitern:

```ts
import { ChevronDown, Images, SwitchCamera, Vibrate, VibrateOff, Zap, ZapOff } from 'lucide-react-native';
```

Hinter `import { ShutterButton } from '@/components/ShutterButton';`:

```ts
import { MomentSubmissionAnimation } from '@/components/MomentSubmissionAnimation';
```

Hinter `import { ownMomentCount } from '@/features/moments/counter';`:

```ts
import {
  assess,
  refusalSummary,
  type AcceptedMedia,
  type PickedMedia,
  type RefusalReason,
} from '@/features/moments/libraryImport';
import { pickFromLibrary } from '@/features/moments/libraryPicker';
import {
  discardRefused,
  submitImports,
  type ImportOutcome,
} from '@/features/moments/libraryImportSubmit';
```

Hinter `const PHOTO_ERROR_TEXT = ...;`:

```ts
// The library picker itself failed (not a refusal by our rules): iOS could
// not present it, or the copy of a selected asset broke off.
const IMPORT_PICKER_ERROR_TEXT = 'Deine Fotos liessen sich nicht öffnen. Probier es nochmal.';
// Same wording as the preview's WITHOUT_SESSION_MESSAGE: the job carries
// the author id, and without a session there is none to carry.
const IMPORT_WITHOUT_SESSION_TEXT = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';
```

- [ ] **Step 4: Zustand**

Hinter `const [captureError, setCaptureError] = useState<string | null>(null);`:

```ts
  // The running library import, or null: how many of the accepted elements
  // have been enqueued so far. While it runs, shutter and header are removed
  // (like during a capture) and the progress pill stands in for them.
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  // A finished import waiting for its success animation: the batch size and
  // the counter value from before the batch, which the animation rolls up
  // from. Back to null once the animation has played.
  const [importDone, setImportDone] = useState<{
    added: number;
    counterBefore: number | null;
  } | null>(null);
  // The refusal summary of the last import, held back until the success
  // animation has played so the two do not stack on top of each other.
  const heldSummary = useRef<string | null>(null);
```

- [ ] **Step 5: Handler**

Direkt hinter der `goToPreview`-Funktion (nach ihrem schliessenden `};`, `trip` ist dort bereits auf «nicht null» verengt):

```ts
  // The library import (spec 2026-08-27): pick, assess against the trip
  // period and the video limit, submit the accepted ones one after the
  // other, then celebrate and explain. `trip` is a const narrowed above, so
  // the closure keeps it non-null across the awaits.
  const importFromLibrary = async () => {
    if (importing || capturing) return;
    setCaptureError(null);
    let picked: Awaited<ReturnType<typeof pickFromLibrary>>;
    try {
      picked = await pickFromLibrary();
    } catch (error) {
      console.error('[capture] library picker failed', error);
      if (active.current) setCaptureError(IMPORT_PICKER_ERROR_TEXT);
      return;
    }
    if (picked.canceled || picked.media.length === 0 || !active.current) return;
    if (!userId) {
      discardRefused(picked.media);
      setCaptureError(IMPORT_WITHOUT_SESSION_TEXT);
      return;
    }

    const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const assessed = picked.media.map((item) => assess(item, trip, MAX_VIDEO_SECONDS, deviceTz));
    const accepted = assessed.filter((item): item is AcceptedMedia => item.accepted);
    const reasons: RefusalReason[] = [];
    const refused: PickedMedia[] = [];
    for (const item of assessed) {
      if (!item.accepted) {
        reasons.push(item.reason);
        refused.push(item.media);
      }
    }
    // Refused copies leave tmp right away; the accepted ones are released by
    // submitImports once they are safely in the queue.
    discardRefused(refused);
    const total = picked.media.length;
    if (accepted.length === 0) {
      setCaptureError(refusalSummary(reasons, total, trip, MAX_VIDEO_SECONDS));
      return;
    }

    // No tab switch in the middle of the batch (captureLock.ts), for the
    // same reason as during a capture: the focus cleanup must not interrupt
    // it.
    captureLock.lock(true);
    const counterBefore = counter;
    setImporting({ done: 0, total: accepted.length });
    let outcome: ImportOutcome;
    try {
      outcome = await submitImports(
        accepted,
        { tripId: trip.id, authorId: userId },
        (done, count) => {
          if (active.current) setImporting({ done, total: count });
        }
      );
    } catch (error) {
      // submitImports catches per element; this is the queue itself failing
      // to initialize. Every accepted element then counts as failed.
      console.error('[capture] library import failed', error);
      outcome = { submitted: 0, failed: accepted.length };
    } finally {
      captureLock.lock(false);
    }
    if (!active.current) return;
    setImporting(null);
    for (let i = 0; i < outcome.failed; i += 1) reasons.push('failed');
    const summary = refusalSummary(reasons, total, trip, MAX_VIDEO_SECONDS);
    if (outcome.submitted === 0) {
      setCaptureError(summary);
      return;
    }
    heldSummary.current = summary;
    setImportDone({ added: outcome.submitted, counterBefore });
  };

  // The success animation has played: the counter effect above re-runs on
  // the focus tick and picks up the fresh queue jobs, and a held summary of
  // the refusals gets its turn in the pill.
  const finishImport = () => {
    setImportDone(null);
    setFocusState((n) => n + 1);
    if (heldSummary.current) {
      setCaptureError(heldSummary.current);
      heldSummary.current = null;
    }
  };
```

- [ ] **Step 6: Render**

Die Bedingung der Kopfzeile von `{!capturing && (` auf:

```tsx
      {!capturing && !importing && (
```

In der Steuerspalte (`<View style={styles.controls}>`) hinter dem Blitz-`PillButton` und vor `{multiCam && (`:

```tsx
            <PillButton label="Momente aus Fotos einsenden" onPress={() => void importFromLibrary()}>
              <Images size={22} color={cinema['text-1']} strokeWidth={1.75} />
            </PillButton>
```

Hinter dem `captureError`-Block (`{captureError && (<Pill ...>...</Pill>)}`) die Fortschritts-Pille:

```tsx
      {importing && (
        <Pill
          testID="import-progress"
          style={[styles.errorPill, styles.importPill, { bottom: errorBottom(zoomVisible) + barHeight }]}
        >
          <ActivityIndicator color={cinema['text-1']} />
          <Text style={[type.secondary, styles.errorText]}>
            {`${importing.done} von ${importing.total} Momenten eingesendet`}
          </Text>
        </Pill>
      )}
```

Den Auslöser-Block in die Bedingung `!importing` einpacken:

```tsx
      {!importing && (
        <View
          testID="shutter-stage"
          style={[styles.shutterWrap, { bottom: SHUTTER_BOTTOM + barHeight }]}
        >
          <ShutterButton
            onPhoto={() => void handlePhoto()}
            onVideoStart={handleVideoStart}
            onVideoStop={() => void handleVideoStop()}
            onZoomDrag={zoomDrag}
            maxSeconds={MAX_VIDEO_SECONDS}
            onLockChange={setCaptureLocked}
          />
        </View>
      )}
```

Direkt danach, als letztes Kind des Screen-`<View>` (vor dessen schliessendem `</View>`), das Overlay:

```tsx
      <MomentSubmissionAnimation
        visible={importDone !== null}
        onFinished={finishImport}
        counter={importDone?.counterBefore ?? null}
        added={importDone?.added ?? 1}
      />
```

- [ ] **Step 7: Style**

Hinter `errorText: { ... },` in `styles`:

```ts
  // The progress pill during a library import: spinner and text side by
  // side in the error pill's frame.
  importPill: { flexDirection: 'row', justifyContent: 'center', gap: spacing.s },
```

- [ ] **Step 8: Tests laufen lassen**

Run: `cd mobile && npx jest "src/app/(tabs)/capture/__tests__/camera.test.tsx"`
Expected: die ganze Datei grün, inklusive der bestehenden Tests (Kopfzeile, Auslöser, Zoom).

Stolpersteine, falls einzelne neue Tests hängen:
- Der Batch-Test wartet auf `'1 von 2 Momenten eingesendet'`: `onProgress(1, 2)` läuft synchron im Promise-Executor, also nach `setImporting({ done: 0 })` und vor dem `await`. Steht dort `0 von 2`, wurde `setImporting` im Callback hinter `active.current` verschluckt; `active` wird im Focus-Effekt gesetzt, der Test rendert fokussiert.
- `'6 Momente'` erscheint erst, wenn der Zähler-Effekt über `focusState` neu läuft; bleibt `4`, fehlt `setFocusState((n) => n + 1)` in `finishImport`.

- [ ] **Step 9: Typen und Lint prüfen**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: tsc ohne Ausgabe; eslint nur die bekannten 29. Falls tsc bei `assess(item, trip, ...)` klagt, weil `trip` als `Trip | CachedTrip` kein `ImportPeriod` sei: beide Typen tragen `start_date`/`end_date` als `string`, strukturell passt das; dann fehlt eher das Narrowing, und der Handler steht zu früh in der Datei (vor `if (!trip) return <TripPickerScreen ... />`).

- [ ] **Step 10: Commit**

```bash
cd mobile
git add "src/app/(tabs)/capture/index.tsx" "src/app/(tabs)/capture/__tests__/camera.test.tsx"
git commit -m "feat(camera): Momente aus Fotos einsenden: Knopf, Batch mit Fortschritt, Animation, Ablehnungen"
```

---

### Task 7: Berechtigungstexte, Gesamtlauf, Geräte-Prüfliste

Beide Plugins setzen `NSPhotoLibraryUsageDescription`; die Texte müssen den neuen Zweck nennen. Wirkt erst mit dem nächsten Native-Build (`expo prebuild` löscht Pods und Team-Auswahl, siehe Memory «Prebuild & Signing»).

**Files:**
- Modify: `mobile/app.json` (Plugin-Blöcke `expo-image-picker` und `expo-media-library`)

- [ ] **Step 1: Texte anpassen**

Im Block `expo-image-picker`:

```json
        {
          "photosPermission": "Reelive braucht Zugriff auf deine Fotos, damit du ein Profilbild auswählen und Momente aus deinen Fotos einsenden kannst.",
          "cameraPermission": "Reelive braucht die Kamera, damit du ein Selfie als Profilbild aufnehmen kannst."
        }
```

Im Block `expo-media-library`:

```json
        {
          "photosPermission": "Reelive braucht Zugriff auf deine Fotobibliothek, um Momente aus dem Recap dort zu sichern und Momente aus deinen Fotos einzusenden.",
          "savePhotosPermission": "Reelive speichert Momente aus dem Recap in deiner Fotobibliothek.",
          "isAccessMediaLocationEnabled": false,
          "granularPermissions": [
            "photo",
            "video"
          ]
        }
```

- [ ] **Step 2: Gesamtlauf**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npm test`
Expected: tsc still, eslint nur die 29 bekannten Fehler, Jest komplett grün.

- [ ] **Step 3: Commit**

```bash
cd mobile
git add app.json
git commit -m "chore(ios): Foto-Berechtigungstexte nennen das Einsenden aus Fotos"
```

- [ ] **Step 4: Geräte-Prüfliste (manuell, am iPhone mit Dev-Client)**

Jest sieht keine Navigation und keine nativen Picker (Memory «Gerätetest: Werkzeuge»). Am Gerät, Reise aktiv, Metro-Log offen:

1. Knopf in der Steuerspalte sichtbar, Icon im Sucher-Look, verschwindet während einer Videoaufnahme.
2. Tipp: Berechtigungsdialog (erster Lauf), danach der iOS-Picker mit Mehrfachauswahl; Abbruch lässt den Sucher unberührt, die Session läuft weiter (Betreten-Effekt-Falle).
3. Drei Fotos aus dem Reisezeitraum wählen: Auslöser weg, Fortschritts-Pille zählt, Animation rollt um 3, Zähler in der Kopf-Pille stimmt danach, keine Zusammenfassung.
4. Ein Foto von vor der Reise dazu: Animation, danach die Zusammenfassung mit dem Zeitraum.
5. Ein HEIC-Foto und ein HEVC-Video (iPhone-Standard «Hocheffizient»): landen als JPEG bzw. H.264 in der Queue (im Metro-Log die `storage_key`-Endungen prüfen, `.mov`/`.mp4`, und nach dem Upload im Web-Player abspielen).
6. Ein Video über 90 s: abgelehnt mit «Video länger als 90 Sekunden».
7. Berechtigung in den Einstellungen entziehen, ein Video ohne EXIF wählen: «Aufnahmedatum unbekannt» mit Hinweis; ein Foto mit EXIF geht trotzdem durch.
8. Snapchat-Sicherung (Foto und Video) aus Fotos importieren: welches Datum trägt der Moment im Recap? Ergebnis in der Memory-Notiz festhalten (Spec, Abschnitt «Bekannte Grenze»).
9. 20 Elemente auf einmal: wie lange braucht der Picker bis zur Übergabe? Ist die Obergrenze richtig gesetzt?
10. Nach einem Batch die Upload-Queue beobachten: alle Jobs laufen durch, Momente erscheinen nach dem Reveal chronologisch nach `captured_at`, nicht nach Import-Zeit.

Die Berechtigungstexte aus Step 1 sind erst nach einem neuen Native-Build zu sehen.
