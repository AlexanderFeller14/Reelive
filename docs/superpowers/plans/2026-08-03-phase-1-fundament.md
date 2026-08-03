# Phase 1: Backend-Fundament & Versiegelungs-Kern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Komplettes Reelive-Datenbankschema mit serverseitig erzwungener Versiegelung, bewiesen durch automatisierte RLS-Policy-Tests.

**Architecture:** Supabase-Projekt (lokal via Supabase CLI, später EU-Region Frankfurt). Alles Schema als versionierte SQL-Migrationen in `supabase/migrations/`. Jede Sicherheitsregel als Row-Level-Security-Policy, getestet mit pgTAP-Tests in `supabase/tests/`, die echte Nutzer-Sessions simulieren (`request.jwt.claims` + Rolle `authenticated`).

**Tech Stack:** Supabase CLI, Postgres, pgTAP (`supabase test db`)

## Global Constraints

- Versiegelung wird serverseitig erzwungen (RLS), niemals nur in der UI — vor dem Reveal liest **niemand** Beiträge, auch der Autor nicht (Spec §4).
- Sortierung von Beiträgen IMMER nach `captured_at` (Gerätezeit, UTC) + `captured_tz`, nie nach Upload-Zeit (Spec §5).
- Nach dem Reveal keine neuen Aufnahmen; angenommen werden nur Uploads mit `captured_at` vor dem Reveal-Zeitpunkt (Spec §7).
- Video-Clips ≤ 30 s; Captions ≤ 120 Zeichen (Spec §2/§5).
- Trip-Status-Übergänge (`active → revealed → archived`) macht nie der Client direkt, nur Edge Functions mit Service-Role (Phase 5); in Phase 1 wird das Status-Feld für `authenticated` schreibgeschützt.
- Kostenziel ~0–30 CHF/Monat: nur Supabase Free Tier, keine Zusatzdienste in Phase 1.

**Voraussetzungen:** Docker Desktop läuft; Supabase CLI installiert (`brew install supabase/tap/supabase`). Alle Befehle im Repo-Root `/Users/lx/PycharmProjects/Reelive` ausführen.

## File Structure

```
supabase/
  config.toml                                  # von supabase init erzeugt
  migrations/
    20260803090000_core_tables.sql             # Task 2: profiles, trips, trip_members
    20260803090100_content_tables.sql          # Task 3: posts, reactions, comments, share_links, reports
    20260803090200_membership_rls.sql          # Task 4: Helper, Trigger, Policies für profiles/trips/trip_members
    20260803090300_sealing_rls.sql             # Task 5: Versiegelungs-Policies für posts
    20260803090400_post_count.sql              # Task 6: Zähler-Funktion
    20260803090500_social_rls.sql              # Task 7: Policies für reactions/comments/share_links/reports
  tests/
    01_schema_core_test.sql                    # Task 2
    02_schema_content_test.sql                 # Task 3
    03_membership_rls_test.sql                 # Task 4
    04_sealing_rls_test.sql                    # Task 5 (wichtigste Testdatei des Projekts)
    05_post_count_test.sql                     # Task 6
    06_social_rls_test.sql                     # Task 7
```

**Wiederkehrender Test-Baustein:** Jede RLS-Testdatei simuliert Nutzer über diesen Block (bewusst pro Datei wiederholt, damit jede Datei allein lesbar ist):

```sql
-- Testnutzer in auth.users anlegen (als Superuser, vor dem Rollenwechsel)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@test.local');

-- Session-Simulation: danach gilt auth.uid() = p_user und RLS greift
create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Zurück zum Superuser (für Seeding zwischen Prüfungen)
create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;
```

---

### Task 1: Supabase-Projekt initialisieren

**Files:**
- Create: `supabase/config.toml` (via CLI)
- Create: `README.md`

**Interfaces:**
- Produces: lauffähige lokale Supabase-Instanz; `supabase test db` als Test-Runner für alle folgenden Tasks.

- [ ] **Step 1: Projekt initialisieren**

```bash
supabase init
```

Expected: `supabase/config.toml` existiert.

- [ ] **Step 2: Lokale Instanz starten und verifizieren**

```bash
supabase start
supabase status
```

Expected: `supabase status` zeigt laufende Services mit API URL `http://127.0.0.1:54321` und DB URL auf Port 54322.

- [ ] **Step 3: Leeren Test-Lauf verifizieren**

```bash
mkdir -p supabase/tests
supabase test db
```

Expected: läuft durch ohne Fehler (keine Tests gefunden ist okay). Falls der Befehl pgTAP anmahnt: jede Testdatei aktiviert die Extension selbst (siehe Task 2).

- [ ] **Step 4: README mit Dev-Setup schreiben**

````markdown
# Reelive

Gemeinsames Reisetagebuch: privates Reiseprojekt, Freunde einladen, spontane
Foto-/Videomomente einsenden — versiegelt bis zum Reveal. Nach der Reise ein
chronologischer Recap aus allen Perspektiven.

Design-Spec: docs/superpowers/specs/2026-08-03-reelive-design.md
Roadmap: docs/superpowers/plans/2026-08-03-reelive-v1-roadmap.md

## Entwicklung (Backend)

Voraussetzungen: Docker Desktop, Supabase CLI (`brew install supabase/tap/supabase`)

```bash
supabase start        # lokale Instanz (API :54321, DB :54322, Studio :54323)
supabase db reset     # Migrationen neu einspielen
supabase test db      # pgTAP-Tests (RLS-Policies!) ausführen
```

Regel: Schema-Änderungen NUR über Migrationen in `supabase/migrations/`.
Jede RLS-Policy braucht Tests in `supabase/tests/`.
````

- [ ] **Step 5: Commit**

```bash
git add supabase README.md
git commit -m "chore: Supabase-Projekt initialisiert, Dev-Setup dokumentiert"
```

---

### Task 2: Kern-Tabellen — profiles, trips, trip_members

**Files:**
- Create: `supabase/migrations/20260803090000_core_tables.sql`
- Test: `supabase/tests/01_schema_core_test.sql`

**Interfaces:**
- Produces: Tabellen `public.profiles`, `public.trips` (mit Enum `trip_status`, Spalte `revealed_at`), `public.trip_members`. Alle späteren Tasks referenzieren exakt diese Namen.

- [ ] **Step 1: Failing Test schreiben** — `supabase/tests/01_schema_core_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(12);

select has_table('public', 'profiles', 'profiles existiert');
select has_column('public', 'profiles', 'username', 'profiles.username');

select has_table('public', 'trips', 'trips existiert');
select has_column('public', 'trips', 'status', 'trips.status');
select has_column('public', 'trips', 'invite_code', 'trips.invite_code');
select has_column('public', 'trips', 'revealed_at', 'trips.revealed_at');
select has_column('public', 'trips', 'plan', 'trips.plan');

select has_table('public', 'trip_members', 'trip_members existiert');
select col_is_pk('public', 'trip_members', array['trip_id','user_id'], 'PK (trip_id, user_id)');

-- Constraints
select throws_ok(
  $$insert into public.trips (name, start_date, end_date, owner_id)
    values ('Test', '2026-08-10', '2026-08-01', '00000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'end_date >= start_date wird erzwungen');

select throws_ok(
  $$insert into public.profiles (id, username, display_name)
    values ('00000000-0000-0000-0000-000000000001', 'AB', 'Zu kurz')$$,
  '23514', null, 'Username-Format wird erzwungen');

select throws_ok(
  $$insert into public.trips (name, start_date, end_date, owner_id, status)
    values ('Test', '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-000000000001', 'geheim')$$,
  '22P02', null, 'Nur gültige Status-Werte');

select * from finish();
rollback;
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

```bash
supabase test db
```

Expected: FAIL («profiles existiert» schlägt fehl).

- [ ] **Step 3: Migration schreiben** — `supabase/migrations/20260803090000_core_tables.sql`:

```sql
-- Nutzerprofile (1:1 zu auth.users, wird im Onboarding vom Client angelegt)
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_key   text,
  created_at   timestamptz not null default now()
);

create type public.trip_status as enum ('active', 'revealed', 'archived');

-- Reiseprojekte. status wechselt NUR via Edge Function (Service-Role, Phase 5).
create table public.trips (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  cover_key   text,
  start_date  date not null,
  end_date    date not null,
  status      public.trip_status not null default 'active',
  revealed_at timestamptz,
  invite_code text unique not null default encode(gen_random_bytes(6), 'hex'),
  owner_id    uuid not null references public.profiles (id),
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  check ((status = 'active') = (revealed_at is null))
);

create table public.trip_members (
  trip_id   uuid not null references public.trips (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index trip_members_user_idx on public.trip_members (user_id);
```

- [ ] **Step 4: Migration einspielen, Test muss grün sein**

```bash
supabase db reset && supabase test db
```

Expected: PASS (12/12).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803090000_core_tables.sql supabase/tests/01_schema_core_test.sql
git commit -m "feat(db): Kern-Tabellen profiles, trips, trip_members"
```

---

### Task 3: Inhalts-Tabellen — posts, reactions, comments, share_links, reports

**Files:**
- Create: `supabase/migrations/20260803090100_content_tables.sql`
- Test: `supabase/tests/02_schema_content_test.sql`

**Interfaces:**
- Consumes: `public.trips`, `public.profiles` (Task 2)
- Produces: `public.posts` (mit `captured_at`, `captured_tz`, `upload_status`), `public.reactions`, `public.comments`, `public.share_links`, `public.reports`.

- [ ] **Step 1: Failing Test schreiben** — `supabase/tests/02_schema_content_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(10);

select has_table('public', 'posts', 'posts existiert');
select has_column('public', 'posts', 'captured_at', 'posts.captured_at');
select has_column('public', 'posts', 'captured_tz', 'posts.captured_tz');
select has_table('public', 'reactions', 'reactions existiert');
select has_table('public', 'comments', 'comments existiert');
select has_table('public', 'share_links', 'share_links existiert');
select has_table('public', 'reports', 'reports existiert');

-- Vorbereitung: Nutzer + Trip als Superuser
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'anna@test.local');
insert into public.profiles (id, username, display_name)
  values ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, duration_s, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'video', 'k', 31, now(), 'Europe/Zurich')$$,
  '23514', null, 'Videos länger als 30s werden abgelehnt');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, caption, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'k', repeat('x', 121), now(), 'Europe/Zurich')$$,
  '23514', null, 'Captions über 120 Zeichen werden abgelehnt');

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'kino', 'k', now(), 'Europe/Zurich')$$,
  '22P02', null, 'Nur photo/video als Typ');

select * from finish();
rollback;
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

```bash
supabase test db
```

Expected: FAIL («posts existiert»).

- [ ] **Step 3: Migration schreiben** — `supabase/migrations/20260803090100_content_tables.sql`:

```sql
create type public.post_type as enum ('photo', 'video');
create type public.upload_status as enum ('pending', 'uploaded');

-- Ein eingesendeter Moment. Chronologie IMMER über captured_at (Gerätezeit).
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete cascade,
  type          public.post_type not null,
  storage_key   text not null,
  thumb_key     text,
  duration_s    numeric check (duration_s is null or duration_s between 0 and 30),
  caption       text check (caption is null or char_length(caption) <= 120),
  captured_at   timestamptz not null,
  captured_tz   text not null,
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),
  place_name    text,
  upload_status public.upload_status not null default 'pending',
  created_at    timestamptz not null default now()
);

create index posts_trip_captured_idx on public.posts (trip_id, captured_at);

create table public.reactions (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

-- Öffentliche Recap-Links (Auflösung nur via Edge Function, Phase 6)
create table public.share_links (
  token      text primary key default encode(gen_random_bytes(16), 'hex'),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  expires_at timestamptz,
  revoked    boolean not null default false,
  created_at timestamptz not null default now()
);

-- Moderations-Pflicht für den Store
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now()
);
```

- [ ] **Step 4: Migration einspielen, Test muss grün sein**

```bash
supabase db reset && supabase test db
```

Expected: PASS (10/10 in Datei 02, Datei 01 weiter grün).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803090100_content_tables.sql supabase/tests/02_schema_content_test.sql
git commit -m "feat(db): Inhalts-Tabellen posts, reactions, comments, share_links, reports"
```

---

### Task 4: RLS für profiles, trips, trip_members

**Files:**
- Create: `supabase/migrations/20260803090200_membership_rls.sql`
- Test: `supabase/tests/03_membership_rls_test.sql`

**Interfaces:**
- Consumes: Tabellen aus Task 2
- Produces: `public.is_trip_member(p_trip_id uuid, p_user_id uuid) returns boolean` (security definer — verhindert RLS-Rekursion auf trip_members; wird in Task 5–7 wiederverwendet); Trigger `trips_add_owner_membership` (Owner wird bei Trip-Erstellung automatisch Mitglied).

- [ ] **Step 1: Failing Test schreiben** — `supabase/tests/03_membership_rls_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben'),
  ('00000000-0000-0000-0000-00000000000c', 'carla', 'Carla');

select is(rowsecurity, true, 'RLS aktiv auf trips')
  from pg_tables where schemaname = 'public' and tablename = 'trips';

-- Anna erstellt einen Trip → wird automatisch Owner-Mitglied
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');

select is(count(*)::int, 1, 'Owner-Mitgliedschaft wurde per Trigger angelegt')
  from public.trip_members
  where trip_id = '11111111-1111-1111-1111-111111111111'
    and user_id = '00000000-0000-0000-0000-00000000000a' and role = 'owner';

select is(count(*)::int, 1, 'Anna sieht ihren Trip')
  from public.trips where id = '11111111-1111-1111-1111-111111111111';

-- Ben ist kein Mitglied → sieht nichts
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 0, 'Nicht-Mitglied sieht den Trip nicht')
  from public.trips where id = '11111111-1111-1111-1111-111111111111';

-- Ben wird Mitglied (Superuser simuliert die Invite-Edge-Function aus Phase 3)
select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 1, 'Mitglied sieht den Trip')
  from public.trips where id = '11111111-1111-1111-1111-111111111111';
select is(count(*)::int, 2, 'Mitglied sieht die Mitgliederliste')
  from public.trip_members where trip_id = '11111111-1111-1111-1111-111111111111';
select is(count(*)::int, 1, 'Mitglied sieht Profil des Mitreisenden')
  from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
select is(count(*)::int, 0, 'Kein Zugriff auf Profile Fremder')
  from public.profiles where id = '00000000-0000-0000-0000-00000000000c';

-- Status-Manipulation durch Client ist verboten (Spec: nur Edge Function)
select throws_ok(
  $$update public.trips set status = 'revealed'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'Client kann trips.status nicht direkt setzen');

select * from finish();
rollback;
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

```bash
supabase test db
```

Expected: FAIL (Trigger existiert nicht, RLS nicht aktiv).

- [ ] **Step 3: Migration schreiben** — `supabase/migrations/20260803090200_membership_rls.sql`:

```sql
-- Security-Definer-Helper: bricht die RLS-Rekursion auf trip_members
create or replace function public.is_trip_member(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = p_user_id
  );
$$;

create or replace function public.shares_trip_with(p_other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.trip_members me
    join public.trip_members other on other.trip_id = me.trip_id
    where me.user_id = auth.uid() and other.user_id = p_other
  );
$$;

-- Owner wird bei Trip-Erstellung automatisch Mitglied
create or replace function public.add_owner_membership()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger trips_add_owner_membership
  after insert on public.trips
  for each row execute function public.add_owner_membership();

alter table public.profiles     enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_members enable row level security;

-- profiles: eigenes Profil verwalten; Mitreisende sehen
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());
create policy profiles_select_own_or_shared on public.profiles
  for select using (id = auth.uid() or public.shares_trip_with(id));

-- trips: Mitglieder lesen; nur Owner erstellt/ändert/löscht
create policy trips_select_member on public.trips
  for select using (public.is_trip_member(id, auth.uid()));
create policy trips_insert_owner on public.trips
  for insert with check (owner_id = auth.uid());
create policy trips_update_owner on public.trips
  for update using (owner_id = auth.uid());
create policy trips_delete_owner on public.trips
  for delete using (owner_id = auth.uid());

-- Status/revealed_at/invite_code/plan sind für Clients schreibgeschützt:
-- Tabellen-Grant entziehen, nur harmlose Spalten freigeben
revoke update on public.trips from authenticated;
grant update (name, cover_key, start_date, end_date) on public.trips to authenticated;

-- trip_members: Mitglieder sehen die Liste; beitreten NUR via Edge Function
-- (Service-Role, Phase 3) oder Owner-Trigger — darum keine Insert-Policy.
create policy trip_members_select_member on public.trip_members
  for select using (public.is_trip_member(trip_id, auth.uid()));
-- Verlassen (selbst, ausser Owner) oder Entfernen (durch Owner)
create policy trip_members_delete on public.trip_members
  for delete using (
    (user_id = auth.uid() and role <> 'owner')
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.owner_id = auth.uid() and user_id <> t.owner_id
    )
  );
```

- [ ] **Step 4: Migration einspielen, Test muss grün sein**

```bash
supabase db reset && supabase test db
```

Expected: PASS (alle Dateien grün).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803090200_membership_rls.sql supabase/tests/03_membership_rls_test.sql
git commit -m "feat(db): RLS für profiles, trips, trip_members inkl. Owner-Trigger"
```

---

### Task 5: Versiegelungs-Policies für posts (Kern des Produkts)

**Files:**
- Create: `supabase/migrations/20260803090300_sealing_rls.sql`
- Test: `supabase/tests/04_sealing_rls_test.sql`

**Interfaces:**
- Consumes: `public.is_trip_member` (Task 4), `public.posts` (Task 3), `trips.status`/`trips.revealed_at` (Task 2)
- Produces: RLS-Regeln, auf die sich Recap (Phase 5) und Upload (Phase 4) verlassen: SELECT nur bei `status = 'revealed'` + Mitgliedschaft; INSERT nur als Mitglied für sich selbst; nach Reveal nur Nachzügler (`captured_at <= revealed_at`).

- [ ] **Step 1: Failing Test schreiben** — `supabase/tests/04_sealing_rls_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben'),
  ('00000000-0000-0000-0000-00000000000c', 'carla', 'Carla');

-- Trip mit Anna (Owner) + Ben; Carla ist aussen vor
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- === Phase AKTIV ===
select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000a', 'photo', 'trips/x/1.jpg',
          '2026-08-02 10:00+00', 'Europe/Lisbon');
select pass('Mitglied kann während aktiver Reise einsenden');

select is(count(*)::int, 0, 'VERSIEGELT: Autorin liest den eigenen Post vor Reveal NICHT')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 0, 'VERSIEGELT: Mitglied liest fremde Posts vor Reveal nicht')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
            'photo', 'k', now(), 'Europe/Lisbon')$$,
  '42501', null, 'Niemand kann Posts im Namen anderer einsenden');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000c',
            'photo', 'k', now(), 'Europe/Lisbon')$$,
  '42501', null, 'Nicht-Mitglieder können nicht einsenden');

-- === REVEAL === (Superuser simuliert die Edge Function aus Phase 5)
select pg_temp.logout();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(count(*)::int, 1, 'Nach Reveal: Mitglied sieht alle Posts')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select is(count(*)::int, 0, 'Nach Reveal: Nicht-Mitglied sieht weiterhin nichts')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

-- Nachzügler: vor dem Reveal aufgenommen → erlaubt
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b',
          'photo', 'trips/x/2.jpg', '2026-08-09 12:00+00', 'Europe/Lisbon');
select pass('Nachzügler-Upload (captured_at vor Reveal) wird angenommen');

-- Neue Aufnahme nach dem Reveal → abgelehnt
select throws_ok(
  $$insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b',
            'photo', 'k', '2026-08-11 09:00+00', 'Europe/Lisbon')$$,
  '42501', null, 'Neue Aufnahmen nach Reveal werden abgelehnt');

select * from finish();
rollback;
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

```bash
supabase test db
```

Expected: FAIL — aktuell hat `posts` gar kein RLS, die «VERSIEGELT»-Prüfungen schlagen fehl, weil Posts sichtbar sind.

- [ ] **Step 3: Migration schreiben** — `supabase/migrations/20260803090300_sealing_rls.sql`:

```sql
alter table public.posts enable row level security;

-- DIE Kernregel des Produkts: Lesen erst nach dem Reveal, nur für Mitglieder.
-- Es gibt bewusst KEINE weitere Select-Policy — dadurch liest vor dem Reveal
-- niemand irgendeinen Post, auch der Autor nicht (Spec §4 «Filmrolle»).
create policy posts_select_revealed_members on public.posts
  for select using (
    public.is_trip_member(trip_id, auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id and t.status = 'revealed'
    )
  );

-- Einsenden: nur Mitglieder, nur im eigenen Namen.
-- Aktive Reise: immer. Nach Reveal: nur Nachzügler (Aufnahme lag vor dem Reveal).
create policy posts_insert_member on public.posts
  for insert with check (
    author_id = auth.uid()
    and public.is_trip_member(trip_id, auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
        and (t.status = 'active'
             or (t.status = 'revealed' and captured_at <= t.revealed_at))
    )
  );

-- Löschen nach Reveal: Autor den eigenen Post, Owner jeden (Moderation).
create policy posts_delete_after_reveal on public.posts
  for delete using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id and t.status = 'revealed'
        and (posts.author_id = auth.uid() or t.owner_id = auth.uid())
    )
  );

-- Kein Update-Zugriff für Clients: Posts sind unveränderlich
-- (upload_status setzt die Upload-Edge-Function mit Service-Role, Phase 4)
revoke update on public.posts from authenticated;
```

- [ ] **Step 4: Migration einspielen, Test muss grün sein**

```bash
supabase db reset && supabase test db
```

Expected: PASS (9/9 — insbesondere beide «VERSIEGELT»-Prüfungen).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803090300_sealing_rls.sql supabase/tests/04_sealing_rls_test.sql
git commit -m "feat(db): Versiegelungs-RLS für posts — Kernmechanik serverseitig erzwungen"
```

---

### Task 6: Zähler-Funktion my_post_count

**Files:**
- Create: `supabase/migrations/20260803090400_post_count.sql`
- Test: `supabase/tests/05_post_count_test.sql`

**Interfaces:**
- Consumes: `public.posts`, `public.is_trip_member`
- Produces: `public.my_post_count(p_trip_id uuid) returns bigint` — einzige erlaubte Information über versiegelte Posts («Du hast 23 Momente eingefangen»). Phase 4 ruft sie via `supabase.rpc('my_post_count', { p_trip_id })` auf.

- [ ] **Step 1: Failing Test schreiben** — `supabase/tests/05_post_count_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@test.local');

create or replace function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben'),
  ('00000000-0000-0000-0000-00000000000c', 'carla', 'Carla');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');

insert into public.posts (trip_id, author_id, type, storage_key, captured_at, captured_tz) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
   'photo', 'a1', '2026-08-02 10:00+00', 'Europe/Lisbon'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
   'photo', 'a2', '2026-08-02 11:00+00', 'Europe/Lisbon');

select is(public.my_post_count('11111111-1111-1111-1111-111111111111'), 2::bigint,
  'Autorin sieht die eigene Anzahl trotz Versiegelung');

select is(count(*)::int, 0, 'Gegenprobe: direkte Post-Abfrage bleibt leer')
  from public.posts where trip_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select is(public.my_post_count('11111111-1111-1111-1111-111111111111'), 0::bigint,
  'Mitglied ohne Posts hat Zähler 0 — sieht NICHT die Anzahl der anderen');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$select public.my_post_count('11111111-1111-1111-1111-111111111111')$$,
  'P0001', 'not a trip member', 'Nicht-Mitglieder erhalten einen Fehler');

select * from finish();
rollback;
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

```bash
supabase test db
```

Expected: FAIL («function public.my_post_count does not exist»).

- [ ] **Step 3: Migration schreiben** — `supabase/migrations/20260803090400_post_count.sql`:

```sql
-- Einzige erlaubte Information über versiegelte Posts: der EIGENE Zähler.
-- security definer, weil RLS die Posts vor dem Reveal komplett verbirgt.
create or replace function public.my_post_count(p_trip_id uuid)
returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip_id, auth.uid()) then
    raise exception 'not a trip member';
  end if;
  return (
    select count(*) from public.posts
    where trip_id = p_trip_id and author_id = auth.uid()
  );
end $$;
```

- [ ] **Step 4: Migration einspielen, Test muss grün sein**

```bash
supabase db reset && supabase test db
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803090400_post_count.sql supabase/tests/05_post_count_test.sql
git commit -m "feat(db): my_post_count — eigener Zähler trotz Versiegelung"
```

---

### Task 7: RLS für reactions, comments, share_links, reports

**Files:**
- Create: `supabase/migrations/20260803090500_social_rls.sql`
- Test: `supabase/tests/06_social_rls_test.sql`

**Interfaces:**
- Consumes: `public.is_trip_member`, Tabellen aus Task 3, Versiegelungs-Logik aus Task 5
- Produces: RLS-Regeln, auf die sich der Recap-Player (Phase 5) und Teilen/Moderation (Phase 6) verlassen. Grundprinzip: Reaktionen/Kommentare/Reports nur auf Posts, die man lesen darf (= nach Reveal).

- [ ] **Step 1: Failing Test schreiben** — `supabase/tests/06_social_rls_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(8);

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

create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'anna', 'Anna'),
  ('00000000-0000-0000-0000-00000000000b', 'ben', 'Ben');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
insert into public.trips (id, name, start_date, end_date, owner_id)
  values ('11111111-1111-1111-1111-111111111111', 'Lissabon',
          '2026-08-01', '2026-08-10', '00000000-0000-0000-0000-00000000000a');
insert into public.posts (id, trip_id, author_id, type, storage_key, captured_at, captured_tz)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-00000000000a', 'photo', 'k1',
          '2026-08-02 10:00+00', 'Europe/Lisbon');
select pg_temp.logout();
insert into public.trip_members (trip_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

-- Vor dem Reveal: keine Reaktionen möglich (Post ist unsichtbar)
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.reactions (post_id, user_id, emoji)
    values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', '🔥')$$,
  '42501', null, 'Vor Reveal keine Reaktionen möglich');

-- Reveal
select pg_temp.logout();
update public.trips set status = 'revealed', revealed_at = '2026-08-10 18:00+00'
  where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
insert into public.reactions (post_id, user_id, emoji)
  values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', '🔥');
select pass('Nach Reveal: Mitglied reagiert');

insert into public.comments (post_id, user_id, text)
  values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'Bestes Foto!');
select pass('Nach Reveal: Mitglied kommentiert');

select pg_temp.login_as('00000000-0000-0000-0000-00000000000a');
select is(count(*)::int, 1, 'Reaktionen sind für Mitglieder sichtbar')
  from public.reactions where post_id = '22222222-2222-2222-2222-222222222222';
select is(count(*)::int, 1, 'Kommentare sind für Mitglieder sichtbar')
  from public.comments where post_id = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$insert into public.comments (post_id, user_id, text)
    values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'Fälschung')$$,
  '42501', null, 'Kommentare nur im eigenen Namen');

insert into public.reports (post_id, reporter_id, reason)
  values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'Unangebracht');
select pass('Mitglied kann Post melden');

-- share_links: nur der Owner verwaltet sie
select pg_temp.login_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$insert into public.share_links (trip_id)
    values ('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'Nur der Owner erstellt Share-Links');

select * from finish();
rollback;
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

```bash
supabase test db
```

Expected: FAIL — reactions/comments haben noch kein RLS, die Vor-Reveal-Sperre fehlt.

- [ ] **Step 3: Migration schreiben** — `supabase/migrations/20260803090500_social_rls.sql`:

```sql
alter table public.reactions   enable row level security;
alter table public.comments    enable row level security;
alter table public.share_links enable row level security;
alter table public.reports     enable row level security;

-- Sichtbarkeit eines Posts (= Mitglied + Trip revealed) als wiederverwendbare Regel
create or replace function public.can_see_post(p_post_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    join public.trips t on t.id = p.trip_id
    where p.id = p_post_id
      and t.status = 'revealed'
      and public.is_trip_member(p.trip_id, auth.uid())
  );
$$;

-- reactions: lesen/reagieren nur auf sichtbare Posts, nur im eigenen Namen
create policy reactions_select on public.reactions
  for select using (public.can_see_post(post_id));
create policy reactions_insert on public.reactions
  for insert with check (user_id = auth.uid() and public.can_see_post(post_id));
create policy reactions_delete_own on public.reactions
  for delete using (user_id = auth.uid());

-- comments: gleiches Prinzip; löschen darf der Verfasser
create policy comments_select on public.comments
  for select using (public.can_see_post(post_id));
create policy comments_insert on public.comments
  for insert with check (user_id = auth.uid() and public.can_see_post(post_id));
create policy comments_delete_own on public.comments
  for delete using (user_id = auth.uid());

-- share_links: ausschliesslich der Trip-Owner, nur für revealed Trips.
-- Öffentliche Auflösung eines Tokens läuft NIE über diese Tabelle direkt,
-- sondern über eine Edge Function mit Service-Role (Phase 6).
create policy share_links_all_owner on public.share_links
  for all using (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid()
              and t.status = 'revealed')
  );

-- reports: melden kann jedes Mitglied (nur sichtbare Posts, eigener Name);
-- lesen darf sie der Trip-Owner (Moderation)
create policy reports_insert on public.reports
  for insert with check (reporter_id = auth.uid() and public.can_see_post(post_id));
create policy reports_select_owner on public.reports
  for select using (
    exists (
      select 1 from public.posts p
      join public.trips t on t.id = p.trip_id
      where p.id = post_id and t.owner_id = auth.uid()
    )
  );
```

- [ ] **Step 4: Migration einspielen, Test muss grün sein**

```bash
supabase db reset && supabase test db
```

Expected: PASS — alle 6 Testdateien grün.

- [ ] **Step 5: Gesamtlauf als Abschluss-Beweis**

```bash
supabase db reset && supabase test db
```

Expected: Alle Migrationen sauber von null, alle Tests grün. Das ist das Phase-1-Deliverable.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803090500_social_rls.sql supabase/tests/06_social_rls_test.sql
git commit -m "feat(db): RLS für reactions, comments, share_links, reports"
```
