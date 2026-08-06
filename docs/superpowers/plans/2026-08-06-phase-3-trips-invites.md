# Phase 3 — Trips & Invites: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reisen entstehen in der App, und Freunde treten über einen Invite-Link bei — zwei echte Accounts teilen sich am Ende eine Reise.

**Architecture:** Der Beitritt läuft über zwei Postgres-Funktionen mit `security definer` (`peek_invite`, `redeem_invite`) statt über eine Edge Function, damit er in die bestehende pgTAP-Suite fällt. Die App bekommt einen Stack im Reise-Tab mit Liste, Erstellen/Bearbeiten, Detail und Einladen; der Beitritts-Screen liegt ausserhalb der Tabs, weil er auch ohne Session erreichbar sein muss. Sämtliche Supabase-Aufrufe leben in `tripsApi.ts` — Screens kennen kein `supabase`-Objekt.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / TypeScript strict, expo-router mit typedRoutes, Supabase (lokal via CLI), pgTAP, Jest + `@testing-library/react-native`, `expo-linking`, `react-native-qrcode-svg` (neu).

## Global Constraints

- **Design-Language ist verbindlich:** `DESIGN-LANGUAGE.md` schlägt Framework-Defaults und eigenen Geschmack. Vor jeder UI-Datei lesen.
- **Keine festen Hex-Werte in Komponenten** — ausschliesslich Tokens aus `@/theme/tokens` über `useTheme()`.
- **Radius nur 12 / 24 / 999** (`radius.control` / `radius.card` / `radius.pill`), Abstände nur aus `spacing`, Screen-Rand `spacing.screen` (24).
- **Genau ein Primär-Button pro Screen.**
- **Schatten nur aus `shadow.s1/s2/s3`**, nur für Schwebendes. Randlose Reise-Karten haben keinen Schatten.
- **Icons:** Lucide Outline, `strokeWidth={1.75}`, nie gefüllt, nie Emoji als Icon.
- **Copy:** Deutsch, Du-Form, sentence case. Vokabular: Moment, Reise, Filmrolle, versiegelt, Recap, einsenden. Nie: Post, Trip, Galerie, gesperrt.
- **Press-Feedback** immer über `PressScale`, nie Opacity-Dimmen.
- **TypeScript strict** — kein `any`, keine nicht-null-Assertions ohne Kommentar.
- **Router-Root ist `mobile/src/app/`** (nicht `mobile/app/`); `typedRoutes` ist aktiv.
- **RTL v14 ist voll async:** `await render(...)` UND `await fireEvent.*(...)`.
- **Schema-Änderungen nur über Migrationen** in `supabase/migrations/`; jede neue Policy/Funktion bekommt pgTAP-Tests in `supabase/tests/`.
- **Fehlermeldungen** nennen Ursache und Lösung, ohne Entschuldigung.
- Alle Tests laufen aus `mobile/` (`npm test`) bzw. dem Repo-Wurzelverzeichnis (`supabase test db`).

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `supabase/migrations/20260806120000_invites.sql` | `peek_invite`, `redeem_invite` |
| `supabase/migrations/20260806120100_counts_and_archived.sql` | `my_post_counts`, Lese-Policy um `archived` erweitern |
| `supabase/tests/09_invites_test.sql` | pgTAP für beide Invite-Funktionen |
| `supabase/tests/10_counts_archived_test.sql` | pgTAP für Zähler und `archived` |
| `mobile/src/features/trips/types.ts` | Gemeinsame Typen, von API und Screens genutzt |
| `mobile/src/features/trips/tripsApi.ts` | Alle Supabase-Aufrufe rund um Reisen |
| `mobile/src/features/trips/tripDay.ts` | Reisetag, Zeitraum-Validierung, Gruppierung aktiv/Recap |
| `mobile/src/features/trips/inviteLink.ts` | Invite-Link erzeugen, Code aus URL lesen, gemerkter Code |
| `mobile/src/components/Avatar.tsx` | Runder Avatar + überlappende Gruppe |
| `mobile/src/components/TripCard.tsx` | Randlose Reise-Karte |
| `mobile/src/components/Badge.tsx` | Pille (versiegelt / Recap / Momente-Zähler) |
| `mobile/src/components/Fab.tsx` | Schwebender Aktionsknopf |
| `mobile/src/app/(tabs)/reise/_layout.tsx` | Stack im Tab |
| `mobile/src/app/(tabs)/reise/index.tsx` | «Meine Reisen» |
| `mobile/src/app/(tabs)/reise/neu.tsx` | Reise erstellen |
| `mobile/src/app/(tabs)/reise/[id]/index.tsx` | Reise-Detail mit Mitgliedern |
| `mobile/src/app/(tabs)/reise/[id]/bearbeiten.tsx` | Name und Zeitraum ändern |
| `mobile/src/app/(tabs)/reise/[id]/einladen.tsx` | QR-Code + Link teilen |
| `mobile/src/app/join/[code].tsx` | Beitritt |
| `mobile/src/app/_layout.tsx` | Ergänzung: gemerkten Invite-Code nach dem Login einlösen |

**Reihenfolge und Parallelität:** Tasks 1–5 sind voneinander unabhängig (alle Signaturen stehen in diesem Plan und müssen nicht abgewartet werden). Task 6 muss vor 7–11 fertig sein, weil alle Screens dieselben Komponenten nutzen. Tasks 7–11 sind untereinander unabhängig. Task 12 kommt zum Schluss.

**Entscheidung Datumseingabe:** Beginn und Ende werden als Textfelder im Format `TT.MM.JJJJ` erfasst, nicht über einen nativen Picker. Grund: kein zusätzliches natives Modul, damit Expo Go weiter funktioniert (Dev-Build kommt erst mit der Kamera in Phase 4). `parseGermanDate` in `tripDay.ts` übernimmt Parsing und Validierung.

---

### Task 1: Invite-Funktionen in Postgres

**Files:**
- Create: `supabase/migrations/20260806120000_invites.sql`
- Test: `supabase/tests/09_invites_test.sql`

**Interfaces:**
- Consumes: `public.trips` (Spalten `id, name, start_date, end_date, status, invite_code, owner_id`), `public.trip_members`, `public.profiles`, `public.is_trip_member(uuid, uuid)` — alle aus Phase 1.
- Produces:
  - `public.peek_invite(p_code text)` → `table(trip_id uuid, name text, start_date date, end_date date, status public.trip_status, member_count bigint, owner_display_name text)`. Null Zeilen bei unbekanntem Code. Ausführbar für `anon` und `authenticated`.
  - `public.redeem_invite(p_code text)` → `table(status text, trip_id uuid)`, `status` ∈ `'joined' | 'already_member' | 'not_found' | 'not_active'`. Nur für `authenticated`.

- [ ] **Step 1: Migration schreiben**

Create `supabase/migrations/20260806120000_invites.sql`:

```sql
-- Beitritt über Invite-Code. security definer, weil trip_members bewusst KEINE
-- Insert-Policy hat (Phase 1) und trips_select_member Nicht-Mitgliedern das
-- Lesen verbietet — beides soll so bleiben.

-- Vorschau vor dem Beitritt: nur das, was der Link ohnehin preisgibt.
-- Gibt NIE invite_code zurück. Unbekannter Code = null Zeilen, kein Fehler.
create or replace function public.peek_invite(p_code text)
returns table (
  trip_id            uuid,
  name               text,
  start_date         date,
  end_date           date,
  status             public.trip_status,
  member_count       bigint,
  owner_display_name text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.start_date, t.end_date, t.status,
         (select count(*) from public.trip_members m where m.trip_id = t.id),
         p.display_name
  from public.trips t
  join public.profiles p on p.id = t.owner_id
  where t.invite_code = p_code;
$$;

-- Beitritt. Erwartbare Fälle kommen als status-Wert zurück, nicht als Exception:
-- der Client kann sie so ohne Fehler-Parsing unterscheiden.
create or replace function public.redeem_invite(p_code text)
returns table (status text, trip_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_trip   public.trips%rowtype;
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  select * into v_trip from public.trips where invite_code = p_code;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if public.is_trip_member(v_trip.id, v_uid) then
    return query select 'already_member'::text, v_trip.id;
    return;
  end if;

  -- Beitritt nur solange die Reise läuft; nach dem Reveal führt der Weg über
  -- den Share-Link (Phase 6), sonst lädt man sich in einen fertigen Recap ein.
  if v_trip.status <> 'active' then
    return query select 'not_active'::text, v_trip.id;
    return;
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (v_trip.id, v_uid, 'member');

  return query select 'joined'::text, v_trip.id;
end $$;

revoke execute on function public.peek_invite(text) from public;
revoke execute on function public.redeem_invite(text) from public;
grant execute on function public.peek_invite(text) to anon, authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
```

- [ ] **Step 2: Migration einspielen und Fehler ausschliessen**

Run: `supabase db reset`
Expected: Läuft ohne Fehler durch, inklusive `Seeding data from supabase/seed.sql`.

- [ ] **Step 3: pgTAP-Tests schreiben**

Create `supabase/tests/09_invites_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(12);

-- Testdaten: zwei Profile, drei Reisen (active, revealed, archived)
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaa0000-0000-4000-8000-000000000001','authenticated','authenticated','41791110001',now(),'','','','','','','','','{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','aaaa0000-0000-4000-8000-000000000002','authenticated','authenticated','41791110002',now(),'','','','','','','','','{}','{}',now(),now());

insert into public.profiles (id, username, display_name) values
  ('aaaa0000-0000-4000-8000-000000000001','owner_t9','Owner'),
  ('aaaa0000-0000-4000-8000-000000000002','gast_t9','Gast');

insert into public.trips (id, name, start_date, end_date, status, revealed_at, invite_code, owner_id) values
  ('bbbb0000-0000-4000-8000-000000000001','Aktive Reise','2026-08-01','2026-08-14','active',   null,        'code-active',   'aaaa0000-0000-4000-8000-000000000001'),
  ('bbbb0000-0000-4000-8000-000000000002','Fertige Reise','2026-05-08','2026-05-12','revealed','2026-05-13','code-revealed', 'aaaa0000-0000-4000-8000-000000000001');

-- peek_invite
select is(
  (select count(*)::int from public.peek_invite('code-active')), 1,
  'peek_invite liefert genau eine Zeile für einen gültigen Code');
select is(
  (select name from public.peek_invite('code-active')), 'Aktive Reise',
  'peek_invite liefert den Reisenamen');
select is(
  (select owner_display_name from public.peek_invite('code-active')), 'Owner',
  'peek_invite nennt, wer einlaedt');
select is(
  (select member_count from public.peek_invite('code-active')), 1::bigint,
  'peek_invite zaehlt den Owner als Mitglied');
select is(
  (select count(*)::int from public.peek_invite('gibt-es-nicht')), 0,
  'peek_invite liefert bei unbekanntem Code null Zeilen');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'peek_invite'
     and column_name = 'invite_code'), 0,
  'peek_invite gibt den invite_code nicht zurueck');

-- redeem_invite als Gast
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select status from public.redeem_invite('gibt-es-nicht')), 'not_found',
  'redeem_invite meldet unbekannten Code');
select is(
  (select status from public.redeem_invite('code-revealed')), 'not_active',
  'redeem_invite verweigert den Beitritt zu einer aufgedeckten Reise');
select is(
  (select status from public.redeem_invite('code-active')), 'joined',
  'redeem_invite laesst in eine laufende Reise beitreten');
select is(
  (select status from public.redeem_invite('code-active')), 'already_member',
  'redeem_invite meldet erneuten Beitritt als bereits Mitglied');
select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'bbbb0000-0000-4000-8000-000000000001'
     and user_id = 'aaaa0000-0000-4000-8000-000000000002'), 1,
  'Beitritt legt genau eine Mitgliedschaft an');

reset role;
select ok(
  not has_function_privilege('anon','public.redeem_invite(text)','execute'),
  'anon darf redeem_invite nicht ausfuehren');
select ok(
  has_function_privilege('anon','public.peek_invite(text)','execute'),
  'anon darf peek_invite ausfuehren');

select * from finish();
rollback;
```

- [ ] **Step 4: Tests laufen lassen**

Run: `supabase test db`
Expected: PASS, alle Dateien grün (bisher 92 Tests + 12 neue).

Schlägt `redeem_invite` mit `permission denied for table trip_members` fehl, fehlt
`security definer` oder `set search_path` an der Funktion — beides ist zwingend, weil
`trip_members` bewusst keine Insert-Policy hat.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260806120000_invites.sql supabase/tests/09_invites_test.sql
git commit -m "feat(db): peek_invite und redeem_invite mit pgTAP-Tests"
```

---

### Task 2: Zähler-Batch und archivierte Reisen lesbar machen

**Files:**
- Create: `supabase/migrations/20260806120100_counts_and_archived.sql`
- Test: `supabase/tests/10_counts_archived_test.sql`

**Interfaces:**
- Consumes: `public.posts`, `public.trip_members`, Policy `posts_select_revealed_members` aus `20260803090300_sealing_rls.sql`.
- Produces: `public.my_post_counts()` → `table(trip_id uuid, count bigint)`, nur für `authenticated`. Liefert für jede Reise, in der die aufrufende Person Mitglied ist, die Anzahl der **eigenen** Momente — auch `0`.

- [ ] **Step 1: Migration schreiben**

Create `supabase/migrations/20260806120100_counts_and_archived.sql`:

```sql
-- Batch-Variante zu my_post_count(trip_id) aus Phase 1: die Reise-Liste
-- braucht den Zähler für alle Reisen auf einmal, sonst ein Roundtrip pro Karte.
-- Gleiche Regel wie das Original: NUR die eigenen Momente, nie fremde.
create or replace function public.my_post_counts()
returns table (trip_id uuid, count bigint)
language sql stable security definer set search_path = public as $$
  select m.trip_id,
         (select count(*) from public.posts p
          where p.trip_id = m.trip_id and p.author_id = auth.uid())
  from public.trip_members m
  where m.user_id = auth.uid();
$$;

revoke execute on function public.my_post_counts() from public;
grant execute on function public.my_post_counts() to authenticated;

-- Korrektur: Bisher erlaubte die Policy nur status = 'revealed'. Eine
-- archivierte Reise war damit für ALLE unlesbar, auch für ihre Mitglieder.
-- «Archiviert» heisst weggelegt, nicht zugesperrt.
drop policy posts_select_revealed_members on public.posts;

create policy posts_select_revealed_members on public.posts
  for select using (
    public.is_trip_member(trip_id, auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id and t.status in ('revealed', 'archived')
    )
  );
```

- [ ] **Step 2: Migration einspielen**

Run: `supabase db reset`
Expected: Läuft ohne Fehler durch.

- [ ] **Step 3: pgTAP-Tests schreiben**

Create `supabase/tests/10_counts_archived_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','cccc0000-0000-4000-8000-000000000001','authenticated','authenticated','41791120001',now(),'','','','','','','','','{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','cccc0000-0000-4000-8000-000000000002','authenticated','authenticated','41791120002',now(),'','','','','','','','','{}','{}',now(),now());

insert into public.profiles (id, username, display_name) values
  ('cccc0000-0000-4000-8000-000000000001','ich_t10','Ich'),
  ('cccc0000-0000-4000-8000-000000000002','fremd_t10','Fremd');

insert into public.trips (id, name, start_date, end_date, status, revealed_at, invite_code, owner_id) values
  ('dddd0000-0000-4000-8000-000000000001','Archiviert','2025-09-06','2025-09-20','archived','2025-09-21','code-arch','cccc0000-0000-4000-8000-000000000001'),
  ('dddd0000-0000-4000-8000-000000000002','Laeuft','2026-08-01','2026-08-14','active',null,'code-act','cccc0000-0000-4000-8000-000000000001');

-- je ein eigener und ein fremder Moment in der archivierten Reise
insert into public.trip_members (trip_id, user_id, role) values
  ('dddd0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000002','member');

insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz) values
  ('dddd0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000001','photo','a.jpg','2025-09-07 10:00+02','Europe/Rome'),
  ('dddd0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000002','photo','b.jpg','2025-09-08 10:00+02','Europe/Rome');

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc0000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.posts
   where trip_id = 'dddd0000-0000-4000-8000-000000000001'), 2,
  'Mitglied liest die Momente einer archivierten Reise');
select is(
  (select count(*)::int from public.posts
   where trip_id = 'dddd0000-0000-4000-8000-000000000002'), 0,
  'Die laufende Reise bleibt versiegelt');
select is(
  (select count from public.my_post_counts()
   where trip_id = 'dddd0000-0000-4000-8000-000000000001'), 1::bigint,
  'my_post_counts zaehlt nur die eigenen Momente');
select is(
  (select count from public.my_post_counts()
   where trip_id = 'dddd0000-0000-4000-8000-000000000002'), 0::bigint,
  'my_post_counts liefert auch fuer leere Reisen eine Zeile');
select is(
  (select count(*)::int from public.my_post_counts()), 2,
  'my_post_counts liefert nur Reisen der aufrufenden Person');

reset role;
select ok(
  not has_function_privilege('anon','public.my_post_counts()','execute'),
  'anon darf my_post_counts nicht ausfuehren');

select * from finish();
rollback;
```

- [ ] **Step 4: Tests laufen lassen**

Run: `supabase test db`
Expected: PASS, alle Dateien grün.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260806120100_counts_and_archived.sql supabase/tests/10_counts_archived_test.sql
git commit -m "feat(db): my_post_counts als Batch, archivierte Reisen wieder lesbar"
```

---

### Task 3: Reise-Logik ohne Netz — Datum, Reisetag, Gruppierung

**Files:**
- Create: `mobile/src/features/trips/types.ts`
- Create: `mobile/src/features/trips/tripDay.ts`
- Test: `mobile/src/features/trips/__tests__/tripDay.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `type TripStatus = 'active' | 'revealed' | 'archived'`
  - `type Trip = { id: string; name: string; start_date: string; end_date: string; status: TripStatus; owner_id: string; member_names: string[]; member_count: number; my_post_count: number }`
  - `type TripMember = { user_id: string; role: 'owner' | 'member'; username: string; display_name: string }`
  - `parseGermanDate(input: string): string | null` — `'06.08.2026'` → `'2026-08-06'`, sonst `null`
  - `formatGermanDate(iso: string): string` — `'2026-08-06'` → `'06.08.2026'`
  - `validateDateRange(startIso: string | null, endIso: string | null): string | null` — Fehlertext oder `null`
  - `tripDay(startIso: string, todayIso: string): number` — 1-basiert, vor dem Beginn `0`
  - `tripLength(startIso: string, endIso: string): number`
  - `formatRange(startIso: string, endIso: string): string` — `'1.–14. Aug 2026'`
  - `groupTrips<T extends { status: TripStatus }>(trips: T[]): { laufend: T[]; recaps: T[] }`

- [ ] **Step 1: Typen anlegen**

Create `mobile/src/features/trips/types.ts`:

```ts
export type TripStatus = 'active' | 'revealed' | 'archived';

export type Trip = {
  id: string;
  name: string;
  start_date: string; // ISO, 'YYYY-MM-DD'
  end_date: string;
  status: TripStatus;
  owner_id: string;
  member_names: string[]; // Anzeigenamen für die überlappenden Avatare auf der Karte
  member_count: number;
  my_post_count: number;
};

export type TripMember = {
  user_id: string;
  role: 'owner' | 'member';
  username: string;
  display_name: string;
};

export type InvitePreview = {
  trip_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  member_count: number;
  owner_display_name: string;
};

export type RedeemResult =
  | { status: 'joined' | 'already_member'; trip_id: string }
  | { status: 'not_found' | 'not_active'; trip_id: string | null };
```

- [ ] **Step 2: Failing Test schreiben**

Create `mobile/src/features/trips/__tests__/tripDay.test.ts`:

```ts
import {
  parseGermanDate, formatGermanDate, validateDateRange,
  tripDay, tripLength, formatRange, groupTrips,
} from '../tripDay';

test.each([
  ['06.08.2026', '2026-08-06'],
  ['1.1.2026', '2026-01-01'],
  ['31.12.2025', '2025-12-31'],
  ['32.01.2026', null],
  ['06.13.2026', null],
  ['29.02.2025', null], // 2025 ist kein Schaltjahr
  ['6.8.26', null],
  ['', null],
])('parseGermanDate(%s) → %s', (input, expected) => {
  expect(parseGermanDate(input)).toBe(expected);
});

test('formatGermanDate kehrt parseGermanDate um', () => {
  expect(formatGermanDate('2026-08-06')).toBe('06.08.2026');
});

test.each([
  ['2026-08-01', '2026-08-14', null],
  ['2026-08-01', '2026-08-01', null],
  ['2026-08-14', '2026-08-01', 'Das Ende darf nicht vor dem Beginn liegen.'],
  [null, '2026-08-14', 'Trag Beginn und Ende ein, z.B. 01.08.2026.'],
  ['2026-08-01', null, 'Trag Beginn und Ende ein, z.B. 01.08.2026.'],
])('validateDateRange(%s, %s) → %s', (start, end, expected) => {
  expect(validateDateRange(start, end)).toBe(expected);
});

test.each([
  ['2026-08-01', '2026-08-06', 6],
  ['2026-08-01', '2026-08-01', 1],
  ['2026-08-01', '2026-07-30', 0], // Reise hat noch nicht begonnen
])('tripDay(%s, %s) → %s', (start, today, expected) => {
  expect(tripDay(start, today)).toBe(expected);
});

test('tripDay zählt über einen Monatswechsel korrekt', () => {
  expect(tripDay('2026-07-30', '2026-08-02')).toBe(4);
});

test('tripLength zählt beide Randtage mit', () => {
  expect(tripLength('2026-08-01', '2026-08-14')).toBe(14);
});

test.each([
  ['2026-08-01', '2026-08-14', '1.–14. Aug 2026'],
  ['2026-07-30', '2026-08-02', '30. Jul – 2. Aug 2026'],
  ['2025-12-28', '2026-01-03', '28. Dez 2025 – 3. Jan 2026'],
])('formatRange(%s, %s) → %s', (start, end, expected) => {
  expect(formatRange(start, end)).toBe(expected);
});

test('groupTrips trennt laufende Reisen von Recaps', () => {
  const trips = [
    { id: 'a', status: 'active' as const },
    { id: 'b', status: 'revealed' as const },
    { id: 'c', status: 'archived' as const },
  ];
  const { laufend, recaps } = groupTrips(trips);
  expect(laufend.map((t) => t.id)).toEqual(['a']);
  expect(recaps.map((t) => t.id)).toEqual(['b', 'c']);
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/trips/__tests__/tripDay.test.ts`
Expected: FAIL — `Cannot find module '../tripDay'`.

- [ ] **Step 4: Implementierung schreiben**

Create `mobile/src/features/trips/tripDay.ts`:

```ts
import type { TripStatus } from './types';

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MS_PRO_TAG = 86_400_000;

// Datumsangaben sind reine Kalendertage ohne Zeitzone. Deshalb überall UTC
// rechnen: Date.UTC vermeidet, dass eine Sommerzeit-Umstellung einen Tag
// verschluckt oder doppelt zählt.
function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function parseGermanDate(input: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const [, d, m, y] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rollover erkennen: der 32.01. wird sonst still zum 01.02.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function validateDateRange(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return 'Trag Beginn und Ende ein, z.B. 01.08.2026.';
  if (toUtc(endIso) < toUtc(startIso)) return 'Das Ende darf nicht vor dem Beginn liegen.';
  return null;
}

export function tripDay(startIso: string, todayIso: string): number {
  const diff = Math.round((toUtc(todayIso) - toUtc(startIso)) / MS_PRO_TAG);
  return diff < 0 ? 0 : diff + 1;
}

export function tripLength(startIso: string, endIso: string): number {
  return Math.round((toUtc(endIso) - toUtc(startIso)) / MS_PRO_TAG) + 1;
}

export function formatRange(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (sy !== ey) return `${sd}. ${MONATE[sm - 1]} ${sy} – ${ed}. ${MONATE[em - 1]} ${ey}`;
  if (sm !== em) return `${sd}. ${MONATE[sm - 1]} – ${ed}. ${MONATE[em - 1]} ${ey}`;
  return `${sd}.–${ed}. ${MONATE[sm - 1]} ${sy}`;
}

export function groupTrips<T extends { status: TripStatus }>(trips: T[]): { laufend: T[]; recaps: T[] } {
  return {
    laufend: trips.filter((t) => t.status === 'active'),
    recaps: trips.filter((t) => t.status !== 'active'),
  };
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/trips/__tests__/tripDay.test.ts`
Expected: PASS, alle Tests grün.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/trips/types.ts mobile/src/features/trips/tripDay.ts mobile/src/features/trips/__tests__/tripDay.test.ts
git commit -m "feat(trips): Datums-, Reisetag- und Gruppierungslogik"
```

---

### Task 4: Invite-Link erzeugen, lesen und merken

**Files:**
- Create: `mobile/src/features/trips/inviteLink.ts`
- Test: `mobile/src/features/trips/__tests__/inviteLink.test.ts`

**Interfaces:**
- Consumes: `expo-linking` (installiert), `@react-native-async-storage/async-storage` (installiert).
- Produces:
  - `createInviteUrl(code: string): string`
  - `extractInviteCode(url: string): string | null`
  - `rememberInvite(code: string): Promise<void>`
  - `takeRememberedInvite(): Promise<string | null>` — liest und löscht in einem Zug

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/features/trips/__tests__/inviteLink.test.ts`:

```ts
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: mockGetItem, setItem: mockSetItem, removeItem: mockRemoveItem },
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `reelive://${path.replace(/^\//, '')}`,
}));

import { createInviteUrl, extractInviteCode, rememberInvite, takeRememberedInvite } from '../inviteLink';

beforeEach(() => jest.clearAllMocks());

test('createInviteUrl baut den Link über expo-linking', () => {
  expect(createInviteUrl('abc123')).toBe('reelive://join/abc123');
});

test.each([
  ['reelive://join/abc123', 'abc123'],
  ['exp://192.168.1.5:8081/--/join/abc123', 'abc123'],
  ['exp://192.168.1.5:8081/--/join/abc123?x=1', 'abc123'],
  ['reelive://join/', null],
  ['reelive://reise/abc123', null],
  ['', null],
])('extractInviteCode(%s) → %s', (url, expected) => {
  expect(extractInviteCode(url)).toBe(expected);
});

test('rememberInvite legt den Code ab', async () => {
  await rememberInvite('abc123');
  expect(mockSetItem).toHaveBeenCalledWith('reelive.pendingInvite', 'abc123');
});

test('takeRememberedInvite liefert den Code und löscht ihn', async () => {
  mockGetItem.mockResolvedValueOnce('abc123');
  await expect(takeRememberedInvite()).resolves.toBe('abc123');
  expect(mockRemoveItem).toHaveBeenCalledWith('reelive.pendingInvite');
});

test('takeRememberedInvite ohne gemerkten Code liefert null und löscht nichts', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(takeRememberedInvite()).resolves.toBeNull();
  expect(mockRemoveItem).not.toHaveBeenCalled();
});

test('takeRememberedInvite verschluckt Storage-Fehler', async () => {
  mockGetItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(takeRememberedInvite()).resolves.toBeNull();
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/trips/__tests__/inviteLink.test.ts`
Expected: FAIL — `Cannot find module '../inviteLink'`.

- [ ] **Step 3: Implementierung schreiben**

Create `mobile/src/features/trips/inviteLink.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

const KEY = 'reelive.pendingInvite';

// createURL liefert in Expo Go exp://host:8081/--/join/<code> und im
// Dev-/Release-Build reelive://join/<code> — derselbe Aufruf, kein Umbau,
// wenn später eine Domain dazukommt.
export function createInviteUrl(code: string): string {
  return Linking.createURL(`/join/${code}`);
}

// Akzeptiert beide Link-Formen. Query-String und Fragment werden abgeschnitten.
export function extractInviteCode(url: string): string | null {
  const match = /\/join\/([^/?#]+)/.exec(url);
  return match ? match[1] : null;
}

// Beim SMS-Login verlässt man die App, um den Code abzulesen. Ein reiner
// Modul-State würde das nicht sicher überleben, deshalb AsyncStorage.
export async function rememberInvite(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // Ein verlorener Invite ist unangenehm, aber kein Grund, den Login zu kippen.
  }
}

export async function takeRememberedInvite(): Promise<string | null> {
  try {
    const code = await AsyncStorage.getItem(KEY);
    if (!code) return null;
    await AsyncStorage.removeItem(KEY);
    return code;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/trips/__tests__/inviteLink.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/trips/inviteLink.ts mobile/src/features/trips/__tests__/inviteLink.test.ts
git commit -m "feat(trips): Invite-Link erzeugen, lesen und über den Login hinweg merken"
```

---

### Task 5: tripsApi — alle Supabase-Aufrufe an einem Ort

**Files:**
- Create: `mobile/src/features/trips/tripsApi.ts`
- Test: `mobile/src/features/trips/__tests__/tripsApi.test.ts`

**Interfaces:**
- Consumes: `supabase` aus `@/lib/supabase`; Typen aus `./types`; die Funktionen `peek_invite`, `redeem_invite`, `my_post_counts` aus Task 1 und 2.
- Produces (alle Fehlermeldungen sind fertige deutsche Texte für die UI):
  - `fetchTrips(): Promise<Trip[]>`
  - `fetchTrip(id: string): Promise<Trip | null>`
  - `createTrip(input: { name: string; startDate: string; endDate: string; ownerId: string }): Promise<{ id: string | null; error: string | null }>`
  - `updateTrip(id: string, input: { name: string; startDate: string; endDate: string }): Promise<{ error: string | null }>`
  - `deleteTrip(id: string): Promise<{ error: string | null }>`
  - `fetchMembers(tripId: string): Promise<TripMember[]>`
  - `removeMember(tripId: string, userId: string): Promise<{ error: string | null }>`
  - `fetchInviteCode(tripId: string): Promise<string | null>`
  - `peekInvite(code: string): Promise<InvitePreview | null>`
  - `redeemInvite(code: string): Promise<RedeemResult>`

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/features/trips/__tests__/tripsApi.test.ts`:

```ts
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: mockRpc, from: mockFrom } }));

import { fetchTrips, createTrip, redeemInvite, peekInvite, removeMember } from '../tripsApi';

beforeEach(() => jest.clearAllMocks());

test('fetchTrips führt Mitglieder und eigenen Zähler zusammen', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [
          {
            id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
            status: 'active', owner_id: 'u1',
            trip_members: [
              { profiles: { display_name: 'Lea' } },
              { profiles: { display_name: 'Jonas' } },
            ],
          },
        ],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: [{ trip_id: 't1', count: 7 }], error: null });

  const trips = await fetchTrips();
  expect(trips).toEqual([
    {
      id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', owner_id: 'u1',
      member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 7,
    },
  ]);
});

test('fetchTrips setzt den Zähler auf 0, wenn die Reise nicht in my_post_counts steht', async () => {
  mockFrom.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [{
          id: 't2', name: 'Neu', start_date: '2026-09-01', end_date: '2026-09-05',
          status: 'active', owner_id: 'u1', trip_members: [{ profiles: { display_name: 'Lea' } }],
        }],
        error: null,
      }),
    }),
  });
  mockRpc.mockResolvedValueOnce({ data: [], error: null });

  const trips = await fetchTrips();
  expect(trips[0].my_post_count).toBe(0);
});

test('fetchTrips liefert bei einem Fehler eine leere Liste', async () => {
  mockFrom.mockReturnValue({
    select: () => ({ order: async () => ({ data: null, error: { message: 'kaputt' } }) }),
  });
  await expect(fetchTrips()).resolves.toEqual([]);
});

test('createTrip gibt die neue id zurück', async () => {
  mockFrom.mockReturnValue({
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'neu-1' }, error: null }) }) }),
  });
  const { id, error } = await createTrip({
    name: 'Sardinien', startDate: '2026-09-06', endDate: '2026-09-20', ownerId: 'u1',
  });
  expect(id).toBe('neu-1');
  expect(error).toBeNull();
});

test('createTrip meldet einen Fehler in deutscher Sprache', async () => {
  mockFrom.mockReturnValue({
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'x' } }) }) }),
  });
  const { id, error } = await createTrip({
    name: 'X', startDate: '2026-09-06', endDate: '2026-09-20', ownerId: 'u1',
  });
  expect(id).toBeNull();
  expect(error).toBe('Die Reise konnte nicht angelegt werden. Probier es gleich nochmal.');
});

test('peekInvite liefert die Vorschau', async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{
      trip_id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
      status: 'active', member_count: 4, owner_display_name: 'Lea',
    }],
    error: null,
  });
  const preview = await peekInvite('abc');
  expect(preview?.owner_display_name).toBe('Lea');
  expect(mockRpc).toHaveBeenCalledWith('peek_invite', { p_code: 'abc' });
});

test('peekInvite liefert null bei unbekanntem Code', async () => {
  mockRpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(peekInvite('weg')).resolves.toBeNull();
});

test('redeemInvite reicht den Status durch', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ status: 'joined', trip_id: 't1' }], error: null });
  await expect(redeemInvite('abc')).resolves.toEqual({ status: 'joined', trip_id: 't1' });
});

test('redeemInvite wertet einen Netzwerkfehler als not_found', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  await expect(redeemInvite('abc')).resolves.toEqual({ status: 'not_found', trip_id: null });
});

test('removeMember löscht genau eine Mitgliedschaft', async () => {
  const eqUser = jest.fn(async () => ({ error: null }));
  const eqTrip = jest.fn(() => ({ eq: eqUser }));
  mockFrom.mockReturnValue({ delete: () => ({ eq: eqTrip }) });

  const { error } = await removeMember('t1', 'u2');
  expect(error).toBeNull();
  expect(eqTrip).toHaveBeenCalledWith('trip_id', 't1');
  expect(eqUser).toHaveBeenCalledWith('user_id', 'u2');
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/trips/__tests__/tripsApi.test.ts`
Expected: FAIL — `Cannot find module '../tripsApi'`.

- [ ] **Step 3: Implementierung schreiben**

Create `mobile/src/features/trips/tripsApi.ts`:

```ts
import { supabase } from '@/lib/supabase';
import type { InvitePreview, RedeemResult, Trip, TripMember } from './types';

const SPALTEN = 'id, name, start_date, end_date, status, owner_id';
// Die Karte zeigt überlappende Avatare (DESIGN-LANGUAGE §4), also werden die
// Anzeigenamen gleich mitgeladen — die Mitgliederzahl fällt dabei ab und
// braucht keine eigene Aggregation.
const MIT_MITGLIEDERN = `${SPALTEN}, trip_members(profiles(display_name))`;

type TripRow = Omit<Trip, 'member_names' | 'member_count' | 'my_post_count'> & {
  trip_members: { profiles: { display_name: string } | null }[] | null;
};

function toTrip(row: TripRow, counts: Map<string, number>): Trip {
  const names = (row.trip_members ?? [])
    .map((m) => m.profiles?.display_name)
    .filter((n): n is string => !!n);
  return {
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    owner_id: row.owner_id,
    member_names: names,
    member_count: names.length,
    my_post_count: counts.get(row.id) ?? 0,
  };
}

async function loadCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('my_post_counts');
  if (error || !data) return new Map();
  return new Map((data as { trip_id: string; count: number }[]).map((r) => [r.trip_id, r.count]));
}

export async function fetchTrips(): Promise<Trip[]> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('trips').select(MIT_MITGLIEDERN).order('start_date', { ascending: false }),
    loadCounts(),
  ]);
  if (error || !data) return [];
  return (data as TripRow[]).map((row) => toTrip(row, counts));
}

export async function fetchTrip(id: string): Promise<Trip | null> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('trips').select(MIT_MITGLIEDERN).eq('id', id).maybeSingle(),
    loadCounts(),
  ]);
  if (error || !data) return null;
  return toTrip(data as TripRow, counts);
}

export async function createTrip(input: {
  name: string; startDate: string; endDate: string; ownerId: string;
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('trips')
    .insert({
      name: input.name.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      owner_id: input.ownerId,
    })
    .select('id')
    .single();
  if (error || !data) {
    return { id: null, error: 'Die Reise konnte nicht angelegt werden. Probier es gleich nochmal.' };
  }
  return { id: data.id, error: null };
}

export async function updateTrip(
  id: string,
  input: { name: string; startDate: string; endDate: string }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('trips')
    .update({ name: input.name.trim(), start_date: input.startDate, end_date: input.endDate })
    .eq('id', id);
  return { error: error ? 'Die Änderung konnte nicht gespeichert werden. Probier es gleich nochmal.' : null };
}

export async function deleteTrip(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  return { error: error ? 'Die Reise konnte nicht gelöscht werden. Probier es gleich nochmal.' : null };
}

export async function fetchMembers(tripId: string): Promise<TripMember[]> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id, role, profiles(username, display_name)')
    .eq('trip_id', tripId)
    .order('joined_at');
  if (error || !data) return [];
  type Row = { user_id: string; role: 'owner' | 'member'; profiles: { username: string; display_name: string } | null };
  return (data as Row[]).map((r) => ({
    user_id: r.user_id,
    role: r.role,
    username: r.profiles?.username ?? '',
    display_name: r.profiles?.display_name ?? '',
  }));
}

// Deckt beide Fälle ab: Owner entfernt ein Mitglied, Mitglied verlässt selbst.
// Welcher Fall erlaubt ist, entscheidet die Policy trip_members_delete (Phase 1).
export async function removeMember(tripId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId);
  return { error: error ? 'Das hat nicht geklappt. Probier es gleich nochmal.' : null };
}

export async function fetchInviteCode(tripId: string): Promise<string | null> {
  const { data, error } = await supabase.from('trips').select('invite_code').eq('id', tripId).maybeSingle();
  if (error || !data) return null;
  return data.invite_code;
}

export async function peekInvite(code: string): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('peek_invite', { p_code: code });
  if (error || !data || (data as InvitePreview[]).length === 0) return null;
  return (data as InvitePreview[])[0];
}

export async function redeemInvite(code: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_code: code });
  if (error || !data || (data as RedeemResult[]).length === 0) {
    return { status: 'not_found', trip_id: null };
  }
  return (data as RedeemResult[])[0];
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/trips/__tests__/tripsApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Typprüfung**

Run: `cd mobile && npx tsc --noEmit`
Expected: Keine Fehler.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/trips/tripsApi.ts mobile/src/features/trips/__tests__/tripsApi.test.ts
git commit -m "feat(trips): tripsApi als einzige Supabase-Schicht fuer Reisen"
```

---

### Task 6: Gemeinsame Komponenten — Avatar, Badge, TripCard, Fab

**Files:**
- Create: `mobile/src/components/Avatar.tsx`
- Create: `mobile/src/components/Badge.tsx`
- Create: `mobile/src/components/TripCard.tsx`
- Create: `mobile/src/components/Fab.tsx`
- Test: `mobile/src/components/__tests__/TripCard.test.tsx`

**Interfaces:**
- Consumes: `useTheme()` aus `@/theme/ThemeProvider`; `radius, spacing, type, shadow` aus `@/theme/tokens`; `PressScale`; `formatRange` aus `@/features/trips/tripDay`; `Trip` aus `@/features/trips/types`.
- Produces:
  - `<Avatar name={string} size?={number} />` — runder Kreis mit Initiale
  - `<AvatarGroup names={string[]} max?={number} />` — überlappend, Rest als `+n`
  - `<Badge label={string} tone?={'seal' | 'neutral'} icon?={ReactNode} />`
  - `<TripCard trip={Trip} onPress={() => void} />`
  - `<Fab label={string} onPress={() => void} />`

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/components/__tests__/TripCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { TripCard } from '../TripCard';
import type { Trip } from '@/features/trips/types';

const trip: Trip = {
  id: 't1', name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active', owner_id: 'u1',
  member_names: ['Lea', 'Mira', 'Jonas', 'Sofia'], member_count: 4, my_post_count: 7,
};

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('zeigt Name, Zeitraum und eigenen Zähler', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('7 Momente')).toBeTruthy();
});

test('zeigt die Mitreisenden als überlappende Avatare', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  // Avatar trägt bis zum Bild-Upload die Initiale
  expect(screen.getByText('L')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy();
  expect(screen.getByText('J')).toBeTruthy();
  expect(screen.getByText('S')).toBeTruthy();
});

test('ab dem fünften Mitreisenden zählt die Gruppe weiter', async () => {
  await wrap(
    <TripCard trip={{ ...trip, member_names: ['Lea', 'Mira', 'Jonas', 'Sofia', 'Ben', 'Nora'] }} onPress={jest.fn()} />
  );
  expect(screen.getByText('+2')).toBeTruthy();
});

test('laufende Reise trägt die Versiegelt-Pille', async () => {
  await wrap(<TripCard trip={trip} onPress={jest.fn()} />);
  expect(screen.getByText('Versiegelt')).toBeTruthy();
});

test('aufgedeckte Reise trägt sie nicht', async () => {
  await wrap(<TripCard trip={{ ...trip, status: 'revealed' }} onPress={jest.fn()} />);
  expect(screen.queryByText('Versiegelt')).toBeNull();
});

test('ein Moment wird im Singular gezählt', async () => {
  await wrap(<TripCard trip={{ ...trip, my_post_count: 1 }} onPress={jest.fn()} />);
  expect(screen.getByText('1 Moment')).toBeTruthy();
});

test('Antippen meldet die Reise zurück', async () => {
  const onPress = jest.fn();
  await wrap(<TripCard trip={trip} onPress={onPress} />);
  await fireEvent.press(screen.getByText('Norwegen mit dem Camper'));
  expect(onPress).toHaveBeenCalled();
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/components/__tests__/TripCard.test.tsx`
Expected: FAIL — `Cannot find module '../TripCard'`.

- [ ] **Step 3: Avatar implementieren**

Create `mobile/src/components/Avatar.tsx`:

```tsx
import { Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, type } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §4: rund, 32–44 px, 2 px weisser Ring, Gruppen −8 px
// überlappend. Bis zum Avatar-Upload (Phase 4) trägt der Kreis die Initiale.
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: colors['bg-1'],
        borderWidth: 2,
        borderColor: colors['bg-0'],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={[type.label, { color: colors['text-2'] }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

export function AvatarGroup({ names, max = 4 }: { names: string[]; max?: number }) {
  const { colors } = useTheme();
  const sichtbar = names.slice(0, max);
  const rest = names.length - sichtbar.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {sichtbar.map((name, i) => (
        <View key={`${name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <Avatar name={name} />
        </View>
      ))}
      {rest > 0 && (
        <Text style={[type.secondary, { color: colors['text-2'], marginLeft: 8 }]}>{`+${rest}`}</Text>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Badge implementieren**

Create `mobile/src/components/Badge.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// Pille (DESIGN-LANGUAGE v2 §4). tone 'seal' nur für Versiegelungs-Symbolik,
// nie für Interaktion — dafür ist accent da.
export function Badge({
  label, tone = 'neutral', icon,
}: { label: string; tone?: 'seal' | 'neutral'; icon?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: colors['bg-1'],
      }}
    >
      {icon}
      <Text style={[type.label, { color: tone === 'seal' ? colors.seal : colors['text-2'] }]}>
        {label}
      </Text>
    </View>
  );
}
```

- [ ] **Step 5: TripCard implementieren**

Create `mobile/src/components/TripCard.tsx`:

```tsx
import { Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Badge } from '@/components/Badge';
import { AvatarGroup } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { formatRange } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

// Randlose Reise-Karte (DESIGN-LANGUAGE v2 §4): Cover 3:2 mit Radius 24,
// darunter ohne Rahmen und ohne Schatten. Cover-Bilder kommen in Phase 4 —
// bis dahin trägt die Fläche bg-1.
export function TripCard({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const { colors } = useTheme();
  const momente = `${trip.my_post_count} ${trip.my_post_count === 1 ? 'Moment' : 'Momente'}`;

  return (
    <PressScale scaleTo={0.98} accessibilityRole="button" onPress={onPress}>
      <View style={{ gap: spacing.m }}>
        <View
          style={{
            aspectRatio: 3 / 2,
            borderRadius: radius.card,
            backgroundColor: colors['bg-1'],
            justifyContent: 'flex-start',
            padding: spacing.m,
          }}
        >
          {trip.status === 'active' && (
            <Badge label="Versiegelt" tone="seal" icon={<Lock size={12} color={colors.seal} strokeWidth={1.75} />} />
          )}
        </View>
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{trip.name}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(trip.start_date, trip.end_date)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginTop: spacing.xs }}>
            <AvatarGroup names={trip.member_names} />
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{momente}</Text>
          </View>
        </View>
      </View>
    </PressScale>
  );
}
```

- [ ] **Step 6: Fab implementieren**

Create `mobile/src/components/Fab.tsx`:

```tsx
import { Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, spacing, type } from '@/theme/tokens';

// FAB (DESIGN-LANGUAGE v2 §4): accent, Radius 999, shadow-2, unten rechts.
// Press-Scale 0.94 laut §5.
export function Fab({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ position: 'absolute', right: spacing.screen, bottom: spacing.screen }}>
      <PressScale scaleTo={0.94} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.s,
            height: 56,
            paddingHorizontal: spacing.l,
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
            ...shadow.s2,
          }}
        >
          <Plus size={20} color={colors['on-accent']} strokeWidth={1.75} />
          <Text style={[type.bodyMedium, { color: colors['on-accent'] }]}>{label}</Text>
        </View>
      </PressScale>
    </View>
  );
}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `cd mobile && npx jest src/components/__tests__/TripCard.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/components/Avatar.tsx mobile/src/components/Badge.tsx mobile/src/components/TripCard.tsx mobile/src/components/Fab.tsx mobile/src/components/__tests__/TripCard.test.tsx
git commit -m "feat(ui): Avatar, Badge, TripCard und Fab nach Design-Language v2"
```

---

### Task 7: Reise-Tab wird ein Stack, «Meine Reisen» zeigt die Liste

**Files:**
- Delete: `mobile/src/app/(tabs)/reise.tsx`
- Create: `mobile/src/app/(tabs)/reise/_layout.tsx`
- Create: `mobile/src/app/(tabs)/reise/index.tsx`
- Test: `mobile/src/app/(tabs)/reise/__tests__/liste.test.tsx`

**Interfaces:**
- Consumes: `fetchTrips` aus `@/features/trips/tripsApi`; `groupTrips` aus `@/features/trips/tripDay`; `TripCard`, `Fab`; `useTheme`.
- Produces: Route `/reise` (Liste), Stack-Container für `/reise/neu` und `/reise/[id]`.

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/app/(tabs)/reise/__tests__/liste.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
  Stack: { Screen: () => null },
}));
jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

import ReiseListe from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 7,
};
const recap = { ...trip, id: 't2', name: 'Lissabon Städtetrip', status: 'revealed' as const };

const wrap = () => render(<ThemeProvider><ReiseListe /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

test('zeigt laufende Reisen und Recaps getrennt', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([trip, recap]);
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('Lissabon Städtetrip')).toBeTruthy();
  expect(screen.getByText('Unterwegs')).toBeTruthy();
  expect(screen.getByText('Recaps')).toBeTruthy();
});

test('ohne Reisen lädt der leere Zustand zum Handeln ein', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([]);
  await wrap();
  expect(await screen.findByText('Noch keine Reise')).toBeTruthy();
  expect(screen.getByText(/Leg deine erste Reise an/)).toBeTruthy();
  expect(screen.queryByText('Unterwegs')).toBeNull();
});

test('der Knopf führt zum Anlegen', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([]);
  await wrap();
  await waitFor(() => expect(fetchTrips).toHaveBeenCalled());
  await fireEvent.press(screen.getByLabelText('Neue Reise'));
  expect(mockPush).toHaveBeenCalledWith('/reise/neu');
});

test('eine Karte führt in die Reise', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue([trip]);
  await wrap();
  await fireEvent.press(await screen.findByText('Norwegen mit dem Camper'));
  expect(mockPush).toHaveBeenCalledWith('/reise/t1');
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/liste.test.tsx`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 3: Alten Platzhalter löschen und Stack anlegen**

```bash
git rm mobile/src/app/\(tabs\)/reise.tsx
```

Create `mobile/src/app/(tabs)/reise/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';

// Stack innerhalb des Tabs: die Tab-Bar bleibt beim Navigieren sichtbar.
// Header aus, jeder Screen bringt seinen eigenen H1 mit (Design-Language §2).
export default function ReiseStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
  );
}
```

- [ ] **Step 4: Liste implementieren**

Create `mobile/src/app/(tabs)/reise/index.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { TripCard } from '@/components/TripCard';
import { Fab } from '@/components/Fab';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { fetchTrips } from '@/features/trips/tripsApi';
import { groupTrips } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

export default function ReiseListe() {
  const { colors } = useTheme();
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [geladen, setGeladen] = useState(false);

  // Beim Zurückkehren neu laden — eine gerade angelegte Reise soll sofort dastehen.
  useFocusEffect(
    useCallback(() => {
      let aktiv = true;
      void fetchTrips().then((t) => {
        if (!aktiv) return;
        setTrips(t);
        setGeladen(true);
      });
      return () => {
        aktiv = false;
      };
    }, [])
  );

  const { laufend, recaps } = groupTrips(trips);
  const leer = geladen && trips.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={styles.inhalt}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Meine Reisen</Text>

        {leer && (
          <View style={{ gap: spacing.s, marginTop: spacing.xl }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Noch keine Reise</Text>
            <Text style={[type.body, { color: colors['text-2'] }]}>
              Leg deine erste Reise an oder tritt einer per Einladungslink bei.
            </Text>
          </View>
        )}

        {laufend.length > 0 && (
          <View style={{ gap: spacing.l }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Unterwegs</Text>
            {laufend.map((t) => (
              <TripCard key={t.id} trip={t} onPress={() => router.push(`/reise/${t.id}`)} />
            ))}
          </View>
        )}

        {recaps.length > 0 && (
          <View style={{ gap: spacing.l }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Recaps</Text>
            {recaps.map((t) => (
              <TripCard key={t.id} trip={t} onPress={() => router.push(`/reise/${t.id}`)} />
            ))}
          </View>
        )}
      </ScrollView>
      <Fab label="Neue Reise" onPress={() => router.push('/reise/neu')} />
    </View>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: 120, gap: spacing.xl },
});
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/liste.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gesamte Suite und Typen prüfen**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: Alles grün — der gelöschte Platzhalter darf keinen Test brechen.

- [ ] **Step 7: Commit**

```bash
git add -A mobile/src/app/\(tabs\)/reise
git commit -m "feat(reise): Reise-Tab wird ein Stack, Liste mit laufenden Reisen und Recaps"
```

---

### Task 8: Reise anlegen und bearbeiten

**Files:**
- Create: `mobile/src/app/(tabs)/reise/neu.tsx`
- Create: `mobile/src/app/(tabs)/reise/[id]/bearbeiten.tsx`
- Test: `mobile/src/app/(tabs)/reise/__tests__/formular.test.tsx`

**Interfaces:**
- Consumes: `createTrip`, `updateTrip`, `fetchTrip` aus `tripsApi`; `parseGermanDate`, `formatGermanDate`, `validateDateRange` aus `tripDay`; `Button`, `Input`; `useAuth` aus `@/features/auth/AuthProvider`.
- Produces: Routen `/reise/neu` und `/reise/[id]/bearbeiten`.

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/app/(tabs)/reise/__tests__/formular.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'u1' }) }));
jest.mock('@/features/trips/tripsApi', () => ({
  createTrip: jest.fn(async () => ({ id: 'neu-1', error: null })),
  updateTrip: jest.fn(async () => ({ error: null })),
  fetchTrip: jest.fn(async () => ({
    id: 't1', name: 'Norwegen', start_date: '2026-08-01', end_date: '2026-08-14',
    status: 'active', owner_id: 'u1',
    member_names: ['Lea'], member_count: 1, my_post_count: 0,
  })),
}));

import NeueReise from '../neu';
import ReiseBearbeiten from '../[id]/bearbeiten';
import { createTrip, updateTrip } from '@/features/trips/tripsApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

test('leerer Name wird abgefangen', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '01.08.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '14.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Gib deiner Reise einen Namen.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});

test('Ende vor Beginn wird abgefangen', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '14.08.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '01.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Das Ende darf nicht vor dem Beginn liegen.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});

test('unlesbares Datum wird abgefangen', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '32.13.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '14.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  expect(await screen.findByText('Trag Beginn und Ende ein, z.B. 01.08.2026.')).toBeTruthy();
});

test('gültige Eingabe legt an und führt zum Einladen', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.changeText(screen.getByLabelText('Beginn'), '01.08.2026');
  await fireEvent.changeText(screen.getByLabelText('Ende'), '14.08.2026');
  await fireEvent.press(screen.getByText('Reise anlegen'));
  await waitFor(() =>
    expect(createTrip).toHaveBeenCalledWith({
      name: 'Norwegen', startDate: '2026-08-01', endDate: '2026-08-14', ownerId: 'u1',
    })
  );
  expect(mockReplace).toHaveBeenCalledWith('/reise/neu-1/einladen');
});

test('Bearbeiten kommt mit vorbelegten Werten und speichert', async () => {
  await wrap(<ReiseBearbeiten />);
  expect(await screen.findByDisplayValue('Norwegen')).toBeTruthy();
  expect(screen.getByDisplayValue('01.08.2026')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen 2026');
  await fireEvent.press(screen.getByText('Speichern'));
  await waitFor(() =>
    expect(updateTrip).toHaveBeenCalledWith('t1', {
      name: 'Norwegen 2026', startDate: '2026-08-01', endDate: '2026-08-14',
    })
  );
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/formular.test.tsx`
Expected: FAIL — `Cannot find module '../neu'`.

- [ ] **Step 3: Anlege-Screen implementieren**

Create `mobile/src/app/(tabs)/reise/neu.tsx`:

```tsx
import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { createTrip } from '@/features/trips/tripsApi';
import { parseGermanDate, validateDateRange } from '@/features/trips/tripDay';

export default function NeueReise() {
  const { colors } = useTheme();
  const router = useRouter();
  const { userId } = useAuth();
  const [name, setName] = useState('');
  const [beginn, setBeginn] = useState('');
  const [ende, setEnde] = useState('');
  const [nameFehler, setNameFehler] = useState<string | undefined>();
  const [datumFehler, setDatumFehler] = useState<string | undefined>();
  const [laedt, setLaedt] = useState(false);

  const absenden = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const start = parseGermanDate(beginn);
    const end = parseGermanDate(ende);
    const dFehler = validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setDatumFehler(dFehler ?? undefined);
    if (nFehler || dFehler || !start || !end || !userId) return;

    setLaedt(true);
    const { id, error } = await createTrip({ name, startDate: start, endDate: end, ownerId: userId });
    setLaedt(false);
    if (error || !id) return setNameFehler(error ?? undefined);
    // Direkt weiter zum Einladen (App-Konzept §5.3); replace, damit «zurück»
    // wieder in der Liste landet und nicht im ausgefüllten Formular.
    router.replace(`/reise/${id}/einladen`);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Neue Reise</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        Name und Zeitraum reichen — Freunde lädst du gleich danach ein.
      </Text>
      <Input label="Name der Reise" value={name} onChangeText={setName} error={nameFehler} placeholder="Norwegen mit dem Camper" autoFocus />
      <Input label="Beginn" value={beginn} onChangeText={setBeginn} keyboardType="numbers-and-punctuation" placeholder="01.08.2026" />
      <Input label="Ende" value={ende} onChangeText={setEnde} error={datumFehler} keyboardType="numbers-and-punctuation" placeholder="14.08.2026" />
      <Button variant="primary" label="Reise anlegen" onPress={absenden} loading={laedt} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
});
```

- [ ] **Step 4: Bearbeiten-Screen implementieren**

Create `mobile/src/app/(tabs)/reise/[id]/bearbeiten.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { fetchTrip, updateTrip } from '@/features/trips/tripsApi';
import { formatGermanDate, parseGermanDate, validateDateRange } from '@/features/trips/tripDay';

export default function ReiseBearbeiten() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [beginn, setBeginn] = useState('');
  const [ende, setEnde] = useState('');
  const [nameFehler, setNameFehler] = useState<string | undefined>();
  const [datumFehler, setDatumFehler] = useState<string | undefined>();
  const [laedt, setLaedt] = useState(false);

  useEffect(() => {
    void fetchTrip(id).then((t) => {
      if (!t) return;
      setName(t.name);
      setBeginn(formatGermanDate(t.start_date));
      setEnde(formatGermanDate(t.end_date));
    });
  }, [id]);

  const speichern = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const start = parseGermanDate(beginn);
    const end = parseGermanDate(ende);
    const dFehler = validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setDatumFehler(dFehler ?? undefined);
    if (nFehler || dFehler || !start || !end) return;

    setLaedt(true);
    const { error } = await updateTrip(id, { name, startDate: start, endDate: end });
    setLaedt(false);
    if (error) return setNameFehler(error);
    router.back();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Reise bearbeiten</Text>
      <Input label="Name der Reise" value={name} onChangeText={setName} error={nameFehler} />
      <Input label="Beginn" value={beginn} onChangeText={setBeginn} keyboardType="numbers-and-punctuation" />
      <Input label="Ende" value={ende} onChangeText={setEnde} error={datumFehler} keyboardType="numbers-and-punctuation" />
      <Button variant="primary" label="Speichern" onPress={speichern} loading={laedt} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
});
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/formular.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/app/\(tabs\)/reise/neu.tsx mobile/src/app/\(tabs\)/reise/\[id\]/bearbeiten.tsx mobile/src/app/\(tabs\)/reise/__tests__/formular.test.tsx
git commit -m "feat(reise): Reise anlegen und bearbeiten"
```

---

### Task 9: Reise-Detail mit Mitgliederverwaltung

**Files:**
- Create: `mobile/src/app/(tabs)/reise/[id]/index.tsx`
- Test: `mobile/src/app/(tabs)/reise/__tests__/detail.test.tsx`

**Interfaces:**
- Consumes: `fetchTrip`, `fetchMembers`, `removeMember`, `deleteTrip` aus `tripsApi`; `tripDay`, `tripLength`, `formatRange` aus `tripDay`; `Avatar`, `Badge`, `Button`; `useAuth`.
- Produces: Route `/reise/[id]`.

**Hinweis zum Zähler:** `my_post_count` steht in Phase 3 immer auf 0. Der Screen zeigt
ihn trotzdem in `type.display` — Phase 4 füllt ihn, ohne das Layout zu ändern.

- [ ] **Step 1: Failing Test schreiben**

Create `mobile/src/app/(tabs)/reise/__tests__/detail.test.tsx`:

```tsx
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
  useFocusEffect: (cb: () => void) => cb(),
}));

// Alert zeigt im Test nur einen Dialog an, ohne dass jemand tippt. Damit die
// destruktiven Pfade prüfbar sind, wird der bestätigende Knopf sofort ausgelöst.
type AlertKnopf = { text?: string; style?: string; onPress?: () => void };
jest.spyOn(Alert, 'alert').mockImplementation((_titel, _text, knoepfe) => {
  (knoepfe as AlertKnopf[] | undefined)?.find((k) => k.style === 'destructive')?.onPress?.();
});

const mockAuth = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/features/trips/tripsApi', () => ({
  fetchTrip: jest.fn(),
  fetchMembers: jest.fn(),
  removeMember: jest.fn(async () => ({ error: null })),
  deleteTrip: jest.fn(async () => ({ error: null })),
}));

import ReiseDetail from '../[id]/index';
import { fetchTrip, fetchMembers, removeMember } from '@/features/trips/tripsApi';

const trip = {
  id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01', end_date: '2026-08-14',
  status: 'active' as const, owner_id: 'u1',
  member_names: ['Lea', 'Jonas'], member_count: 2, my_post_count: 0,
};
const mitglieder = [
  { user_id: 'u1', role: 'owner' as const, username: 'lea', display_name: 'Lea' },
  { user_id: 'u2', role: 'member' as const, username: 'jonas', display_name: 'Jonas' },
];

const wrap = () => render(<ThemeProvider><ReiseDetail /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.userId = 'u1';
  (fetchTrip as jest.Mock).mockResolvedValue(trip);
  (fetchMembers as jest.Mock).mockResolvedValue(mitglieder);
});

test('zeigt Name, Zeitraum und Mitglieder', async () => {
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
  expect(screen.getByText('Lea')).toBeTruthy();
  expect(screen.getByText('Jonas')).toBeTruthy();
});

test('zeigt den eigenen Zähler mit Erklärung', async () => {
  await wrap();
  expect(await screen.findByText('0')).toBeTruthy();
  expect(screen.getByText(/Momente eingefangen/)).toBeTruthy();
});

test('Owner kann einladen, bearbeiten und Mitglieder entfernen', async () => {
  await wrap();
  await fireEvent.press(await screen.findByText('Freunde einladen'));
  expect(mockPush).toHaveBeenCalledWith('/reise/t1/einladen');

  await fireEvent.press(screen.getByLabelText('Jonas entfernen'));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith('t1', 'u2'));
});

test('Owner kann sich selbst nicht entfernen', async () => {
  await wrap();
  await screen.findByText('Lea');
  expect(screen.queryByLabelText('Lea entfernen')).toBeNull();
});

test('Mitglied sieht Verlassen statt Löschen', async () => {
  mockAuth.userId = 'u2';
  await wrap();
  expect(await screen.findByText('Reise verlassen')).toBeTruthy();
  expect(screen.queryByText('Reise löschen')).toBeNull();
  expect(screen.queryByLabelText('Jonas entfernen')).toBeNull();
});

test('Owner sieht Löschen statt Verlassen', async () => {
  await wrap();
  expect(await screen.findByText('Reise löschen')).toBeTruthy();
  expect(screen.queryByText('Reise verlassen')).toBeNull();
});

test('aufgedeckte Reise zeigt keinen Einladen-Knopf', async () => {
  (fetchTrip as jest.Mock).mockResolvedValue({ ...trip, status: 'revealed' });
  await wrap();
  await screen.findByText('Norwegen mit dem Camper');
  expect(screen.queryByText('Freunde einladen')).toBeNull();
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/detail.test.tsx`
Expected: FAIL — `Cannot find module '../[id]/index'`.

- [ ] **Step 3: Detail-Screen implementieren**

Create `mobile/src/app/(tabs)/reise/[id]/index.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, X } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { deleteTrip, fetchMembers, fetchTrip, removeMember } from '@/features/trips/tripsApi';
import { formatRange, tripDay, tripLength } from '@/features/trips/tripDay';
import type { Trip, TripMember } from '@/features/trips/types';

export default function ReiseDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [mitglieder, setMitglieder] = useState<TripMember[]>([]);

  const laden = useCallback(async () => {
    const [t, m] = await Promise.all([fetchTrip(id), fetchMembers(id)]);
    setTrip(t);
    setMitglieder(m);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void laden();
    }, [laden])
  );

  if (!trip) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  const istOwner = trip.owner_id === userId;
  const laeuft = trip.status === 'active';
  const heute = new Date().toISOString().slice(0, 10);
  const tag = tripDay(trip.start_date, heute);
  const laenge = tripLength(trip.start_date, trip.end_date);

  const entfernen = (m: TripMember) => {
    Alert.alert(`${m.display_name} entfernen?`, 'Bereits eingesendete Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          void removeMember(id, m.user_id).then(laden);
        },
      },
    ]);
  };

  const verlassen = () => {
    Alert.alert('Reise verlassen?', 'Deine bereits eingesendeten Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: () => {
          if (!userId) return;
          void removeMember(id, userId).then(() => router.replace('/reise'));
        },
      },
    ]);
  };

  const loeschen = () => {
    Alert.alert('Reise löschen?', 'Die Reise und alle Momente darin verschwinden für alle.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          void deleteTrip(id).then(() => router.replace('/reise'));
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: colors['bg-0'] }} contentContainerStyle={styles.inhalt}>
      <View style={{ aspectRatio: 3 / 2, borderRadius: radius.card, backgroundColor: colors['bg-1'], padding: spacing.m }}>
        {laeuft && (
          <Badge label="Versiegelt" tone="seal" icon={<Lock size={12} color={colors.seal} strokeWidth={1.75} />} />
        )}
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {formatRange(trip.start_date, trip.end_date)}
        </Text>
        {laeuft && tag > 0 && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{`Tag ${tag} von ${laenge}`}</Text>
        )}
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.display, { color: colors['text-1'] }]}>{String(trip.my_post_count)}</Text>
        <Text style={[type.body, { color: colors['text-2'] }]}>
          Momente eingefangen — bis zum Recap versiegelt.
        </Text>
      </View>

      <View style={{ gap: spacing.m }}>
        <Text style={[type.h2, { color: colors['text-1'] }]}>Wer dabei ist</Text>
        {mitglieder.map((m) => (
          <View key={m.user_id} style={styles.zeile}>
            <Avatar name={m.display_name} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{m.display_name}</Text>
              <Text style={[type.secondary, { color: colors['text-2'] }]}>
                {m.role === 'owner' ? 'Hat die Reise angelegt' : `@${m.username}`}
              </Text>
            </View>
            {istOwner && m.user_id !== userId && (
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={`${m.display_name} entfernen`}
                onPress={() => entfernen(m)}
              >
                <X size={20} color={colors['text-2']} strokeWidth={1.75} />
              </PressScale>
            )}
          </View>
        ))}
      </View>

      {istOwner && laeuft && (
        <Button variant="primary" label="Freunde einladen" onPress={() => router.push(`/reise/${id}/einladen`)} />
      )}
      {istOwner && (
        <Button variant="secondary" label="Reise bearbeiten" onPress={() => router.push(`/reise/${id}/bearbeiten`)} />
      )}
      <Button
        variant="text"
        label={istOwner ? 'Reise löschen' : 'Reise verlassen'}
        onPress={istOwner ? loeschen : verlassen}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.xl },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
});
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/detail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/reise/\[id\]/index.tsx mobile/src/app/\(tabs\)/reise/__tests__/detail.test.tsx
git commit -m "feat(reise): Detailscreen mit Mitgliederverwaltung"
```

---

### Task 10: Einladen — QR-Code und Link teilen

**Files:**
- Modify: `mobile/package.json` (Abhängigkeit `react-native-qrcode-svg`)
- Create: `mobile/src/app/(tabs)/reise/[id]/einladen.tsx`
- Test: `mobile/src/app/(tabs)/reise/__tests__/einladen.test.tsx`

**Interfaces:**
- Consumes: `fetchInviteCode` aus `tripsApi`; `createInviteUrl` aus `inviteLink`; `Share` aus React Native; `Button`.
- Produces: Route `/reise/[id]/einladen`.

`react-native-qrcode-svg` ist reines JavaScript auf dem bereits installierten
`react-native-svg` — Expo Go bleibt damit nutzbar, kein Dev-Build nötig.

- [ ] **Step 1: Abhängigkeit installieren**

Run: `cd mobile && npx expo install react-native-qrcode-svg`
Expected: Installiert ohne Peer-Warnungen zu `react-native-svg`.

- [ ] **Step 2: Failing Test schreiben**

Create `mobile/src/app/(tabs)/reise/__tests__/einladen.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));
jest.mock('@/features/trips/tripsApi', () => ({ fetchInviteCode: jest.fn(async () => 'abc123') }));
jest.mock('@/features/trips/inviteLink', () => ({ createInviteUrl: (c: string) => `reelive://join/${c}` }));
jest.mock('react-native-qrcode-svg', () => 'QRCode');

import Einladen from '../[id]/einladen';

const wrap = () => render(<ThemeProvider><Einladen /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

test('zeigt den Hinweis, dass man jederzeit dazukommen kann', async () => {
  await wrap();
  expect(await screen.findByText(/jederzeit dazukommen/)).toBeTruthy();
});

test('teilt den Link über das System-Share-Sheet', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await wrap();
  await fireEvent.press(await screen.findByText('Link teilen'));
  await waitFor(() =>
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('reelive://join/abc123'),
    })
  );
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/einladen.test.tsx`
Expected: FAIL — `Cannot find module '../[id]/einladen'`.

- [ ] **Step 4: Einladen-Screen implementieren**

Create `mobile/src/app/(tabs)/reise/[id]/einladen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Share, Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing, type } from '@/theme/tokens';
import { fetchInviteCode } from '@/features/trips/tripsApi';
import { createInviteUrl } from '@/features/trips/inviteLink';

export default function Einladen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    void fetchInviteCode(id).then((code) => setUrl(code ? createInviteUrl(code) : null));
  }, [id]);

  const teilen = async () => {
    if (!url) return;
    await Share.share({ message: `Komm mit auf die Reise: ${url}` });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Freunde einladen</Text>
      <Text style={[type.body, { color: colors['text-2'] }]}>
        Scannen oder Link schicken. Deine Freunde können jederzeit dazukommen, auch mitten in der Reise.
      </Text>

      <View style={styles.qr}>
        {url && (
          // QRCode nimmt feste Farbwerte statt Style-Props — bewusst die
          // Token-Werte durchgereicht, keine neuen Hex-Werte.
          <QRCode value={url} size={220} color={palette['text-1']} backgroundColor={palette['bg-0']} />
        )}
      </View>

      <Button variant="primary" label="Link teilen" onPress={() => void teilen()} />
      <Button variant="text" label="Später" onPress={() => router.replace(`/reise/${id}`)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  qr: { alignItems: 'center', paddingVertical: spacing.xl },
});
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npx jest src/app/\(tabs\)/reise/__tests__/einladen.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/app/\(tabs\)/reise/\[id\]/einladen.tsx mobile/src/app/\(tabs\)/reise/__tests__/einladen.test.tsx
git commit -m "feat(reise): Einladen mit QR-Code und Link teilen"
```

---

### Task 11: Beitritt über den Link, auch quer durch den Login

**Files:**
- Create: `mobile/src/app/join/[code].tsx`
- Modify: `mobile/src/features/auth/guard.ts` (Funktion `isPublicArea` ergänzen)
- Modify: `mobile/src/app/_layout.tsx` (öffentlichen Bereich beachten, gemerkten Code einlösen)
- Test: `mobile/src/app/join/__tests__/join.test.tsx`
- Test: `mobile/src/features/auth/__tests__/guard.test.ts` (erweitern)

**Interfaces:**
- Consumes: `peekInvite`, `redeemInvite` aus `tripsApi`; `rememberInvite`, `takeRememberedInvite` aus `inviteLink`; `useAuth`.
- Produces: Route `/join/[code]`; `isPublicArea(area: string | undefined): boolean` in `guard.ts`.

- [ ] **Step 1: Guard-Test erweitern**

Ergänze in `mobile/src/features/auth/__tests__/guard.test.ts` am Ende:

```ts
import { isPublicArea } from '../guard';

test.each([
  ['join', true],
  ['(auth)', false],
  ['(tabs)', false],
  [undefined, false],
])('isPublicArea(%s) → %s', (area, expected) => {
  expect(isPublicArea(area)).toBe(expected);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/auth/__tests__/guard.test.ts`
Expected: FAIL — `isPublicArea is not a function`.

- [ ] **Step 3: guard.ts ergänzen**

Ergänze in `mobile/src/features/auth/guard.ts` am Ende:

```ts
// Der Beitritts-Screen muss auch ohne Session stehenbleiben dürfen: er zeigt die
// Vorschau und schickt erst beim Antippen in den Login. Ohne diese Ausnahme
// würde der Guard einen frisch angetippten Einladungslink sofort wegleiten.
export function isPublicArea(area: string | undefined): boolean {
  return area === 'join';
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `cd mobile && npx jest src/features/auth/__tests__/guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Root-Layout anpassen**

Ersetze in `mobile/src/app/_layout.tsx` die Funktion `Guarded` durch:

```tsx
function Guarded() {
  const { status } = useAuth();
  // Cast: mit experiments.typedRoutes engt useSegments() den Rückgabetyp auf die
  // aktuell existierenden Routen ein — segments[1] wäre sonst ein
  // Tuple-Out-of-Bounds-Fehler. Laufzeitverhalten unverändert.
  const segments = useSegments() as string[];
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    const target = resolveRoute(status);
    if (!target) return;
    void SplashScreen.hideAsync();
    const area = segments[0]; // '(auth)' | '(tabs)' | 'join' | undefined
    // Der Beitritts-Screen bleibt in jedem Status stehen.
    if (isPublicArea(area)) return;
    if (status === 'signedIn' && area !== '(tabs)') router.replace(target);
    if (status !== 'signedIn' && area !== '(auth)') router.replace(target);
    if (status === 'needsProfile' && segments[1] !== 'profile-setup') router.replace(target);
  }, [status, segments, router]);

  // Ein vor dem Login angetippter Einladungslink wird eingelöst, sobald Session
  // UND Profil stehen — vorher gäbe es keine profiles-Zeile für trip_members.
  useEffect(() => {
    if (status !== 'signedIn') return;
    let aktiv = true;
    void takeRememberedInvite().then(async (code) => {
      if (!code || !aktiv) return;
      const ergebnis = await redeemInvite(code);
      if (!aktiv) return;
      if (ergebnis.trip_id && (ergebnis.status === 'joined' || ergebnis.status === 'already_member')) {
        router.replace(`/reise/${ergebnis.trip_id}`);
      }
    });
    return () => {
      aktiv = false;
    };
  }, [status, router]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
    </>
  );
}
```

Ergänze oben in derselben Datei die Importe:

```tsx
import { resolveRoute, isPublicArea } from '@/features/auth/guard';
import { takeRememberedInvite } from '@/features/trips/inviteLink';
import { redeemInvite } from '@/features/trips/tripsApi';
```

(die bestehende Zeile `import { resolveRoute } from '@/features/auth/guard';` wird dabei ersetzt)

- [ ] **Step 6: Failing Test für den Beitritts-Screen schreiben**

Create `mobile/src/app/join/__tests__/join.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
  useLocalSearchParams: () => ({ code: 'abc123' }),
}));

const mockAuth = { status: 'signedIn' as string };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/features/trips/tripsApi', () => ({ peekInvite: jest.fn(), redeemInvite: jest.fn() }));
jest.mock('@/features/trips/inviteLink', () => ({ rememberInvite: jest.fn(async () => {}) }));

import JoinScreen from '../[code]';
import { peekInvite, redeemInvite } from '@/features/trips/tripsApi';
import { rememberInvite } from '@/features/trips/inviteLink';

const preview = {
  trip_id: 't1', name: 'Norwegen mit dem Camper', start_date: '2026-08-01',
  end_date: '2026-08-14', status: 'active' as const, member_count: 4, owner_display_name: 'Lea',
};

const wrap = () => render(<ThemeProvider><JoinScreen /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.status = 'signedIn';
  (peekInvite as jest.Mock).mockResolvedValue(preview);
});

test('zeigt die Vorschau samt einladender Person', async () => {
  await wrap();
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('Lea nimmt dich mit')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('unbekannter Code erklärt die Lage', async () => {
  (peekInvite as jest.Mock).mockResolvedValue(null);
  await wrap();
  expect(await screen.findByText('Diesen Einladungslink gibt es nicht mehr.')).toBeTruthy();
  expect(screen.queryByText('Reise beitreten')).toBeNull();
});

test('abgeschlossene Reise verweist auf den Recap-Link', async () => {
  (peekInvite as jest.Mock).mockResolvedValue({ ...preview, status: 'revealed' });
  await wrap();
  expect(
    await screen.findByText('Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.')
  ).toBeTruthy();
  expect(screen.queryByText('Reise beitreten')).toBeNull();
});

test('eingeloggt: Beitritt führt in die Reise', async () => {
  (redeemInvite as jest.Mock).mockResolvedValue({ status: 'joined', trip_id: 't1' });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise beitreten'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/reise/t1'));
});

test('bereits Mitglied führt ebenfalls in die Reise', async () => {
  (redeemInvite as jest.Mock).mockResolvedValue({ status: 'already_member', trip_id: 't1' });
  await wrap();
  await fireEvent.press(await screen.findByText('Reise beitreten'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/reise/t1'));
});

test('ohne Session wird der Code gemerkt und zum Login geschickt', async () => {
  mockAuth.status = 'signedOut';
  await wrap();
  await fireEvent.press(await screen.findByText('Reise beitreten'));
  await waitFor(() => expect(rememberInvite).toHaveBeenCalledWith('abc123'));
  expect(mockReplace).toHaveBeenCalledWith('/welcome');
  expect(redeemInvite).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/app/join/__tests__/join.test.tsx`
Expected: FAIL — `Cannot find module '../[code]'`.

- [ ] **Step 8: Beitritts-Screen implementieren**

Create `mobile/src/app/join/[code].tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { peekInvite, redeemInvite } from '@/features/trips/tripsApi';
import { rememberInvite } from '@/features/trips/inviteLink';
import { formatRange } from '@/features/trips/tripDay';
import type { InvitePreview } from '@/features/trips/types';

export default function JoinScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { status } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  useEffect(() => {
    void peekInvite(code).then((p) => {
      setPreview(p);
      setGeladen(true);
    });
  }, [code]);

  const beitreten = async () => {
    // Ohne Session zuerst anmelden — der Code wartet solange und wird vom
    // Root-Layout eingelöst, sobald Session und Profil stehen.
    if (status !== 'signedIn') {
      await rememberInvite(code);
      router.replace('/welcome');
      return;
    }
    setLaedt(true);
    const ergebnis = await redeemInvite(code);
    setLaedt(false);
    if (ergebnis.trip_id && (ergebnis.status === 'joined' || ergebnis.status === 'already_member')) {
      router.replace(`/reise/${ergebnis.trip_id}`);
      return;
    }
    setFehler(
      ergebnis.status === 'not_active'
        ? 'Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.'
        : 'Diesen Einladungslink gibt es nicht mehr.'
    );
  };

  if (!geladen) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  const offen = preview !== null && preview.status === 'active';
  const meldung =
    fehler ??
    (preview === null
      ? 'Diesen Einladungslink gibt es nicht mehr.'
      : preview.status !== 'active'
        ? 'Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.'
        : null);

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      {preview && (
        <>
          <Text style={[type.label, { color: colors['text-2'] }]}>
            {`${preview.owner_display_name} nimmt dich mit`}
          </Text>
          <Text style={[type.h1, { color: colors['text-1'] }]}>{preview.name}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(preview.start_date, preview.end_date)}
          </Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {`${preview.member_count} ${preview.member_count === 1 ? 'Person ist' : 'Personen sind'} dabei`}
          </Text>
        </>
      )}

      {meldung && <Text style={[type.body, { color: colors.danger }]}>{meldung}</Text>}

      <View style={{ marginTop: spacing.xl }}>
        {offen && !fehler ? (
          <Button variant="primary" label="Reise beitreten" onPress={() => void beitreten()} loading={laedt} />
        ) : (
          <Button variant="secondary" label="Zu meinen Reisen" onPress={() => router.replace('/reise')} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.s },
});
```

- [ ] **Step 9: Alle Tests und Typen prüfen**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: Alles grün.

- [ ] **Step 10: Commit**

```bash
git add mobile/src/app/join mobile/src/features/auth/guard.ts mobile/src/features/auth/__tests__/guard.test.ts mobile/src/app/_layout.tsx
git commit -m "feat(invite): Beitritts-Screen und Einloesen ueber den Login hinweg"
```

---

### Task 12: Verifikation am laufenden System

**Files:** keine — dieser Task prüft nur.

- [ ] **Step 1: Backend frisch aufsetzen**

Run: `supabase db reset && supabase test db`
Expected: Migrationen und Seed laufen durch; alle pgTAP-Dateien grün (92 aus Phase 1/2 plus 18 neue).

- [ ] **Step 2: App-Suite und Typen**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: Alle Jest-Tests grün, keine Typfehler.

- [ ] **Step 3: Dev-Server starten**

Run: `cd mobile && npx expo start --ios`
Expected: Metro bündelt, die App öffnet im Simulator.

- [ ] **Step 4: Reise anlegen und einladen**

Als `+41 79 000 00 01` (Code `123456`) anmelden. Im Reise-Tab müssen die drei
Seed-Reisen erscheinen: «Norwegen mit dem Camper» unter *Unterwegs*, «Lissabon
Städtetrip» und «Sardinien im Van» unter *Recaps*. Eine neue Reise anlegen — danach
muss der Einladen-Screen mit QR-Code erscheinen. Link teilen antippen und den Link
aus dem Share-Sheet kopieren.

- [ ] **Step 5: Beitritt mit dem zweiten Konto**

Abmelden, als `+41 79 000 00 02` anmelden (dieses Konto hat kein Profil und läuft
zuerst durch das Onboarding). Den Link öffnen:

```bash
xcrun simctl openurl booted "<kopierter Link>"
```

Expected: Der Beitritts-Screen zeigt Reisename, Zeitraum und «Lea nimmt dich mit».
Nach «Reise beitreten» landet man im Detail der Reise und steht in der
Mitgliederliste.

- [ ] **Step 6: Beitritt vor dem Login**

Abmelden, denselben Link erneut öffnen. Expected: Vorschau erscheint trotz fehlender
Session; «Reise beitreten» führt zum Login; nach dem Login landet man direkt im
Detail der Reise, ohne den Link nochmal anzutippen.

- [ ] **Step 7: Mitgliederverwaltung**

Als Owner ein Mitglied entfernen (Bestätigungsdialog erscheint, danach ist die Zeile
weg). Als Mitglied die Reise verlassen. Expected: Die Reise verschwindet aus der
Liste des Mitglieds, bleibt beim Owner bestehen.

- [ ] **Step 8: Ergebnis festhalten**

Wenn ein Schritt scheitert: Fehler beschreiben, Ursache suchen, korrigieren, den
betroffenen Task-Test ergänzen. Erst wenn alle acht Schritte durchlaufen, ist Phase 3
fertig.

---

## Offene Punkte nach Phase 3

- Universal Links / App Links inklusive Store-Fallback (braucht eine Domain, Phase 6).
- Rate-Limit auf `peek_invite` gegen Code-Enumeration (2⁴⁸ Codes, in V1 vertretbar).
- Cover-Bilder für Reisen (Phase 4, sobald R2 angebunden ist).
- Die Auth-Screens haben oben keinen Safe-Area-Abstand — beim Simulator-Durchlauf
  aufgefallen, gehört in einen eigenen kleinen Fix.
