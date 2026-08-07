# Phase 5 — Reveal & Recap: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Owner-Person schliesst die Reise ab, das Siegel bricht, und die Gruppe sieht zum
ersten Mal alle Momente — chronologisch nach Aufnahmezeit, nach Reisetagen gruppiert, mit
Reaktionen und Kommentaren.

**Architecture:** Der Statuswechsel und jede lesende Medien-URL entstehen ausschliesslich in
Edge Functions mit Service-Role; der Client hat auf `trips.status` gar kein Grant und bekommt
Signaturen nur für Schlüssel, die die Function selbst aus der Datenbank gelesen hat. In der App
liegt die Kernlogik (Sortierung, Tages-Gruppierung, Player-Zustandsmaschine, URL-Vorrat) in
reinen, netzfreien Modulen unter `mobile/src/features/recap/`; die Screens sind dünn.

**Tech Stack:** Expo SDK 57 / React Native 0.86, expo-router, TypeScript strict ·
Reanimated 4 + Gesture Handler · `expo-image` (Fotos, Vorladen), `expo-video` (Videos) ·
`expo-notifications` (neu) · Supabase Postgres + RLS, Deno Edge Functions, `aws4fetch`

## Spec

`docs/superpowers/specs/2026-08-08-phase-5-reveal-recap-design.md` — bei jedem Widerspruch
zwischen Plan und Spec gilt die Spec, und der Widerspruch wird gemeldet.

## Global Constraints

Diese gelten für **jeden** Task, auch wenn sie im Task-Text nicht wiederholt werden.

- **`DESIGN-LANGUAGE.md` ist verbindlich** und schlägt Framework-Defaults und eigenen Geschmack.
  Sie wird vor jeder UI-Arbeit gelesen. Besonders: Farben nur über Tokens aus
  `mobile/src/theme/tokens.ts`, nie feste Hex-Werte. Radius nur 12 / 24 / 999. Abstände nur aus
  4 · 8 · 12 · 16 · 24 · 32 · 48, Screen-Ränder 24. Genau ein Primär-Button pro Screen.
  Icons: Lucide, Outline, Stroke 1.75, nie gefüllt, nie Emoji als Icon.
- **Medien-Screens sind Kino** (`cinema`-Palette), alle anderen hell. Auf Bildinhalt liegt UI
  ausschliesslich als translucente Pille.
- **Motion:** nur `transform` und `opacity`. `linear` ist verboten (Ausnahme: Fortschritt, der
  reale Zeit abbildet — der Fortschrittsbalken des Players ist genau diese Ausnahme).
  `prefers-reduced-motion` wird respektiert (`useReducedMotion` aus `mobile/src/theme/`).
- **Copy:** Deutsch, Du-Form, sentence case. Vokabular: **Moment** (nie Post/Beitrag/Snap),
  **Reise** (nie Trip), **Filmrolle**, **versiegelt**, **Recap**, **einsenden** (nie posten/
  hochladen/teilen). Fehler erklären Ursache und Lösung, ohne Entschuldigung.
- **Sortierung von Momenten IMMER nach `captured_at` aufsteigend**, mit `id` als zweitem
  Kriterium für stabile Reihenfolge bei gleicher Sekunde. Nie nach `created_at`.
- **Schema-Änderungen nur über Migrationen** in `supabase/migrations/`; jede neue oder geänderte
  RLS-Policy bekommt pgTAP-Tests in `supabase/tests/`.
- **Neue Tabellen bekommen ihre Grants ausdrücklich.** `supabase/migrations/20260804090000_acl_baseline.sql`
  hat die Default-Privilegien für `anon` und `authenticated` abgeräumt — eine Migration ohne
  `grant` liefert eine Tabelle, die niemand benutzen kann.
- **Die Versiegelung ist serverseitig.** Kein Client-Code darf je die einzige Prüfung sein.
- TypeScript strict; `npx tsc --noEmit` muss sauber bleiben.
- Tests liegen co-located in `__tests__/` neben dem Code, Muster `<Name>.test.ts(x)`.
  `@testing-library/react-native` v14 ist **vollständig async**: jedes `render`, `fireEvent`,
  `act` und `unmount` wird `await`-et.
- **Kein Lint-Lauf.** Es ist keiner konfiguriert.

## Hinweis an alle Implementer

Die Code-Ausschnitte in diesem Plan sind **sorgfältig gemeint, aber nicht bewiesen** — sie sind
ohne laufendes System entstanden. In Phase 3 waren elf von elf gefundenen Mängeln Fehler in
genau solchen Ausschnitten, nicht in der Umsetzung. Behandle sie als Skizze und leite aus dem
Interface-Vertrag ab, was wirklich nötig ist. **Findest du einen Widerspruch, melde ihn, statt
ihn abzuschreiben.**

Dasselbe gilt für Auslassungen: wenn dein Task ein Versprechen aus Spec §4 berührt und der
Brief es nicht erwähnt, sag es.

## Ist-Zustand (nachgewiesen, nicht angenommen)

- `posts`-SELECT ist erlaubt für Mitglieder, wenn `trips.status in ('revealed','archived')`
  (`20260806120100_counts_and_archived.sql`). Vor dem Reveal liest niemand, auch nicht der Autor.
- `reactions`, `comments`, `reports` und ihre Policies existieren vollständig seit Phase 1
  (`20260803090500_social_rls.sql`) und hängen an `can_see_post(post_id)`.
- `can_see_post` prüft **nur** `status = 'revealed'` — nicht `'archived'`. Das ist der Fehler,
  den Task 1 behebt.
- `authenticated` hat auf `trips` ein Update-Grant nur für `(name, cover_key, start_date,
  end_date)`. `status`, `revealed_at`, `invite_code`, `plan` sind für den Client unschreibbar.
- `is_trip_member(trip_id, user_id)` liefert für Service-Role **immer `false`** (Oracle-Guard,
  `20260803090700`). Edge Functions lesen `trip_members` direkt.
- `media-urls` kennt heute `sign` und `confirm`, beide mit Body `{ aktion, post_id }`, Antwort
  bei Fehlern immer `{ fehler: "<deutscher Klartext>" }`. Schlüssel entstehen in
  `supabase/functions/media-urls/keys.ts` über `erwarteteSchluessel(tripId, postId, typ, mediaExt)`.
- Der Recap-Tab existiert als Platzhalter: `mobile/src/app/(tabs)/recap.tsx`.
- Es gibt **keine** Sheet-Komponente. `expo-blur` ist nicht installiert.
- `expo-notifications` ist **nicht** installiert.
- Vorhandene Komponenten: `Ausloeser`, `Avatar`/`AvatarGroup`, `Badge`, `Button`, `Card`, `Fab`,
  `Input`, `PressScale`, `TripCard`, `Versiegelung`.

## File Structure

**Server**

| Datei | Verantwortung |
|---|---|
| `supabase/migrations/20260808090000_push_tokens.sql` | Tabelle `push_tokens`, RLS, Grants |
| `supabase/migrations/20260808090100_can_see_post_archived.sql` | `can_see_post` auch für `'archived'` |
| `supabase/functions/reveal-trip/index.ts` | Statuswechsel, Owner-Prüfung, Idempotenz |
| `supabase/functions/reveal-trip/push.ts` | Expo-Push-Versand, Blöcke à 100, Ticket-Auswertung |
| `supabase/functions/media-urls/index.ts` | zusätzlich Aktion `lesen` |
| `supabase/tests/13_push_tokens_test.sql` | Grants und Policies der neuen Tabelle |
| `supabase/tests/14_reveal_regeln_test.sql` | Unschreibbarkeit von `status`, `can_see_post` im Archiv, Social-Sichtbarkeit |

**App**

| Datei | Verantwortung |
|---|---|
| `mobile/src/features/recap/types.ts` | `RecapMoment`, `RecapTag`, `MedienUrl`, `UrlVorrat` |
| `mobile/src/features/recap/recapApi.ts` | Momente laden, Reveal auslösen, Lese-URLs holen |
| `mobile/src/features/recap/tage.ts` | rein: sortieren, nach Tagen gruppieren, Ortsname je Tag |
| `mobile/src/features/recap/playerLogic.ts` | rein: Zustandsmaschine des Players |
| `mobile/src/features/recap/urlVorrat.ts` | Vorrat an Lese-URLs halten und erneuern |
| `mobile/src/features/recap/sozialApi.ts` | Reaktionen und Kommentare lesen/schreiben/löschen |
| `mobile/src/features/recap/gesehen.ts` | merkt, welche Reveal-Inszenierung schon lief |
| `mobile/src/features/push/pushApi.ts` | Berechtigung, Token, Registrierung |
| `mobile/src/components/Sheet.tsx` | Sheet von unten (§4) |
| `mobile/src/components/RevealInszenierung.tsx` | Siegel bricht auf, Gold-Funken |
| `mobile/src/components/Fortschrittsbalken.tsx` | segmentierter Fortschritt |
| `mobile/src/app/(tabs)/recap/_layout.tsx` | Stack für den Recap-Bereich |
| `mobile/src/app/(tabs)/recap/index.tsx` | Liste der Recaps (ersetzt `recap.tsx`) |
| `mobile/src/app/(tabs)/recap/[id]/player.tsx` | Story-Player |
| `mobile/src/app/(tabs)/recap/[id]/uebersicht.tsx` | Tages-Raster |
| `mobile/src/app/(tabs)/reise/[id]/index.tsx` | «Reise abschliessen» + Reveal-Entdeckung |

---

### Task 1: Migrationen — `push_tokens` und `can_see_post` im Archiv

**Files:**
- Create: `supabase/migrations/20260808090000_push_tokens.sql`
- Create: `supabase/migrations/20260808090100_can_see_post_archived.sql`
- Create: `supabase/tests/13_push_tokens_test.sql`
- Create: `supabase/tests/14_reveal_regeln_test.sql`

**Interfaces:**
- Produces: Tabelle `public.push_tokens (token text primary key, user_id uuid not null references
  public.profiles(id) on delete cascade, platform text not null check (platform in ('ios','android')),
  updated_at timestamptz not null default now())`, Index auf `(user_id)`.

**Kontext:** Der Primärschlüssel ist der **Token**, nicht `(user_id, token)`. Grund: dasselbe
Gerät kann den Account wechseln. Dann muss die Zeile der neuen Person gehören, statt doppelt zu
existieren — sonst bekäme die vorige Person weiterhin Pushes für Reisen, die sie nichts angehen.
Der Client schreibt darum mit `upsert` auf `token`.

- [ ] **Step 1: Migration `push_tokens` schreiben**

Enthält: Tabelle wie oben, `alter table … enable row level security`, vier Policies
(`select`, `insert`, `update`, `delete`) jeweils gebunden an `user_id = auth.uid()`, und
**ausdrückliche Grants** `grant select, insert, update, delete on public.push_tokens to authenticated;`
— `anon` bekommt nichts. Kommentar an der Tabelle, warum der Token der Primärschlüssel ist.

- [ ] **Step 2: Migration `can_see_post` schreiben**

`create or replace function public.can_see_post(...)` mit `t.status in ('revealed','archived')`
statt `t.status = 'revealed'`. Restliche Signatur, `security definer`, `set search_path` und
Grants **unverändert** aus `20260803090500_social_rls.sql` übernehmen. Ein Kommentar hält fest,
dass die Archiv-Erweiterung aus `20260806120100` hier nachgezogen wird.

- [ ] **Step 3: pgTAP für `push_tokens`**

`supabase/tests/13_push_tokens_test.sql`, Aufbau wie die bestehenden Dateien (`plan(n)`,
`pg_temp.login_as`, `pg_temp.as_anon`, `finish()`, `rollback`). Belegt:
1. Angemeldet: eigene Zeile anlegen gelingt.
2. Angemeldet: eine Zeile mit fremder `user_id` anlegen scheitert (`42501`).
3. Angemeldet: fremde Zeilen sind unsichtbar (`select count(*)` liefert nur eigene).
4. Angemeldet: fremde Zeile löschen bewirkt nichts.
5. `anon`: jeder Zugriff scheitert.
6. Upsert auf denselben Token durch eine **andere** Person übernimmt die Zeile.

- [ ] **Step 4: pgTAP für die Reveal-Regeln**

`supabase/tests/14_reveal_regeln_test.sql`. Belegt:
1. `authenticated` kann `trips.status` nicht schreiben (`update trips set status='revealed'`
   scheitert am fehlenden Spalten-Grant — **erwarteter SQLSTATE selbst ermitteln**, nicht raten).
2. Dasselbe für `revealed_at`.
3. Vor dem Reveal: Mitglied sieht keine Reaktionen und keine Kommentare zu einem Post der Reise.
4. Nach dem Reveal: Mitglied sieht sie und kann im eigenen Namen schreiben.
5. Nach dem Reveal: Nicht-Mitglied sieht nichts.
6. Bei `status='archived'`: Mitglied sieht Reaktionen und Kommentare **weiterhin** — das ist der
   Test, der ohne Step 2 fehlschlägt.

- [ ] **Step 5: `supabase db reset && supabase test db`**

Erwartet: alle Dateien grün, Gesamtzahl der Tests gestiegen.

- [ ] **Step 6: Commit**

---

### Task 2: Edge Function `reveal-trip`

**Files:**
- Create: `supabase/functions/reveal-trip/index.ts`
- Create: `supabase/functions/reveal-trip/push.ts`
- Create: `supabase/functions/reveal-trip/push_test.ts`
- Create: `supabase/functions/reveal-trip/deno.json` (Vorlage: `supabase/functions/media-urls/deno.json`)

**Interfaces:**
- Consumes: `push_tokens` aus Task 1.
- Produces: `POST /functions/v1/reveal-trip` mit Body `{ trip_id: string }`.
  Antwort 200 `{ ok: true, revealed_at: string }`, Fehler `{ fehler: "<deutscher Klartext>" }`
  mit passendem Status. Fehlerformat und Aufbau von `supabase/functions/media-urls/index.ts`
  übernehmen (dieselben `json()`/`fehler()`-Helfer, JWT nur aus dem Header).

**Kontext:** Diese Function ist der einzige Weg, wie eine Reise je den Status wechselt.

- [ ] **Step 1: Grundgerüst mit Berechtigungsprüfung**

Reihenfolge der Prüfungen:
1. JWT aus dem `Authorization`-Header, `supabaseAdmin.auth.getUser(token)`. Kein Body-Token.
2. `trips`-Zeile per Service-Role lesen (`id, name, owner_id, status, revealed_at`).
   Nicht gefunden → 404.
3. `owner_id !== anfragendeId` → 403 «Nur wer die Reise angelegt hat, kann sie abschliessen.»
4. `status === 'revealed'` → **200 mit dem bestehenden `revealed_at`** (idempotent).
5. `status === 'archived'` → 409 «Diese Reise ist schon archiviert.»

- [ ] **Step 2: Statuswechsel atomar**

Ein einziges `update trips set status='revealed', revealed_at=now() where id=… and status='active'`
mit `.select('revealed_at').maybeSingle()`. Liefert es keine Zeile, hat ein paralleler Aufruf
gewonnen — dann die Zeile neu lesen und deren `revealed_at` zurückgeben, **nicht** fehlschlagen.

Warum `now()` in der Datenbank und nicht in Deno: die Nachzügler-Regel aus Phase 1 vergleicht
`captured_at <= revealed_at`. Beide Werte müssen aus derselben Uhr kommen.

- [ ] **Step 3: `push.ts` — reiner Versand-Baustein**

Exportiert mindestens:
```ts
export type PushNachricht = { to: string; title: string; body: string; data: Record<string, unknown> };
export function inBloecke<T>(items: T[], groesse: number): T[][];
export function tokensZumLoeschen(tickets: unknown, tokens: string[]): string[];
export async function sende(nachrichten: PushNachricht[], fetchImpl?: typeof fetch): Promise<string[]>;
```
`sende` postet an `https://exp.host/--/api/v2/push/send`, höchstens **100** Nachrichten pro
Anfrage, Header `accept: application/json`, `content-type: application/json`. Sie gibt die Tokens
zurück, deren Ticket `status: "error"` mit `details.error === "DeviceNotRegistered"` meldet.
`fetchImpl` ist der Einstiegspunkt für den Test — kein Netz im Test.

- [ ] **Step 4: `push_test.ts`**

Deno-Tests (Muster: `supabase/functions/media-urls/keys_test.ts`) für: Blockbildung bei 0, 1,
100, 101 und 250 Einträgen; `tokensZumLoeschen` erkennt genau die `DeviceNotRegistered`-Tickets
und ignoriert andere Fehler; `sende` mit einem gefälschten `fetch` schickt zwei Anfragen für 150
Nachrichten.

- [ ] **Step 5: Versand einhängen**

Nach erfolgreichem Statuswechsel: alle `trip_members` der Reise ausser der auslösenden Person,
dazu deren `push_tokens`. Titel/Text: `✈️ Euer Recap von «<Reisename>» ist bereit!` —
**der Reisename wird eingesetzt, nicht der Platzhalter.** `data: { trip_id }`.
Zurückgemeldete Tokens werden gelöscht.

**Ein Fehler beim Versand darf den Reveal nicht scheitern lassen.** Der Statuswechsel ist die
Wahrheit, die Benachrichtigung nur die Botschaft: `try/catch` um den ganzen Versand,
`console.error` im Fehlerfall, Antwort trotzdem 200.

- [ ] **Step 6: `deno check` auf beiden Dateien, `deno test push_test.ts`**

- [ ] **Step 7: Commit**

---

### Task 3: `media-urls` bekommt die Aktion `lesen`

**Files:**
- Modify: `supabase/functions/media-urls/index.ts`
- Create: `supabase/functions/media-urls/lesen_test.ts`

**Interfaces:**
- Produces: Body `{ aktion: 'lesen', trip_id: string }`.
  Antwort 200: `{ medien: Array<{ post_id: string; medium_url: string; thumb_url: string }>, gueltig_bis: string }`
  (`gueltig_bis` als ISO-8601). Fehler wie gehabt `{ fehler: … }`.

**Kontext:** Das ist der wichtigste Task der Phase (Spec §4, V1). Bis hier war die Versiegelung
dadurch geschützt, dass es keinen Leseweg gab.

- [ ] **Step 1: Prüfkette**

In dieser Reihenfolge, und keine Abkürzung:
1. JWT gültig (bestehender Weg).
2. `trips`-Zeile lesen. Nicht gefunden → 404.
3. `status in ('revealed','archived')` — sonst **403 «Diese Reise ist noch versiegelt.»**
4. Mitgliedschaft: direkte Abfrage auf `trip_members` mit Service-Role. Kein Mitglied → 403.
   **Nicht** `is_trip_member` benutzen: der Oracle-Guard liefert für Service-Role immer `false`
   (siehe Ist-Zustand).

- [ ] **Step 2: Schlüssel aus der Datenbank, nie aus dem Body**

Alle `posts` der Reise mit `upload_status = 'uploaded'` lesen (`id, storage_key, thumb_key`).
Für jeden eine presignte **GET**-URL herleiten. Die Gültigkeit ist **3600 Sekunden**; die
bestehende Konstante für Uploads (600 s) bleibt unverändert — zwei getrennte Werte, jeder mit
Kommentar, warum er so ist.

`thumb_key` kann `null` sein (die Spalte ist nullable). Dann entfällt `thumb_url` für diesen
Eintrag, statt eine URL auf `null` zu signieren.

- [ ] **Step 3: `lesen_test.ts`**

Integrationstest nach dem Muster von `confirm_integration_test.ts` (überspringt sich sauber,
wenn kein lokaler Stack läuft). Belegt:
1. Vor dem Reveal antwortet `lesen` mit 403 — **auch für die Autorin des Moments**.
2. Für ein Nicht-Mitglied 403.
3. Nach dem Reveal bekommt ein Mitglied URLs, und ein `GET` darauf liefert 200.
4. Ein `PUT` auf eine Lese-URL scheitert (SigV4 bindet die Methode).
5. Momente mit `upload_status='pending'` fehlen in der Antwort.

- [ ] **Step 4: `deno check`, Test laufen lassen, Commit**

---

### Task 4: Push-Registrierung in der App

**Files:**
- Create: `mobile/src/features/push/pushApi.ts`
- Create: `mobile/src/features/push/__tests__/pushApi.test.ts`
- Modify: `mobile/src/app/_layout.tsx`
- Modify: `mobile/package.json` (`expo-notifications`), `mobile/app.json` (Plugin/Berechtigungen)

**Interfaces:**
- Produces: `export async function registrierePushToken(userId: string): Promise<'ok'|'keine-berechtigung'|'nicht-unterstuetzt'|'fehler'>`

- [ ] **Step 1: `expo-notifications` installieren**

`npx expo install expo-notifications` aus `mobile/`. **Scheitert die Installation oder fehlt ein
Config-Plugin, melde BLOCKED statt zu improvisieren** — genau daran ist in Phase 4
`react-native-vision-camera` gescheitert.

- [ ] **Step 2: `pushApi.ts`**

Ablauf: Läuft die App auf einem echten Gerät (`expo-device`, ist installiert)? Berechtigung
erfragen, falls noch nicht entschieden. Token holen. Zeile in `push_tokens` per `upsert` auf
`token` schreiben, mit `user_id` und `platform`.

**Jeder Fehlschlag ist ein Normalfall, kein Fehler:** keine Berechtigung, Simulator, Expo Go —
die Funktion gibt den passenden Wert zurück, wirft nie und zeigt der Person nichts an. Expo Go
kann laut Expo-Doku gar keine Remote-Pushes empfangen; die App darf daran nicht sichtbar leiden.

- [ ] **Step 3: Tests**

Mit gefälschten Modulen: gibt `'keine-berechtigung'` zurück, wenn die Anfrage abgelehnt wird;
`'nicht-unterstuetzt'` ohne echtes Gerät; schreibt bei Erfolg genau eine Zeile mit `upsert` auf
`token`; wirft in **keinem** dieser Fälle.

- [ ] **Step 4: In `_layout.tsx` einhängen**

Bei `status === 'signedIn'` einmal aufrufen, ohne auf das Ergebnis zu warten und ohne das
Rendern zu blockieren. Vorbild ist der bestehende Start des Upload-Workers in derselben Datei.

- [ ] **Step 5: `npm test`, `npx tsc --noEmit`, Commit**

---

### Task 5: Recap-Daten und Tages-Gruppierung

**Files:**
- Create: `mobile/src/features/recap/types.ts`
- Create: `mobile/src/features/recap/recapApi.ts`
- Create: `mobile/src/features/recap/tage.ts`
- Create: `mobile/src/features/recap/__tests__/tage.test.ts`
- Create: `mobile/src/features/recap/__tests__/recapApi.test.ts`

**Interfaces:**
- Produces:
```ts
export type RecapMoment = {
  id: string; trip_id: string; author_id: string;
  type: 'photo' | 'video'; duration_s: number | null; caption: string | null;
  captured_at: string; captured_tz: string;
  place_name: string | null; upload_status: 'pending' | 'uploaded';
  autor_name: string;
};
export type RecapTag = { nummer: number; datum: string; ort: string | null; momente: RecapMoment[] };
// Für Task 12 hier mitdefiniert, damit beide Tasks dieselben Typen benutzen:
export type Reaktion = { post_id: string; user_id: string; emoji: string };
export type Kommentar = { id: string; post_id: string; user_id: string; text: string; created_at: string; autor_name: string };

// recapApi.ts
export async function fetchRecapMomente(tripId: string): Promise<Gelesen<RecapMoment[]>>;
export async function revealTrip(tripId: string): Promise<{ revealed_at: string | null; error: string | null }>;

// tage.ts — rein, kein Netz, kein React
export function sortiereMomente(momente: RecapMoment[]): RecapMoment[];
export function gruppiereNachTagen(momente: RecapMoment[], startDate: string): RecapTag[];
export function ortDesTages(momente: RecapMoment[]): string | null;
```
- Consumes: `Gelesen<T>` und den Fehlerstil aus `mobile/src/features/trips/tripsApi.ts`;
  `OFFLINE_HINT`/`istOffline` aus `mobile/src/lib/netzfehler.ts`.

**Kontext:** `tage.ts` ist die Kernlogik dieser Phase und wird netzfrei getestet.

- [ ] **Step 1: Tests für `tage.ts` zuerst**

Deckt ab:
- Sortierung nach `captured_at`; bei gleicher Sekunde entscheidet `id`, und das Ergebnis ist bei
  wiederholtem Sortieren identisch.
- Die Tagesnummer zählt ab `trips.start_date` als **Tag 1**. Ein Moment vor dem Startdatum
  (jemand hat schon auf der Anreise ausgelöst) bekommt Tag 1 und wird nicht verworfen.
- Die Tagesgrenze richtet sich nach `captured_tz` des Moments, nicht nach der Gerätezeitzone:
  ein Moment um 23:30 Ortszeit gehört zu diesem Tag, auch wenn das Gerät in einer anderen Zone
  steht. Zwei Momente in verschiedenen Zeitzonen am selben Ortstag dürfen nicht auseinanderfallen.
- `ortDesTages` liefert den häufigsten `place_name`; bei Gleichstand den des frühesten Moments;
  `null`, wenn alle leer sind.
- Leere Eingabe liefert eine leere Liste, keinen Fehler.

- [ ] **Step 2: `tage.ts` umsetzen, Tests grün**

- [ ] **Step 3: `recapApi.ts`**

`fetchRecapMomente` liest `posts` der Reise samt Autorennamen (`profiles`) — ein Aufruf, kein
N+1. Sortierung passiert über `tage.sortiereMomente`, nicht über die Datenbank allein, damit die
Stabilität bei Gleichstand nachweisbar bleibt.

`revealTrip` ruft die Edge Function aus Task 2 auf. Fehler werden zu deutschen Klartexten; ein
Netzfehler wird über `istOffline` erkannt und bekommt `OFFLINE_HINT`.

- [ ] **Step 4: Tests für `recapApi.ts`** (Supabase-Client gemockt)

- [ ] **Step 5: `npm test`, `npx tsc --noEmit`, Commit**

---

### Task 6: Vorrat an Lese-URLs

**Files:**
- Create: `mobile/src/features/recap/urlVorrat.ts`
- Create: `mobile/src/features/recap/__tests__/urlVorrat.test.ts`

**Interfaces:**
- Produces:
```ts
export type MedienUrl = { post_id: string; medium_url: string; thumb_url: string | null };
export type Vorrat = { urls: Map<string, MedienUrl>; gueltigBis: number };
export async function holeVorrat(tripId: string): Promise<{ vorrat: Vorrat | null; error: string | null }>;
export function laeuftBaldAb(vorrat: Vorrat, jetzt: number): boolean;
```

**Kontext:** Spec §7 und Versprechen V10. Eine abgelaufene URL darf den Recap nie beenden.

- [ ] **Step 1: Tests zuerst**

- `laeuftBaldAb` ist `true`, sobald weniger als **fünf Minuten** übrig sind, und `false` davor.
  Die Schwelle ist eine benannte Konstante, keine rohe Zahl im Vergleich.
- `holeVorrat` gibt bei Erfolg eine Zuordnung `post_id → URLs` zurück.
- Ein 403 der Function wird zu «Diese Reise ist noch versiegelt.» bzw. — wenn die Reise
  aufgedeckt ist — zum Hinweis auf die verlorene Mitgliedschaft. Beide Fälle sind unterscheidbar
  und werden getrennt getestet.
- Ein Netzfehler liefert `OFFLINE_HINT`.

- [ ] **Step 2: Umsetzen, Tests grün**

- [ ] **Step 3: Commit**

---

### Task 7: Zustandsmaschine des Players

**Files:**
- Create: `mobile/src/features/recap/playerLogic.ts`
- Create: `mobile/src/features/recap/__tests__/playerLogic.test.ts`

**Interfaces:**
- Produces:
```ts
export type PlayerStand = { index: number; pausiert: boolean; fortschritt: number };
export const FOTO_DAUER_MS: number;              // 5000
export function dauerFuer(m: RecapMoment): number;
export function weiter(stand: PlayerStand, anzahl: number): PlayerStand | 'ende';
export function zurueck(stand: PlayerStand): PlayerStand;
export function tagWechselt(momente: RecapMoment[], startDate: string, index: number): boolean;
```

**Kontext:** Rein, netzfrei, kein React. Das ist die Logik, die der Screen in Task 11 nur noch
bedient.

- [ ] **Step 1: Tests zuerst**

- `dauerFuer`: Foto → `FOTO_DAUER_MS`; Video → `duration_s * 1000`; Video ohne `duration_s`
  (die Spalte ist nullable) → ein benannter Rückfallwert, kein `NaN`.
- `weiter` am letzten Moment liefert `'ende'`, nicht Index `anzahl`.
- `zurueck` am ersten Moment bleibt bei Index 0 und setzt den Fortschritt zurück — es springt
  nicht in den vorherigen Tag hinaus.
- `zurueck` setzt `fortschritt` immer auf 0, auch mitten in einem Video.
- `tagWechselt` ist `true` genau beim ersten Moment eines neuen Tages und beim allerersten
  Moment überhaupt.
- Leere Liste: `weiter` liefert sofort `'ende'`.

- [ ] **Step 2: Umsetzen, Tests grün**

- [ ] **Step 3: Commit**

---

### Task 8: Sheet-Komponente und «Reise abschliessen»

**Files:**
- Create: `mobile/src/components/Sheet.tsx`
- Create: `mobile/src/components/__tests__/Sheet.test.tsx`
- Modify: `mobile/src/app/(tabs)/reise/[id]/index.tsx`
- Modify/Create: `mobile/src/app/(tabs)/reise/__tests__/detail.test.tsx`

**Interfaces:**
- Produces: `<Sheet sichtbar titel onSchliessen>{children}</Sheet>` — von unten, Radius 24 oben,
  Grabber, `shadow.s3`, öffnet per `spring-ui`, schliesst per Tipp auf den Hintergrund und per
  Wisch nach unten. `prefers-reduced-motion` → 200-ms-Fade.

**Kontext:** Es gibt heute keine Sheet-Komponente, DESIGN-LANGUAGE §4 beschreibt sie aber. Sie
wird hier und in Task 12 (Kommentare) gebraucht.

- [ ] **Step 1: `Sheet.tsx` mit Tests**

- [ ] **Step 2: Reveal-Auslöser im Reise-Detail**

Sichtbar **nur** für die Owner-Person und **nur** bei `status === 'active'`. Der einzige
Primär-Button des Screens — die bestehenden Buttons («Freunde einladen» usw.) werden dabei zu
Sekundär-Buttons, falls sie es noch nicht sind (DESIGN-LANGUAGE §7: genau ein Primär-Button).

Ab dem Enddatum rückt er nach oben, mit der Zeile «Eure Reise ist zu Ende. Zeit für den Recap.»
Davor steht er unten ohne Drängen.

- [ ] **Step 3: Bestätigungs-Sheet**

Titel «Reise abschliessen?», Text «Danach kann niemand mehr Momente einsenden, und alle sehen
den Recap. Das lässt sich nicht rückgängig machen.», Aktionen «Abschliessen» und «Abbrechen».
Haptik `warning` beim Öffnen.

Warten noch eigene Momente in der Warteschlange (`uploadWorker.wartende(tripId)` bzw.
`queueLogic.wartendeAnzahl` — die vorhandene Funktion benutzen, nicht neu bauen), kommt eine
beruhigende Zeile dazu: «Deine 3 wartenden Momente kommen noch durch — sie sind vor dem Reveal
entstanden.» Singular und Plural korrekt.

- [ ] **Step 4: Aufruf und Ergebnis**

`revealTrip` aus Task 5. Bei Erfolg: Reise neu laden, Inszenierung aus Task 9 auslösen.
Bei Fehler: Sheet bleibt offen, Ursache darunter, der Knopf bleibt bedienbar — die Function ist
idempotent, ein zweiter Versuch ist immer erlaubt.

- [ ] **Step 5: Tests** — Knopf fehlt für Mitglieder ohne Owner-Rolle; fehlt bei bereits
aufgedeckter Reise; Sheet zeigt die Wartenden-Zeile nur, wenn es welche gibt; ein Fehler lässt
den Knopf bedienbar.

- [ ] **Step 6: `npm test`, `npx tsc --noEmit`, Commit**

---

### Task 9: Reveal-Entdeckung und Inszenierung

**Files:**
- Create: `mobile/src/features/recap/gesehen.ts`
- Create: `mobile/src/features/recap/__tests__/gesehen.test.ts`
- Create: `mobile/src/components/RevealInszenierung.tsx`
- Create: `mobile/src/components/__tests__/RevealInszenierung.test.tsx`
- Modify: `mobile/src/app/(tabs)/reise/[id]/index.tsx`

**Interfaces:**
- Produces:
  `export async function revealGesehen(tripId: string): Promise<boolean>`,
  `export async function merkeRevealGesehen(tripId: string): Promise<void>` (AsyncStorage,
  Schlüsselmuster wie in `mobile/src/features/trips/tripsCache.ts`);
  `<RevealInszenierung sichtbar onFertig />`.

**Kontext:** Versprechen V6 und V9. Die zweite der beiden inszenierten Ausnahmen aus
DESIGN-LANGUAGE §5 — **Siegel bricht auf, Gold-Funken ✦ steigen, kein Konfetti.**

- [ ] **Step 1: `gesehen.ts` mit Tests**

- [ ] **Step 2: `RevealInszenierung.tsx`**

700–900 ms, `seal-glow` erlaubt, Haptik `success`, nur `transform` und `opacity`.
`useReducedMotion` → 200-ms-Fade. Vorbild für Aufbau und Testbarkeit ist die vorhandene
`Versiegelung.tsx`.

- [ ] **Step 3: Entdeckung im Reise-Detail**

Der Screen lädt beim Fokussieren ohnehin neu. Stellt er fest, dass `status !== 'active'` ist und
`revealGesehen(tripId)` `false` liefert, spielt er die Inszenierung, merkt sie und zeigt danach
«Recap starten» als Primär-Button.

**Das ist der Weg, der ohne Push funktionieren muss (V6).** Es darf keine Stelle geben, an der
der Recap nur über eine Benachrichtigung erreichbar ist.

- [ ] **Step 4: Tests** — Inszenierung läuft genau einmal; sie läuft auch, wenn nie ein Push
ankam; bei bereits gesehener Reise erscheint sofort «Recap starten».

- [ ] **Step 5: `npm test`, `npx tsc --noEmit`, Commit**

---

### Task 10: Recap-Tab und Übersicht

**Files:**
- Delete: `mobile/src/app/(tabs)/recap.tsx`
- Create: `mobile/src/app/(tabs)/recap/_layout.tsx`
- Create: `mobile/src/app/(tabs)/recap/index.tsx`
- Create: `mobile/src/app/(tabs)/recap/[id]/uebersicht.tsx`
- Create: `mobile/src/app/(tabs)/recap/__tests__/liste.test.tsx`
- Create: `mobile/src/app/(tabs)/recap/__tests__/uebersicht.test.tsx`

**Kontext:** Der Tab existiert heute als einzelne Platzhalter-Datei. Er wird ein Stack —
Vorbild ist `mobile/src/app/(tabs)/reise/_layout.tsx`. Expo Router findet ein Verzeichnis
`recap/` unter demselben Namen wie vorher die Datei `recap.tsx`; `(tabs)/_layout.tsx` sollte
darum unverändert bleiben. **Prüfe das nach** — bleibt der Tab leer oder doppelt, sag es, statt
den Screen woanders hin zu verdrahten.

- [ ] **Step 1: Stack und Liste**

Die Liste zeigt alle Reisen mit `status in ('revealed','archived')` als «entwickelte» Karten.
`TripCard` wird wiederverwendet, falls sie den Zustand tragen kann — sonst wird sie erweitert,
**nicht** kopiert. Leerer Zustand: «Noch kein Recap. Der erste kommt, sobald ihr eine Reise
abschliesst.»

- [ ] **Step 2: Übersichts-Screen**

Nach Tagen gruppierte Thumbnails im Raster (`gruppiereNachTagen` aus Task 5, Thumbnails über den
Vorrat aus Task 6, gerendert mit `expo-image`). Sektionskopf «Tag 3 · Lissabon · 12. August».
Tippen öffnet den Player an genau diesem Moment (Parameter in der Route).

Momente mit `upload_status='pending'` erscheinen nicht im Raster; stattdessen steht am Ende
«3 Momente werden noch hochgeladen».

- [ ] **Step 3: Tests** — Liste zeigt nur aufgedeckte und archivierte Reisen; leerer Zustand;
Raster gruppiert korrekt; ein Tipp übergibt den richtigen Startindex.

- [ ] **Step 4: `npm test`, `npx tsc --noEmit`, Commit**

---

### Task 11: Story-Player

**Files:**
- Create: `mobile/src/app/(tabs)/recap/[id]/player.tsx`
- Create: `mobile/src/components/Fortschrittsbalken.tsx`
- Create: `mobile/src/components/__tests__/Fortschrittsbalken.test.tsx`
- Create: `mobile/src/app/(tabs)/recap/__tests__/player.test.tsx`

**Interfaces:**
- Consumes: `playerLogic` (Task 7), `tage` und `recapApi` (Task 5), `urlVorrat` (Task 6).
- Produces: Route `/(tabs)/recap/[id]/player?start=<index>`.

**Kontext:** Das zweite Herzstück der App. Kino-Palette, der Übergang dorthin ist der
inszenierte Fade durch Dunkel («das Licht geht aus»).

- [ ] **Step 1: `Fortschrittsbalken.tsx`**

Ein Segment pro Moment, das aktive füllt sich in Echtzeit. **Hier ist `linear` erlaubt und
richtig** — der Balken bildet reale Zeit ab; DESIGN-LANGUAGE §5 nennt genau diese Ausnahme. Ein
Kommentar hält das fest, damit es niemand später «korrigiert».

- [ ] **Step 2: Gesten**

Tippen rechte Hälfte = weiter, linke Hälfte = zurück, Halten = Pause (und weiter beim Loslassen),
Wisch nach unten = schliessen. Gesture Handler ist installiert.

- [ ] **Step 3: Anzeige eines Moments**

Fotos mit `expo-image`, Videos mit `expo-video` direkt von der signierten URL. Overlays als
translucente Pillen: Avatar + Name, Uhrzeit (in `captured_tz` des Moments, nicht in Gerätezeit),
Ort, Caption falls vorhanden.

- [ ] **Step 4: Tages-Trenner**

Wechselt der Tag (`tagWechselt` aus Task 7), erscheint vor dem Moment eine Zwischenkarte
«Tag 3 · Lissabon · 12. August», 1,5 Sekunden, dann weiter. Tippen überspringt sie.

- [ ] **Step 5: Vorladen (V8)**

Die nächsten **drei** Fotos per `expo-image` vorladen. Beim Weitertippen darf nichts schwarz
blitzen.

- [ ] **Step 6: URL-Erneuerung (V10)**

Vor jedem Weiter prüfen, ob der Vorrat bald abläuft (`laeuftBaldAb`); dann im Hintergrund neu
holen, ohne den Player anzuhalten. Antwortet ein Medium mit 403, einmal neu holen und erneut
versuchen, bevor eine Meldung erscheint.

- [ ] **Step 7: Randfälle**

Reise ohne einen einzigen hochgeladenen Moment → «Diese Reise ist leer geblieben.», kein leerer
Player. Video lädt nicht → Thumbnail plus Hinweis, Weitertippen bleibt möglich. Am Ende:
Nachzügler-Zeile, falls es welche gibt, und ein Weg zurück in die Übersicht.

- [ ] **Step 8: Tests** — die Zustandsmaschine wird über den Screen bedient (weiter, zurück,
Ende); der Tages-Trenner erscheint an der richtigen Stelle; ein abgelaufener Vorrat wird erneuert
statt den Player zu beenden; die leere Reise zeigt ihren Text.

- [ ] **Step 9: `npm test`, `npx tsc --noEmit`, Commit**

---

### Task 12: Reaktionen und Kommentare

**Files:**
- Create: `mobile/src/features/recap/sozialApi.ts`
- Create: `mobile/src/features/recap/__tests__/sozialApi.test.ts`
- Modify: `mobile/src/app/(tabs)/recap/[id]/player.tsx`
- Modify: `mobile/src/app/(tabs)/recap/__tests__/player.test.tsx`

**Interfaces:**
- Produces:
```ts
export async function fetchReaktionen(postIds: string[]): Promise<Gelesen<Record<string, Reaktion[]>>>;
export async function setzeReaktion(postId: string, emoji: string): Promise<{ error: string | null }>;
export async function entferneReaktion(postId: string, emoji: string): Promise<{ error: string | null }>;
export async function fetchKommentare(postId: string): Promise<Gelesen<Kommentar[]>>;
export async function schreibeKommentar(postId: string, text: string): Promise<{ error: string | null }>;
```

**Kontext:** Tabellen, Policies und Grants stehen seit Phase 1. Hier entsteht **kein Schema**.
Die Emoji-Auswahl ist eine feste kleine Leiste — kein Emoji-Picker, kein neues Paket.

- [ ] **Step 1: `sozialApi.ts` mit Tests**

`fetchReaktionen` holt alle Reaktionen für eine Liste von Momenten in **einem** Aufruf.
`schreibeKommentar` prüft die Länge (1–500, wie der Datenbank-Check) vor dem Absenden.

- [ ] **Step 2: Emoji-Leiste im Player**

Am unteren Rand, translucente Pillen. Tippen setzt **optimistisch**: die Reaktion erscheint
sofort, ohne Wartespinner. Scheitert der Aufruf, verschwindet sie wieder und die Ursache steht
kurz da. Haptik `light`.

- [ ] **Step 3: Kommentar-Sheet**

Wisch nach oben öffnet das `Sheet` aus Task 8 mit den Kommentaren des Moments. **Der Player
pausiert, solange es offen ist**, und läuft danach weiter. Eingabefeld mit dem vorhandenen
`Input`.

- [ ] **Step 4: Reaktionen anderer**

Dezent auf dem Moment eingeblendet, nicht als Zählerbalken. Nur die Emojis, ohne Namen.

- [ ] **Step 5: Tests** — optimistisches Setzen und Zurücknehmen bei Fehler; der Player pausiert
bei offenem Sheet; ein zu langer Kommentar wird vor dem Absenden abgefangen.

- [ ] **Step 6: `npm test`, `npx tsc --noEmit`, Commit**

---

### Task 13: Verifikation am laufenden System

**Files:** keine — dieser Task prüft nur.

- [ ] **Step 1: Alles grün**

`supabase db reset && supabase test db`, dann aus `mobile/`: `npm test && npx tsc --noEmit`,
dazu `deno check` und die Deno-Tests der beiden Functions.

- [ ] **Step 2: Der Reveal serverseitig**

Mit `curl` gegen den lokalen Stack, beide Functions laufend:
1. `reveal-trip` als Mitglied ohne Owner-Rolle → 403.
2. Als Owner → 200 mit `revealed_at`.
3. Nochmal als Owner → wieder 200, gleiches `revealed_at` (Idempotenz).
4. `media-urls`/`lesen` **vor** dem Reveal auf einer anderen Reise → 403, auch als Autorin.
5. Nach dem Reveal → URLs, und ein `GET` darauf liefert 200 mit dem richtigen Content-Type.

- [ ] **Step 3: Der Recap in der App**

Anmelden, aufgedeckte Reise öffnen: Inszenierung läuft einmal. Recap durchtippen — Foto, Video,
Tages-Trenner, Zurücktippen, Halten pausiert, Wisch nach unten schliesst. Reagieren und
kommentieren. Übersicht öffnen und an eine Stelle springen.

- [ ] **Step 4: Die Randfälle**

Flugmodus im Player. Reise ohne Momente. Reise mit wartendem Nachzügler aufdecken und
beobachten, wie er nach dem Upload erscheint.

- [ ] **Step 5: Ergebnis festhalten**

Scheitert ein Schritt: Fehler beschreiben, Ursache suchen, korrigieren, den betroffenen
Task-Test ergänzen.

---

## Abdeckung der Versprechen (Spec §4)

| Versprechen | Task |
|---|---|
| V1 — vor dem Reveal liest niemand ein Medium | 3 (Prüfkette + Test), 13 (Step 2.4) |
| V2 — nach dem Reveal alle Momente nach `captured_at` | 5 (`sortiereMomente`), 11 |
| V3 — Reveal unumkehrbar, nur Owner, idempotent | 1 (Step 4.1/4.2), 2, 8, 13 (Step 2) |
| V4 — Nachzügler sortieren sich ein | 5, 10 (Step 2), 11 (Step 7), 13 (Step 4) |
| V5 — nach dem Reveal kein neuer Moment | 1 (Step 4) belegt die bestehende Regel erneut |
| V6 — Recap ohne Push erreichbar | 9 (Step 3), 4 (jeder Fehlschlag ist Normalfall) |
| V7 — Reaktionen nur für Mitglieder aufgedeckter Reisen | 1 (Step 4.3–4.6), 12 |
| V8 — Player flüssig, kein schwarzes Blitzen | 11 (Step 5) |
| V9 — Kino, inszenierter Übergang, Siegel mit Gold-Funken | 9, 10, 11 |
| V10 — abgelaufene URL beendet den Recap nicht | 6, 11 (Step 6) |

## Offene Punkte nach Phase 5

- Share-Link, schreibgeschützter Web-Player, Galerie-Export, Melden und Moderation,
  Account-Löschung — alles Phase 6.
- Die Reveal-Erinnerung ab Enddatum (braucht einen Scheduler) und Push bei Beitritten.
- Das Archivieren einer Reise durch die Owner-Person: `'archived'` existiert im Schema und wird
  überall unterstützt, aber niemand kann den Status setzen.
- Aus Phase 4 mitgenommen: der `useFocusEffect`-Mock in `liste.test.tsx` und `detail.test.tsx`
  feuert bei jedem Rendern und überlebt nur durch stabile Objekt-Referenzen; die Geräte-
  Verifikation von Phase 4 steht weiterhin aus.
