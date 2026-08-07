# Phase 4 — Kamera & Upload-Queue: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Momente einfangen — vollständig offline, versiegelt, und hochgeladen sobald wieder Netz da ist.

**Architecture:** Die Aufnahme läuft über `expo-camera` — Expo Go trägt damit weiter, ein Dev-Build ist nicht nötig; die Videoauflösung kommt aus der Aufnahmequalität statt aus einer Transkodierung. Die Kamera-Anbindung bleibt bewusst auf den Sucher-Screen begrenzt, damit ein späterer Wechsel auf `vision-camera` eine Datei trifft. Jeder eingesendete Moment wird ein Job in einer SQLite-Queue, die Neustarts überlebt. Ein Worker legt die `posts`-Zeile an, holt presigned S3-PUT-URLs von einer Edge Function, lädt hoch und lässt die Function den Upload bestätigen — `upload_status` kann der Client nicht selbst setzen, das hat Phase 1 bewusst gesperrt.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / TypeScript strict, expo-router, `expo-camera`, `expo-sqlite`, `expo-image-manipulator`, `expo-video-thumbnails`, `expo-location`, `expo-network`, `expo-crypto`, `expo-haptics`, Supabase Edge Functions (Deno) mit `aws4fetch`, pgTAP, Jest + `@testing-library/react-native`.

## Hinweis an alle Implementer

Die Code-Blöcke in diesem Plan sind **sorgfältig gemeint, aber nicht bewiesen**. In der Vorphase waren vier von elf Snippets defekt — Races, vakuöse Tests, falsche Mock-Verdrahtung. Behandle sie als präzise Vorlage, nicht als Evangelium: wenn ein Snippet der Beschreibung widerspricht, dem Interface-Vertrag widerspricht oder dir schlicht falsch vorkommt, **melde es, statt es abzutippen**. Die Interface-Verträge (`Produces`) sind bindend, die Implementierung dahinter darf besser sein als hier skizziert.

## Global Constraints

- **Design-Language ist verbindlich:** `DESIGN-LANGUAGE.md` schlägt Framework-Defaults und eigenen Geschmack. Vor jeder UI-Datei lesen.
- **Die Medien-Screens tragen die Kino-Palette** (`cinema` aus `@/theme/tokens`), nicht das helle Theme. Kamera, Preview und Versiegelung gehören dazu.
- **Keine festen Hex-Werte, keine rohen Abstandszahlen** — nur Tokens. Radius nur 12/24/999, Screen-Rand `spacing.screen`.
- **Genau ein Primär-Button pro Screen.**
- **Icons:** Lucide Outline, `strokeWidth={1.75}`, nie gefüllt, nie Emoji als Icon.
- **Copy:** Deutsch, Du-Form, sentence case. Vokabular: Moment, Reise, Filmrolle, versiegelt, Recap, einsenden — nie Post, Trip, Galerie, gesperrt, hochladen (als Nutzertext).
- **Fehler nennen Ursache und Lösung, ohne Entschuldigung.** Offline-Meldung: `OFFLINE_HINT` aus `@/lib/netzfehler`.
- **Screens sprechen nie direkt mit Supabase** — alles über `features/*/…Api.ts`.
- **`captured_at` und `captured_tz` kommen vom Gerät**, nie vom Server. Sortiert wird immer danach.
- **Die Versiegelung ist unantastbar:** Diese Phase fügt keine lesende Sicht auf `posts` hinzu. Wer eine Policy anfassen will, meldet das statt es zu tun.
- **TypeScript strict** — kein `any`, keine nicht-null-Assertions ohne Kommentar.
- **RTL v14 ist voll async:** `await render(...)` UND `await fireEvent.*(...)`.
- **Schema-Änderungen nur über neue Migrationen**; jede neue Policy/Funktion bekommt pgTAP-Tests.
- Jest läuft aus `mobile/` (`npm test`), pgTAP aus dem Wurzelverzeichnis (`supabase test db`).

## Ausgangslage

Phase 3 ist fertig (Branch `phase-3-trips-invites`, hierauf aufgebaut): Reisen, Invites, Mitglieder, `tripsApi`, `tripDay`, `Avatar`/`Badge`/`TripCard`/`Fab`. 177 Jest-Tests, 120 pgTAP-Tests, alle grün — sie müssen grün bleiben.

Aus Phase 1 gilt weiterhin und wird **nicht** geändert:
- `posts` ist vor dem Reveal für niemanden lesbar, auch nicht für den Autor.
- `authenticated` hat **kein** `update` auf `posts` — `upload_status` setzt nur die Service-Role.
- Insert erlaubt: eigener `author_id`, Mitglied, Reise `active` — oder `revealed` mit `captured_at <= revealed_at` (Nachzügler).
- `my_post_counts()` liefert den eigenen Zähler je Reise.

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `mobile/app.json` | Kamera-, Mikrofon-, Ortungs-Berechtigungen |
| `supabase/functions/media-urls/index.ts` | Edge Function: `sign` und `confirm` |
| `supabase/functions/media-urls/keys.ts` | Schlüssel-Ableitung, netzfrei testbar |
| `supabase/tests/12_upload_status_test.sql` | pgTAP: `upload_status` nur per Service-Role, Nachzügler-Regel |
| `mobile/src/features/moments/types.ts` | `QueueJob`, `MomentEntwurf`, Zustände |
| `mobile/src/features/moments/queueDb.ts` | SQLite-Zugriff: anlegen, lesen, aktualisieren, löschen |
| `mobile/src/features/moments/queueLogic.ts` | Reine Zustandsmaschine: Backoff, Auswahl des nächsten Jobs |
| `mobile/src/features/moments/postsApi.ts` | `posts`-Insert, Edge-Function-Aufrufe |
| `mobile/src/features/moments/uploadWorker.ts` | Orchestriert Job → Insert → Upload → Bestätigung |
| `mobile/src/features/moments/medien.ts` | Kompression, Thumbnail, Schlüssel |
| `mobile/src/features/moments/einstellungen.ts` | «Nur über WLAN» lesen/schreiben |
| `mobile/src/app/(tabs)/aufnehmen/index.tsx` | Kamera-Sucher |
| `mobile/src/app/(tabs)/aufnehmen/preview.tsx` | Preview, Caption, Einsenden |
| `mobile/src/components/Ausloeser.tsx` | Auslöser mit Fortschrittsring |
| `mobile/src/components/Versiegelung.tsx` | Einsende-Inszenierung |

**Reihenfolge:** Task 1 zuerst (ohne die Pakete läuft nichts). Tasks 2–5 sind untereinander unabhängig. Task 6 braucht 5, Tasks 7–9 brauchen 6. Task 10 zum Schluss.

---

### Task 1: Abhängigkeiten und Berechtigungen

**Files:**
- Modify: `mobile/app.json`
- Modify: `mobile/package.json`

**Interfaces:**
- Consumes: nichts.
- Produces: alle Pakete dieser Phase installiert und in Expo Go lauffähig; Berechtigungstexte deklariert.

**Wichtig zur Vorgeschichte:** Ein erster Anlauf setzte auf `react-native-vision-camera`. Das Paket ist in Version 5.2.2 nicht installierbar (kein Config-Plugin, Einstiegspunkt unter Node 24 nicht ladbar — offenes Upstream-Problem), und für den Dev-Build fehlte auf dem Rechner der Platz. Die Entscheidung ist deshalb auf `expo-camera` gefallen; Expo Go bleibt. Falls im Arbeitsbaum noch Reste des ersten Versuchs liegen (vision-camera in `package.json`, ein Mock unter `mobile/__mocks__/`, Plugin-Einträge in `app.json`), entferne sie vollständig.

- [ ] **Step 1: Reste des ersten Versuchs entfernen**

Prüfe `git status` und `mobile/package.json`. `react-native-vision-camera` und alles, was nur dafür da war, muss weg — auch aus `package-lock.json` (`npm uninstall react-native-vision-camera`).

- [ ] **Step 2: Abhängigkeiten installieren**

Run (aus `mobile/`):
```bash
npx expo install expo-camera expo-sqlite expo-image-manipulator expo-video-thumbnails expo-location expo-network
```
Expected: Alle sechs landen in `package.json` in Fassungen, die zu SDK 57 passen.

- [ ] **Step 3: Berechtigungen in `app.json` eintragen**

Ergänze im `plugins`-Array:

```json
[
  "expo-camera",
  {
    "cameraPermission": "Reelive braucht die Kamera, um deine Momente einzufangen.",
    "microphonePermission": "Reelive braucht das Mikrofon für Videos mit Ton."
  }
],
[
  "expo-location",
  {
    "locationWhenInUsePermission": "Reelive hängt Ort und Zeit an deine Momente, damit der Recap sie einordnen kann."
  }
]
```

Die Texte sind Nutzertexte und folgen §6: sie sagen, wofür die Berechtigung gebraucht wird. Prüfe die genauen Optionsnamen gegen die installierte Fassung der Pakete — sie haben sich zwischen SDK-Versionen geändert; nimm die, die deine Fassung dokumentiert, und halte im Bericht fest, welche das waren.

- [ ] **Step 4: Lauffähigkeit in Expo Go belegen**

Run (aus `mobile/`): `npx expo start --ios`
Expected: Metro bündelt ohne Fehler, die App startet im Simulator und der bestehende Login-Fluss funktioniert weiter. Ein Bundling-Fehler wegen eines der neuen Pakete ist ein echtes Signal — melde ihn.

Beende den Dev-Server danach wieder.

- [ ] **Step 5: Suite und Typen prüfen**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: 177 Tests grün, keine Typfehler. Falls eines der neuen Pakete unter Jest stolpert, halte dich an das etablierte `moduleNameMapper`-Muster in `mobile/package.json` und dokumentiere die Ergänzung.

- [ ] **Step 6: Commit**

```bash
git add mobile/app.json mobile/package.json mobile/package-lock.json
git commit -m "build(phase-4): Kamera-, Speicher- und Ortungspakete fuer Expo Go"
```

---

### Task 2: Queue-Logik als reine Zustandsmaschine

**Files:**
- Create: `mobile/src/features/moments/types.ts`
- Create: `mobile/src/features/moments/queueLogic.ts`
- Test: `mobile/src/features/moments/__tests__/queueLogic.test.ts`

Das ist die Kernlogik dieser Phase. Sie entscheidet, welcher Job wann drankommt — netzfrei, ohne SQLite, ohne Supabase. Alles, was hier hineinpasst, gehört hierher und nicht in den Worker.

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `type JobZustand = 'wartet' | 'laeuft' | 'fertig'`
  - `type QueueJob = { id: string; post_id: string; trip_id: string; typ: 'photo' | 'video'; medium_uri: string; thumb_uri: string; storage_key: string; thumb_key: string; caption: string | null; captured_at: string; captured_tz: string; lat: number | null; lng: number | null; place_name: string | null; duration_s: number | null; zustand: JobZustand; versuche: number; naechster_versuch: number; zeile_angelegt: boolean; medium_geladen: boolean; thumb_geladen: boolean }`
  - `backoffMs(versuche: number): number` — 2 s verdoppelnd, gedeckelt bei 10 min
  - `naechsterJob(jobs: QueueJob[], jetzt: number, aufWlan: boolean, nurWlan: boolean): QueueJob | null`
  - `nachFehlschlag(job: QueueJob, jetzt: number): QueueJob`
  - `wartendeAnzahl(jobs: QueueJob[]): number`

- [ ] **Step 1: Typen anlegen**

Create `mobile/src/features/moments/types.ts`:

```ts
export type JobZustand = 'wartet' | 'laeuft' | 'fertig';

// Ein Job trägt alles, was die posts-Zeile braucht, plus den Fortschritt.
// post_id und die Schlüssel stehen schon beim Aufnehmen fest (Spec §5) —
// nur so legt ein Wiederanlauf nach Absturz keine zweite Zeile an.
export type QueueJob = {
  id: string;
  post_id: string;
  trip_id: string;
  typ: 'photo' | 'video';
  medium_uri: string;
  thumb_uri: string;
  storage_key: string;
  thumb_key: string;
  caption: string | null;
  captured_at: string;
  captured_tz: string;
  lat: number | null;
  lng: number | null;
  place_name: string | null;
  duration_s: number | null;
  zustand: JobZustand;
  versuche: number;
  naechster_versuch: number; // ms seit Epoch
  zeile_angelegt: boolean;
  medium_geladen: boolean;
  thumb_geladen: boolean;
};
```

- [ ] **Step 2: Failing Test schreiben**

Create `mobile/src/features/moments/__tests__/queueLogic.test.ts`:

```ts
import { backoffMs, naechsterJob, nachFehlschlag, wartendeAnzahl } from '../queueLogic';
import type { QueueJob } from '../types';

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 'j1', post_id: 'p1', trip_id: 't1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
  ...over,
});

test.each([
  [0, 2_000],
  [1, 4_000],
  [2, 8_000],
  [3, 16_000],
])('backoffMs(%i) → %i', (versuche, erwartet) => {
  expect(backoffMs(versuche)).toBe(erwartet);
});

test('backoffMs ist bei 10 Minuten gedeckelt', () => {
  expect(backoffMs(20)).toBe(600_000);
  expect(backoffMs(100)).toBe(600_000);
});

test('naechsterJob nimmt den ältesten fälligen Job', () => {
  const jobs = [
    job({ id: 'a', naechster_versuch: 5_000 }),
    job({ id: 'b', naechster_versuch: 1_000 }),
  ];
  expect(naechsterJob(jobs, 10_000, true, false)?.id).toBe('b');
});

test('naechsterJob überspringt noch nicht fällige Jobs', () => {
  const jobs = [job({ id: 'a', naechster_versuch: 50_000 })];
  expect(naechsterJob(jobs, 10_000, true, false)).toBeNull();
});

test('naechsterJob überspringt laufende und fertige Jobs', () => {
  const jobs = [
    job({ id: 'a', zustand: 'laeuft' }),
    job({ id: 'b', zustand: 'fertig' }),
  ];
  expect(naechsterJob(jobs, 10_000, true, false)).toBeNull();
});

test('nurWlan pausiert auf Mobilfunk statt Jobs scheitern zu lassen', () => {
  const jobs = [job()];
  expect(naechsterJob(jobs, 10_000, false, true)).toBeNull();
  expect(naechsterJob(jobs, 10_000, true, true)?.id).toBe('j1');
  expect(naechsterJob(jobs, 10_000, false, false)?.id).toBe('j1');
});

test('nachFehlschlag zählt hoch und verschiebt den nächsten Versuch', () => {
  const nachher = nachFehlschlag(job({ versuche: 1 }), 10_000);
  expect(nachher.versuche).toBe(2);
  expect(nachher.naechster_versuch).toBe(10_000 + 8_000);
  expect(nachher.zustand).toBe('wartet');
});

test('nachFehlschlag verwirft einen Job nie', () => {
  let j = job();
  for (let i = 0; i < 50; i++) j = nachFehlschlag(j, 0);
  expect(j.zustand).toBe('wartet');
});

test('wartendeAnzahl zählt alles, was noch nicht fertig ist', () => {
  const jobs = [job({ zustand: 'wartet' }), job({ zustand: 'laeuft' }), job({ zustand: 'fertig' })];
  expect(wartendeAnzahl(jobs)).toBe(2);
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/queueLogic.test.ts`
Expected: FAIL — `Cannot find module '../queueLogic'`.

- [ ] **Step 4: Implementierung schreiben**

Create `mobile/src/features/moments/queueLogic.ts`:

```ts
import type { QueueJob } from './types';

const BASIS_MS = 2_000;
const DECKEL_MS = 600_000; // 10 Minuten

// Verdoppelnder Backoff. Bewusst ohne Obergrenze für die Versuchszahl: ein Moment
// darf nie still verlorengehen, nur weil das Netz lange weg war (Spec §5).
export function backoffMs(versuche: number): number {
  const roh = BASIS_MS * 2 ** versuche;
  return Number.isFinite(roh) ? Math.min(roh, DECKEL_MS) : DECKEL_MS;
}

export function naechsterJob(
  jobs: QueueJob[],
  jetzt: number,
  aufWlan: boolean,
  nurWlan: boolean
): QueueJob | null {
  if (nurWlan && !aufWlan) return null;
  const faellig = jobs
    .filter((j) => j.zustand === 'wartet' && j.naechster_versuch <= jetzt)
    .sort((a, b) => a.naechster_versuch - b.naechster_versuch);
  return faellig[0] ?? null;
}

export function nachFehlschlag(job: QueueJob, jetzt: number): QueueJob {
  const versuche = job.versuche + 1;
  return { ...job, versuche, zustand: 'wartet', naechster_versuch: jetzt + backoffMs(versuche) };
}

export function wartendeAnzahl(jobs: QueueJob[]): number {
  return jobs.filter((j) => j.zustand !== 'fertig').length;
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/queueLogic.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/moments/types.ts mobile/src/features/moments/queueLogic.ts mobile/src/features/moments/__tests__/queueLogic.test.ts
git commit -m "feat(moments): Zustandsmaschine der Upload-Queue"
```

---

### Task 3: Queue-Speicher in SQLite

**Files:**
- Create: `mobile/src/features/moments/queueDb.ts`
- Test: `mobile/src/features/moments/__tests__/queueDb.test.ts`

**Interfaces:**
- Consumes: `QueueJob` aus `./types`; `expo-sqlite`.
- Produces:
  - `initQueue(): Promise<void>` — legt die Tabelle an, idempotent
  - `jobHinzufuegen(job: QueueJob): Promise<void>`
  - `alleJobs(): Promise<QueueJob[]>`
  - `jobAktualisieren(job: QueueJob): Promise<void>`
  - `jobEntfernen(id: string): Promise<void>`

Booleans liegen als `0`/`1`, Zeiten als Zahl. Die Umwandlung passiert hier und nirgends sonst.

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/features/moments/__tests__/queueDb.test.ts`:

```ts
// In-Memory-Nachbau von expo-sqlite: prüft, dass queueDb korrekt SQL absetzt und
// Zeilen sauber in QueueJob zurückwandelt. Die Datenbank selbst ist nicht unser
// Testgegenstand, die Übersetzung schon.
const zeilen: Record<string, unknown>[] = [];
const mockRunAsync = jest.fn(async () => {});
const mockGetAllAsync = jest.fn(async () => zeilen);
const mockExecAsync = jest.fn(async () => {});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: (...a: unknown[]) => mockExecAsync(...a),
    runAsync: (...a: unknown[]) => mockRunAsync(...a),
    getAllAsync: (...a: unknown[]) => mockGetAllAsync(...a),
  })),
}));

import { initQueue, jobHinzufuegen, alleJobs, jobAktualisieren, jobEntfernen } from '../queueDb';
import type { QueueJob } from '../types';

const job: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: 'Hallo', captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: 47.1, lng: 8.2, place_name: 'Luzern', duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

beforeEach(() => {
  zeilen.length = 0;
  jest.clearAllMocks();
});

test('initQueue legt die Tabelle an', async () => {
  await initQueue();
  expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('create table if not exists'));
});

test('jobHinzufuegen schreibt alle Felder', async () => {
  await jobHinzufuegen(job);
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('insert');
  expect(werte).toContain('j1');
  expect(werte).toContain('trips/t1/p1.jpg');
});

test('alleJobs wandelt 0/1 zurück in Booleans', async () => {
  zeilen.push({
    ...job, zeile_angelegt: 1, medium_geladen: 0, thumb_geladen: 1,
  });
  const [geladen] = await alleJobs();
  expect(geladen.zeile_angelegt).toBe(true);
  expect(geladen.medium_geladen).toBe(false);
  expect(geladen.thumb_geladen).toBe(true);
});

test('jobAktualisieren schreibt den Fortschritt zurück', async () => {
  await jobAktualisieren({ ...job, versuche: 3, zeile_angelegt: true });
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('update');
  expect(werte).toContain(3);
  expect(werte).toContain(1); // true → 1
});

test('jobEntfernen löscht über die id', async () => {
  await jobEntfernen('j1');
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('delete');
  expect(werte).toEqual(['j1']);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/queueDb.test.ts`
Expected: FAIL — `Cannot find module '../queueDb'`.

- [ ] **Step 3: Implementierung schreiben**

Create `mobile/src/features/moments/queueDb.ts`. Leitlinien statt fertigem Code, weil die genaue Form von der `expo-sqlite`-Fassung abhängt:

- Datenbank einmal öffnen und die Instanz im Modul halten (lazy, nicht beim Import — sonst bricht jeder Test, der das Modul nur lädt).
- `initQueue` legt `create table if not exists upload_queue (...)` an; `id` ist Primärschlüssel. Idempotent, wird bei jedem App-Start gerufen.
- Booleans als `integer` speichern, beim Lesen zurückwandeln. Genau eine Stelle für diese Übersetzung.
- `jobAktualisieren` schreibt den vollständigen Job (kein Teil-Update) — einfacher und ohne Race, solange nur der Worker schreibt.
- Alle Funktionen geben Promises zurück und werfen nicht: Fehler werden geloggt und nach oben gereicht, damit der Worker sie behandeln kann.

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/queueDb.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/moments/queueDb.ts mobile/src/features/moments/__tests__/queueDb.test.ts
git commit -m "feat(moments): Upload-Queue in SQLite, neustart-fest"
```

---

### Task 4: Medien-Aufbereitung und Schlüssel

**Files:**
- Create: `mobile/src/features/moments/medien.ts`
- Test: `mobile/src/features/moments/__tests__/medien.test.ts`

**Interfaces:**
- Consumes: `expo-image-manipulator`, `expo-video-thumbnails`, `expo-crypto`.
- Produces:
  - `storageKey(tripId: string, postId: string, typ: 'photo' | 'video'): string` — `trips/<tripId>/<postId>.jpg|.mp4`
  - `thumbKey(tripId: string, postId: string): string` — `trips/<tripId>/<postId>_t.jpg`
  - `neuePostId(): string` — UUID via `expo-crypto`
  - `fotoAufbereiten(uri: string): Promise<{ medium: string; thumb: string }>` — skaliert auf max. 1080 px lange Kante (JPEG 0.8) und erzeugt ein Thumbnail (max. 320 px)
  - `videoAufbereiten(uri: string): Promise<{ medium: string; thumb: string }>` — Video bleibt wie aufgenommen (Auflösung kam schon aus dem Kamera-Format), Thumbnail aus dem ersten Bild

Die Schlüssel-Logik existiert bewusst zweimal: hier und in der Edge Function. Der Client braucht sie vor dem Insert, die Function traut ihm nicht und leitet sie selbst ab (Spec §6). Beide Stellen tragen einen Kommentar, der auf die jeweils andere verweist.

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/features/moments/__tests__/medien.test.ts`:

```ts
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-fest' }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (_uri: string, aktionen: unknown[]) => ({
    uri: `file:///bearbeitet-${(aktionen as { resize?: { width?: number } }[])[0]?.resize?.width ?? 0}.jpg`,
  })),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(async () => ({ uri: 'file:///videobild.jpg' })),
}));

import { storageKey, thumbKey, neuePostId, fotoAufbereiten, videoAufbereiten } from '../medien';

test('storageKey folgt dem vereinbarten Muster', () => {
  expect(storageKey('t1', 'p1', 'photo')).toBe('trips/t1/p1.jpg');
  expect(storageKey('t1', 'p1', 'video')).toBe('trips/t1/p1.mp4');
});

test('thumbKey ist immer ein JPEG', () => {
  expect(thumbKey('t1', 'p1')).toBe('trips/t1/p1_t.jpg');
});

test('neuePostId liefert eine UUID', () => {
  expect(neuePostId()).toBe('uuid-fest');
});

test('fotoAufbereiten liefert Medium und Thumbnail', async () => {
  const { medium, thumb } = await fotoAufbereiten('file:///roh.jpg');
  expect(medium).toContain('1080');
  expect(thumb).toContain('320');
});

test('videoAufbereiten lässt das Video unangetastet und zieht ein Standbild', async () => {
  const { medium, thumb } = await videoAufbereiten('file:///roh.mp4');
  expect(medium).toBe('file:///roh.mp4');
  expect(thumb).toBe('file:///videobild.jpg');
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/medien.test.ts`
Expected: FAIL — `Cannot find module '../medien'`.

- [ ] **Step 3: Implementierung schreiben**

Leitlinien:
- `storageKey`/`thumbKey` sind reine Zeichenketten-Funktionen, keine Seiteneffekte.
- `fotoAufbereiten` ruft `manipulateAsync` zweimal: einmal mit `resize: { width: 1080 }` und `compress: 0.8`, einmal mit `resize: { width: 320 }` fürs Thumbnail. Beide als JPEG.
- `videoAufbereiten` gibt die Original-URI als `medium` zurück und holt das Thumbnail über `getThumbnailAsync(uri, { time: 0 })`.
- Beide Funktionen dürfen werfen — der Aufrufer (Preview) fängt und zeigt eine Meldung.

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/medien.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/moments/medien.ts mobile/src/features/moments/__tests__/medien.test.ts
git commit -m "feat(moments): Medien-Aufbereitung und Speicherschluessel"
```

---

### Task 5: Edge Function `media-urls`

**Files:**
- Create: `supabase/functions/media-urls/index.ts`
- Create: `supabase/functions/media-urls/keys.ts`
- Create: `supabase/functions/media-urls/keys_test.ts`
- Modify: `supabase/config.toml` (Function registrieren, falls nötig)
- Modify: `mobile/.env.example` (keine neuen Client-Variablen — nur dokumentieren, dass die Function Server-seitige S3-Variablen braucht)

Die erste Edge Function des Projekts. Sie ist der einzige Ort, der S3-Zugangsdaten kennt.

**Interfaces:**
- Consumes: `posts`, `trip_members` (Service-Role); Umgebung: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
- Produces (HTTP, JWT des Aufrufers im `Authorization`-Header):
  - `POST /media-urls` mit `{ aktion: 'sign', post_id }` → `{ medium_url, thumb_url }` (presigned PUT, kurzlebig) oder `{ fehler }`
  - `POST /media-urls` mit `{ aktion: 'confirm', post_id }` → `{ ok: true }` oder `{ fehler }`
  - `keys.ts` exportiert `erwarteteSchluessel(tripId, postId, typ)` → `{ storage_key, thumb_key }`

**Sicherheitsregeln, die der Reviewer prüfen wird:**
- Die Function liest die `posts`-Zeile selbst und leitet die Schlüssel daraus ab. Ein vom Client mitgeschickter Schlüssel wird ignoriert.
- Sie signiert nur, wenn `auth.uid()` aus dem JWT gleich `posts.author_id` ist.
- `confirm` setzt `upload_status` erst, nachdem beide Objekte per HEAD nachgewiesen sind.
- Kein Endpunkt gibt lesende URLs aus. Das wäre ein Bruch der Versiegelung und gehört in Phase 5.

- [ ] **Step 1: Schlüssel-Ableitung mit Deno-Test**

Create `supabase/functions/media-urls/keys.ts`:

```ts
// Spiegelt bewusst mobile/src/features/moments/medien.ts: der Client braucht die
// Schlüssel vor dem Insert, diese Funktion traut ihm nicht und leitet sie neu ab.
export function erwarteteSchluessel(
  tripId: string,
  postId: string,
  typ: 'photo' | 'video'
): { storage_key: string; thumb_key: string } {
  const ext = typ === 'video' ? 'mp4' : 'jpg';
  return {
    storage_key: `trips/${tripId}/${postId}.${ext}`,
    thumb_key: `trips/${tripId}/${postId}_t.jpg`,
  };
}
```

Create `supabase/functions/media-urls/keys_test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';
import { erwarteteSchluessel } from './keys.ts';

Deno.test('Foto-Schlüssel', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'photo'), {
    storage_key: 'trips/t1/p1.jpg',
    thumb_key: 'trips/t1/p1_t.jpg',
  });
});

Deno.test('Video-Schlüssel', () => {
  assertEquals(erwarteteSchluessel('t1', 'p1', 'video').storage_key, 'trips/t1/p1.mp4');
});
```

- [ ] **Step 2: Deno-Test laufen lassen**

Run: `supabase functions test media-urls` — oder, falls der CLI-Befehl in dieser Fassung fehlt, direkt `deno test supabase/functions/media-urls/keys_test.ts`.
Expected: PASS. Wenn keine Deno-Laufzeit erreichbar ist, melde das — dann trägt die Verifikation in Task 12 diesen Teil.

- [ ] **Step 3: Function implementieren**

Leitlinien für `index.ts`:
- `serve` aus `jsr:@supabase/functions-js` bzw. dem im Projekt üblichen Muster.
- Supabase-Client mit Service-Role aus `SUPABASE_SERVICE_ROLE_KEY`; den JWT des Aufrufers separat mit `auth.getUser(token)` prüfen — nie dem Body glauben.
- Presigning mit `aws4fetch` (`import { AwsClient } from 'npm:aws4fetch'`) gegen `S3_ENDPOINT`; Gültigkeit knapp halten (10 Minuten reichen für einen Upload-Versuch).
- `confirm` prüft beide Objekte per HEAD und setzt danach `upload_status = 'uploaded'` mit der Service-Role.
- Fehlerantworten sind deutsche Klartexte für die App, keine rohen Provider-Fehler.

- [ ] **Step 4: Lokal gegen die laufende Instanz prüfen**

Run: `supabase functions serve media-urls` in einem Terminal, dann ein `curl` mit dem JWT eines Testkontos gegen `sign` für einen selbst angelegten Post.
Expected: Zwei presigned URLs kommen zurück; ein `sign`-Aufruf für einen fremden Post wird abgelehnt.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/media-urls supabase/config.toml mobile/.env.example
git commit -m "feat(upload): Edge Function media-urls fuer signierte S3-URLs"
```

---

### Task 6: postsApi und Upload-Worker

**Files:**
- Create: `mobile/src/features/moments/postsApi.ts`
- Create: `mobile/src/features/moments/einstellungen.ts`
- Create: `mobile/src/features/moments/uploadWorker.ts`
- Test: `mobile/src/features/moments/__tests__/uploadWorker.test.ts`

Hier laufen alle Fäden zusammen. Der Worker ist die einzige Stelle, die Jobs verändert.

**Interfaces:**
- Consumes: `queueDb`, `queueLogic`, `supabase`, `expo-network`, `AsyncStorage`.
- Produces:
  - `postsApi.momentAnlegen(job: QueueJob): Promise<{ error: string | null }>` — Insert in `posts` mit der `id` aus dem Job. Ein bereits vorhandener Datensatz (Unique-Verletzung auf dem Primärschlüssel) gilt als Erfolg, nicht als Fehler — der Wiederanlauf soll durchlaufen.
  - `postsApi.signierteUrls(postId: string): Promise<{ medium_url: string; thumb_url: string } | null>`
  - `postsApi.uploadBestaetigen(postId: string): Promise<{ error: string | null }>`
  - `einstellungen.nurUeberWlan(): Promise<boolean>` / `setzeNurUeberWlan(wert: boolean): Promise<void>` (AsyncStorage, Schlüssel `reelive.nurWlan`, Standard `false`)
  - `uploadWorker.jobEinreihen(job: QueueJob): Promise<void>`
  - `uploadWorker.starte(): void` / `stoppe(): void` — Schleife, die fällige Jobs abarbeitet
  - `uploadWorker.wartende(): Promise<number>`

**Ablauf je Job** (jeder Schritt einzeln persistiert, damit ein Absturz nichts wiederholt, was schon getan ist):
1. `zeile_angelegt` falsch → `momentAnlegen`, dann Flag setzen.
2. `signierteUrls` holen.
3. `medium_geladen` falsch → PUT des Mediums, Flag setzen.
4. `thumb_geladen` falsch → PUT des Thumbnails, Flag setzen.
5. `uploadBestaetigen`, dann Job auf `fertig` und aus der Datenbank entfernen.

Fehlschlag an beliebiger Stelle: `nachFehlschlag` anwenden, speichern, nächster Durchlauf.

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/features/moments/__tests__/uploadWorker.test.ts`. Er ist der wichtigste Test der Phase — er muss belegen, dass ein Wiederanlauf nichts doppelt tut:

```ts
const jobs: Record<string, unknown>[] = [];
jest.mock('../queueDb', () => ({
  initQueue: jest.fn(async () => {}),
  jobHinzufuegen: jest.fn(async (j: Record<string, unknown>) => { jobs.push(j); }),
  alleJobs: jest.fn(async () => jobs),
  jobAktualisieren: jest.fn(async (j: Record<string, unknown>) => {
    const i = jobs.findIndex((x) => x.id === j.id);
    if (i >= 0) jobs[i] = j;
  }),
  jobEntfernen: jest.fn(async (id: string) => {
    const i = jobs.findIndex((x) => x.id === id);
    if (i >= 0) jobs.splice(i, 1);
  }),
}));
jest.mock('../postsApi', () => ({
  momentAnlegen: jest.fn(async () => ({ error: null })),
  signierteUrls: jest.fn(async () => ({ medium_url: 'https://s3/m', thumb_url: 'https://s3/t' })),
  uploadBestaetigen: jest.fn(async () => ({ error: null })),
}));
jest.mock('../einstellungen', () => ({ nurUeberWlan: jest.fn(async () => false) }));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, type: 'WIFI' })),
}));

import { einenJobAbarbeiten } from '../uploadWorker';
import * as postsApi from '../postsApi';
import * as queueDb from '../queueDb';
import type { QueueJob } from '../types';

const basis: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

const globalFetch = jest.fn(async () => ({ ok: true }) as unknown as Response);
beforeEach(() => {
  jobs.length = 0;
  jest.clearAllMocks();
  (global as unknown as { fetch: unknown }).fetch = globalFetch;
});

test('ein vollständiger Durchlauf legt an, lädt beides hoch, bestätigt und räumt auf', async () => {
  jobs.push({ ...basis });
  await einenJobAbarbeiten();
  expect(postsApi.momentAnlegen).toHaveBeenCalledTimes(1);
  expect(globalFetch).toHaveBeenCalledTimes(2);
  expect(postsApi.uploadBestaetigen).toHaveBeenCalledWith('p1');
  expect(queueDb.jobEntfernen).toHaveBeenCalledWith('j1');
});

test('ein Wiederanlauf legt die Zeile nicht zweimal an', async () => {
  jobs.push({ ...basis, zeile_angelegt: true, medium_geladen: true });
  await einenJobAbarbeiten();
  expect(postsApi.momentAnlegen).not.toHaveBeenCalled();
  expect(globalFetch).toHaveBeenCalledTimes(1); // nur noch das Thumbnail
});

test('ein fehlgeschlagener Upload zählt hoch statt den Job zu verlieren', async () => {
  globalFetch.mockResolvedValueOnce({ ok: false } as unknown as Response);
  jobs.push({ ...basis });
  await einenJobAbarbeiten();
  const [gespeichert] = jobs as unknown as QueueJob[];
  expect(gespeichert.versuche).toBe(1);
  expect(gespeichert.zustand).toBe('wartet');
  expect(queueDb.jobEntfernen).not.toHaveBeenCalled();
});

test('ohne fälligen Job passiert nichts', async () => {
  jobs.push({ ...basis, naechster_versuch: Number.MAX_SAFE_INTEGER });
  await einenJobAbarbeiten();
  expect(postsApi.momentAnlegen).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/uploadWorker.test.ts`
Expected: FAIL — `Cannot find module '../uploadWorker'`.

- [ ] **Step 3: `postsApi` und `einstellungen` implementieren**

Leitlinien:
- `momentAnlegen` setzt `id: job.post_id` explizit mit und schreibt alle Metadaten. Fehlercode `23505` (Primärschlüssel schon da) wird als Erfolg gewertet — der Kommentar sagt warum.
- Die beiden Edge-Function-Aufrufe laufen über `supabase.functions.invoke('media-urls', { body: { aktion, post_id } })`.
- Fehlermeldungen sind deutsche Klartexte; der Offline-Fall kommt aus `@/lib/netzfehler`.

- [ ] **Step 4: `uploadWorker` implementieren**

Leitlinien:
- `einenJobAbarbeiten()` ist exportiert und macht genau einen Schritt-Durchlauf — nur so ist die Schleife testbar.
- `starte()` ruft es in einem Intervall (z.B. alle 5 s) und beim Wiedererlangen der Netzverbindung; `stoppe()` räumt auf. Beide sind idempotent.
- Vor jedem Durchlauf: `getNetworkStateAsync` und `nurUeberWlan()` lesen, an `naechsterJob` durchreichen.
- Der Worker fasst nie zwei Jobs gleichzeitig an (ein `laeuft`-Flag genügt, solange nur er schreibt).
- **Reise wird währenddessen aufgedeckt (Spec §8):** Lehnt der Insert einen Job dauerhaft ab, weil `captured_at` nach dem Reveal liegt, hilft kein Wiederholen — Phase 1 erlaubt nur Nachzügler von vorher. Solche Jobs werden aus der Queue entfernt und der Grund festgehalten, statt sie ewig zu wiederholen. Unterscheide das sauber von einem Netzfehler: nur eine Ablehnung durch die Policy zählt, nicht jede fehlgeschlagene Anfrage. Ergänze dafür einen Testfall.

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments && npx tsc --noEmit`
Expected: PASS, keine Typfehler.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/moments/postsApi.ts mobile/src/features/moments/einstellungen.ts mobile/src/features/moments/uploadWorker.ts mobile/src/features/moments/__tests__/uploadWorker.test.ts
git commit -m "feat(moments): Upload-Worker mit wiederanlauffestem Ablauf"
```

---

### Task 7: Kamera-Screen mit Auslöser

**Files:**
- Delete: `mobile/src/app/(tabs)/aufnehmen.tsx`
- Create: `mobile/src/app/(tabs)/aufnehmen/_layout.tsx`
- Create: `mobile/src/app/(tabs)/aufnehmen/index.tsx`
- Create: `mobile/src/components/Ausloeser.tsx`
- Test: `mobile/src/components/__tests__/Ausloeser.test.tsx`
- Test: `mobile/src/app/(tabs)/aufnehmen/__tests__/kamera.test.tsx`

**Interfaces:**
- Consumes: `expo-camera`, `fetchTrips` aus `tripsApi`, `cinema`-Tokens, `PressScale`.
- Produces:
  - `<Ausloeser onFoto={() => void} onVideoStart={() => void} onVideoStop={() => void} maxSekunden={number} />` — Tippen löst `onFoto`, Halten startet und stoppt Video, ein Ring zeigt den Fortschritt und stoppt bei `maxSekunden` selbsttätig
  - Route `/aufnehmen` — Vollbild-Sucher

**Gestaltung nach DESIGN-LANGUAGE §1 und §4:** Kino-Palette, Bedienelemente ausschliesslich als translucente Pillen mit Blur, Auslöser rund (Radius 999). Der Ring nutzt `react-native-svg` (bereits vorhanden).

Der Sucher zeigt oben Reisename und eigenen Zähler. Gibt es keine laufende Reise, erscheint statt der Kamera ein erklärender Screen mit Weg zum Anlegen oder Beitreten. Gibt es mehrere, wird zuerst ausgewählt.

Fehlende Kamera- oder Mikrofon-Berechtigung: erklärender Screen mit Knopf in die Systemeinstellungen (`Linking.openSettings()`), nie eine schwarze Fläche.

- [ ] **Step 1: Failing Test für den Auslöser schreiben**

Der Auslöser ist die einzige Stelle mit echter Logik — Tippen gegen Halten unterscheiden und bei 30 s selbst stoppen. Beide Fälle gehören getestet, die Kamera selbst wird gemockt.

```tsx
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Ausloeser } from '../Ausloeser';

jest.useFakeTimers();

test('Tippen löst ein Foto aus, kein Video', async () => {
  const onFoto = jest.fn(); const onVideoStart = jest.fn();
  await render(<Ausloeser onFoto={onFoto} onVideoStart={onVideoStart} onVideoStop={jest.fn()} maxSekunden={30} />);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(onFoto).toHaveBeenCalledTimes(1);
  expect(onVideoStart).not.toHaveBeenCalled();
});

test('Halten startet ein Video und stoppt es beim Loslassen', async () => {
  const onFoto = jest.fn(); const onVideoStart = jest.fn(); const onVideoStop = jest.fn();
  await render(<Ausloeser onFoto={onFoto} onVideoStart={onVideoStart} onVideoStop={onVideoStop} maxSekunden={30} />);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  act(() => { jest.advanceTimersByTime(600); });
  expect(onVideoStart).toHaveBeenCalledTimes(1);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(onVideoStop).toHaveBeenCalledTimes(1);
  expect(onFoto).not.toHaveBeenCalled();
});

test('das Video stoppt nach der Höchstdauer von selbst', async () => {
  const onVideoStop = jest.fn();
  await render(<Ausloeser onFoto={jest.fn()} onVideoStart={jest.fn()} onVideoStop={onVideoStop} maxSekunden={30} />);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  act(() => { jest.advanceTimersByTime(31_000); });
  expect(onVideoStop).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/components/__tests__/Ausloeser.test.tsx`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Auslöser implementieren**

Leitlinien: Ein Timer entscheidet nach ~500 ms, dass aus dem Druck ein Video wird. Ein zweiter stoppt bei `maxSekunden`. Beide werden beim Loslassen und beim Unmount aufgeräumt — ein hängender Timer würde nach dem Verlassen des Screens weiterlaufen. Der Ring animiert nur `transform`/`opacity` (§5).

- [ ] **Step 4: Kamera-Screen implementieren**

Leitlinien: Berechtigungen über die Hooks von `expo-camera` (`useCameraPermissions`, `useMicrophonePermissions`). Video über `maxDuration` auf 30 s begrenzen und die Qualitätsstufe auf max. 1080p setzen — prüfe die genauen Namen gegen die installierte Fassung. Aufnahme über eine Ref auf die Kamera-Komponente. Nach der Aufnahme mit den Dateipfaden zu `/aufnehmen/preview` navigieren (`router.push` mit Parametern).

Der Screen stellt die Statusleiste beim Fokussieren auf hell und beim Verlassen zurück — das Muster steht bereits im alten Platzhalter `aufnehmen.tsx`, übernimm es.

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: Alles grün.

- [ ] **Step 6: Commit**

```bash
git add -A mobile/src/app/\(tabs\)/aufnehmen mobile/src/components/Ausloeser.tsx mobile/src/components/__tests__/Ausloeser.test.tsx
git commit -m "feat(kamera): Vollbild-Sucher mit Auslöser und Fortschrittsring"
```

---

### Task 8: Preview, Caption und Einsenden

**Files:**
- Create: `mobile/src/app/(tabs)/aufnehmen/preview.tsx`
- Create: `mobile/src/features/moments/ortUndZeit.ts`
- Test: `mobile/src/features/moments/__tests__/ortUndZeit.test.ts`
- Test: `mobile/src/app/(tabs)/aufnehmen/__tests__/preview.test.tsx`

**Interfaces:**
- Consumes: `medien`, `uploadWorker.jobEinreihen`, `expo-location`, `cinema`-Tokens.
- Produces:
  - `ortUndZeit.jetzt(): { captured_at: string; captured_tz: string }` — Gerätezeit als ISO plus IANA-Zone
  - `ortUndZeit.ortBestimmen(): Promise<{ lat: number | null; lng: number | null; place_name: string | null }>` — wirft nie; ohne Berechtigung oder bei Fehler kommen drei `null` zurück
  - Route `/aufnehmen/preview` mit Parametern `uri`, `typ`, `dauer`

- [ ] **Step 1: Failing Test für Ort und Zeit**

```ts
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 47.05, longitude: 8.31 } })),
  reverseGeocodeAsync: jest.fn(async () => [{ city: 'Luzern' }]),
}));

import { jetzt, ortBestimmen } from '../ortUndZeit';
import * as Location from 'expo-location';

test('jetzt liefert ISO-Zeit und die Zone des Geräts', () => {
  const { captured_at, captured_tz } = jetzt();
  expect(captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(captured_tz.length).toBeGreaterThan(0);
});

test('ortBestimmen liefert Koordinaten und Ortsnamen', async () => {
  await expect(ortBestimmen()).resolves.toEqual({ lat: 47.05, lng: 8.31, place_name: 'Luzern' });
});

test('ohne Berechtigung kommen drei null zurück, ohne zu werfen', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
  await expect(ortBestimmen()).resolves.toEqual({ lat: null, lng: null, place_name: null });
});

test('ein Fehler beim Geocoding kostet höchstens den Ortsnamen', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(ortBestimmen()).resolves.toEqual({ lat: 47.05, lng: 8.31, place_name: null });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/ortUndZeit.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: `ortUndZeit` implementieren**

Leitlinien: `captured_tz` über `Intl.DateTimeFormat().resolvedOptions().timeZone`. Jeder Schritt in `ortBestimmen` einzeln abgesichert — eine verweigerte Berechtigung, ein Timeout oder ein fehlgeschlagenes Geocoding dürfen die Aufnahme nie kosten (Spec §4).

- [ ] **Step 4: Preview-Screen implementieren**

Leitlinien:
- Aufnahme formatfüllend, Kino-Palette, Scrim oben und unten (§1 — der einzige erlaubte Gradient).
- Caption als Texteingabe über dem Bild, max. 120 Zeichen; verschiebbar per Drag (nur `transform` animieren).
- Ort und Zeit klein eingeblendet, sobald `ortBestimmen` geantwortet hat — die Anzeige wartet nicht darauf.
- Genau ein Primär-Button «Einsenden», daneben verwerfen als Text-Aktion.
- «Einsenden» ruft: `neuePostId`, Medien aufbereiten, Job bauen, `jobEinreihen`, Versiegelungs-Inszenierung (Task 9), dann `router.replace('/aufnehmen')`.
- Der Job wird **vor** der Animation eingereiht — die Inszenierung darf nie darüber entscheiden, ob ein Moment gesichert ist.
- **Voller Gerätespeicher (Spec §8):** Schlägt das Aufbereiten oder das Schreiben in die Queue fehl, weil kein Platz mehr ist, wird das Einsenden mit klarer Ursache abgelehnt und der Screen bleibt stehen — der Moment darf nicht stillschweigend verschwinden. Die Meldung nennt die Ursache und was zu tun ist (§6). Ein Testfall deckt ab, dass ein Fehler beim Aufbereiten keinen Job einreiht.

- [ ] **Step 5: Preview-Test schreiben und grün bekommen**

Deckt ab: Caption über 120 Zeichen wird begrenzt; «Einsenden» reiht genau einen Job ein und navigiert zurück; verwerfen reiht nichts ein; ein Fehler beim Aufbereiten zeigt eine Meldung und behält den Screen.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/app/\(tabs\)/aufnehmen/preview.tsx mobile/src/features/moments/ortUndZeit.ts mobile/src/features/moments/__tests__/ortUndZeit.test.ts mobile/src/app/\(tabs\)/aufnehmen/__tests__/preview.test.tsx
git commit -m "feat(kamera): Preview mit Caption, Ort und Einsenden"
```

---

### Task 9: Versiegelungs-Inszenierung und Zähler

**Files:**
- Create: `mobile/src/components/Versiegelung.tsx`
- Create: `mobile/src/features/moments/zaehler.ts`
- Test: `mobile/src/features/moments/__tests__/zaehler.test.ts`
- Test: `mobile/src/components/__tests__/Versiegelung.test.tsx`

**Interfaces:**
- Consumes: `my_post_counts` über `tripsApi`, `wartendeAnzahl` aus `queueLogic`, `expo-haptics`, Reanimated.
- Produces:
  - `zaehler.eigenerZaehler(tripId: string): Promise<number>` — Serverstand plus noch nicht hochgeladene Momente derselben Reise
  - `<Versiegelung sichtbar={boolean} onFertig={() => void} />` — 700–900 ms, Gold-Glow, Haptik `success`

Die Inszenierung ist eine der beiden erlaubten Ausnahmen aus DESIGN-LANGUAGE §5. Sie animiert ausschliesslich `transform` und `opacity`, respektiert `prefers-reduced-motion` (dann 200 ms Fade) und läuft auf dem UI-Thread.

- [ ] **Step 1: Failing Test für den Zähler**

```ts
jest.mock('@/features/trips/tripsApi', () => ({ eigeneZaehler: jest.fn(async () => ({ t1: 5 })) }));
jest.mock('../queueDb', () => ({ alleJobs: jest.fn(async () => []) }));

import { eigenerZaehler } from '../zaehler';
import * as queueDb from '../queueDb';

test('ohne wartende Momente zählt nur der Serverstand', async () => {
  await expect(eigenerZaehler('t1')).resolves.toBe(5);
});

test('wartende Momente derselben Reise zählen mit', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet' }, { trip_id: 't1', zustand: 'laeuft' },
  ]);
  await expect(eigenerZaehler('t1')).resolves.toBe(7);
});

test('wartende Momente anderer Reisen zählen nicht mit', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([{ trip_id: 't2', zustand: 'wartet' }]);
  await expect(eigenerZaehler('t1')).resolves.toBe(5);
});
```

Der Zähler darf nach einer Offline-Aufnahme nie rückwärts springen — genau das prüfen diese drei Fälle.

- [ ] **Step 2: Implementieren und grün bekommen**

`tripsApi` bekommt dafür eine schmale Ergänzung `eigeneZaehler()`, die `my_post_counts` als Map liefert (die Funktion existiert seit Phase 3 in `loadCounts`, ist dort aber privat — zieh sie sauber heraus, statt sie zu kopieren).

- [ ] **Step 3: Versiegelung implementieren und testen**

Der Test prüft, was ohne echtes Rendering prüfbar ist: die Haptik feuert genau einmal, `onFertig` kommt nach der Dauer, und bei reduzierter Bewegung ist die Dauer kürzer. Die Optik selbst verantwortet Task 12.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/Versiegelung.tsx mobile/src/features/moments/zaehler.ts mobile/src/features/moments/__tests__/zaehler.test.ts mobile/src/components/__tests__/Versiegelung.test.tsx mobile/src/features/trips/tripsApi.ts
git commit -m "feat(moments): Versiegelungs-Inszenierung und Zaehler inklusive Warteschlange"
```

---

### Task 10: Upload-Status im Reise-Detail und «Nur über WLAN»

**Files:**
- Modify: `mobile/src/app/(tabs)/reise/[id]/index.tsx`
- Modify: `mobile/src/app/(tabs)/profil.tsx`
- Test: beide zugehörigen Testdateien erweitern

**Zu tun:**
- Der Reise-Detailscreen zeigt seinen Zähler künftig über `eigenerZaehler` (also inklusive wartender Momente) und darunter dezent «3 Momente warten auf Upload», sobald die Queue für diese Reise nicht leer ist. Bei leerer Queue erscheint die Zeile nicht.
- Der Profil-Tab bekommt einen Schalter «Nur über WLAN hochladen», der `einstellungen.setzeNurUeberWlan` schreibt. Beschriftung und Hilfetext nach §6.

Beide bestehenden Testdateien werden erweitert, nicht ersetzt. Die vorhandenen Tests müssen unverändert grün bleiben.

- [ ] **Step 1: Tests erweitern, fehlschlagen lassen, implementieren, grün bekommen**

Run: `cd mobile && npm test && npx tsc --noEmit`

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(reise): Upload-Status im Detail und WLAN-Schalter im Profil"
```

---

### Task 11: pgTAP für die Upload-Regeln

**Files:**
- Create: `supabase/tests/12_upload_status_test.sql`

**Zu tun:** Belegen, was diese Phase an der Datenbank berührt — ohne die Versiegelung anzufassen:

- `authenticated` kann `upload_status` **nicht** ändern (kein Update-Recht auf `posts`); die Service-Role kann es.
- Ein Insert mit fremdem `author_id` scheitert.
- Nachzügler-Regel: nach dem Reveal ist ein Insert mit `captured_at <= revealed_at` erlaubt, mit späterem `captured_at` nicht.
- Ein Insert in eine archivierte Reise scheitert.

Die ersten beiden Punkte sind teilweise schon durch `04_sealing_rls_test.sql` abgedeckt — ergänze nur, was dort fehlt, statt zu duplizieren, und verweise im Kommentar auf die bestehende Datei.

- [ ] **Step 1: Tests schreiben, laufen lassen**

Run: `supabase test db`
Expected: PASS, alle Dateien grün (120 bestehende + neue).

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/12_upload_status_test.sql
git commit -m "test(db): Upload-Regeln und Nachzuegler-Grenze belegen"
```

---

### Task 12: Verifikation am Dev-Build

**Files:** keine — dieser Task prüft nur.

- [ ] **Step 1: Alles grün**

Run: `supabase db reset && supabase test db`, dann aus `mobile/`: `npm test && npx tsc --noEmit`

- [ ] **Step 2: Dev-Build starten**

Run (aus `mobile/`): `npx expo run:ios`

- [ ] **Step 3: Foto einsenden**

Anmelden, Reise «Norwegen mit dem Camper» wählen, ein Foto aufnehmen, Caption schreiben, einsenden. Expected: Versiegelungs-Animation läuft, der Zähler springt hoch, die App landet wieder in der Kamera. In der Datenbank steht eine neue `posts`-Zeile mit `upload_status = 'uploaded'`, und im Storage liegen beide Objekte.

- [ ] **Step 4: Video mit 30-Sekunden-Grenze**

Auslöser halten und laufen lassen. Expected: Die Aufnahme stoppt selbsttätig bei 30 s, der Ring ist voll, das Video ist einsendbar.

- [ ] **Step 5: Der Offline-Durchlauf — das Kernversprechen**

Flugmodus einschalten, zwei Momente einsenden, die App vollständig beenden, Flugmodus ausschalten, App öffnen. Expected: Beide Momente laufen von selbst durch; der Zähler war die ganze Zeit korrekt, «2 Momente warten auf Upload» verschwindet, danach stehen beide Zeilen auf `uploaded`.

- [ ] **Step 6: Verweigerte Berechtigungen**

Kamera-Berechtigung in den Systemeinstellungen entziehen und den Tab öffnen. Expected: erklärender Screen mit Weg in die Einstellungen, keine schwarze Fläche. Dasselbe für die Ortung: die Aufnahme läuft weiter, nur ohne Ort.

- [ ] **Step 7: «Nur über WLAN»**

Schalter im Profil aktivieren, auf Mobilfunk umstellen (Simulator: Netzbedingungen), einen Moment einsenden. Expected: Der Moment wartet sichtbar, statt fehlzuschlagen; nach Rückkehr ins WLAN läuft er durch.

- [ ] **Step 8: Ergebnis festhalten**

Scheitert ein Schritt: Fehler beschreiben, Ursache suchen, korrigieren, den betroffenen Task-Test ergänzen. Erst wenn alle sieben Schritte durchlaufen, ist Phase 4 fertig.

---

## Offene Punkte nach Phase 4

- Echtes R2 samt Credentials und EAS-Build (Phase 6).
- Trip-Umschalter direkt im Sucher, sobald Nutzer mehrere Reisen parallel führen.
- Lesende signierte URLs — gehören zu Phase 5 und dürfen vorher nicht entstehen.
- Aus Phase 3 mitgenommen: `peekInvite` kollabiert Netzfehler zu «Link gibt es nicht mehr»; `bearbeiten.tsx` zeigt bei Lesefehler ein leeres Formular; Owner steht in der Mitgliederliste zuunterst statt zuoberst; kein `Database`-Generic am Supabase-Client.
