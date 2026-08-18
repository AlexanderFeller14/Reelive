# Auto-Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Reise wird am Tag nach ihrem Enddatum automatisch aufgedeckt (Status `revealed`, Push an alle Mitglieder), und die Owner-Person bekommt am Morgen des letzten Tags eine Erinnerung.

**Architecture:** pg_cron ruft über einen SQL-Wrapper (Vault-Secrets, pg_net) zweimal täglich die neue Edge Function `reveal-zeitplan` auf. Deren reine Entscheidungslogik (`zeitplan.ts`) liegt über einer Store-Schnittstelle, die die bestehende `RevealStore`-Schnittstelle von reveal-trip erweitert; CAS-Update und Push-Versand werden aus `reveal-trip` wiederverwendet. Der Kalendertag «heute» wird in SQL berechnet (Europe/Zurich, DB-Uhr) und der Function im Body mitgegeben.

**Tech Stack:** Supabase (Postgres, pg_cron, pg_net, Vault, Edge Functions/Deno), Expo Push, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-18-auto-reveal-design.md`

## Global Constraints

- Alle Texte Deutsch, Du-Form; typografische Anführungszeichen «…» (DESIGN-LANGUAGE §6).
- Keine Em-Dashes (—) in Texten, Kommentaren und Commit-Messages.
- Zeitreferenz fest **Europe/Zurich**; die Cron-Zeiten sind UTC: `10 23 * * *` (Reveal) und `30 7 * * *` (Erinnerung).
- Schema-Änderungen nur über `supabase/migrations/`; die Versiegelung bleibt serverseitig erzwungen, an RLS-Policies ändert sich nichts.
- Secrets (Cron-Geheimnis, Projekt-URL) nie in versionierte Dateien; sie liegen im Supabase-Vault bzw. in `supabase/functions/.env`.
- Push-Texte: Reveal `✈️ Euer Recap von «NAME» ist bereit!` (bestehend), Erinnerung `Heute ist der letzte Tag eurer Reise «NAME». Um Mitternacht wird euer Recap aufgedeckt.`
- Arbeitsverzeichnis für Deno-Kommandos ist jeweils der Function-Ordner (dort liegt die `deno.json`).
- Vor jedem Commit gilt: nur die im Task genannten Dateien stagen, im Repo liegen fremde, nicht committete Änderungen.

---

### Task 1: Migration und pgTAP (Spalte, Extensions, SQL-Wrapper, Cron-Jobs)

**Files:**
- Create: `supabase/tests/21_auto_reveal_test.sql`
- Create: `supabase/migrations/20260818100000_auto_reveal.sql`

**Interfaces:**
- Consumes: bestehende Tabelle `public.trips`, Vault (`vault.decrypted_secrets`), Grants aus `20260803090200_membership_rls.sql` (spaltenweiser Update-Grant) und `20260803090600_role_hardening.sql` (service_role hat volle DML auf trips, deckt neue Spalten automatisch ab).
- Produces: Spalte `trips.end_reminder_sent_at timestamptz null`; SQL-Funktion `public.rufe_reveal_zeitplan(aufgabe text)`; Cron-Jobs `reveal-zeitplan-reveal` und `reveal-zeitplan-erinnerung`. Der Wrapper POSTet an `<projekt_url>/functions/v1/reveal-zeitplan` mit Header `x-cron-geheimnis` und Body `{"aufgabe": "reveal"|"erinnerung", "heute": "YYYY-MM-DD"}` (heute in Europe/Zurich, DB-Uhr).

- [ ] **Step 1: pgTAP-Test schreiben (RED)**

`supabase/tests/21_auto_reveal_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(6);

-- Auto-Reveal (Spec 2026-08-18): Spalte, ACL und Cron-Verdrahtung der
-- Migration 20260818100000. Keine neuen Policies, darum keine Policy-Tests.

select has_column('public', 'trips', 'end_reminder_sent_at', 'trips.end_reminder_sent_at');

-- Der spaltenweise Update-Grant (20260803090200) darf die neue Spalte nicht
-- aufnehmen: geschrieben wird sie nur von der Service-Role (Edge Function).
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_reminder_sent_at', 'UPDATE'),
  false,
  'authenticated kann end_reminder_sent_at nicht schreiben');

-- Gegenprobe: ohne sie belegte der Test oben auch einen versehentlich ganz
-- fehlenden Update-Grant auf trips.
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_date', 'UPDATE'),
  true,
  'authenticated kann end_date weiterhin schreiben');

-- Lesbar wie alle trips-Spalten (Tabellen-Grant select, Spec §5).
select is(
  has_column_privilege('authenticated', 'public.trips', 'end_reminder_sent_at', 'SELECT'),
  true,
  'authenticated kann end_reminder_sent_at lesen');

select is(
  (select count(*)::int from cron.job
    where jobname in ('reveal-zeitplan-reveal', 'reveal-zeitplan-erinnerung')),
  2,
  'beide Cron-Jobs sind eingeplant');

select is(
  has_function_privilege('authenticated', 'public.rufe_reveal_zeitplan(text)', 'EXECUTE'),
  false,
  'authenticated kann den Cron-Wrapper nicht aufrufen');

select * from finish();
rollback;
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Aus dem Repo-Root (Stack muss laufen, sonst zuerst `supabase start`):

```bash
supabase test db
```

Expected: FAIL in `21_auto_reveal_test.sql` (has_column schlägt fehl, `cron.job` existiert noch nicht). Die Datei kann schon am fehlenden `cron`-Schema mit einem SQL-Fehler abbrechen; das zählt als korrekter Fehlschlag. Bestehende Tests 01 bis 20 müssen weiterhin grün sein.

- [ ] **Step 3: Migration schreiben**

`supabase/migrations/20260818100000_auto_reveal.sql`:

```sql
-- ============================================================================
-- Auto-Reveal (Spec docs/superpowers/specs/2026-08-18-auto-reveal-design.md):
-- eine Reise wird am Tag nach ihrem Enddatum automatisch aufgedeckt, die
-- Owner-Person bekommt am Morgen des letzten Tags eine Erinnerung.
-- Drei Bausteine:
--   1. trips.end_reminder_sent_at: Marker, dass die Erinnerung raus ist
--      (CAS auf «is null» in der Edge Function, ein doppelter Cron-Lauf
--      schickt nichts doppelt).
--   2. rufe_reveal_zeitplan(aufgabe): liest projekt_url/cron_geheimnis aus
--      dem Vault und stösst die Edge Function reveal-zeitplan per pg_net an.
--      Die Secrets liegen NICHT in dieser Datei, das Einrichten pro Umgebung
--      beschreibt supabase/README.md.
--   3. Zwei pg_cron-Jobs zu festen UTC-Zeiten (pg_cron kennt keine
--      Zeitzonen): 23:10 UTC liegt ganzjährig nach Zürcher Mitternacht
--      (00:10 im Winter, 01:10 im Sommer), 07:30 UTC ganzjährig am Zürcher
--      Morgen (08:30/09:30).
-- Der Kalendertag «heute» wird HIER in SQL berechnet (Europe/Zurich) und der
-- Function im Body mitgegeben: so hängt die Fällig-Entscheidung an derselben
-- einen Uhr, der des DB-Servers, die auch revealed_at schreibt
-- (revealStore.ts, Sonderwert 'now'), statt zusätzlich an der Uhr des
-- Deno-Hosts.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.trips add column end_reminder_sent_at timestamptz;

comment on column public.trips.end_reminder_sent_at is
  'Wann die Erinnerung «Heute ist der letzte Tag» an die Owner-Person rausging; gesetzt nur von der Edge Function reveal-zeitplan (Service-Role, CAS auf is null). Der spaltenweise Update-Grant für authenticated (20260803090200) nimmt die Spalte bewusst nicht auf.';

create or replace function public.rufe_reveal_zeitplan(aufgabe text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  projekt_url text;
  geheimnis   text;
begin
  select decrypted_secret into projekt_url
    from vault.decrypted_secrets where name = 'projekt_url';
  select decrypted_secret into geheimnis
    from vault.decrypted_secrets where name = 'cron_geheimnis';

  -- Warnung statt Exception: eine fehlende Konfiguration soll im Log
  -- auffallen, aber keinen dauerhaft roten Job-Verlauf erzeugen; der
  -- nächste Lauf nach dem Einrichten holt alles nach (der Reveal fragt
  -- end_date < heute ab, nicht end_date = gestern).
  if projekt_url is null or geheimnis is null then
    raise warning 'rufe_reveal_zeitplan: Vault-Secrets projekt_url/cron_geheimnis fehlen, Aufruf übersprungen.';
    return;
  end if;

  perform net.http_post(
    url     := projekt_url || '/functions/v1/reveal-zeitplan',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-geheimnis', geheimnis
    ),
    body := jsonb_build_object(
      'aufgabe', aufgabe,
      'heute', to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM-DD')
    )
  );
end $$;

comment on function public.rufe_reveal_zeitplan(text) is
  'Cron-Wrapper: liest projekt_url/cron_geheimnis aus dem Vault und ruft die Edge Function reveal-zeitplan mit {aufgabe, heute} auf; heute ist der Kalendertag in Europe/Zurich nach der DB-Uhr.';

-- Nur der Cron (läuft als postgres) ruft den Wrapper; Client-Rollen könnten
-- sonst beliebig oft Reveal-Läufe anstossen (harmlos wegen CAS, aber ein
-- unnötiger Hebel) und die Existenz der Vault-Secrets abfragen.
revoke execute on function public.rufe_reveal_zeitplan(text) from public, anon, authenticated;

select cron.schedule('reveal-zeitplan-reveal', '10 23 * * *',
  $$select public.rufe_reveal_zeitplan('reveal')$$);
select cron.schedule('reveal-zeitplan-erinnerung', '30 7 * * *',
  $$select public.rufe_reveal_zeitplan('erinnerung')$$);
```

- [ ] **Step 4: Migration anwenden**

```bash
supabase db reset
```

Expected: läuft durch, inklusive Seed. Falls `create extension pg_cron` scheitert, die CLI-Version prüfen (`supabase --version`, lokales pg_cron ist seit langem enthalten) und NICHT die Extension aus der Migration entfernen.

- [ ] **Step 5: Test laufen lassen, Erfolg verifizieren**

```bash
supabase test db
```

Expected: PASS, alle Dateien inklusive `21_auto_reveal_test.sql` (6 Tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818100000_auto_reveal.sql supabase/tests/21_auto_reveal_test.sql
git commit -m "feat(reveal): der Kalender bekommt einen Cron, die Erinnerung einen Marker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: versendeRevealPush kennt «niemand hat ausgelöst» (reveal-trip)

Beim Auto-Reveal gibt es keine auslösende Person; der Push muss an ALLE Mitglieder gehen. Bisher verlangt `versendeRevealPush` eine `ausloesendeId: string` und filtert sie aus den Empfängern.

**Files:**
- Modify: `supabase/functions/reveal-trip/reveal.ts` (Signatur `versendeRevealPush`, Export `StoreErgebnis`)
- Test: `supabase/functions/reveal-trip/reveal_test.ts`

**Interfaces:**
- Consumes: `versendeRevealPush(store, sendeFn, trip, ausloesendeId)` aus `reveal.ts`.
- Produces: `versendeRevealPush(store: RevealStore, sendeFn: SendeFn, trip: TripZeile, ausloesendeId: string | null)`; bei `null` wird niemand aus den Empfängern gefiltert. Ausserdem wird `StoreErgebnis<T>` aus `reveal.ts` exportiert (Task 3 braucht den Typ für die erweiterte Store-Schnittstelle).

- [ ] **Step 1: Failing Test schreiben**

In `supabase/functions/reveal-trip/reveal_test.ts` ergänzen (ans Ende der Datei; `fakeStore`, `neueFakeZustand`, `OWNER_ID`, `MEMBER_ID` existieren dort bereits, der Fake-Zustand enthält Tokens für OWNER_ID, MEMBER_ID und MEMBER2_ID):

```ts
// Auto-Reveal (Spec 2026-08-18): der Kalender löst aus, keine Person. Bei
// ausloesendeId null darf NIEMAND aus den Empfängern gefiltert werden, auch
// die Owner-Person nicht.
Deno.test('versendeRevealPush: ausloesendeId null schreibt alle Mitglieder an', async () => {
  const zustand = neueFakeZustand('active');
  const aufrufe = { holeMitglieder: 0, loescheTokens: [] as Array<{ tokens: string[]; userIds: string[] }> };
  const store = fakeStore(zustand, aufrufe);
  const gesendet: PushNachricht[] = [];
  const sendeFake: SendeFn = async (nachrichten) => {
    gesendet.push(...nachrichten);
    return [];
  };

  await versendeRevealPush(store, sendeFake, zustand.trip, null);

  const empfaenger = gesendet.map((n) => n.to).sort();
  const alleTokens = [...zustand.tokens.values()].flat().sort();
  assertEquals(empfaenger, alleTokens);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

```bash
cd supabase/functions/reveal-trip
npx deno test reveal_test.ts
```

Expected: FAIL. Der Lauf scheitert am Typ-Check (`null` ist kein `string`); das ist der korrekte Fehlschlag, das Feature fehlt in der Signatur.

- [ ] **Step 3: Minimale Implementierung**

In `supabase/functions/reveal-trip/reveal.ts`:

1. Zeile 50, den Typ exportieren:

```ts
export type StoreErgebnis<T> = { data: T | null; error: unknown };
```

2. Signatur von `versendeRevealPush` erweitern und den Filter-Kommentar ergänzen:

```ts
export async function versendeRevealPush(
  store: RevealStore,
  sendeFn: SendeFn,
  trip: TripZeile,
  ausloesendeId: string | null,
): Promise<void> {
```

Der bestehende Filter `.filter((userId) => userId !== ausloesendeId)` bleibt unverändert: gegen `null` ist jede user_id ungleich, also wird niemand gefiltert. Am Filter diesen Satz als Kommentar ergänzen:

```ts
  // ausloesendeId null (Auto-Reveal, Spec 2026-08-18): der Kalender hat
  // ausgelöst, keine Person, niemand wird gefiltert; der Vergleich
  // userId !== null ist für jede user_id wahr.
```

- [ ] **Step 4: Tests laufen lassen, Erfolg verifizieren**

```bash
cd supabase/functions/reveal-trip
npx deno test reveal_test.ts && npx deno check index.ts
```

Expected: PASS, alle bestehenden Tests der Datei ebenfalls; `deno check` ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/reveal-trip/reveal.ts supabase/functions/reveal-trip/reveal_test.ts
git commit -m "feat(reveal): der Push kennt den Fall ohne auslösende Person

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: zeitplan.ts, Anfrage-Prüfung und Auto-Reveal-Logik

**Files:**
- Create: `supabase/functions/reveal-zeitplan/zeitplan.ts`
- Create: `supabase/functions/reveal-zeitplan/deno.json` (Kopie von `reveal-trip/deno.json`)
- Test: `supabase/functions/reveal-zeitplan/zeitplan_test.ts`

**Interfaces:**
- Consumes: `versendeRevealPush(store, sendeFn, trip, null)`, `RevealStore`, `SendeFn`, `StoreErgebnis`, `TripZeile` aus `../reveal-trip/reveal.ts`; `PushNachricht` aus `../reveal-trip/push.ts`; `MeldeFn` aus `../_shared/fehlermelder.ts`.
- Produces (Task 4 bis 6 verlassen sich darauf):

```ts
export type ZeitplanAufgabe = 'reveal' | 'erinnerung';
export type ZeitplanAnfrage = { aufgabe: ZeitplanAufgabe; heute: string };
export type ZeitplanErgebnis = { status: number; body: Record<string, unknown> };
export interface ZeitplanStore extends RevealStore {
  holeFaelligeReisen(heute: string): Promise<StoreErgebnis<TripZeile[]>>;
  holeErinnerungsReisen(heute: string): Promise<StoreErgebnis<TripZeile[]>>;
  markiereErinnerung(tripId: string): Promise<StoreErgebnis<{ end_reminder_sent_at: string }>>;
}
export function pruefeZeitplanAnfrage(geheimnisHeader: string | null, konfiguriertesGeheimnis: string, body: unknown):
  { ok: true; anfrage: ZeitplanAnfrage } | { ok: false; status: number; fehler: string };
export async function fuehreAutoRevealAus(store: ZeitplanStore, sendeFn: SendeFn, heute: string, melde?: MeldeFn): Promise<ZeitplanErgebnis>;
```

- [ ] **Step 1: deno.json anlegen**

`supabase/functions/reveal-zeitplan/deno.json`:

```json
{
  "imports": {
    "@supabase/functions-js": "jsr:@supabase/functions-js@^2",
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@^2"
  }
}
```

- [ ] **Step 2: Failing Tests schreiben**

`supabase/functions/reveal-zeitplan/zeitplan_test.ts` (der Fake-Store dieser Datei modelliert MEHRERE Reisen mitsamt `end_date` und Marker; die Fällig-Filterung liegt in der Produktion im SQL-Adapter, der Fake bildet exakt dieselben Bedingungen nach, damit die reine Logik gegen realistische Auswahlen läuft):

```ts
// Unit-Tests für die Entscheidungslogik von reveal-zeitplan (zeitplan.ts),
// ohne Stack und ohne Netz, Stil wie ../reveal-trip/reveal_test.ts.
import { assertEquals } from 'jsr:@std/assert';
import {
  fuehreAutoRevealAus,
  pruefeZeitplanAnfrage,
  type ZeitplanStore,
} from './zeitplan.ts';
import type { SendeFn, TripZeile } from '../reveal-trip/reveal.ts';
import type { PushNachricht } from '../reveal-trip/push.ts';

const OWNER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const MEMBER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

type FakeReise = TripZeile & { end_date: string; end_reminder_sent_at: string | null };

type FakeZustand = {
  reisen: FakeReise[];
  // user_id -> Tokens; gilt für ALLE Reisen des Zustands (reicht für die Tests).
  tokens: Map<string, string[]>;
  mitglieder: string[];
};

// kaputteUpdates: trip_ids, deren CAS-Update mit einem Fehler antwortet,
// für den Test «ein Fehler stoppt die Schleife nicht».
function fakeStore(zustand: FakeZustand, kaputteUpdates: string[] = []): ZeitplanStore {
  const zeile = ({ id, name, owner_id, status, revealed_at }: FakeReise): TripZeile =>
    ({ id, name, owner_id, status, revealed_at });
  return {
    async holeFaelligeReisen(heute) {
      return {
        data: zustand.reisen.filter((r) => r.status === 'active' && r.end_date < heute).map(zeile),
        error: null,
      };
    },
    async holeErinnerungsReisen(heute) {
      return {
        data: zustand.reisen
          .filter((r) => r.status === 'active' && r.end_date === heute && r.end_reminder_sent_at === null)
          .map(zeile),
        error: null,
      };
    },
    async markiereErinnerung(tripId) {
      const reise = zustand.reisen.find((r) => r.id === tripId);
      if (!reise || reise.end_reminder_sent_at !== null) return { data: null, error: null };
      reise.end_reminder_sent_at = new Date().toISOString();
      return { data: { end_reminder_sent_at: reise.end_reminder_sent_at }, error: null };
    },
    async holeTrip(tripId) {
      const reise = zustand.reisen.find((r) => r.id === tripId);
      return { data: reise ? { ...zeile(reise) } : null, error: null };
    },
    async aktualisiereWennAktiv(tripId) {
      if (kaputteUpdates.includes(tripId)) return { data: null, error: new Error('kaputt') };
      const reise = zustand.reisen.find((r) => r.id === tripId);
      if (!reise || reise.status !== 'active') return { data: null, error: null };
      reise.status = 'revealed';
      reise.revealed_at = new Date().toISOString();
      return { data: { revealed_at: reise.revealed_at }, error: null };
    },
    async holeRevealedAtNachlese(tripId) {
      const reise = zustand.reisen.find((r) => r.id === tripId);
      return { data: reise ? { revealed_at: reise.revealed_at } : null, error: null };
    },
    async holeMitglieder() {
      return { data: zustand.mitglieder.map((user_id) => ({ user_id })), error: null };
    },
    async holeTokens(userIds) {
      const zeilen: { token: string }[] = [];
      for (const userId of userIds) {
        for (const token of zustand.tokens.get(userId) ?? []) zeilen.push({ token });
      }
      return { data: zeilen, error: null };
    },
    async loescheTokens() {
      return { error: null };
    },
  };
}

function reise(id: string, end_date: string, status: TripZeile['status'] = 'active'): FakeReise {
  return {
    id,
    name: `Reise ${id}`,
    owner_id: OWNER_ID,
    status,
    revealed_at: status === 'revealed' ? '2026-08-01T10:00:00.000Z' : null,
    end_date,
    end_reminder_sent_at: null,
  };
}

function sammelnd(): { gesendet: PushNachricht[]; sendeFn: SendeFn } {
  const gesendet: PushNachricht[] = [];
  const sendeFn: SendeFn = async (nachrichten) => {
    gesendet.push(...nachrichten);
    return [];
  };
  return { gesendet, sendeFn };
}

// --- pruefeZeitplanAnfrage ---------------------------------------------------

Deno.test('pruefeZeitplanAnfrage: korrektes Secret und Body ergeben die Anfrage', () => {
  const ergebnis = pruefeZeitplanAnfrage('s3cret', 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(ergebnis, { ok: true, anfrage: { aufgabe: 'reveal', heute: '2026-08-18' } });
});

Deno.test('pruefeZeitplanAnfrage: falsches oder fehlendes Secret ergibt 401', () => {
  const falsch = pruefeZeitplanAnfrage('anders', 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(falsch.ok, false);
  if (!falsch.ok) assertEquals(falsch.status, 401);
  const fehlt = pruefeZeitplanAnfrage(null, 's3cret', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(fehlt.ok, false);
  if (!fehlt.ok) assertEquals(fehlt.status, 401);
});

Deno.test('pruefeZeitplanAnfrage: unkonfiguriertes Secret ergibt 500, nie 200', () => {
  const ergebnis = pruefeZeitplanAnfrage('', '', { aufgabe: 'reveal', heute: '2026-08-18' });
  assertEquals(ergebnis.ok, false);
  if (!ergebnis.ok) assertEquals(ergebnis.status, 500);
});

Deno.test('pruefeZeitplanAnfrage: unbekannte Aufgabe oder kaputtes heute ergeben 400', () => {
  const aufgabe = pruefeZeitplanAnfrage('s3cret', 's3cret', { aufgabe: 'putzen', heute: '2026-08-18' });
  assertEquals(aufgabe.ok, false);
  if (!aufgabe.ok) assertEquals(aufgabe.status, 400);
  const heute = pruefeZeitplanAnfrage('s3cret', 's3cret', { aufgabe: 'reveal', heute: '18.08.2026' });
  assertEquals(heute.ok, false);
  if (!heute.ok) assertEquals(heute.status, 400);
});

// --- fuehreAutoRevealAus -----------------------------------------------------

Deno.test('fuehreAutoRevealAus: fällige Reise wird revealed, Push an alle inklusive Owner', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']], [MEMBER_ID, ['tok-member']]]),
    mitglieder: [OWNER_ID, MEMBER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(ergebnis.status, 200);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(zustand.reisen[0].status, 'revealed');
  assertEquals(gesendet.map((n) => n.to).sort(), ['tok-member', 'tok-owner']);
});

Deno.test('fuehreAutoRevealAus: nichts fällig heisst verarbeitet 0 und kein Push', async () => {
  const zustand: FakeZustand = {
    // end_date == heute ist NICHT fällig: bis 23:59 des Enddatums bleibt die
    // Reise unterwegs (Spec §2).
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
  assertEquals(zustand.reisen[0].status, 'active');
  assertEquals(gesendet.length, 0);
});

Deno.test('fuehreAutoRevealAus: verlorenes CAS heisst kein zweiter Push', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-17')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const store = fakeStore(zustand);
  // Das Rennen: die Auswahl sieht die Reise noch als active, dann schliesst
  // jemand manuell ab, das CAS-Update dieses Laufs trifft 0 Zeilen. Der
  // manuelle Abschluss passiert hier ZWISCHEN Auswahl und Rückgabe.
  const echteAuswahl = store.holeFaelligeReisen.bind(store);
  store.holeFaelligeReisen = async (heute) => {
    const auswahl = await echteAuswahl(heute);
    await store.aktualisiereWennAktiv('t1');
    return auswahl;
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(store, sendeFn, '2026-08-18');

  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
  assertEquals(gesendet.length, 0);
});

Deno.test('fuehreAutoRevealAus: ein Fehler bei Reise eins stoppt Reise zwei nicht', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-17'), reise('t2', '2026-08-16')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const gemeldet: unknown[] = [];
  const { sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(
    fakeStore(zustand, ['t1']),
    sendeFn,
    '2026-08-18',
    async (fehler) => {
      gemeldet.push(fehler);
    },
  );

  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(zustand.reisen.find((r) => r.id === 't2')?.status, 'revealed');
  assertEquals(gemeldet.length, 1);
});

Deno.test('fuehreAutoRevealAus: scheiternde Auswahl ergibt 500 und eine Meldung', async () => {
  const store = fakeStore({ reisen: [], tokens: new Map(), mitglieder: [] });
  store.holeFaelligeReisen = async () => ({ data: null, error: new Error('kaputt') });
  const gemeldet: unknown[] = [];
  const { sendeFn } = sammelnd();

  const ergebnis = await fuehreAutoRevealAus(store, sendeFn, '2026-08-18', async (fehler) => {
    gemeldet.push(fehler);
  });

  assertEquals(ergebnis.status, 500);
  assertEquals(gemeldet.length, 1);
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag verifizieren**

```bash
cd supabase/functions/reveal-zeitplan
npx deno test zeitplan_test.ts
```

Expected: FAIL, `zeitplan.ts` existiert nicht (Modul nicht gefunden).

- [ ] **Step 4: zeitplan.ts implementieren (Anfrage-Prüfung + Auto-Reveal)**

`supabase/functions/reveal-zeitplan/zeitplan.ts`:

```ts
// Entscheidungslogik von reveal-zeitplan, dem zeitgesteuerten Gegenstück zum
// manuellen reveal-trip (Spec docs/superpowers/specs/2026-08-18-auto-reveal-design.md).
// Aufbau wie ../reveal-trip/reveal.ts: reine Funktionen über einer schmalen
// Store-Schnittstelle, I/O steckt in zeitplanStore.ts, der Handler in
// index.ts übersetzt nur HTTP.
//
// Der Kalendertag «heute» kommt als Parameter herein (berechnet in SQL vom
// Cron-Wrapper rufe_reveal_zeitplan, Europe/Zurich nach der DB-Uhr): die
// Logik hier besitzt bewusst KEINE eigene Uhr, das hält sie deterministisch
// testbar und die Fällig-Entscheidung an derselben Uhr wie revealed_at.
//
// Kein Owner-Check wie in fuehreRevealAus: den Abschluss löst der Kalender
// aus, nicht eine Person. Die Absicherung der Function übernimmt das
// Cron-Secret (pruefeZeitplanAnfrage), nicht ein JWT.
import {
  versendeRevealPush,
  type RevealStore,
  type SendeFn,
  type StoreErgebnis,
  type TripZeile,
} from '../reveal-trip/reveal.ts';
import type { PushNachricht } from '../reveal-trip/push.ts';
import type { MeldeFn } from '../_shared/fehlermelder.ts';

const KEIN_MELDER: MeldeFn = async () => {};

export type ZeitplanAufgabe = 'reveal' | 'erinnerung';
export type ZeitplanAnfrage = { aufgabe: ZeitplanAufgabe; heute: string };
export type ZeitplanErgebnis = { status: number; body: Record<string, unknown> };

export interface ZeitplanStore extends RevealStore {
  // status='active' und end_date < heute; die Bedingungen stehen als echte
  // Postgres-Abfrage im Adapter (zeitplanStore.ts), geprüft im
  // Integrationstest, hier zählt nur: was zurückkommt, ist fällig.
  holeFaelligeReisen(heute: string): Promise<StoreErgebnis<TripZeile[]>>;
  // status='active', end_date = heute, end_reminder_sent_at is null.
  holeErinnerungsReisen(heute: string): Promise<StoreErgebnis<TripZeile[]>>;
  // CAS auf den Marker (… where end_reminder_sent_at is null): null heisst
  // 0 Zeilen, ein anderer Lauf war schneller, kein zweiter Push.
  markiereErinnerung(tripId: string): Promise<StoreErgebnis<{ end_reminder_sent_at: string }>>;
}

const HEUTE_FORM = /^\d{4}-\d{2}-\d{2}$/;

// Die komplette Zulassungsprüfung des Handlers als reine Funktion, damit
// zeitplan_test.ts sie ohne Deno.serve prüfen kann. Reihenfolge: erst die
// Server-Konfiguration (500), dann das Secret (401), dann der Body (400);
// ein leeres konfiguriertes Secret darf NIE als «Header passt» durchgehen.
export function pruefeZeitplanAnfrage(
  geheimnisHeader: string | null,
  konfiguriertesGeheimnis: string,
  body: unknown,
): { ok: true; anfrage: ZeitplanAnfrage } | { ok: false; status: number; fehler: string } {
  if (!konfiguriertesGeheimnis) {
    return { ok: false, status: 500, fehler: 'Server nicht konfiguriert.' };
  }
  if (!geheimnisHeader || geheimnisHeader !== konfiguriertesGeheimnis) {
    return { ok: false, status: 401, fehler: 'Nicht berechtigt.' };
  }
  const b = (body ?? {}) as { aufgabe?: unknown; heute?: unknown };
  if (b.aufgabe !== 'reveal' && b.aufgabe !== 'erinnerung') {
    return { ok: false, status: 400, fehler: 'Ungültige Anfrage.' };
  }
  if (typeof b.heute !== 'string' || !HEUTE_FORM.test(b.heute)) {
    return { ok: false, status: 400, fehler: 'Ungültige Anfrage.' };
  }
  return { ok: true, anfrage: { aufgabe: b.aufgabe, heute: b.heute } };
}

// Deckt alle fälligen Reisen auf. Pro Reise: CAS-Update wie beim manuellen
// Reveal; nur der Gewinner (1 Zeile) schickt den Push, an ALLE Mitglieder
// (ausloesendeId null, siehe versendeRevealPush). Fehler einer Reise werden
// gemeldet und stoppen die Schleife nicht: die übrigen Reisen kommen dran.
export async function fuehreAutoRevealAus(
  store: ZeitplanStore,
  sendeFn: SendeFn,
  heute: string,
  melde: MeldeFn = KEIN_MELDER,
): Promise<ZeitplanErgebnis> {
  const { data: faellige, error } = await store.holeFaelligeReisen(heute);
  if (error || !faellige) {
    console.error('reveal-zeitplan: Auswahl fälliger Reisen fehlgeschlagen', error);
    await melde(error ?? new Error('reveal-zeitplan: Auswahl ohne Daten.'), { heute });
    return { status: 500, body: { fehler: 'Auswahl fehlgeschlagen.' } };
  }

  let verarbeitet = 0;
  for (const trip of faellige) {
    const { data: aktualisiert, error: updateError } = await store.aktualisiereWennAktiv(trip.id);
    if (updateError) {
      console.error('reveal-zeitplan: trips-Update fehlgeschlagen', updateError);
      await melde(updateError, { trip_id: trip.id, heute });
      continue;
    }
    // 0 Zeilen: zwischen Auswahl und Update hat jemand manuell abgeschlossen,
    // dessen Zweig hat den Push bereits verschickt.
    if (!aktualisiert) continue;
    verarbeitet++;
    // Wie beim manuellen Reveal: der Statuswechsel ist die Wahrheit, der Push
    // nur die Botschaft, ein Versandfehler nimmt nichts zurück.
    try {
      await versendeRevealPush(store, sendeFn, trip, null);
    } catch (err) {
      console.error('reveal-zeitplan: Push-Versand fehlgeschlagen', err);
    }
  }
  return { status: 200, body: { ok: true, verarbeitet } };
}
```

(`PushNachricht` wird erst in Task 4 gebraucht; der Import darf bis dahin fehlen, sonst meckert der Linter über einen unbenutzten Import.)

- [ ] **Step 5: Tests laufen lassen, Erfolg verifizieren**

```bash
cd supabase/functions/reveal-zeitplan
npx deno test zeitplan_test.ts
```

Expected: PASS (alle Tests dieser Datei; die Erinnerungs-Tests kommen erst in Task 4).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/reveal-zeitplan/zeitplan.ts supabase/functions/reveal-zeitplan/zeitplan_test.ts supabase/functions/reveal-zeitplan/deno.json
git commit -m "feat(reveal): der Zeitplan prüft das Cron-Secret und deckt Fälliges auf

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Erinnerung am letzten Tag (zeitplan.ts)

**Files:**
- Modify: `supabase/functions/reveal-zeitplan/zeitplan.ts`
- Test: `supabase/functions/reveal-zeitplan/zeitplan_test.ts`

**Interfaces:**
- Consumes: `ZeitplanStore`, `ZeitplanErgebnis`, Fake-Store aus Task 3; `PushNachricht` aus `../reveal-trip/push.ts`.
- Produces: `fuehreErinnerungAus(store: ZeitplanStore, sendeFn: SendeFn, heute: string, melde?: MeldeFn): Promise<ZeitplanErgebnis>`; Push-Empfänger ist NUR die Owner-Person, Text `Heute ist der letzte Tag eurer Reise «NAME». Um Mitternacht wird euer Recap aufgedeckt.` in title UND body (Muster wie der Reveal-Push), `data: { trip_id }`.

- [ ] **Step 1: Failing Tests schreiben**

In `zeitplan_test.ts` ergänzen (`fuehreErinnerungAus` zum Import in Zeile 4 bis 8 hinzufügen):

```ts
// --- fuehreErinnerungAus -----------------------------------------------------

Deno.test('fuehreErinnerungAus: Owner bekommt die Erinnerung, Mitglieder nicht', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']], [MEMBER_ID, ['tok-member']]]),
    mitglieder: [OWNER_ID, MEMBER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(ergebnis.status, 200);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(gesendet.map((n) => n.to), ['tok-owner']);
  assertEquals(gesendet[0].title, 'Heute ist der letzte Tag eurer Reise «Reise t1». Um Mitternacht wird euer Recap aufgedeckt.');
  assertEquals(gesendet[0].data, { trip_id: 't1' });
});

Deno.test('fuehreErinnerungAus: ein zweiter Lauf schickt nichts mehr', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const store = fakeStore(zustand);
  const erste = sammelnd();
  await fuehreErinnerungAus(store, erste.sendeFn, '2026-08-18');
  const zweite = sammelnd();

  const ergebnis = await fuehreErinnerungAus(store, zweite.sendeFn, '2026-08-18');

  assertEquals(erste.gesendet.length, 1);
  assertEquals(zweite.gesendet.length, 0);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
});

Deno.test('fuehreErinnerungAus: verlorenes Marker-CAS heisst kein Push', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    mitglieder: [OWNER_ID],
  };
  const store = fakeStore(zustand);
  // Ein paralleler Lauf hat den Marker gerade gesetzt, die Auswahl dieses
  // Laufs war aber schon gelesen: markiereErinnerung liefert dann null.
  const echteAuswahl = store.holeErinnerungsReisen.bind(store);
  store.holeErinnerungsReisen = async (heute) => {
    const auswahl = await echteAuswahl(heute);
    await store.markiereErinnerung('t1');
    return auswahl;
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(store, sendeFn, '2026-08-18');

  assertEquals(gesendet.length, 0);
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 0 });
});

Deno.test('fuehreErinnerungAus: Owner ohne Token zählt trotzdem als verarbeitet', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map(),
    mitglieder: [OWNER_ID],
  };
  const { gesendet, sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(fakeStore(zustand), sendeFn, '2026-08-18');

  assertEquals(gesendet.length, 0);
  // Der Marker ist gesetzt (die Erinnerung IST behandelt), nur zustellen
  // liess sich nichts.
  assertEquals(ergebnis.body, { ok: true, verarbeitet: 1 });
  assertEquals(zustand.reisen[0].end_reminder_sent_at !== null, true);
});

Deno.test('fuehreErinnerungAus: tote Tokens werden im Owner-Kreis aufgeräumt', async () => {
  const zustand: FakeZustand = {
    reisen: [reise('t1', '2026-08-18')],
    tokens: new Map([[OWNER_ID, ['tok-tot']]]),
    mitglieder: [OWNER_ID],
  };
  const geloescht: Array<{ tokens: string[]; userIds: string[] }> = [];
  const store = fakeStore(zustand);
  store.loescheTokens = async (tokens, userIds) => {
    geloescht.push({ tokens, userIds });
    return { error: null };
  };
  const sendeFn: SendeFn = async () => ['tok-tot'];

  await fuehreErinnerungAus(store, sendeFn, '2026-08-18');

  assertEquals(geloescht, [{ tokens: ['tok-tot'], userIds: [OWNER_ID] }]);
});

Deno.test('fuehreErinnerungAus: scheiternde Auswahl ergibt 500 und eine Meldung', async () => {
  const store = fakeStore({ reisen: [], tokens: new Map(), mitglieder: [] });
  store.holeErinnerungsReisen = async () => ({ data: null, error: new Error('kaputt') });
  const gemeldet: unknown[] = [];
  const { sendeFn } = sammelnd();

  const ergebnis = await fuehreErinnerungAus(store, sendeFn, '2026-08-18', async (fehler) => {
    gemeldet.push(fehler);
  });

  assertEquals(ergebnis.status, 500);
  assertEquals(gemeldet.length, 1);
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag verifizieren**

```bash
cd supabase/functions/reveal-zeitplan
npx deno test zeitplan_test.ts
```

Expected: FAIL, `fuehreErinnerungAus` existiert nicht.

- [ ] **Step 3: fuehreErinnerungAus implementieren**

In `zeitplan.ts` ergänzen; dazu jetzt den in Task 3 bewusst weggelassenen Import an den Dateianfang aufnehmen:

```ts
import type { PushNachricht } from '../reveal-trip/push.ts';
```

```ts
// Erinnert die Owner-Person am Morgen des letzten Reisetags (Spec §2 Punkt 2).
// CAS auf den Marker macht einen doppelten Lauf folgenlos; nur der Gewinner
// schickt den Push. Scheitert der Versand NACH dem gesetzten Marker, bleibt
// die Erinnerung aus (kein Retry): sie ist Komfort, der Reveal am Folgetag
// kommt unabhängig davon (Spec §6).
export async function fuehreErinnerungAus(
  store: ZeitplanStore,
  sendeFn: SendeFn,
  heute: string,
  melde: MeldeFn = KEIN_MELDER,
): Promise<ZeitplanErgebnis> {
  const { data: reisen, error } = await store.holeErinnerungsReisen(heute);
  if (error || !reisen) {
    console.error('reveal-zeitplan: Auswahl der Erinnerungen fehlgeschlagen', error);
    await melde(error ?? new Error('reveal-zeitplan: Erinnerungs-Auswahl ohne Daten.'), { heute });
    return { status: 500, body: { fehler: 'Auswahl fehlgeschlagen.' } };
  }

  let verarbeitet = 0;
  for (const trip of reisen) {
    const { data: markiert, error: markerError } = await store.markiereErinnerung(trip.id);
    if (markerError) {
      console.error('reveal-zeitplan: Erinnerungs-Marker fehlgeschlagen', markerError);
      await melde(markerError, { trip_id: trip.id, heute });
      continue;
    }
    if (!markiert) continue;
    verarbeitet++;

    try {
      const { data: tokenZeilen, error: tokenError } = await store.holeTokens([trip.owner_id]);
      if (tokenError) {
        console.error('reveal-zeitplan: push_tokens-Select fehlgeschlagen', tokenError);
        continue;
      }
      const tokens = tokenZeilen ?? [];
      if (tokens.length === 0) continue;

      const text = `Heute ist der letzte Tag eurer Reise «${trip.name}». Um Mitternacht wird euer Recap aufgedeckt.`;
      const nachrichten: PushNachricht[] = tokens.map((t) => ({
        to: t.token,
        title: text,
        body: text,
        data: { trip_id: trip.id },
      }));
      const tote = await sendeFn(nachrichten);
      if (tote.length > 0) {
        const { error: deleteError } = await store.loescheTokens(tote, [trip.owner_id]);
        if (deleteError) {
          console.error('reveal-zeitplan: Aufräumen abgemeldeter push_tokens fehlgeschlagen', deleteError);
        }
      }
    } catch (err) {
      console.error('reveal-zeitplan: Erinnerungs-Versand fehlgeschlagen', err);
    }
  }
  return { status: 200, body: { ok: true, verarbeitet } };
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg verifizieren**

```bash
cd supabase/functions/reveal-zeitplan
npx deno test zeitplan_test.ts
```

Expected: PASS, alle Tests der Datei.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/reveal-zeitplan/zeitplan.ts supabase/functions/reveal-zeitplan/zeitplan_test.ts
git commit -m "feat(reveal): die Erinnerung am letzten Tag kommt genau einmal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: zeitplanStore.ts und Integrationstests

**Files:**
- Create: `supabase/functions/reveal-zeitplan/zeitplanStore.ts`
- Test: `supabase/functions/reveal-zeitplan/zeitplanStore_integration_test.ts`

**Interfaces:**
- Consumes: `ZeitplanStore` aus `./zeitplan.ts`; `erstelleRevealStore`, `erstelleAdminClient`, `AdminClient` aus `../reveal-trip/revealStore.ts`; `TripZeile` aus `../reveal-trip/reveal.ts`; Seed-Konto `LEA_ID = '11111111-1111-4111-8111-111111111111'`.
- Produces: `erstelleZeitplanStore(supabaseAdmin: AdminClient): ZeitplanStore`; Re-Export von `erstelleAdminClient` (Task 6 importiert beide aus `zeitplanStore.ts`).

- [ ] **Step 1: Failing Integrationstest schreiben**

`supabase/functions/reveal-zeitplan/zeitplanStore_integration_test.ts` (Gating-Muster wortgleich zu `../reveal-trip/revealStore_integration_test.ts`, inklusive `supabaseStatusEnv`, `restErreichbar`, `stackBereit`, `restHeaders`, `erwarteJson`; kopiere diese Helfer, sie sind bewusst pro Testdatei eigenständig):

```ts
// Integrationstest für zeitplanStore.ts, genau die Abfragen, die kein
// Fake-Store beweisen kann, weil er ihre Bedingungen selbst vorgibt:
//   1. holeFaelligeReisen: end_date STRENG kleiner heute und status='active'
//      im echten Select (Spec §2: bis 23:59 des Enddatums bleibt die Reise
//      unterwegs).
//   2. holeErinnerungsReisen: end_date = heute UND Marker leer.
//   3. markiereErinnerung: die CAS-Bedingung `is('end_reminder_sent_at',
//      null)` im echten Update, zweiter Aufruf 0 Zeilen.
//
// Ausführen:
//   cd supabase/functions/reveal-zeitplan
//   npx deno test --allow-net --allow-run=supabase zeitplanStore_integration_test.ts

import { assert, assertEquals } from 'jsr:@std/assert';
import { erstelleAdminClient, erstelleZeitplanStore } from './zeitplanStore.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';

// [Hier die Helfer supabaseStatusEnv, SUPABASE_URL, SERVICE_ROLE_KEY,
//  restErreichbar, stackBereit inkl. Warn-Block, restHeaders, erwarteJson
//  wortgleich aus ../reveal-trip/revealStore_integration_test.ts Zeilen
//  36 bis 93 übernehmen; einzige Änderung: die Warn-Zeile auf
//  'zeitplanStore_integration_test: übersprungen, braucht `supabase start`.'
//  ändern.]

async function neueTrip(endDate: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      name: 'Integrationstest zeitplanStore',
      start_date: '2026-01-01',
      end_date: endDate,
      owner_id: LEA_ID,
      status: 'active',
    }),
  });
  const [trip] = (await erwarteJson(res, 201)) as Array<{ id: string }>;
  return trip.id;
}

async function loescheTrip(tripId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, { method: 'DELETE', headers: restHeaders() }).catch(
    () => null,
  );
}

Deno.test({
  name: 'holeFaelligeReisen: end_date streng kleiner heute, active only',
  ignore: !stackBereit,
  fn: async () => {
    const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await neueTrip('2026-01-02');
    try {
      const fael = await store.holeFaelligeReisen('2026-01-03');
      assert(fael.data !== null, String(fael.error));
      assert(fael.data.some((t) => t.id === tripId), 'Reise mit end_date < heute ist fällig');

      // Am Enddatum selbst (bis 23:59) noch NICHT fällig.
      const nochNicht = await store.holeFaelligeReisen('2026-01-02');
      assert(nochNicht.data !== null, String(nochNicht.error));
      assertEquals(nochNicht.data.some((t) => t.id === tripId), false);

      // Revealed zählt nicht als fällig.
      await store.aktualisiereWennAktiv(tripId);
      const revealed = await store.holeFaelligeReisen('2026-01-03');
      assert(revealed.data !== null, String(revealed.error));
      assertEquals(revealed.data.some((t) => t.id === tripId), false);
    } finally {
      await loescheTrip(tripId);
    }
  },
});

Deno.test({
  name: 'markiereErinnerung: CAS im echten Update, zweiter Aufruf 0 Zeilen',
  ignore: !stackBereit,
  fn: async () => {
    const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await neueTrip('2026-01-02');
    try {
      const erster = await store.markiereErinnerung(tripId);
      assert(erster.data !== null, String(erster.error));
      const zweiter = await store.markiereErinnerung(tripId);
      assertEquals(zweiter.data, null);
      assertEquals(zweiter.error, null);
    } finally {
      await loescheTrip(tripId);
    }
  },
});

Deno.test({
  name: 'holeErinnerungsReisen: end_date = heute und Marker leer',
  ignore: !stackBereit,
  fn: async () => {
    const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await neueTrip('2026-01-02');
    try {
      const faellig = await store.holeErinnerungsReisen('2026-01-02');
      assert(faellig.data !== null, String(faellig.error));
      assert(faellig.data.some((t) => t.id === tripId), 'Reise mit end_date = heute braucht die Erinnerung');

      const anderesDatum = await store.holeErinnerungsReisen('2026-01-01');
      assert(anderesDatum.data !== null, String(anderesDatum.error));
      assertEquals(anderesDatum.data.some((t) => t.id === tripId), false);

      await store.markiereErinnerung(tripId);
      const markiert = await store.holeErinnerungsReisen('2026-01-02');
      assert(markiert.data !== null, String(markiert.error));
      assertEquals(markiert.data.some((t) => t.id === tripId), false);
    } finally {
      await loescheTrip(tripId);
    }
  },
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Stack muss laufen (`supabase start`, danach `supabase db reset`, falls Task 1 noch nicht angewandt ist):

```bash
cd supabase/functions/reveal-zeitplan
npx deno test --allow-net --allow-run=supabase zeitplanStore_integration_test.ts
```

Expected: FAIL, `zeitplanStore.ts` existiert nicht.

- [ ] **Step 3: zeitplanStore.ts implementieren**

```ts
// Der reale I/O-Adapter für zeitplan.ts' ZeitplanStore-Schnittstelle: die
// geteilten Bausteine (CAS-Reveal, Mitglieder, Tokens) kommen unverändert
// aus ../reveal-trip/revealStore.ts, hier stehen nur die drei Zeitplan-
// Abfragen. Deren Bedingungen (streng kleiner, Marker-CAS) prüft
// zeitplanStore_integration_test.ts gegen den echten Stack.
import type { ZeitplanStore } from './zeitplan.ts';
import type { TripZeile } from '../reveal-trip/reveal.ts';
import { erstelleRevealStore, type AdminClient } from '../reveal-trip/revealStore.ts';

export { erstelleAdminClient } from '../reveal-trip/revealStore.ts';

const TRIP_SPALTEN = 'id, name, owner_id, status, revealed_at';

export function erstelleZeitplanStore(supabaseAdmin: AdminClient): ZeitplanStore {
  return {
    ...erstelleRevealStore(supabaseAdmin),

    // Streng kleiner: am Enddatum selbst (bis 23:59) bleibt die Reise
    // unterwegs (Spec §2).
    async holeFaelligeReisen(heute) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_SPALTEN)
        .eq('status', 'active')
        .lt('end_date', heute);
      return { data: data as TripZeile[] | null, error };
    },

    async holeErinnerungsReisen(heute) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_SPALTEN)
        .eq('status', 'active')
        .eq('end_date', heute)
        .is('end_reminder_sent_at', null);
      return { data: data as TripZeile[] | null, error };
    },

    // 'now' wie in revealStore.ts: der Zeitstempel kommt aus der DB-Uhr.
    // Die CAS-Bedingung `is('end_reminder_sent_at', null)`: nur der erste
    // Lauf betrifft eine Zeile, jeder weitere bekommt null zurück.
    async markiereErinnerung(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .update({ end_reminder_sent_at: 'now' })
        .eq('id', tripId)
        .is('end_reminder_sent_at', null)
        .select('end_reminder_sent_at')
        .maybeSingle();
      return { data: data as { end_reminder_sent_at: string } | null, error };
    },
  };
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg verifizieren**

```bash
cd supabase/functions/reveal-zeitplan
npx deno test --allow-net --allow-run=supabase zeitplanStore_integration_test.ts && npx deno test zeitplan_test.ts
```

Expected: PASS (3 Integrationstests gegen den Stack, Unit-Tests unverändert grün).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/reveal-zeitplan/zeitplanStore.ts supabase/functions/reveal-zeitplan/zeitplanStore_integration_test.ts
git commit -m "feat(reveal): der Zeitplan-Store fragt Fälliges gegen echtes Postgres ab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Handler, config.toml und .env.example

**Files:**
- Create: `supabase/functions/reveal-zeitplan/index.ts`
- Modify: `supabase/config.toml` (neuer Block nach `[functions.moment-entfernen]`; ausserdem den share-link-Kommentar anpassen, der behauptet, share-link sei die EINZIGE Function mit `verify_jwt = false`)
- Modify: `supabase/functions/.env.example` (Zeile `CRON_GEHEIMNIS=`)

**Interfaces:**
- Consumes: `pruefeZeitplanAnfrage`, `fuehreAutoRevealAus`, `fuehreErinnerungAus` aus `./zeitplan.ts`; `erstelleZeitplanStore`, `erstelleAdminClient` aus `./zeitplanStore.ts`; `sende` aus `../reveal-trip/push.ts`; `erstelleFehlermelder` aus `../_shared/fehlermelder.ts`.
- Produces: HTTP-Endpunkt `POST /functions/v1/reveal-zeitplan`, Header `x-cron-geheimnis`, Body `{aufgabe, heute}`; Antworten: 200 `{ok, verarbeitet}`, 400/401/405/500 `{fehler}`.

- [ ] **Step 1: index.ts schreiben**

`supabase/functions/reveal-zeitplan/index.ts`:

```ts
// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// reveal-zeitplan, das zeitgesteuerte Gegenstück zu reveal-trip: aufgerufen
// von pg_cron über rufe_reveal_zeitplan (Migration 20260818100000), nie von
// der App. Statt eines JWT trägt der Aufruf das Cron-Secret im Header
// x-cron-geheimnis; die komplette Zulassungsprüfung ist als reine Funktion
// in zeitplan.ts testbar (pruefeZeitplanAnfrage). Dieser Handler übersetzt
// nur HTTP: Methode, Konfiguration, Body-Parsing, Dispatch nach Aufgabe.
import { sende } from '../reveal-trip/push.ts';
import { erstelleFehlermelder } from '../_shared/fehlermelder.ts';
import { fuehreAutoRevealAus, fuehreErinnerungAus, pruefeZeitplanAnfrage } from './zeitplan.ts';
import { erstelleAdminClient, erstelleZeitplanStore } from './zeitplanStore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_GEHEIMNIS = Deno.env.get('CRON_GEHEIMNIS') ?? '';

const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const melde = erstelleFehlermelder(SENTRY_DSN, 'reveal-zeitplan');

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fehler(nachricht: string, status: number): Response {
  return json({ fehler: nachricht }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return fehler('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('reveal-zeitplan: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    await melde(new Error('reveal-zeitplan: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.'));
    return fehler('Server nicht konfiguriert.', 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fehler('Ungültige Anfrage.', 400);
  }

  const zulassung = pruefeZeitplanAnfrage(req.headers.get('x-cron-geheimnis'), CRON_GEHEIMNIS, body);
  if (!zulassung.ok) {
    if (zulassung.status === 500) {
      console.error('reveal-zeitplan: CRON_GEHEIMNIS fehlt.');
      await melde(new Error('reveal-zeitplan: CRON_GEHEIMNIS fehlt.'));
    }
    return fehler(zulassung.fehler, zulassung.status);
  }

  const store = erstelleZeitplanStore(erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
  const { aufgabe, heute } = zulassung.anfrage;
  const ergebnis = aufgabe === 'reveal'
    ? await fuehreAutoRevealAus(store, sende, heute, melde)
    : await fuehreErinnerungAus(store, sende, heute, melde);
  return json(ergebnis.body, ergebnis.status);
});
```

- [ ] **Step 2: Typprüfung**

```bash
cd supabase/functions/reveal-zeitplan
npx deno check index.ts
```

Expected: keine Fehler.

- [ ] **Step 3: config.toml ergänzen**

In `supabase/config.toml` nach dem `[functions.moment-entfernen]`-Block anfügen:

```toml
# reveal-zeitplan (Auto-Reveal, Spec 2026-08-18): das zeitgesteuerte
# Gegenstück zu reveal-trip. Aufrufer ist pg_cron im eigenen Postgres
# (Migration 20260818100000), nie die App.
[functions.reveal-zeitplan]
enabled = true
# verify_jwt = false wie bei share-link, aber aus einem anderen Grund: der
# Aufrufer ist kein Mensch und hat kein JWT, er ist die eigene Datenbank.
# Was die Function stattdessen trägt, ist das Cron-Secret: der Header
# x-cron-geheimnis muss der Umgebungsvariable CRON_GEHEIMNIS entsprechen
# (pruefeZeitplanAnfrage in zeitplan.ts, ein leeres konfiguriertes Secret
# ergibt 500, nie Durchlass). Wer diese Prüfung entfernt, macht Reveal-Läufe
# für jeden Anonymen auslösbar.
verify_jwt = false
import_map = "./functions/reveal-zeitplan/deno.json"
entrypoint = "./functions/reveal-zeitplan/index.ts"
```

Zusätzlich im share-link-Kommentar (Zeile 486) den Satz «Diese Function ist die EINZIGE mit verify_jwt = false» ersetzen durch:

```toml
# ACHTUNG: verify_jwt = false. Lange war share-link die einzige Function
# ohne JWT-Pflicht; inzwischen steht auch reveal-zeitplan (unten) auf false,
# dort trägt ein Cron-Secret statt des Tokens. Warum hier, und was daran
# hängt:
```

- [ ] **Step 4: .env.example ergänzen**

In `supabase/functions/.env.example` anfügen:

```bash
# Geteiltes Secret zwischen dem Cron-Wrapper (Vault: cron_geheimnis) und der
# Edge Function reveal-zeitplan. Erzeugen mit: openssl rand -hex 32
CRON_GEHEIMNIS=
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/reveal-zeitplan/index.ts supabase/config.toml supabase/functions/.env.example
git commit -m "feat(reveal): reveal-zeitplan nimmt den Cron an der Tür in Empfang

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: README, lokale End-zu-End-Verifikation

**Files:**
- Create: `supabase/README.md`

**Interfaces:**
- Consumes: alles aus Task 1 bis 6.
- Produces: dokumentierte Einrichtung pro Umgebung; ein am lokalen Stack belegter Reveal- und Erinnerungs-Lauf.

- [ ] **Step 1: README schreiben**

`supabase/README.md`:

````markdown
# Supabase-Betrieb

## Auto-Reveal einrichten (einmal pro Umgebung)

Der Auto-Reveal (Spec `docs/superpowers/specs/2026-08-18-auto-reveal-design.md`)
braucht pro Umgebung zwei Vault-Secrets und eine Function-Umgebungsvariable.
Ohne sie loggt der Cron-Wrapper eine Warnung und tut nichts.

Secret erzeugen (ein Wert, er wird an zwei Stellen hinterlegt):

```bash
openssl rand -hex 32
```

### Lokal

1. Vault-Secrets anlegen (`supabase start` muss laufen; `host.docker.internal`
   ist die Sicht des Postgres-Containers auf den Host, auf dem Kong Port
   54321 bedient):

   ```bash
   psql "$(supabase status -o env | grep DB_URL | cut -d'"' -f2)" \
     -c "select vault.create_secret('http://host.docker.internal:54321', 'projekt_url');" \
     -c "select vault.create_secret('HIER-DAS-SECRET', 'cron_geheimnis');"
   ```

2. In `supabase/functions/.env` dieselbe Zeile wie in `.env.example`
   eintragen: `CRON_GEHEIMNIS=HIER-DAS-SECRET`.

3. Functions neu starten (`supabase functions serve`), damit die Variable
   ankommt.

### Hosted (EU-Projekt)

1. Vault-Secrets im Dashboard (Project Settings, Vault) oder per SQL anlegen:
   `projekt_url` = `https://<projekt-ref>.supabase.co`, `cron_geheimnis` =
   das erzeugte Secret.
2. Function-Secret setzen: `supabase secrets set CRON_GEHEIMNIS=<secret>`.
3. Deploy OHNE JWT-Pflicht (config.toml gilt nur lokal):
   `supabase functions deploy reveal-zeitplan --no-verify-jwt`.
4. Nach dem Ausrollen prüfen: `select jobname, schedule from cron.job;`
   muss `reveal-zeitplan-reveal` (`10 23 * * *`) und
   `reveal-zeitplan-erinnerung` (`30 7 * * *`) zeigen. Achtung: der erste
   Reveal-Lauf deckt auch alte aktive Reisen mit vergangenem Enddatum auf
   (Spec §2, abgenommen).

## Zeiten

Zeitreferenz ist fest Europe/Zurich (Spec §3). Die UTC-Cron-Zeiten liegen
ganzjährig nach Zürcher Mitternacht (Reveal) bzw. am Zürcher Morgen
(Erinnerung); «heute» berechnet der SQL-Wrapper mit der DB-Uhr.
````

- [ ] **Step 2: Lokale Verifikation des ganzen Wegs**

Voraussetzung: Task 1 ist angewandt (`supabase db reset`), Secrets nach README Schritt 1 und 2 gesetzt, `supabase functions serve` läuft in einem eigenen Terminal.

```bash
export SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d'"' -f2)
# Eine Reise mit vergangenem Enddatum anlegen:
curl -s "http://127.0.0.1:54321/rest/v1/trips" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "content-type: application/json" -H "Prefer: return=representation" \
  -d '{"name":"Cron-Probe","start_date":"2026-08-01","end_date":"2026-08-17","owner_id":"11111111-1111-4111-8111-111111111111"}'
# Den Reveal-Lauf von Hand anstossen, wie ihn der Cron schicken würde:
curl -s -X POST "http://127.0.0.1:54321/functions/v1/reveal-zeitplan" \
  -H "content-type: application/json" -H "x-cron-geheimnis: HIER-DAS-SECRET" \
  -d '{"aufgabe":"reveal","heute":"2026-08-18"}'
```

Expected: `{"ok":true,"verarbeitet":1}` (oder mehr, falls Seed-Reisen fällig sind), und die Probe-Reise steht danach auf `status = 'revealed'`. Danach denselben Aufruf mit `{"aufgabe":"erinnerung","heute":"<end_date einer zweiten, heute endenden Probe-Reise>"}` wiederholen: Expected `{"ok":true,"verarbeitet":1}` beim ersten, `{"ok":true,"verarbeitet":0}` beim zweiten Lauf. Ein Aufruf mit falschem Secret muss 401 liefern. Probe-Reisen danach per REST löschen.

Falls die Edge-Runtime 503 liefert: bekanntes lokales Verhalten (Memory «Edge-Runtime verschwindet»), `supabase functions serve` neu starten, kein Code-Problem.

- [ ] **Step 3: Voller Testlauf**

```bash
supabase test db
cd supabase/functions/reveal-trip && npx deno test reveal_test.ts push_test.ts
cd ../reveal-zeitplan && npx deno test zeitplan_test.ts
npx deno test --allow-net --allow-run=supabase zeitplanStore_integration_test.ts
```

Expected: alles PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/README.md
git commit -m "docs(reveal): der Betriebs-Fahrplan für den Auto-Reveal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
