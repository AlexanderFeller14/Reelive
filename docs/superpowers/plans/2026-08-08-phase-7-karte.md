# Phase 7 — Die Karte des Recaps: Implementierungsplan

> **Für agentische Worker:** ERFORDERLICHE SUB-SKILL: Nutze
> superpowers:subagent-driven-development (empfohlen) oder
> superpowers:executing-plans, um diesen Plan Task für Task umzusetzen.
> Schritte tragen Checkbox-Syntax (`- [ ]`) zur Nachverfolgung.

**Goal:** Eine dritte Lesart des Recaps — die Karte —, auf der jeder Moment mit
Koordinaten als Thumbnail-Nadel sitzt, die Aufnahmereihenfolge als Linie
sichtbar ist und ein Tipp in den Player an genau diese Stelle führt.

**Architecture:** Fast vollständig clientseitig. Die Koordinaten liegen seit Phase 1
in `posts.lat`/`posts.lng` und stehen unter derselben Select-Policy wie der
Rest des Moments — es gibt keine Migration und keine Policy in dieser Phase. Die einzige
Serverarbeit kommt aus Entscheid R4: die bestehende Edge Function
`share-link` gibt zwei Spalten mehr aus, damit der geteilte Recap dieselbe
Karte zeigen kann. Alle Rechenarbeit (Punkte ziehen, Ausschnitt
bestimmen, gruppieren) sitzt in reinen Modulen unter
`mobile/src/features/karte/`, die ohne Karte und ohne React testbar sind; der
Screen verdrahtet sie nur.

**Tech Stack:** Expo SDK 57 / React Native 0.86, TypeScript strict,
expo-router, `react-native-maps` (Apple Maps auf iOS, Google Maps auf Android),
Jest + @testing-library/react-native v14.

## Spec

`docs/superpowers/specs/2026-08-08-phase-7-karte-design.md` — insbesondere §3
(Rahmenentscheide R1–R5), §4 (Versprechen K1–K12) und §5 (der Screen).

## Global Constraints

Diese gelten für JEDEN Task dieses Plans, auch wenn der Task sie nicht
wiederholt.

- **DESIGN-LANGUAGE.md ist bindend** und schlägt Framework-Defaults. Farben nur
  über Tokens aus `@/theme/tokens`, nie feste Hex-Werte. Radius ∈ {12, 24, 999}.
  Abstände aus {4, 8, 12, 16, 24, 32, 48}, Screen-Ränder 24. Schatten nur aus
  der Dreier-Skala. Genau EIN Primär-Button pro Screen. Icons: Lucide, Outline,
  Stroke 1.75 — nie gefüllt, nie Emoji.
  **Einzige Ausnahme dieser Phase:** die Kartenkacheln selbst (Spec R2). Alles,
  was auf ihnen liegt, folgt der Design Language ohne Abstrich.
- **Der Kartenscreen ist hell**, nicht Kino. Kino beginnt erst im Player.
- **UI-Sprache Deutsch, Du-Form**, Vokabular aus DESIGN-LANGUAGE §6: Moment,
  Reise, Filmrolle, versiegelt, Recap, einsenden. Nie Post, Trip, Pin, Marker
  im sichtbaren Text.
- **Sortierung IMMER über `tage.sortiereMomente`** (`captured_at` aufsteigend,
  `id` als stabiles zweites Kriterium). Nie `created_at`. Der `start`-Parameter
  des Players ist ein **Index in genau diese Liste**.
- **Kein `any`.** `tsc --noEmit` muss sauber sein.
- **RTL v14 ist voll async:** `await render(...)` UND `await fireEvent.*(...)`.
- **Router-Root ist `mobile/src/app/`**, typedRoutes ist aktiv.
- Nach jedem Commit `git show --stat HEAD` prüfen: der Index ist geteilt, es
  dürfen keine fremden Dateien mitgehen. Immer `git commit -- <pfade>`.
- Reduced Motion (`useReducedMotion`) schaltet Kamerafahrten auf sofortiges
  Setzen um.

## Ist-Zustand (nachgewiesen, nicht vermutet)

Vor dem Schreiben dieses Plans geprüft:

- `posts` hat `lat double precision`, `lng double precision`, `place_name text`
  — alle nullable, seit `20260803090100_content_tables.sql`.
- `ortUndZeit.ortBestimmen()` (Phase 4) liefert bei fehlender Berechtigung,
  Zeitüberschreitung oder fehlendem Fix bewusst `{lat: null, lng: null,
  place_name: null}` und lässt den Moment trotzdem durch.
- `recapApi.SPALTEN` listet `lat`/`lng` **nicht** — sie fehlen also heute in
  `RecapMoment`. `place_name` ist bereits dabei.
- `SPALTEN` enthält `profiles!posts_author_id_fkey(display_name)`. Der
  Fremdschlüsselname ist zwingend: zwischen `posts` und `profiles` gibt es zwei
  Wege (direkt über `author_id`, many-to-many über `reactions`), und PostgREST
  verweigert eine mehrdeutige Einbettung mit HTTP 300 und liefert gar nichts.
  Wer den Namen kürzt, bricht den gesamten Recap. Der Kommentar in `recapApi.ts`
  bleibt stehen.
- `player.tsx` liest `useLocalSearchParams<{ id: string; start?: string }>()`;
  `uebersicht.tsx` setzt `start: String(index)` — ein **Index**, keine ID.
- `urlVorrat.holeVorrat(tripId)` liefert `Map<post_id, {medium_url, thumb_url}>`
  inklusive Ablauf-Behandlung; die Übersicht benutzt `thumb_url ?? medium_url`.
- `useOberkante(basis)` (`@/theme/useOberkante`) liefert den oberen Abstand
  inklusive Safe Area; der SafeAreaProvider steht im Root-Layout.
- `react-native-maps` ist **nicht** installiert.
- Der Seed hat für JEDEN Moment Koordinaten — K6 und K9 sind damit heute nicht
  prüfbar.

## File Structure

**Neu:**

| Datei | Verantwortung |
|---|---|
| `mobile/src/features/karte/typen.ts` | `KartenPunkt`, `Gruppe`, `Ausschnitt` — der gemeinsame Vertrag |
| `mobile/src/features/karte/kartenPunkte.ts` | Aus `RecapMoment[]` die Punkte mit Ort ziehen, die ohne zählen, Spiellisten-Index mitführen |
| `mobile/src/features/karte/ausschnitt.ts` | Aus n Punkten die Region, die alle zeigt (inkl. 180. Längengrad) |
| `mobile/src/features/karte/gruppierung.ts` | Punkte nach Bildschirmabstand gruppieren |
| `mobile/src/features/karte/KartenFlaeche.tsx` | Die Kartenfläche nativ (react-native-maps) |
| `mobile/src/features/karte/KartenFlaeche.web.tsx` | Dieselbe Fläche im Browser (Leaflet, OSM-Kacheln) |
| `mobile/src/app/(tabs)/recap/[id]/karte.tsx` | Der Screen in der App |
| `mobile/src/features/karte/__tests__/*.test.ts` | Je eine Testdatei pro reinem Modul |
| `mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx` | Screen-Tests |

**Geändert:**

| Datei | Änderung |
|---|---|
| `mobile/src/features/recap/types.ts` | `RecapMoment` bekommt `lat`/`lng` |
| `mobile/src/features/recap/recapApi.ts` | `SPALTEN` bekommt `lat, lng` |
| `mobile/src/app/(tabs)/recap/[id]/uebersicht.tsx` | Segment-Zeile «Nach Tagen / Auf der Karte» |
| `mobile/package.json`, `mobile/app.json` | `react-native-maps`, `leaflet` |
| `supabase/functions/share-link/store.ts` | `lat, lng` in die Momente-Abfrage |
| `supabase/functions/share-link/aufloesung.ts` | `lat`/`lng` in `MomentZeile` und `OeffentlicherMoment` |
| `supabase/functions/share-link/aufloesung_test.ts` | Deno-Tests für die zwei neuen Felder |
| `mobile/src/app/teilen/[token].tsx` | Segment-Zeile und Karte im geteilten Recap |
| `supabase/seed.sql` | Drei Momente ohne Ort |

---

### Task 1: Koordinaten durch den Datenweg, und Testdaten ohne Ort

**Files:**
- Modify: `mobile/src/features/recap/types.ts`
- Modify: `mobile/src/features/recap/recapApi.ts`
- Modify: `mobile/src/features/recap/__tests__/recapApi.test.ts`
- Modify: `supabase/seed.sql`

**Interfaces:**
- Produces: `RecapMoment.lat: number | null`, `RecapMoment.lng: number | null` —
  alle folgenden Tasks lesen genau diese beiden Felder.

- [ ] **Schritt 1: Test schreiben, der die neuen Spalten festnagelt**

In `mobile/src/features/recap/__tests__/recapApi.test.ts` bei den bestehenden
`SPALTEN`-Tests ergänzen:

```ts
test('fetchRecapMomente fragt lat und lng mit ab', async () => {
  mockSelect.mockResolvedValueOnce({ data: [], error: null });
  await fetchRecapMomente('t1');
  const spalten = mockSelect.mock.calls[0][0] as string;
  expect(spalten).toContain('lat');
  expect(spalten).toContain('lng');
  // Der Fremdschlüsselname bleibt zwingend — ohne ihn liefert PostgREST
  // HTTP 300 und der gesamte Recap ist leer (siehe Kommentar in recapApi.ts).
  expect(spalten).toContain('profiles!posts_author_id_fkey(display_name)');
});

test('fetchRecapMomente reicht lat/lng durch', async () => {
  mockSelect.mockResolvedValueOnce({
    data: [{
      id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null,
      caption: null, captured_at: '2026-05-08T12:00:00Z', captured_tz: 'Europe/Lisbon',
      place_name: 'Alfama', upload_status: 'uploaded', lat: 38.7139, lng: -9.1301,
      profiles: { display_name: 'Mira' },
    }],
    error: null,
  });
  const { data } = await fetchRecapMomente('t1');
  expect(data[0].lat).toBe(38.7139);
  expect(data[0].lng).toBe(-9.1301);
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/recap/__tests__/recapApi.test.ts`
Expected: FAIL — `spalten` enthält `lat` nicht, `data[0].lat` ist `undefined`.

- [ ] **Schritt 3: Typ erweitern**

In `mobile/src/features/recap/types.ts`, in `RecapMoment` nach `place_name`:

```ts
  place_name: string | null;
  // Koordinaten der Aufnahme. null ist der Normalfall und kein Fehler:
  // ortBestimmen() (Phase 4) liefert bewusst null, wenn die Ortungsdienste
  // nicht erlaubt sind, drinnen kein Fix zustande kommt oder die Frist
  // ablaeuft — der Moment wird trotzdem eingesendet.
  lat: number | null;
  lng: number | null;
```

- [ ] **Schritt 4: Abfrage erweitern**

In `mobile/src/features/recap/recapApi.ts`, in `SPALTEN` — der Kommentar über
`SPALTEN` bleibt unverändert stehen:

```ts
const SPALTEN = [
  'id', 'trip_id', 'author_id', 'type', 'duration_s', 'caption',
  'captured_at', 'captured_tz', 'place_name', 'lat', 'lng', 'upload_status',
  'profiles!posts_author_id_fkey(display_name)',
].join(', ');
```

Und in der `map`-Projektion darunter, nach `place_name: row.place_name,`:

```ts
    lat: row.lat,
    lng: row.lng,
```

- [ ] **Schritt 5: Test laufen lassen**

Run: `cd mobile && npx jest src/features/recap && npx tsc --noEmit`
Expected: PASS, keine Typfehler.

- [ ] **Schritt 6: Seed um Momente ohne Ort ergänzen**

In `supabase/seed.sql` beim Lissabon-Block (der aufgedeckten Reise) drei
Momente mit `lat`, `lng` und `place_name` auf `null` ergänzen. Vorhandene
Momente NICHT ändern — die Karte soll beides zeigen. Dieselben Spalten und
dieselbe Form wie die Nachbarzeilen benutzen; die drei neuen bekommen
`captured_at` innerhalb des bestehenden Zeitraums, damit sie in den
Tagesgruppen landen.

Beispielzeile (an die Spaltenliste des vorhandenen Inserts anpassen):

```sql
  ('cccc0000-0000-4000-8000-00000000f001', 'aaaaaaaa-0000-4000-8000-000000000002',
   '11111111-0000-4000-8000-000000000002', 'photo', 'jpg',
   'lissabon/f001.jpg', 'lissabon/f001_thumb.jpg', null,
   'Im Museum, kein Empfang', '2026-05-09T15:20:00+01:00', 'Europe/Lisbon',
   null, null, null, 'uploaded', '2026-05-09T15:25:00+01:00'),
```

- [ ] **Schritt 7: Datenbank neu aufsetzen und zählen**

```bash
npx supabase db reset --local
docker exec supabase_db_reelive psql -U postgres -d postgres -c \
  "select count(*) filter (where lat is null) as ohne_ort, count(*) as gesamt
     from public.posts where trip_id = 'aaaaaaaa-0000-4000-8000-000000000002';"
```
Expected: `ohne_ort = 3`, `gesamt` um 3 höher als zuvor.

**Hinweis:** `supabase db reset` leert den Storage-Bucket. Die Testmedien
müssen danach neu hochgeladen werden, sonst zeigen Übersicht und Karte leere
Kacheln.

- [ ] **Schritt 8: Commit**

```bash
git commit -- mobile/src/features/recap supabase/seed.sql \
  -m "feat(karte): lat/lng im Recap-Datenweg, Seed mit Momenten ohne Ort"
```

---

### Task 2: `kartenPunkte.ts` — was auf die Karte kommt und was nicht

**Files:**
- Create: `mobile/src/features/karte/typen.ts`
- Create: `mobile/src/features/karte/kartenPunkte.ts`
- Test: `mobile/src/features/karte/__tests__/kartenPunkte.test.ts`

**Interfaces:**
- Consumes: `RecapMoment` mit `lat`/`lng` aus Task 1
- Produces:
  - `type KartenPunkt = { moment: RecapMoment; lat: number; lng: number; index: number }`
  - `function zuKartenPunkten(momente: RecapMoment[]): { punkte: KartenPunkt[]; ohneOrt: RecapMoment[] }`

`index` ist die Position in der Liste, die HEREINGEGEBEN wird — und die muss
die **Spielliste** sein, nicht die rohe Momente-Liste.

**Korrektur nach dem Review von Task 2 (2026-08-09).** Der ursprüngliche Plan
behauptete, `start` sei ein Index in alle sortierten Momente. Das ist falsch,
nachgeprüft in `player.tsx:503-527`: der Player baut seine Spielliste als

```ts
const uploaded = momente.filter((m) => m.upload_status === 'uploaded');
const mitBild = uploaded.filter((m) => urlsMap.has(m.id));
```

und `parseStartIndex(startParam, mitBild.length)` zählt in **diese** Liste.
`uebersicht.tsx:316-317` baut ihr `indexById` aus exakt derselben Filterung.
Jeder Moment, der noch `pending` ist oder für den der Vorrat keine URL hat,
verschiebt sonst alles dahinter — der Sprung von der Karte landete beim
falschen Moment, und niemand merkt es, ausser er zählt nach.

`zuKartenPunkten` bleibt unverändert: es sortiert und zählt über das, was es
bekommt. Die Pflicht liegt beim Aufrufer (Tasks 5, 8, 10), ihm dieselbe
gefilterte Liste zu geben, die Player und Übersicht benutzen.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`mobile/src/features/karte/__tests__/kartenPunkte.test.ts`:

```ts
import { zuKartenPunkten } from '../kartenPunkte';
import type { RecapMoment } from '@/features/recap/types';

const moment = (teil: Partial<RecapMoment> & { id: string }): RecapMoment => ({
  trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
  captured_at: '2026-05-08T10:00:00Z', captured_tz: 'Europe/Lisbon',
  place_name: null, lat: null, lng: null, upload_status: 'uploaded',
  autor_name: 'Mira', ...teil,
});

test('trennt Momente mit Ort von denen ohne', () => {
  const { punkte, ohneOrt } = zuKartenPunkten([
    moment({ id: 'a', lat: 38.71, lng: -9.13 }),
    moment({ id: 'b' }),
    moment({ id: 'c', lat: 38.69, lng: -9.21 }),
  ]);
  expect(punkte.map((p) => p.moment.id)).toEqual(['a', 'c']);
  expect(ohneOrt.map((m) => m.id)).toEqual(['b']);
});

// Der Index zeigt in die SORTIERTE Gesamtliste, nicht in die gefilterte —
// sonst startet der Player beim falschen Moment.
test('der Index zaehlt ueber alle Momente, nicht nur ueber die mit Ort', () => {
  const { punkte } = zuKartenPunkten([
    moment({ id: 'a', captured_at: '2026-05-08T09:00:00Z' }),
    moment({ id: 'b', captured_at: '2026-05-08T10:00:00Z', lat: 1, lng: 2 }),
  ]);
  expect(punkte[0].index).toBe(1);
});

// Die Karte sortiert selbst, statt sich auf den Aufrufer zu verlassen:
// captured_at aufsteigend, id als stabiles zweites Kriterium.
test('sortiert nach captured_at, nicht nach Eingabereihenfolge', () => {
  const { punkte } = zuKartenPunkten([
    moment({ id: 'spaet', captured_at: '2026-05-09T10:00:00Z', lat: 1, lng: 1 }),
    moment({ id: 'frueh', captured_at: '2026-05-08T10:00:00Z', lat: 2, lng: 2 }),
  ]);
  expect(punkte.map((p) => p.moment.id)).toEqual(['frueh', 'spaet']);
});

test('eine halbe Koordinate ist keine Koordinate', () => {
  const { punkte, ohneOrt } = zuKartenPunkten([moment({ id: 'a', lat: 38.71, lng: null })]);
  expect(punkte).toHaveLength(0);
  expect(ohneOrt.map((m) => m.id)).toEqual(['a']);
});

test('leere Liste ergibt leere Ergebnisse', () => {
  expect(zuKartenPunkten([])).toEqual({ punkte: [], ohneOrt: [] });
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/karte`
Expected: FAIL — `Cannot find module '../kartenPunkte'`.

- [ ] **Schritt 3: Typen anlegen**

`mobile/src/features/karte/typen.ts`:

```ts
import type { RecapMoment } from '@/features/recap/types';

// Ein Moment, von dem feststeht, dass er einen Ort hat. Das ist der
// Unterschied zu RecapMoment: dort sind lat/lng nullable, hier nicht mehr —
// jede Rechnung dieser Feature-Mappe darf sich darauf verlassen.
export type KartenPunkt = {
  moment: RecapMoment;
  lat: number;
  lng: number;
  // Position in der sortierten Gesamtliste aller Momente der Reise. Genau
  // dieser Wert geht als `start` an den Player.
  index: number;
};

// Der sichtbare Kartenausschnitt, in der Form, die react-native-maps erwartet.
export type Ausschnitt = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

// Punkte, die auf dem Bildschirm zu nah beieinander liegen, um sie einzeln
// zu zeigen. `anker` ist der frueheste Moment der Gruppe und stellt sie dar.
export type Gruppe = {
  anker: KartenPunkt;
  punkte: KartenPunkt[];
};
```

- [ ] **Schritt 4: Implementieren**

`mobile/src/features/karte/kartenPunkte.ts`:

```ts
import { sortiereMomente } from '@/features/recap/tage';
import type { RecapMoment } from '@/features/recap/types';
import type { KartenPunkt } from './typen';

// Zieht aus allen Momenten einer Reise die heraus, die einen Ort tragen — und
// behaelt die anderen, statt sie fallen zu lassen: eine Karte, auf der drei
// Momente einfach fehlen, ohne dass es jemand erfaehrt, luegt ueber die Reise
// (Spec K6).
//
// Sortiert selbst ueber sortiereMomente, statt sich auf den Aufrufer zu
// verlassen. Der Grund ist nicht Bequemlichkeit: `index` muss in dieselbe
// Reihenfolge zeigen, die der Player spielt, sonst startet er am falschen
// Moment — und diese Reihenfolge ist per CLAUDE.md IMMER captured_at.
export function zuKartenPunkten(momente: RecapMoment[]): {
  punkte: KartenPunkt[];
  ohneOrt: RecapMoment[];
} {
  const sortiert = sortiereMomente(momente);
  const punkte: KartenPunkt[] = [];
  const ohneOrt: RecapMoment[] = [];

  sortiert.forEach((moment, index) => {
    // Beide Werte oder keiner: eine halbe Koordinate ist auf einer Karte
    // nicht darstellbar, und `lat ?? 0` waere ein Punkt im Golf von Guinea.
    if (moment.lat === null || moment.lng === null) {
      ohneOrt.push(moment);
      return;
    }
    punkte.push({ moment, lat: moment.lat, lng: moment.lng, index });
  });

  return { punkte, ohneOrt };
}
```

- [ ] **Schritt 5: Laufen lassen**

Run: `cd mobile && npx jest src/features/karte && npx tsc --noEmit`
Expected: PASS.

- [ ] **Schritt 6: Commit**

```bash
git commit -- mobile/src/features/karte \
  -m "feat(karte): Kartenpunkte aus Momenten, Momente ohne Ort bleiben sichtbar"
```

---

### Task 3: `ausschnitt.ts` — die Region, die alles zeigt

**Files:**
- Create: `mobile/src/features/karte/ausschnitt.ts`
- Test: `mobile/src/features/karte/__tests__/ausschnitt.test.ts`

**Interfaces:**
- Consumes: `KartenPunkt[]`, `Ausschnitt` aus Task 2
- Produces: `function ausschnittFuer(punkte: KartenPunkt[]): Ausschnitt | null`

`null` heisst «es gibt nichts zu zeigen» — der Screen entscheidet dann auf den
Leer-Zustand (K9), statt einen erfundenen Ausschnitt zu bekommen.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`mobile/src/features/karte/__tests__/ausschnitt.test.ts`:

```ts
import { ausschnittFuer } from '../ausschnitt';
import type { KartenPunkt } from '../typen';

const punkt = (lat: number, lng: number): KartenPunkt =>
  ({ lat, lng, index: 0, moment: { id: `${lat},${lng}` } } as unknown as KartenPunkt);

test('ohne Punkte gibt es keinen Ausschnitt', () => {
  expect(ausschnittFuer([])).toBeNull();
});

// Ein einzelner Punkt hat keine Ausdehnung — ohne Sonderfall waere das Delta 0
// und die Karte zoomte bis auf Hausnummern hinunter.
test('ein einzelner Punkt bekommt einen festen Radius', () => {
  const a = ausschnittFuer([punkt(38.71, -9.13)])!;
  expect(a.latitude).toBeCloseTo(38.71, 5);
  expect(a.longitude).toBeCloseTo(-9.13, 5);
  expect(a.latitudeDelta).toBeGreaterThan(0);
  expect(a.longitudeDelta).toBeGreaterThan(0);
});

test('zwei Punkte liegen mittig im Ausschnitt und passen mit Rand hinein', () => {
  const a = ausschnittFuer([punkt(38.70, -9.20), punkt(38.72, -9.10)])!;
  expect(a.latitude).toBeCloseTo(38.71, 5);
  expect(a.longitude).toBeCloseTo(-9.15, 5);
  expect(a.latitudeDelta).toBeGreaterThan(0.02);
  expect(a.longitudeDelta).toBeGreaterThan(0.10);
});

// Der Fall, an dem die naive Rechnung (min/max) scheitert: Fidschi liegt
// beiderseits des 180. Laengengrads. min/max ergaebe eine Spanne von 359 Grad
// und einen Mittelpunkt in Afrika.
test('ueber den 180. Laengengrad hinweg bleibt der Ausschnitt eng', () => {
  const a = ausschnittFuer([punkt(-17.8, 179.0), punkt(-17.9, -179.5)])!;
  expect(a.longitudeDelta).toBeLessThan(5);
  expect(Math.abs(a.longitude)).toBeGreaterThan(175);
});

// Der Fehler, den Task 3 beim Umsetzen gefunden hat: bei identischen
// Laengengraden fand die Luecken-Suche eine Luecke von 0 Grad und machte
// daraus eine Spanne von 360 — der Mittelpunkt landete auf dem Antipoden.
test('mehrere Punkte auf derselben Koordinate bleiben dort', () => {
  const a = ausschnittFuer([punkt(38.71, -9.13), punkt(38.71, -9.13)])!;
  expect(a.longitude).toBeCloseTo(-9.13, 5);
  expect(a.latitude).toBeCloseTo(38.71, 5);
});

test('der Mittelpunkt bleibt im gueltigen Bereich', () => {
  const a = ausschnittFuer([punkt(-17.8, 179.0), punkt(-17.9, -179.5)])!;
  expect(a.longitude).toBeGreaterThanOrEqual(-180);
  expect(a.longitude).toBeLessThanOrEqual(180);
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/karte/__tests__/ausschnitt.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Schritt 3: Implementieren**

`mobile/src/features/karte/ausschnitt.ts`:

```ts
import type { Ausschnitt, KartenPunkt } from './typen';

// Rand um die aeussersten Punkte, damit keine Nadel am Bildschirmrand klebt.
const RAND = 1.4;
// Ausdehnung fuer den Fall, dass es keine gibt (ein einziger Punkt, oder
// mehrere auf exakt derselben Koordinate). Rund 1,1 km in der Breite.
const MINDESTSPANNE = 0.01;

// Die kleinste Laengengrad-Spanne, die alle Punkte enthaelt.
//
// Die naive Rechnung max - min stimmt ueberall ausser dort, wo die Reise den
// 180. Laengengrad kreuzt: fuer 179 und -179.5 ergaebe sie 358.5 Grad und
// einen Mittelpunkt auf der anderen Seite der Erde. Stattdessen wird die
// GROESSTE LUECKE zwischen zwei benachbarten Laengengraden gesucht — was
// uebrig bleibt, ist die gesuchte Spanne.
function laengenSpanne(lngs: number[]): { mitte: number; spanne: number } {
  const sortiert = [...lngs].sort((a, b) => a - b);
  let groessteLuecke = -1;
  let nachLuecke = 0;
  for (let i = 0; i < sortiert.length; i++) {
    const luecke = (sortiert[(i + 1) % sortiert.length] - sortiert[i] + 360) % 360;
    if (luecke > groessteLuecke) {
      groessteLuecke = luecke;
      nachLuecke = (i + 1) % sortiert.length;
    }
  }
  // Sind alle Laengengrade gleich (ein einziger Punkt, oder mehrere auf
  // derselben Koordinate), ist JEDE Luecke 0 — auch die Umrundung, denn
  // (x - x + 360) % 360 ist 0. Ohne diesen Ausstieg ergaebe `360 - 0` eine
  // Spanne von 360 Grad und einen Mittelpunkt auf dem Antipoden: fuer Lissabon
  // (-9.13) landete die Karte bei 170.87 im Pazifik. Groesste Luecke = 0 heisst
  // genau dann «alle gleich»: bei zwei verschiedenen Werten a < b sind beide
  // Luecken (b-a) und (a-b+360) groesser als null.
  if (groessteLuecke === 0) return { mitte: sortiert[0], spanne: 0 };

  const west = sortiert[nachLuecke];
  const spanne = 360 - groessteLuecke;
  // +540 statt +180 vor dem Modulo: der Zwischenwert kann negativ werden, und
  // JavaScripts % behaelt bei negativen Zahlen das Vorzeichen.
  const mitte = ((west + spanne / 2 + 540) % 360) - 180;
  return { mitte, spanne };
}

// Die Region, in der ALLE uebergebenen Punkte sichtbar sind (Spec K2).
// `null` heisst: es gibt nichts zu zeigen — der Screen entscheidet dann auf
// den Leer-Zustand, statt einen erfundenen Ausschnitt zu bekommen.
export function ausschnittFuer(punkte: KartenPunkt[]): Ausschnitt | null {
  if (punkte.length === 0) return null;

  const lats = punkte.map((p) => p.lat);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const { mitte: longitude, spanne } = laengenSpanne(punkte.map((p) => p.lng));

  return {
    latitude: (minLat + maxLat) / 2,
    longitude,
    latitudeDelta: Math.max((maxLat - minLat) * RAND, MINDESTSPANNE),
    longitudeDelta: Math.max(spanne * RAND, MINDESTSPANNE),
  };
}
```

- [ ] **Schritt 4: Laufen lassen**

Run: `cd mobile && npx jest src/features/karte && npx tsc --noEmit`
Expected: PASS.

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/features/karte \
  -m "feat(karte): Ausschnitt, der alle Momente zeigt — auch ueber den 180. Laengengrad"
```

---

### Task 4: `gruppierung.ts` — Nadeln, die einander nicht verdecken

**Files:**
- Create: `mobile/src/features/karte/gruppierung.ts`
- Test: `mobile/src/features/karte/__tests__/gruppierung.test.ts`

**Interfaces:**
- Consumes: `KartenPunkt`, `Ausschnitt`, `Gruppe` aus Task 2
- Produces:
  - `const GRUPPEN_ABSTAND_PT = 40`
  - `function gruppiere(punkte, ausschnitt, breite, hoehe, schwelle?): Gruppe[]`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`mobile/src/features/karte/__tests__/gruppierung.test.ts`:

```ts
import { gruppiere, GRUPPEN_ABSTAND_PT } from '../gruppierung';
import type { Ausschnitt, KartenPunkt } from '../typen';

const punkt = (id: string, lat: number, lng: number, index = 0): KartenPunkt =>
  ({ lat, lng, index, moment: { id } } as unknown as KartenPunkt);

// 0.1 Grad ueber 400 Punkte Breite: ein Grad sind 4000 Punkte, ein
// Tausendstel Grad also 4 Punkte.
const AUSSCHNITT: Ausschnitt = {
  latitude: 0, longitude: 0, latitudeDelta: 0.1, longitudeDelta: 0.1,
};
const BREITE = 400;
const HOEHE = 400;

test('weit auseinander liegende Punkte bleiben einzeln', () => {
  const gruppen = gruppiere(
    [punkt('a', 0.04, 0.04), punkt('b', -0.04, -0.04)],
    AUSSCHNITT, BREITE, HOEHE
  );
  expect(gruppen).toHaveLength(2);
  expect(gruppen.every((g) => g.punkte.length === 1)).toBe(true);
});

test('dicht beieinander liegende Punkte werden zu einer Gruppe', () => {
  const gruppen = gruppiere(
    [punkt('a', 0, 0), punkt('b', 0.001, 0.001), punkt('c', 0.002, 0)],
    AUSSCHNITT, BREITE, HOEHE
  );
  expect(gruppen).toHaveLength(1);
  expect(gruppen[0].punkte.map((p) => p.moment.id)).toEqual(['a', 'b', 'c']);
});

// Der Anker stellt die Gruppe dar. Er ist der ERSTE der Eingabereihenfolge,
// und die ist nach captured_at sortiert — die Gruppe traegt also das
// Thumbnail des fruehesten Moments.
test('der Anker ist der fruehste Moment der Gruppe', () => {
  const gruppen = gruppiere(
    [punkt('frueh', 0, 0, 3), punkt('spaet', 0.001, 0, 7)],
    AUSSCHNITT, BREITE, HOEHE
  );
  expect(gruppen[0].anker.moment.id).toBe('frueh');
});

test('identische Koordinaten landen in einer Gruppe', () => {
  const gruppen = gruppiere(
    [punkt('a', 12.34, 56.78), punkt('b', 12.34, 56.78)],
    { latitude: 12.34, longitude: 56.78, latitudeDelta: 0.1, longitudeDelta: 0.1 },
    BREITE, HOEHE
  );
  expect(gruppen).toHaveLength(1);
});

test('ein einzelner Punkt ergibt eine Gruppe mit einem Punkt', () => {
  const gruppen = gruppiere([punkt('a', 0, 0)], AUSSCHNITT, BREITE, HOEHE);
  expect(gruppen).toEqual([{ anker: expect.anything(), punkte: [expect.anything()] }]);
});

test('ohne Punkte gibt es keine Gruppen', () => {
  expect(gruppiere([], AUSSCHNITT, BREITE, HOEHE)).toEqual([]);
});

// Beim Hineinzoomen faellt eine Gruppe auseinander — genau das passiert, wenn
// jemand sie antippt (Spec §5.5).
test('enger Ausschnitt loest die Gruppe auf', () => {
  const punkte = [punkt('a', 0, 0), punkt('b', 0.001, 0.001)];
  const eng: Ausschnitt = { ...AUSSCHNITT, latitudeDelta: 0.002, longitudeDelta: 0.002 };
  expect(gruppiere(punkte, AUSSCHNITT, BREITE, HOEHE)).toHaveLength(1);
  expect(gruppiere(punkte, eng, BREITE, HOEHE)).toHaveLength(2);
});

test('die Schwelle ist in Bildschirmpunkten und einstellbar', () => {
  const punkte = [punkt('a', 0, 0), punkt('b', 0.004, 0)];
  expect(gruppiere(punkte, AUSSCHNITT, BREITE, HOEHE, 4)).toHaveLength(2);
  expect(gruppiere(punkte, AUSSCHNITT, BREITE, HOEHE, GRUPPEN_ABSTAND_PT)).toHaveLength(1);
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/features/karte/__tests__/gruppierung.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Schritt 3: Implementieren**

`mobile/src/features/karte/gruppierung.ts`:

```ts
import type { Ausschnitt, Gruppe, KartenPunkt } from './typen';

// Zwei Nadeln naeher als das verdecken einander: das Thumbnail ist 44 Punkte
// breit, ab rund 40 Punkten Abstand ueberlappen die Raender sichtbar.
export const GRUPPEN_ABSTAND_PT = 40;

type Bildpunkt = { x: number; y: number };

// Lineare Projektion des sichtbaren Ausschnitts auf die Flaeche. Bewusst OHNE
// Mercator-Korrektur: es geht nicht um Kartografie, sondern um die Frage «wie
// weit sind diese zwei Nadeln auf DIESEM Bildschirm auseinander» — und der
// Ausschnitt ist klein genug, dass die Verzerrung darin nicht ins Gewicht
// faellt.
function aufBildschirm(
  punkt: KartenPunkt,
  ausschnitt: Ausschnitt,
  breite: number,
  hoehe: number
): Bildpunkt {
  const westen = ausschnitt.longitude - ausschnitt.longitudeDelta / 2;
  const norden = ausschnitt.latitude + ausschnitt.latitudeDelta / 2;
  return {
    x: ((punkt.lng - westen) / ausschnitt.longitudeDelta) * breite,
    y: ((norden - punkt.lat) / ausschnitt.latitudeDelta) * hoehe,
  };
}

// Fasst Punkte zusammen, die auf dem Bildschirm zu nah beieinander liegen.
//
// Bewusst gierig und in Eingabereihenfolge statt als k-means o.ae.: die
// Eingabe ist nach captured_at sortiert, also ist das Ergebnis deterministisch
// und der Anker jeder Gruppe ihr fruehester Moment. Ein Verfahren mit
// Zufallsstart wuerde die Karte bei jedem Rendern anders aussehen lassen.
export function gruppiere(
  punkte: KartenPunkt[],
  ausschnitt: Ausschnitt,
  breite: number,
  hoehe: number,
  schwelle: number = GRUPPEN_ABSTAND_PT
): Gruppe[] {
  const gruppen: { gruppe: Gruppe; ankerBild: Bildpunkt }[] = [];

  for (const punkt of punkte) {
    const bild = aufBildschirm(punkt, ausschnitt, breite, hoehe);
    const treffer = gruppen.find(({ ankerBild }) => {
      return Math.hypot(bild.x - ankerBild.x, bild.y - ankerBild.y) < schwelle;
    });
    if (treffer) {
      treffer.gruppe.punkte.push(punkt);
      continue;
    }
    gruppen.push({ gruppe: { anker: punkt, punkte: [punkt] }, ankerBild: bild });
  }

  return gruppen.map(({ gruppe }) => gruppe);
}
```

- [ ] **Schritt 4: Laufen lassen**

Run: `cd mobile && npx jest src/features/karte && npx tsc --noEmit`
Expected: PASS.

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/features/karte \
  -m "feat(karte): Gruppierung nach Bildschirmabstand statt nach Metern"
```

---

### Task 5: `react-native-maps` und der Screen mit Nadeln

**Files:**
- Modify: `mobile/package.json`, `mobile/app.json`
- Create: `mobile/src/app/(tabs)/recap/[id]/karte.tsx`
- Test: `mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx`

**Interfaces:**
- Consumes: `zuKartenPunkten`, `ausschnittFuer`, `fetchRecapMomente`, `fetchTrip`,
  `holeVorrat`, `useOberkante`
- Produces: die Route `/recap/[id]/karte`

- [ ] **Schritt 1: Abhängigkeit installieren**

```bash
cd mobile && npx expo install react-native-maps
```

`react-native-maps` läuft in Expo Go und nutzt auf iOS Apple Maps ohne
API-Schlüssel (Spec R1). Für den Android-Store-Build wird später ein
Google-Maps-Schlüssel gebraucht — der gehört auf die Konten-Liste aus Phase 6,
nicht in diesen Task.

- [ ] **Schritt 2: Jest-Mock für die Karte anlegen**

`react-native-maps` bringt native Module mit, die im Test-Environment nicht
existieren. In `mobile/jest.setup.ts` ergänzen:

```ts
// react-native-maps bringt native Views mit, die im Test-Environment nicht
// existieren. Der Mock rendert stattdessen schlichte Views mit denselben
// testID/children — genug, um zu pruefen, WELCHE Nadeln der Screen setzt,
// ohne eine Karte zu rendern.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Karte = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn(), fitToCoordinates: jest.fn() }));
    return React.createElement(View, props, props.children as React.ReactNode);
  });
  return {
    __esModule: true,
    default: Karte,
    Marker: (props: Record<string, unknown>) => React.createElement(View, props, props.children as React.ReactNode),
    Polyline: (props: Record<string, unknown>) => React.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});
```

- [ ] **Schritt 3: Den fehlschlagenden Screen-Test schreiben**

`mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx` — Muster wie
`uebersicht.test.tsx` (dort nachschlagen, wie `expo-router`, `AuthProvider`,
`recapApi` und `urlVorrat` gemockt werden):

```ts
test('setzt eine Nadel je Moment mit Ort', async () => {
  await wrap(<RecapKarte />);
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);
});

test('Momente ohne Ort bekommen keine Nadel', async () => {
  await wrap(<RecapKarte />);
  expect(screen.queryByTestId('karte-nadel-ohne-ort')).toBeNull();
});
```

- [ ] **Schritt 4: Laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/karte.test.tsx`
Expected: FAIL — Screen fehlt.

- [ ] **Schritt 5: Screen implementieren**

`mobile/src/app/(tabs)/recap/[id]/karte.tsx` — in diesem Task nur: Laden,
Nadeln, Ausschnitt, Zurück-Pille. Sheet, Filter und Linie kommen in den
folgenden Tasks.

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import MapView, { Marker, type MapViewProps } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import type { RecapMoment } from '@/features/recap/types';
import { holeVorrat, type Vorrat } from '@/features/recap/urlVorrat';
import { zuKartenPunkten } from '@/features/karte/kartenPunkte';
import { ausschnittFuer } from '@/features/karte/ausschnitt';
import type { Ausschnitt, KartenPunkt } from '@/features/karte/typen';
import { useOberkante } from '@/theme/useOberkante';
import { spacing } from '@/theme/tokens';

export default function RecapKarte() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const oben = useOberkante(spacing.base);
  const { width, height } = useWindowDimensions();

  const karte = useRef<MapView>(null);
  const [punkte, setPunkte] = useState<KartenPunkt[]>([]);
  const [ohneOrt, setOhneOrt] = useState<RecapMoment[]>([]);
  const [vorrat, setVorrat] = useState<Vorrat | null>(null);
  const [ausschnitt, setAusschnitt] = useState<Ausschnitt | null>(null);
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    let aktiv = true;
    void Promise.all([fetchRecapMomente(id), holeVorrat(id)]).then(([momente, v]) => {
      if (!aktiv) return;
      const { punkte: p, ohneOrt: o } = zuKartenPunkten(momente.data);
      setPunkte(p);
      setOhneOrt(o);
      setVorrat(v);
      setAusschnitt(ausschnittFuer(p));
      setGeladen(true);
    });
    return () => { aktiv = false; };
  }, [id]);

  // ... Rendering: <MapView initialRegion={ausschnitt} onRegionChangeComplete={setAusschnitt}>
  //     mit einem <Marker testID={`karte-nadel-${p.moment.id}`}> je Punkt.
}
```

Verbindliche Punkte für die Umsetzung:

- **Die Spielliste, nicht die rohe Momente-Liste.** Vor `zuKartenPunkten` filtert
  der Screen genau wie Player und Übersicht:
  ```ts
  const uploaded = momente.data.filter((m) => m.upload_status === 'uploaded');
  const mitBild = uploaded.filter((m) => v.urls.has(m.id));
  const { punkte, ohneOrt } = zuKartenPunkten(mitBild);
  ```
  Sonst zeigt `punkt.index` in einen anderen Indexraum als der Player, und der
  Sprung landet beim falschen Moment (siehe Task 2, Interfaces).
- Der Screen ist **hell** (`colors['bg-0']` als Grund unter der Karte).
- Die Zurück-Pille sitzt bei `top: oben`, links bei `spacing.screen`, als
  translucente Pille (`rgba(19,17,16,0.55)`, Radius 999, Lucide `ChevronLeft`).
- `initialRegion` bekommt den Ausschnitt aus `ausschnittFuer`; ist er `null`,
  rendert der Screen gar keine Karte (Leer-Zustand folgt in Task 10).
- `onRegionChangeComplete` schreibt den sichtbaren Ausschnitt in den State —
  Task 7 braucht ihn für die Gruppierung.
- Jede Nadel trägt `testID={`karte-nadel-${moment.id}`}`.

- [ ] **Schritt 6: Laufen lassen**

Run: `cd mobile && npx jest src/app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Schritt 7: Commit**

```bash
git commit -- mobile/package.json mobile/package-lock.json mobile/app.json \
  mobile/jest.setup.ts mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): Kartenscreen mit einer Nadel je Moment"
```

---

### Task 6: Die Nadel bekommt ein Gesicht, die Reise eine Linie

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/karte.tsx`
- Create: `mobile/src/components/KartenNadel.tsx`
- Test: `mobile/src/components/__tests__/KartenNadel.test.tsx`

**Interfaces:**
- Consumes: `MedienUrl` aus `@/features/recap/urlVorrat`
- Produces: `<KartenNadel moment thumbUrl anzahl? />`

- [ ] **Schritt 1: Test für die Nadel schreiben**

```tsx
test('zeigt das Thumbnail des Moments', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-bild').props.source.uri).toBe('https://x/t.jpg');
});

test('ohne Thumbnail steht ein Skeleton-Kreis', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl={null} />);
  expect(screen.getByTestId('nadel-skelett')).toBeTruthy();
});

test('ein Video traegt zusaetzlich das Play-Zeichen', async () => {
  await wrap(<KartenNadel moment={videoMoment} thumbUrl="https://x/t.jpg" />);
  expect(screen.getByTestId('nadel-video')).toBeTruthy();
});

test('eine Gruppe zeigt ihre Anzahl', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" anzahl={4} />);
  expect(screen.getByText('4')).toBeTruthy();
});

test('eine Gruppe von einem zeigt keine Zahl', async () => {
  await wrap(<KartenNadel moment={fotoMoment} thumbUrl="https://x/t.jpg" anzahl={1} />);
  expect(screen.queryByText('1')).toBeNull();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

Run: `cd mobile && npx jest src/components/__tests__/KartenNadel.test.tsx`
Expected: FAIL — Komponente fehlt.

- [ ] **Schritt 3: `KartenNadel` implementieren**

Gestalt nach Spec §5.4: rundes Thumbnail 44 px, Radius 999, 2 px weisser Ring,
`shadow.s2`. Ohne URL ein `bg-1`-Kreis mit Opacity-Puls (§4 Skeleton, dasselbe
Muster wie `SkelettBlock` in `uebersicht.tsx`). Video zusätzlich mit Lucide
`Play` (Outline, Stroke 1.75) in einer translucenten Pille. `anzahl > 1` setzt
eine Zähler-Pille an den Rand: `accent`-Fläche, Text `on-accent`, Caption-Grösse,
`tabular-nums`.

- [ ] **Schritt 4: Nadeln und Linie in den Screen**

In `karte.tsx`:

```tsx
<Marker
  key={gruppe.anker.moment.id}
  testID={`karte-nadel-${gruppe.anker.moment.id}`}
  coordinate={{ latitude: gruppe.anker.lat, longitude: gruppe.anker.lng }}
  onPress={() => aufNadel(gruppe)}
  tracksViewChanges={false}
>
  <KartenNadel
    moment={gruppe.anker.moment}
    thumbUrl={vorrat?.urls.get(gruppe.anker.moment.id)?.thumb_url ?? null}
    anzahl={gruppe.punkte.length}
  />
</Marker>
```

`tracksViewChanges={false}` ist Pflicht, nicht Geschmack: ohne das rendert
react-native-maps jede Nadel bei jedem Frame neu und die Karte ruckelt, sobald
mehr als eine Handvoll darauf liegt. Weil das Thumbnail erst nachträglich
eintrifft, muss der Wert `true` sein, solange die URL fehlt, und danach `false`
— sonst bleibt der Skeleton-Kreis für immer stehen.

Die Linie (Spec K3, `accent`, Breite 3):

```tsx
<Polyline
  coordinates={punkte.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
  strokeColor={colors.accent}
  strokeWidth={3}
/>
```

`punkte` ist bereits nach `captured_at` sortiert (Task 2) — die Linie folgt
damit der Aufnahmereihenfolge und nie der Upload-Zeit.

- [ ] **Schritt 5: Laufen lassen**

Run: `cd mobile && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Schritt 6: Commit**

```bash
git commit -- mobile/src/components mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): Thumbnail-Nadeln und die Reise als Linie"
```

---

### Task 7: Gruppierung im Screen

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/karte.tsx`
- Modify: `mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx`

- [ ] **Schritt 1: Test schreiben**

```ts
test('dicht beieinander liegende Momente teilen sich eine Nadel', async () => {
  // Zwei Momente auf fast derselben Koordinate.
  await wrap(<RecapKarte />);
  const nadeln = await screen.findAllByTestId(/^karte-nadel/);
  expect(nadeln).toHaveLength(1);
  expect(screen.getByText('2')).toBeTruthy();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

Expected: FAIL — heute zwei Nadeln.

- [ ] **Schritt 3: Gruppierung verdrahten**

```tsx
const gruppen = useMemo(
  () => (ausschnitt ? gruppiere(punkte, ausschnitt, width, height) : []),
  [punkte, ausschnitt, width, height]
);
```

`useMemo` ist hier nicht Optimierung, sondern Notwendigkeit: `gruppiere` läuft
bei jeder Kartenbewegung, und ein neues Array bei jedem Render würde alle
Marker neu mounten.

Ein Tipp auf eine Gruppe mit mehr als einem Punkt zoomt hinein, statt ein Sheet
zu öffnen (Spec §5.5):

```tsx
const aufNadel = (gruppe: Gruppe) => {
  if (gruppe.punkte.length === 1) return setGewaehlt(gruppe.anker);
  const ziel = ausschnittFuer(gruppe.punkte);
  if (!ziel) return;
  // Reduced Motion (§5): springen statt fahren.
  if (reducedMotion) karte.current?.setNativeProps({ region: ziel });
  else karte.current?.animateToRegion(ziel, motion.duration.base);
};
```

- [ ] **Schritt 4: Laufen lassen**

Run: `cd mobile && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): Gruppen statt Nadelhaufen, Tipp zoomt hinein"
```

---

### Task 8: Das Moment-Sheet und der Sprung in den Player

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/karte.tsx`
- Modify: `mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx`

**Interfaces:**
- Consumes: `Sheet` aus `@/components/Sheet`

- [ ] **Schritt 1: Test schreiben**

```ts
test('ein Tipp auf eine einzelne Nadel zeigt den Moment', async () => {
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('Angekommen, 28 Grad im Mai')).toBeTruthy();
  expect(screen.getByText('Mira · 14:32')).toBeTruthy();
});

// Der wichtigste Test dieses Plans: `start` ist ein INDEX in die sortierte
// Gesamtliste. Zeigt er auf den falschen Wert, startet der Player beim
// falschen Moment — und niemand merkt es, ausser er zaehlt nach.
test('«Im Recap ansehen» startet den Player bei genau diesem Moment', async () => {
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByTestId('karte-nadel-p3'));
  await fireEvent.press(screen.getByText('Im Recap ansehen'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '2' },
  });
});

test('das Sheet schliesst, ohne den Screen zu verlassen', async () => {
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  await fireEvent.press(screen.getByLabelText('Schliessen'));
  expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

- [ ] **Schritt 2b: Der Ausweg für Gruppen, die sich nicht auflösen lassen**

Task 7 hat eine Sackgasse gefunden: zwei Momente auf derselben Koordinate
fallen durch keinen Zoom auseinander — der Ausschnitt hat eine Mindestspanne
von rund 1,1 km. Wer so eine Gruppe antippt, tippt ins Leere.

```ts
test('eine Gruppe, die sich nicht aufzoomen laesst, oeffnet doch ein Sheet', async () => {
  // Zwei Momente auf exakt derselben Koordinate.
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(screen.getByText('2 Momente an diesem Ort')).toBeTruthy();
  expect(screen.getAllByTestId(/^gruppe-eintrag/)).toHaveLength(2);
});

test('eine Gruppe, die sich aufzoomen laesst, oeffnet KEIN Sheet', async () => {
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByTestId('karte-nadel-p3'));
  expect(screen.queryByText(/an diesem Ort/)).toBeNull();
});
```

Die Regel bleibt: erst zoomen, Sheet nur, wenn Zoomen nichts mehr ausrichtet.
Wie «lässt sich nicht auflösen» festgestellt wird, entscheidet der Implementer —
naheliegend ist ein Vergleich des Zielausschnitts mit der Mindestspanne aus
`ausschnitt.ts`. Jeder Eintrag im Sheet führt über denselben Index-Weg in den
Player wie ein einzelner Moment.

- [ ] **Schritt 3: Sheet implementieren**

Aufbau nach Spec §5.7. Der Sprung:

```tsx
const zumPlayer = (punkt: KartenPunkt) => {
  router.push({
    pathname: '/recap/[id]/player',
    params: { id, start: String(punkt.index) },
  });
};
```

`punkt.index` kommt aus `zuKartenPunkten` und zählt über die **Spielliste**,
die Task 5 vorher filtert — dieselbe, die der Player aufbaut. Nie den Index
innerhalb von `punkte` verwenden: der überspringt die Momente ohne Ort.

Uhrzeit über dieselbe Formatierung wie im Player (`captured_at` in
`captured_tz`), nicht über eine zweite eigene.

- [ ] **Schritt 4: Laufen lassen**

Run: `cd mobile && npx jest && npx tsc --noEmit`

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): Moment-Sheet mit dem Weg in den Player"
```

---

### Task 9: Der Tagesfilter

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/karte.tsx`
- Modify: `mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx`

**Interfaces:**
- Consumes: `gruppiereNachTagen` (oder wie die Funktion in
  `@/features/recap/tage` tatsächlich heisst — vor der Umsetzung dort
  nachsehen, NICHT raten)

- [ ] **Schritt 1: Test schreiben**

```ts
test('der Filter zeigt zunaechst alle Tage', async () => {
  await wrap(<RecapKarte />);
  expect(await screen.findByText('Alle Tage')).toBeTruthy();
});

test('ein gewaehlter Tag duennt die Nadeln aus', async () => {
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByText('Alle Tage'));
  await fireEvent.press(screen.getByText('Tag 2'));
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(1);
  expect(screen.getByText('Tag 2')).toBeTruthy();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

- [ ] **Schritt 3: Filter implementieren**

Pille oben rechts (`top: oben`, `right: spacing.screen`) mit dem aktuellen
Stand. Ein Tipp öffnet ein `Sheet` mit «Alle Tage» und je einem Eintrag pro
Reisetag. Der gewählte Tag filtert `punkte` **vor** Gruppierung und Linie; der
Ausschnitt wird auf die gefilterten Punkte neu gesetzt (mit derselben
Reduced-Motion-Weiche wie in Task 7).

Der Tagesfilter ändert `punkt.index` NICHT — der zeigt weiterhin in die
ungefilterte Spielliste, sonst startet der Player falsch.

- [ ] **Schritt 4: Laufen lassen**

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): Tagesfilter fuer Nadeln und Linie"
```

---

### Task 10: Momente ohne Ort und der leere Fall

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/karte.tsx`
- Modify: `mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx`

- [ ] **Schritt 1: Test schreiben**

```ts
test('die Leiste nennt die Momente ohne Ort', async () => {
  await wrap(<RecapKarte />);
  expect(await screen.findByText('3 Momente ohne Ort')).toBeTruthy();
});

test('ein einzelner Moment ohne Ort steht im Singular', async () => {
  // fetchRecapMomente liefert genau einen Moment ohne lat/lng
  await wrap(<RecapKarte />);
  expect(await screen.findByText('1 Moment ohne Ort')).toBeTruthy();
});

test('ohne solche Momente gibt es keine Leiste', async () => {
  await wrap(<RecapKarte />);
  expect(screen.queryByText(/ohne Ort/)).toBeNull();
});

test('aus dem Sheet fuehrt der Weg in den Player', async () => {
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByText('3 Momente ohne Ort'));
  await fireEvent.press(screen.getByTestId('ohne-ort-kachel-p9'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player',
    params: { id: 't1', start: '8' },
  });
});

// Kein leerer Kartenausschnitt ueber dem Atlantik (Spec K9).
test('hat kein Moment einen Ort, erklaert der Screen das', async () => {
  await wrap(<RecapKarte />);
  expect(await screen.findByText('Diese Reise hat keine Orte')).toBeTruthy();
  expect(screen.queryByTestId(/^karte-nadel/)).toBeNull();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

- [ ] **Schritt 3: Implementieren**

Leiste unten, Text exakt `${n} ${n === 1 ? 'Moment' : 'Momente'} ohne Ort`.
Ein Tipp öffnet ein Sheet mit derselben Kachel-Liste wie in der Übersicht;
jede Kachel trägt `testID={`ohne-ort-kachel-${moment.id}`}` und springt über
denselben Index-Weg in den Player.

Leer-Zustand (`punkte.length === 0`) nach Spec §5.9: Überschrift, Erklärung,
genau ein Knopf «Zurück zur Übersicht». Keine Karte rendern.

- [ ] **Schritt 4: Laufen lassen**

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): Momente ohne Ort bleiben erreichbar, leere Reise erklaert sich"
```

---

### Task 11: Der Einstieg — und nur nach dem Reveal

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/uebersicht.tsx`
- Modify: `mobile/src/app/(tabs)/recap/__tests__/uebersicht.test.tsx`

- [ ] **Schritt 1: Test schreiben**

```ts
test('die Uebersicht bietet die Karte an', async () => {
  await wrap(<RecapUebersicht />);
  expect(await screen.findByText('Auf der Karte')).toBeTruthy();
});

test('ein Tipp fuehrt zur Karte', async () => {
  await wrap(<RecapUebersicht />);
  await fireEvent.press(await screen.findByText('Auf der Karte'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/karte',
    params: { id: 't1' },
  });
});

// Spec K10: eine Karte der laufenden Reise wuerde verraten, wo die anderen
// gerade sind — genau das, was die Versiegelung verhindert.
test('eine versiegelte Reise bietet keine Karte an', async () => {
  (fetchTrip as jest.Mock).mockResolvedValueOnce({
    data: { ...trip, status: 'active' }, error: null,
  });
  await wrap(<RecapUebersicht />);
  expect(screen.queryByText('Auf der Karte')).toBeNull();
});

test('eine archivierte Reise bietet die Karte weiterhin an', async () => {
  (fetchTrip as jest.Mock).mockResolvedValueOnce({
    data: { ...trip, status: 'archived' }, error: null,
  });
  await wrap(<RecapUebersicht />);
  expect(await screen.findByText('Auf der Karte')).toBeTruthy();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

- [ ] **Schritt 3: Segment-Zeile implementieren**

Zwei Pillen direkt unter dem Kopf: «Nach Tagen» (aktiv, `text-1` auf `bg-1`)
und «Auf der Karte» (`text-2` auf `bg-0`, Hairline). Radius 999.
Press-Feedback über `PressScale` (§5, nie Opacity-Dimmen).

Bedingung: `trip.status !== 'active'`.

- [ ] **Schritt 4: Laufen lassen**

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): Einstieg in der Uebersicht, gesperrt vor dem Reveal"
```

---

### Task 12: Reduced Motion und die Design-Checkliste

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/karte.tsx`
- Modify: `mobile/src/app/(tabs)/recap/__tests__/karte.test.tsx`

- [ ] **Schritt 1: Test schreiben**

```ts
test('mit Reduced Motion springt die Karte, statt zu fahren', async () => {
  mockReduziert = true;
  await wrap(<RecapKarte />);
  await fireEvent.press(await screen.findByTestId('karte-nadel-p1'));
  expect(animateToRegion).not.toHaveBeenCalled();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestätigen**

- [ ] **Schritt 3: Alle Kamerabewegungen über eine Stelle führen**

Eine einzige Funktion `zeige(ausschnitt: Ausschnitt)` im Screen, die die
Reduced-Motion-Weiche kennt; alle Aufrufer (Erststart, Gruppen-Zoom,
Tagesfilter) gehen darüber. Zwei Wege würden garantiert auseinanderlaufen.

- [ ] **Schritt 4: DESIGN-LANGUAGE §9 durchgehen**

Die Checkliste aus §9 Punkt für Punkt am Kartenscreen und an `KartenNadel`
abhaken. Besonders zu prüfen:

- Kein Blau, Violett, Türkis in der eigenen UI. Die Kartenkacheln bringen ihre
  Farben mit — das ist die eine erlaubte Ausnahme (Spec R2) und gilt NICHT für
  Nadeln, Pillen, Sheet oder Knöpfe.
- Genau ein Primär-Button im Moment-Sheet.
- Alle Radien ∈ {12, 24, 999}, alle Abstände aus dem 4er-Raster.
- Kein festes Hex im Code ausser der translucenten Pille aus §1.
- Copy: «Moment», nie «Marker» oder «Pin»; Du-Form; sentence case.

- [ ] **Schritt 5: Laufen lassen**

Run: `cd mobile && npx jest && npx tsc --noEmit`

- [ ] **Schritt 6: Commit**

```bash
git commit -- mobile/src/app/\(tabs\)/recap \
  -m "feat(karte): eine Stelle fuer alle Kamerafahrten, Reduced Motion respektiert"
```

---

### Task 13: `share-link` gibt Koordinaten mit aus

**Files:**
- Modify: `supabase/functions/share-link/store.ts`
- Modify: `supabase/functions/share-link/aufloesung.ts`
- Modify: `supabase/functions/share-link/aufloesung_test.ts`

**Interfaces:**
- Produces: `OeffentlicherMoment.lat: number | null`, `.lng: number | null` —
  Task 15 liest genau diese Felder.

Dies ist der einzige Weg, auf dem Koordinaten an Menschen ohne Konto gelangen
(Spec R4). Die Function laeuft mit `verify_jwt = false`; ihre Ablehnung ist die
einzige Sperre.

- [ ] **Schritt 1: Deno-Tests schreiben**

In `supabase/functions/share-link/aufloesung_test.ts` bei den bestehenden
`baueMedien`-Tests:

```ts
Deno.test('baueMedien reicht lat und lng durch', async () => {
  const [moment] = await baueMedien(
    [{ ...zeile, lat: 38.7139, lng: -9.1301 }],
    async (key) => `https://signiert/${key}`,
  );
  assertEquals(moment.lat, 38.7139);
  assertEquals(moment.lng, -9.1301);
});

// Der Normalfall, nicht der Sonderfall: ortBestimmen() liefert bewusst null,
// wenn die Ortungsdienste nicht erlaubt sind.
Deno.test('ein Moment ohne Ort behaelt null, statt zu verschwinden', async () => {
  const [moment] = await baueMedien(
    [{ ...zeile, lat: null, lng: null }],
    async (key) => `https://signiert/${key}`,
  );
  assertEquals(moment.lat, null);
  assertEquals(moment.lng, null);
});
```

Und bei den `beurteileToken`-Tests eine Aussage zu K15 — sie prueft keine neue
Logik, sondern nagelt fest, dass der Widerruf VOR dem Bauen der Antwort greift
und es also gar keinen Pfad gibt, auf dem Koordinaten einen toten Link
verlassen:

```ts
Deno.test('ein widerrufener Link kommt nie bis zu den Koordinaten', () => {
  const urteil = beurteileToken({ ...linkZeile, revoked: true }, JETZT);
  assertEquals(urteil.erlaubt, false);
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestaetigen**

Run: `cd supabase/functions && deno test --allow-env share-link/`
Expected: FAIL — `lat` existiert auf `OeffentlicherMoment` nicht.

- [ ] **Schritt 3: Typen erweitern**

In `aufloesung.ts`, in `MomentZeile` nach `place_name`:

```ts
  place_name: string | null;
  // Seit Phase 7 Teil der oeffentlichen Antwort (Spec R4, Entscheid des
  // Users): der geteilte Recap zeigt dieselbe Karte wie die App. Das ist der
  // einzige Weg, auf dem Koordinaten an Menschen ohne Konto gelangen.
  lat: number | null;
  lng: number | null;
```

Dasselbe Paar in `OeffentlicherMoment`. Der Kommentar ueber dem Typ nennt
«genau die zehn Felder aus dem Interface-Vertrag» — daraus werden zwoelf, der
Kommentar wird mitgezogen.

- [ ] **Schritt 4: Projektion und Abfrage erweitern**

In `baueMedien`, in der Projektion nach `place_name: zeile.place_name,`:

```ts
        lat: zeile.lat,
        lng: zeile.lng,
```

In `store.ts` in `holeMomenteSeite` die Select-Liste — der lange Kommentar
ueber der Abfrage bleibt unveraendert stehen, insbesondere die Begruendung des
Fremdschluesselnamens:

```ts
  'id, type, media_ext, storage_key, thumb_key, captured_at, captured_tz, place_name, lat, lng, caption, duration_s, profiles!posts_author_id_fkey(display_name)',
```

und in der `map`-Projektion darunter dieselben zwei Zeilen.

- [ ] **Schritt 5: Laufen lassen**

Run: `cd supabase/functions && deno test --allow-env share-link/`
Expected: PASS.

- [ ] **Schritt 6: Gegen den laufenden Stack pruefen**

```bash
supabase functions serve --env-file supabase/functions/.env &
TOKEN=$(docker exec supabase_db_reelive psql -U postgres -d postgres -tAc \
  "select token from public.share_links where revoked = false limit 1;" | tr -d ' ')
curl -s -X POST http://127.0.0.1:54321/functions/v1/share-link \
  -H 'Content-Type: application/json' -d "{\"aktion\":\"aufloesen\",\"token\":\"$TOKEN\"}" \
  | python3 -c "import sys,json; m=json.load(sys.stdin)['medien']; print(len(m), [ (x['lat'], x['lng']) for x in m[:3] ])"
```
Expected: die Koordinaten stehen in der Antwort, `null` bei den Momenten ohne Ort.

- [ ] **Schritt 7: Commit**

```bash
git commit -- supabase/functions/share-link \
  -m "feat(karte): share-link gibt Koordinaten mit aus"
```

---

### Task 14: Die Kartenflaeche, zweimal — nativ und im Browser

**Files:**
- Create: `mobile/src/features/karte/KartenFlaeche.tsx`
- Create: `mobile/src/features/karte/KartenFlaeche.web.tsx`
- Test: `mobile/src/features/karte/__tests__/KartenFlaeche.test.tsx`
- Modify: `mobile/package.json`

**Interfaces:**
- Produces:

```ts
export type KartenFlaecheProps = {
  ausschnitt: Ausschnitt;
  gruppen: Gruppe[];
  linie: { latitude: number; longitude: number }[];
  thumbFuer: (postId: string) => string | null;
  aufGruppe: (gruppe: Gruppe) => void;
  aufAusschnitt: (ausschnitt: Ausschnitt) => void;
  reducedMotion: boolean;
};
```

Der Plattform-Schalter ist derselbe, den Phase 6 dreimal benutzt: Metro waehlt
`*.web.tsx` im Web-Bundle und `*.tsx` sonst, ohne dass ein Aufrufer davon
weiss. Beide Fassungen halten denselben Vertrag — der Screen (Task 5–12) und
der geteilte Player (Task 15) benutzen dieselbe Komponente.

Dieser Task **extrahiert**, was die Tasks 5 bis 12 im Screen aufgebaut haben,
und stellt ihm einen Zwilling fuer den Browser zur Seite. Der Screen benutzt
danach `KartenFlaeche` statt `MapView` direkt; sein Verhalten aendert sich
nicht, und seine Tests aus Task 5–12 muessen unveraendert gruen bleiben — genau
das ist hier der Beweis, dass die Extraktion nichts verschoben hat.

- [ ] **Schritt 1: Abhaengigkeiten**

`react-native-maps` steht seit Task 5. Dazu kommt nur Leaflet fuer das
Web-Bundle:

```bash
cd mobile && npm install leaflet && npm install --save-dev @types/leaflet
```

- [ ] **Schritt 2: Test schreiben**

Der Test laeuft gegen die NATIVE Fassung (jest-expo aufloest `.tsx`), prueft
also den Vertrag, nicht Leaflet:

```tsx
test('setzt eine Nadel je Gruppe', async () => {
  await wrap(<KartenFlaeche {...basis} gruppen={[gruppeA, gruppeB]} />);
  expect(screen.getAllByTestId(/^karte-nadel/)).toHaveLength(2);
});

test('meldet den Tipp auf eine Gruppe nach oben', async () => {
  const aufGruppe = jest.fn();
  await wrap(<KartenFlaeche {...basis} gruppen={[gruppeA]} aufGruppe={aufGruppe} />);
  await fireEvent.press(screen.getByTestId(`karte-nadel-${gruppeA.anker.moment.id}`));
  expect(aufGruppe).toHaveBeenCalledWith(gruppeA);
});
```

- [ ] **Schritt 3: Laufen lassen, Fehlschlag bestaetigen**

- [ ] **Schritt 4: Native Fassung**

`MapView` + `Marker` je Gruppe (mit `KartenNadel` aus Task 6) + `Polyline`.
`tracksViewChanges` wie in Task 6 beschrieben. `onRegionChangeComplete` ruft
`aufAusschnitt`.

- [ ] **Schritt 5: Web-Fassung**

Leaflet imperativ an einem `div`-Ref. In einer `.web.tsx`-Datei sind echte
DOM-Elemente erlaubt — React Native Web rendert ohnehin ins DOM.

Verbindlich:

- Kacheln von `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Namensnennung ist Pflicht** (K14): `attribution: '© OpenStreetMap'` — die
  Lizenz der Kacheln verlangt sie, und Leaflet blendet sie nur ein, wenn sie
  gesetzt ist. Nicht wegoptimieren.
- Nadeln als `L.divIcon` mit demselben runden Thumbnail wie nativ
- `map.on('moveend', …)` ruft `aufAusschnitt`
- Kamerafahrten ueber `map.flyTo` bzw. `map.setView` je nach `reducedMotion`
- Leaflets CSS muss mit ins Bundle (`import 'leaflet/dist/leaflet.css'`),
  sonst liegen die Kacheln als ungeordneter Bilderstapel uebereinander

- [ ] **Schritt 6: Laufen lassen**

Run: `cd mobile && npx jest && npx tsc --noEmit`

- [ ] **Schritt 7: Commit**

```bash
git commit -- mobile/src/features/karte mobile/package.json mobile/package-lock.json \
  -m "feat(karte): Kartenflaeche nativ und im Browser hinter einem Vertrag"
```

---

### Task 15: Die Karte im geteilten Recap

**Files:**
- Modify: `mobile/src/app/teilen/[token].tsx`
- Modify: `mobile/src/app/teilen/__tests__/*.test.tsx`

- [ ] **Schritt 1: Tests schreiben**

```ts
test('der geteilte Recap bietet die Karte an', async () => {
  await wrap(<GeteilterRecap />);
  expect(await screen.findByText('Auf der Karte')).toBeTruthy();
});

test('die Karte zeigt die Momente mit Ort', async () => {
  await wrap(<GeteilterRecap />);
  await fireEvent.press(await screen.findByText('Auf der Karte'));
  expect(await screen.findAllByTestId(/^karte-nadel/)).toHaveLength(2);
});

// Der Knopf heisst hier anders und fuehrt woanders hin: es gibt keinen
// Recap-Player der App, sondern den geteilten Player auf derselben Seite.
test('«Ab hier ansehen» springt im geteilten Player an die Stelle', async () => {
  await wrap(<GeteilterRecap />);
  await fireEvent.press(await screen.findByText('Auf der Karte'));
  await fireEvent.press(screen.getByTestId('karte-nadel-p3'));
  await fireEvent.press(screen.getByText('Ab hier ansehen'));
  expect(screen.getByTestId('teilen-player')).toBeTruthy();
  expect(screen.getByText('Fado im Hinterhof')).toBeTruthy();
});

test('ohne einen einzigen Ort gibt es keinen Karten-Einstieg', async () => {
  await wrap(<GeteilterRecap />);
  expect(screen.queryByText('Auf der Karte')).toBeNull();
});
```

- [ ] **Schritt 2: Laufen lassen, Fehlschlag bestaetigen**

- [ ] **Schritt 3: Umsetzen**

Segment-Zeile «Ansehen · Auf der Karte» ueber dem Player; die Karte ersetzt
den Player im selben Screen, statt zu navigieren (die Seite hat keine zweite
Route und soll auch keine bekommen — ein geteilter Link ist EINE URL).

Kein Tagesfilter (Spec §5.10). Der Sprung setzt den Index des geteilten
Players, nicht `router.push`.

- [ ] **Schritt 4: Laufen lassen**

Run: `cd mobile && npx jest && npx tsc --noEmit`

- [ ] **Schritt 5: Commit**

```bash
git commit -- mobile/src/app/teilen \
  -m "feat(karte): Karte im geteilten Recap"
```

---

### Task 16: Verifikation am laufenden System

**Files:** keine — dieser Task schreibt einen Bericht, keinen Code.

Das ist der Task, an dem Phase 5 gescheitert ist: alle Tests waren grün, und
der Recap lud trotzdem keinen einzigen Moment, weil jeder Test den
Supabase-Client mockt. Was hier nicht wirklich am laufenden Stack gedrückt
wurde, gilt als ungeprüft.

- [ ] **Schritt 1: Stack hochfahren**

```bash
npx supabase start
npx supabase db reset --local     # leert den Bucket!
# Testmedien neu hochladen (siehe README «Testdaten»)
cd mobile && npx expo start --lan
```

- [ ] **Schritt 2: Am Simulator durchspielen**

`react-native-maps` läuft in Expo Go (Spec R1) — es braucht keinen Dev-Build.

Prüfen und je einen Screenshot ablegen:

1. Lissabon-Recap öffnen → Segment-Zeile ist da
2. «Auf der Karte» → alle Nadeln sichtbar, ohne zu zoomen (K2)
3. Die Linie verbindet die Momente in Aufnahmereihenfolge (K3)
4. Eine Gruppe antippen → sie fällt auseinander (K7)
5. Eine einzelne Nadel antippen → Sheet mit Bild, Autor, Zeit, Caption (K4)
6. «Im Recap ansehen» → Player startet bei genau diesem Moment (K5) —
   **nachzählen**, nicht danebenliegen lassen
7. Tagesfilter auf Tag 2 → Nadeln und Linie dünnen aus (K8)
8. «3 Momente ohne Ort» → Sheet, Kachel antippen, Player startet richtig (K6)
9. Norwegen (laufend) öffnen → keine Segment-Zeile (K10)

- [ ] **Schritt 2b: Den geteilten Recap prüfen** (Entscheid R4)

Nativ per Deep Link und im Browser, mit einem frischen Token:

10. `exp://<LAN-IP>:8081/--/teilen/<token>` → «Auf der Karte» ist da
11. Karte zeigt dieselben Nadeln wie in der App (K13)
12. «Ab hier ansehen» springt im geteilten Player an die Stelle
13. Im Browser (`http://127.0.0.1:8081/teilen/<token>`): Leaflet-Karte lädt
    Kacheln, **die Namensnennung «© OpenStreetMap» ist sichtbar** (K14)
14. Link widerrufen, Seite neu laden → Ablehnung, keine Koordinaten in der
    Antwort (K15) — mit `curl` gegenprüfen, nicht nur im UI

- [ ] **Schritt 3: Gegenprobe in der Datenbank**

```bash
docker exec supabase_db_reelive psql -U postgres -d postgres -c \
  "select count(*) filter (where lat is not null) as mit_ort,
          count(*) filter (where lat is null)     as ohne_ort
     from public.posts where trip_id = 'aaaaaaaa-0000-4000-8000-000000000002';"
```

Die Zahl der Nadeln plus die Zahl in der Leiste muss die Summe ergeben. Weicht
sie ab, ist ein Moment unterwegs verloren gegangen.

- [ ] **Schritt 4: Bericht schreiben**

Was geprüft wurde, was funktioniert, was nicht — mit Screenshots. Nicht
geprüfte Punkte ausdrücklich als ungeprüft benennen, nie stillschweigend
weglassen.

---

## Abdeckung der Versprechen (Spec §4)

| # | Versprechen | Task | Datei, die es hält |
|---|---|---|---|
| K1 | Nadel je Moment mit Ort | 1, 2, 5 | `kartenPunkte.ts`, `karte.tsx` |
| K2 | Ausschnitt zeigt alles | 3, 5 | `ausschnitt.ts` |
| K3 | Linie in `captured_at`-Reihenfolge | 2, 6 | `kartenPunkte.ts` (Sortierung), `karte.tsx` (Polyline) |
| K4 | Sheet zeigt den Moment | 8 | `karte.tsx` |
| K5 | Ein Knopf, richtiger Startpunkt | 2, 8 | `kartenPunkte.ts` (`index`), `karte.tsx` |
| K6 | Momente ohne Ort bleiben erreichbar | 2, 10 | `kartenPunkte.ts` (`ohneOrt`), `karte.tsx` |
| K7 | Gruppen statt Nadelhaufen | 4, 7 | `gruppierung.ts`, `karte.tsx` |
| K8 | Tagesfilter | 9 | `karte.tsx` |
| K9 | Leer-Zustand statt leerer Karte | 3, 10 | `ausschnitt.ts` (`null`), `karte.tsx` |
| K10 | Kein Einstieg vor dem Reveal | 11 | `uebersicht.tsx` |
| K11 | Design Language eingehalten | 6, 12 | `KartenNadel.tsx`, `karte.tsx` |
| K12 | Reduced Motion | 7, 12 | `karte.tsx` (`zeige`) |
| K13 | Karte im geteilten Recap | 13, 14, 15 | `store.ts`/`aufloesung.ts`, `KartenFlaeche.web.tsx`, `teilen/[token].tsx` |
| K14 | Namensnennung der Kacheln | 14 | `KartenFlaeche.web.tsx` |
| K15 | Widerrufener Link gibt keine Orte her | 13 | `aufloesung_test.ts` |

## Offene Punkte nach Phase 7

- **Google-Maps-API-Schlüssel für den Android-Store-Build** — braucht ein
  Google-Cloud-Konto und den SHA-1-Fingerabdruck des Signaturzertifikats.
  Gehört auf dieselbe Liste wie die übrigen Konten-Schritte aus Phase 6.
- Ort nachträglich setzen oder korrigieren (Spec §8).
- Karte über mehrere Reisen hinweg (Spec §8).
