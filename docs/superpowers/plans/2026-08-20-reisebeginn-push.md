# Push beim Reisebeginn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle Mitglieder einer Reise bekommen am ersten Reisetag um 08:00 UTC einen Push «Heute beginnt eure Reise ...».

**Architecture:** Dritter Task `trip_start` im bestehenden reveal-schedule-Mechanismus: ein neuer pg_cron-Job ruft die unveraenderte SQL-Funktion `call_reveal_schedule('trip_start')`, die Edge Function waehlt Reisen mit `start_date = today` aus, setzt per CAS den neuen Marker `trips.start_push_sent_at` und schickt den Push ueber einen aus `sendRevealPush` verallgemeinerten Helfer `sendTripPush` an alle Mitglieder.

**Tech Stack:** Postgres (pg_cron, pg_net, Vault), Supabase Edge Functions (Deno), pgTAP, Deno-Tests.

**Spec:** `docs/superpowers/specs/2026-08-20-reisebeginn-push-design.md`

## Global Constraints

- Quellcode ist englisch: Bezeichner, Kommentare, Testbeschreibungen (CLAUDE.md). Nur sichtbare Texte sind deutsch; der Push-Text ist sichtbar und deshalb deutsch.
- Push-Text EXAKT, in title UND body identisch: `Heute beginnt eure Reise «${trip.name}». Sendet eure ersten Momente ein!`
- Keine Gedankenstriche (em-dashes) in Code, Kommentaren, Texten oder Commit-Messages.
- Task-Wert `trip_start`, Cron-Job `reveal-schedule-trip-start`, Schedule `0 8 * * *`, Spalte `trips.start_push_sent_at timestamptz`.
- Wire-Vertrag SQL <-> Edge Function: die Task-Werte stehen in der Migration, in `index.ts` und in `schedule.ts`; die Vertragskommentare an ALLEN drei Enden werden nachgefuehrt.
- Empfaenger sind ALLE Mitglieder (`triggeringUserId` null, niemand wird gefiltert).
- Der Umbau von `sendRevealPush` ist verhaltensneutral: alle bestehenden Faelle in `reveal_test.ts` bleiben UNVERAENDERT gruen.
- Schema-Aenderungen nur ueber `supabase/migrations/`; jede Migration bekommt pgTAP-Tests in `supabase/tests/`.
- Commit-Messages deutsch.
- Voraussetzung fuer pgTAP- und Integrationstests: der lokale Stack laeuft (`supabase start`).

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `supabase/migrations/20260820120000_trip_start_push.sql` (neu) | Spalte + Cron-Job |
| `supabase/tests/22_trip_start_push_test.sql` (neu) | pgTAP: Spalte, ACL, Cron-Verdrahtung |
| `supabase/functions/reveal-trip/reveal.ts` | `sendTripPush` (verallgemeinert), `sendRevealPush` als Wrapper |
| `supabase/functions/reveal-schedule/schedule.ts` | Task-Typ, Zulassung, `performTripStart`, Store-Interface |
| `supabase/functions/reveal-schedule/scheduleStore.ts` | zwei neue Queries (Auswahl, Marker-CAS) |
| `supabase/functions/reveal-schedule/index.ts` | dritter Dispatch-Zweig |
| `supabase/functions/reveal-schedule/schedule_test.ts` | Unit-Tests fuer Zulassung + `performTripStart` |
| `supabase/functions/reveal-schedule/scheduleStore_integration_test.ts` | Bedingungen der zwei neuen Queries |

### Task-Übersicht

1. Migration + pgTAP (Spalte, Cron-Job)
2. `sendTripPush`-Umbau in reveal.ts (verhaltensneutral)
3. Logik + Store: `performTripStart`, Adapter-Queries, Unit-Tests
4. Verdrahtung + Integrationsbeweis: index.ts, Vertragskommentare, Integrationstests, Gesamtlauf

---

### Task 1: Migration und pgTAP

**Files:**
- Create: `supabase/migrations/20260820120000_trip_start_push.sql`
- Create: `supabase/tests/22_trip_start_push_test.sql`

**Interfaces:**
- Consumes: `public.call_reveal_schedule(task text)` (Migration `20260820090000_english_function_names.sql`, bleibt unveraendert).
- Produces: Spalte `trips.start_push_sent_at timestamptz` und Cron-Job `reveal-schedule-trip-start` (`0 8 * * *`); Task 3 und 4 verlassen sich auf exakt diese Namen.

- [ ] **Step 1: pgTAP-Test schreiben (rot)**

`supabase/tests/22_trip_start_push_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(5);

-- Trip-start push (Spec 2026-08-20): column, ACL and cron wiring of
-- migration 20260820120000. No new policies, therefore no policy tests.

select has_column('public', 'trips', 'start_push_sent_at', 'trips.start_push_sent_at');

-- The column-wise update grant (20260803090200) must not include the new
-- column: only the service role (edge function) writes it.
select is(
  has_column_privilege('authenticated', 'public.trips', 'start_push_sent_at', 'UPDATE'),
  false,
  'authenticated cannot write start_push_sent_at');

-- Readable like every trips column (table-level select grant).
select is(
  has_column_privilege('authenticated', 'public.trips', 'start_push_sent_at', 'SELECT'),
  true,
  'authenticated can read start_push_sent_at');

select is(
  (select count(*)::int from cron.job where jobname = 'reveal-schedule-trip-start'),
  1,
  'the trip start job is scheduled exactly once');

select is(
  (select schedule from cron.job where jobname = 'reveal-schedule-trip-start'),
  '0 8 * * *',
  'the trip start job runs 08:00 UTC, 10:00 summer / 09:00 winter in Zurich');

select * from finish();
rollback;
```

- [ ] **Step 2: Test laufen lassen, Scheitern pruefen**

Run: `supabase test db`
Expected: `22_trip_start_push_test` schlaegt fehl (Spalte und Job existieren nicht); die Tests 01 bis 21 bleiben gruen.

- [ ] **Step 3: Migration schreiben**

`supabase/migrations/20260820120000_trip_start_push.sql`:

```sql
-- ============================================================================
-- Trip-start push (Spec docs/superpowers/specs/2026-08-20-reisebeginn-push-design.md):
-- every member gets a push on the morning of the first trip day. Two pieces:
--   1. trips.start_push_sent_at: marker that the push went out (CAS on
--      «is null» in the edge function, a double cron run sends nothing twice).
--   2. A third pg_cron job at a fixed UTC time (pg_cron knows no timezones):
--      08:00 UTC is 10:00 Zurich in summer, 09:00 in winter.
-- call_reveal_schedule itself stays unchanged: it passes the task through and
-- computes today in Europe/Zurich (migration 20260820090000).
-- Wire contract with the edge function reveal-schedule: the task value
-- 'trip_start' below and the task values in schedule.ts/index.ts move
-- together.
-- ============================================================================

alter table public.trips add column start_push_sent_at timestamptz;

comment on column public.trips.start_push_sent_at is
  'When the push «Heute beginnt eure Reise» went out to all members; written only by the edge function reveal-schedule (service role, CAS on is null). The column-wise update grant for authenticated (20260803090200) deliberately does not include this column.';

-- Idempotent like in 20260820090000: cron.unschedule throws hard when the
-- job does not exist (rerun after a failure, migration repair), that must
-- not abort this migration.
do $$ begin
  perform cron.unschedule('reveal-schedule-trip-start');
exception when others then null; end $$;

select cron.schedule('reveal-schedule-trip-start', '0 8 * * *',
  $$select public.call_reveal_schedule('trip_start')$$);
```

- [ ] **Step 4: Migration anwenden**

Run: `supabase migration up`
Expected: laeuft ohne Fehler durch.

- [ ] **Step 5: pgTAP laufen lassen, Gruen pruefen**

Run: `supabase test db`
Expected: alle Testdateien gruen, inklusive `22_trip_start_push_test` (5 Tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820120000_trip_start_push.sql supabase/tests/22_trip_start_push_test.sql
git commit -m "feat(push): Marker-Spalte und Cron-Job fuer den Reisebeginn-Push"
```

---

### Task 2: sendTripPush als verallgemeinerter Kern von sendRevealPush

**Files:**
- Modify: `supabase/functions/reveal-trip/reveal.ts:85-155` (der Block von der Doku ueber `sendRevealPush` bis zu dessen schliessender Klammer)

**Interfaces:**
- Consumes: `RevealStore` (fetchMembers/fetchTokens/deleteTokens), `SendFn`, `TripRow`, `PushMessage` (alle bereits in reveal.ts bzw. push.ts).
- Produces: `sendTripPush(store: RevealStore, sendFn: SendFn, trip: TripRow, text: string, triggeringUserId: string | null): Promise<void>` als neuer Export; `sendRevealPush` behaelt seine Signatur `(store, sendFn, trip, triggeringUserId)` und sein Verhalten exakt. Task 3 importiert `sendTripPush`.

**Verhaltensneutral:** kein neuer Test; der Beweis ist, dass `reveal_test.ts` unveraendert gruen bleibt (dort stehen 8 `sendRevealPush`-Faelle inklusive Ausschluss der ausloesenden Person, Token-Aufraeumen im Empfaengerkreis und `triggeringUserId null` benachrichtigt alle).

- [ ] **Step 1: Gruene Ausgangslage festhalten**

Run: `cd supabase/functions/reveal-trip && npx deno test reveal_test.ts`
Expected: PASS (alle Tests gruen). Anzahl notieren.

- [ ] **Step 2: Umbau**

In `reveal.ts` den bestehenden Block `export async function sendRevealPush(...) { ... }` inklusive des Doku-Kommentars direkt darueber (beginnt mit `// Sends the reveal notification to every member`) durch Folgendes ersetzen. Der Funktionskoerper ist wortgleich der bisherige, mit genau zwei Aenderungen: der Parameter `text: string` ersetzt den fest verdrahteten Reveal-Text in `messages`, und die Log-Praefixe bleiben `reveal-trip:` (der Code wohnt weiter in reveal-trip):

```ts
// Sends one notification text to every member of the trip except the
// triggering person and deletes tokens Expo reports as deregistered. The
// text goes into title AND body, like every push in this project.
//
// Generalized from the former sendRevealPush body (trip-start push, Spec
// 2026-08-20): recipients, token loading and dead-token cleanup are
// identical for every trip-wide push, only the text differs.
//
// IMPORTANT: `performReveal` only calls this (via sendRevealPush) in the
// winner branch of the CAS update. A parallel call that did not itself
// trigger the status change (0 rows affected, follow-up branch) must not
// send the push a second time, exactly this double send was a review
// finding on an earlier version of this function (f26437a) and is now
// proven, not just by reading the code, by reveal_test.ts with a real
// two-call race against a shared fake store.
export async function sendTripPush(
  store: RevealStore,
  sendFn: SendFn,
  trip: TripRow,
  text: string,
  triggeringUserId: string | null,
): Promise<void> {
  const { data: members, error: membersError } = await store.fetchMembers(trip.id);
  if (membersError) {
    console.error('reveal-trip: trip_members select failed', membersError);
    return;
  }

  // The triggering person does not get her own action pushed to her, she
  // already knows, she just tapped the button herself. Previously a
  // `.neq('user_id', triggeringUserId)` clause in the SQL query itself, now
  // the same set as pure JS filtering, so reveal_test.ts can check it with
  // no Docker.
  //
  // triggeringUserId null (auto-reveal and trip-start push): the calendar
  // triggered it, no person, nobody gets filtered; the comparison userId
  // !== null is true for every user_id.
  const recipientIds = (members ?? [])
    .map((m) => m.user_id)
    .filter((userId) => userId !== triggeringUserId);
  if (recipientIds.length === 0) return;

  const { data: tokenRows, error: tokenError } = await store.fetchTokens(recipientIds);
  if (tokenError) {
    console.error('reveal-trip: push_tokens select failed', tokenError);
    return;
  }
  const tokens = tokenRows ?? [];
  if (tokens.length === 0) return;

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: text,
    body: text,
    data: { trip_id: trip.id },
  }));

  const dead = await sendFn(messages);
  if (dead.length === 0) return;

  // Additionally restricted to `recipientIds` (review minor): the
  // ticket-to-token mapping in push.ts is purely position-based (ticket i
  // belongs to message i). Should Expo ever return a shifted `data` block,
  // a token wrongly read as DeviceNotRegistered must NEVER delete outside
  // the just-notified recipient circle, the restriction limits the damage
  // to exactly this circle, instead of running as the service role over
  // the whole table.
  const { error: deleteError } = await store.deleteTokens(dead, recipientIds);
  if (deleteError) {
    console.error('reveal-trip: cleaning up unregistered push_tokens failed', deleteError);
  }
}

// The reveal message as a thin wrapper: same recipients and cleanup, only
// the text is fixed. All existing callers stay unchanged.
export async function sendRevealPush(
  store: RevealStore,
  sendFn: SendFn,
  trip: TripRow,
  triggeringUserId: string | null,
): Promise<void> {
  await sendTripPush(store, sendFn, trip, `✈️ Euer Recap von «${trip.name}» ist bereit!`, triggeringUserId);
}
```

- [ ] **Step 3: Beide betroffenen Suiten laufen lassen**

Run: `cd supabase/functions/reveal-trip && npx deno test reveal_test.ts`
Expected: PASS, gleiche Anzahl wie Step 1.
Run: `cd ../reveal-schedule && npx deno test schedule_test.ts`
Expected: PASS (performAutoReveal nutzt sendRevealPush weiter ueber den Wrapper).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/reveal-trip/reveal.ts
git commit -m "refactor(push): sendTripPush als parametrisierter Kern, sendRevealPush wird Wrapper"
```

---

### Task 3: performTripStart, Store-Erweiterung und Unit-Tests

**Files:**
- Modify: `supabase/functions/reveal-schedule/schedule.ts` (Task-Typ, Zulassung, Store-Interface, neue Funktion)
- Modify: `supabase/functions/reveal-schedule/scheduleStore.ts` (zwei neue Queries)
- Test: `supabase/functions/reveal-schedule/schedule_test.ts`

**Interfaces:**
- Consumes: `sendTripPush(store, sendFn, trip, text, triggeringUserId)` aus Task 2; `TripRow`, `SendFn`, `StoreResult` aus `../reveal-trip/reveal.ts`; `ReportFn` aus `../_shared/errorReporter.ts`.
- Produces: `ScheduleTask = 'reveal' | 'reminder' | 'trip_start'`; `ScheduleStore.fetchTripStartTrips(today: string): Promise<StoreResult<TripRow[]>>`; `ScheduleStore.markStartPush(tripId: string): Promise<StoreResult<{ start_push_sent_at: string }>>`; `performTripStart(store: ScheduleStore, sendFn: SendFn, today: string, report?: ReportFn): Promise<ScheduleResult>`. Task 4 verdrahtet genau diese Namen.

- [ ] **Step 1: Unit-Tests schreiben (rot)**

In `schedule_test.ts`:

a) Import erweitern: in der Import-Liste aus `'./schedule.ts'` zusaetzlich `performTripStart` aufnehmen.

b) `FakeTrip` und den `trip()`-Helfer um Startdatum und Marker erweitern (bestehende Aufrufer bleiben gueltig, die neuen Felder haben Defaults):

```ts
type FakeTrip = TripRow & {
  start_date: string;
  end_date: string;
  end_reminder_sent_at: string | null;
  start_push_sent_at: string | null;
};
```

und im `trip()`-Helfer den Rueckgabewert ergaenzen um:

```ts
    start_date: '2026-08-01',
    start_push_sent_at: null,
```

sowie die Signatur erweitern zu:

```ts
function trip(
  id: string,
  end_date: string,
  status: TripRow['status'] = 'active',
  start_date = '2026-08-01',
): FakeTrip {
```

und `start_date` statt des Literals im Objekt verwenden (`start_date,`).

c) Im `fakeStore()`-Objekt nach `markReminder` die zwei neuen Methoden einsetzen:

```ts
    async fetchTripStartTrips(today) {
      return {
        data: state.trips
          .filter((t) => t.status === 'active' && t.start_date === today && t.start_push_sent_at === null)
          .map(row),
        error: null,
      };
    },
    async markStartPush(tripId) {
      const trip = state.trips.find((t) => t.id === tripId);
      if (!trip || trip.status !== 'active' || trip.start_push_sent_at !== null) {
        return { data: null, error: null };
      }
      trip.start_push_sent_at = new Date().toISOString();
      return { data: { start_push_sent_at: trip.start_push_sent_at }, error: null };
    },
```

d) Bei `checkScheduleRequest` einen Fall ergaenzen:

```ts
Deno.test('checkScheduleRequest: trip_start is a valid task', () => {
  const result = checkScheduleRequest('s3cret', 's3cret', { task: 'trip_start', today: '2026-08-20' });
  assertEquals(result, { ok: true, request: { task: 'trip_start', today: '2026-08-20' } });
});
```

e) Am Dateiende den Block `// --- performTripStart ---` anfuegen:

```ts
// --- performTripStart --------------------------------------------------------

Deno.test('performTripStart: every member gets the push, with the start text', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-30', 'active', '2026-08-20')],
    tokens: new Map([[OWNER_ID, ['tok-owner']], [MEMBER_ID, ['tok-member']]]),
    members: [OWNER_ID, MEMBER_ID],
  };
  const { sent, sendFn } = collecting();

  const result = await performTripStart(fakeStore(state), sendFn, '2026-08-20');

  assertEquals(result.status, 200);
  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(sent.map((n) => n.to).sort(), ['tok-member', 'tok-owner']);
  assertEquals(sent[0].title, 'Heute beginnt eure Reise «Reise t1». Sendet eure ersten Momente ein!');
  assertEquals(sent[0].body, sent[0].title);
  assertEquals(sent[0].data, { trip_id: 't1' });
});

Deno.test('performTripStart: a trip starting on another day gets nothing', async () => {
  const state: FakeState = {
    // Starts tomorrow: planned, not running, no push today.
    trips: [trip('t1', '2026-08-30', 'active', '2026-08-21')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const { sent, sendFn } = collecting();

  const result = await performTripStart(fakeStore(state), sendFn, '2026-08-20');

  assertEquals(result.body, { ok: true, processed: 0 });
  assertEquals(sent.length, 0);
});

Deno.test('performTripStart: a second run sends nothing more', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-30', 'active', '2026-08-20')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const store = fakeStore(state);
  const first = collecting();
  await performTripStart(store, first.sendFn, '2026-08-20');
  const second = collecting();

  const result = await performTripStart(store, second.sendFn, '2026-08-20');

  assertEquals(first.sent.length, 1);
  assertEquals(second.sent.length, 0);
  assertEquals(result.body, { ok: true, processed: 0 });
});

Deno.test('performTripStart: a lost marker CAS means no push', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-30', 'active', '2026-08-20')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const store = fakeStore(state);
  // A parallel run just set the marker, but this run's selection had
  // already been read: markStartPush then returns null.
  const realSelection = store.fetchTripStartTrips.bind(store);
  store.fetchTripStartTrips = async (today) => {
    const selection = await realSelection(today);
    await store.markStartPush('t1');
    return selection;
  };
  const { sent, sendFn } = collecting();

  const result = await performTripStart(store, sendFn, '2026-08-20');

  assertEquals(sent.length, 0);
  assertEquals(result.body, { ok: true, processed: 0 });
});

Deno.test('performTripStart: members with no token still count as processed', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-30', 'active', '2026-08-20')],
    tokens: new Map(),
    members: [OWNER_ID],
  };
  const { sent, sendFn } = collecting();

  const result = await performTripStart(fakeStore(state), sendFn, '2026-08-20');

  assertEquals(sent.length, 0);
  // The marker is set (the start IS handled), only delivery had nothing
  // to reach.
  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(state.trips[0].start_push_sent_at !== null, true);
});

Deno.test('performTripStart: dead tokens are cleaned up within the member circle', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-30', 'active', '2026-08-20')],
    tokens: new Map([[OWNER_ID, ['tok-tot']]]),
    members: [OWNER_ID, MEMBER_ID],
  };
  const deleted: Array<{ tokens: string[]; userIds: string[] }> = [];
  const store = fakeStore(state);
  store.deleteTokens = async (tokens, userIds) => {
    deleted.push({ tokens, userIds });
    return { error: null };
  };
  const sendFn: SendFn = async () => ['tok-tot'];

  await performTripStart(store, sendFn, '2026-08-20');

  assertEquals(deleted, [{ tokens: ['tok-tot'], userIds: [OWNER_ID, MEMBER_ID] }]);
});

Deno.test('performTripStart: a failing push is reported, the marker stands', async () => {
  const state: FakeState = {
    trips: [trip('t1', '2026-08-30', 'active', '2026-08-20')],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const reported: unknown[] = [];
  const throwingSendFn: SendFn = async () => {
    throw new Error('Push kaputt');
  };

  const result = await performTripStart(fakeStore(state), throwingSendFn, '2026-08-20', async (error) => {
    reported.push(error);
  });

  assertEquals(result.status, 200);
  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(state.trips[0].start_push_sent_at !== null, true);
  assertEquals(reported.length, 1);
});

Deno.test('performTripStart: a failing selection produces 500 and one report', async () => {
  const store = fakeStore({ trips: [], tokens: new Map(), members: [] });
  store.fetchTripStartTrips = async () => ({ data: null, error: new Error('kaputt') });
  const reported: unknown[] = [];
  const { sendFn } = collecting();

  const result = await performTripStart(store, sendFn, '2026-08-20', async (error) => {
    reported.push(error);
  });

  assertEquals(result.status, 500);
  assertEquals(reported.length, 1);
});

Deno.test('performTripStart: a marker error on trip one does not stop trip two', async () => {
  const state: FakeState = {
    trips: [
      trip('t1', '2026-08-30', 'active', '2026-08-20'),
      trip('t2', '2026-08-30', 'active', '2026-08-20'),
    ],
    tokens: new Map([[OWNER_ID, ['tok-owner']]]),
    members: [OWNER_ID],
  };
  const store = fakeStore(state);
  const realMark = store.markStartPush.bind(store);
  store.markStartPush = async (tripId) =>
    tripId === 't1' ? { data: null, error: new Error('kaputt') } : realMark(tripId);
  const reported: unknown[] = [];
  const { sent, sendFn } = collecting();

  const result = await performTripStart(store, sendFn, '2026-08-20', async (error) => {
    reported.push(error);
  });

  assertEquals(result.body, { ok: true, processed: 1 });
  assertEquals(sent.length, 1);
  assertEquals(reported.length, 1);
});
```

- [ ] **Step 2: Tests laufen lassen, Scheitern pruefen**

Run: `cd supabase/functions/reveal-schedule && npx deno test schedule_test.ts`
Expected: FAIL beim Kompilieren (`performTripStart` existiert nicht, `ScheduleStore` kennt die neuen Methoden nicht).

- [ ] **Step 3: schedule.ts erweitern**

a) Task-Typ und Zulassung:

```ts
export type ScheduleTask = 'reveal' | 'reminder' | 'trip_start';
```

und in `checkScheduleRequest` die Task-Pruefung ersetzen durch:

```ts
  if (b.task !== 'reveal' && b.task !== 'reminder' && b.task !== 'trip_start') {
    return { ok: false, status: 400, error: 'Ungültige Anfrage.' };
  }
```

b) Im Header-Kommentar der Datei (Wire-Vertrag) `'reveal'/'reminder'` zu `'reveal'/'reminder'/'trip_start'` nachfuehren und die Migrationsnummern `20260820090000` um `20260820120000` ergaenzen.

c) Import ergaenzen: in der Import-Liste aus `'../reveal-trip/reveal.ts'` zusaetzlich `sendTripPush` aufnehmen.

d) `ScheduleStore` um die zwei Methoden erweitern (nach `markReminder`):

```ts
  // status='active', start_date = today, start_push_sent_at is null; like
  // fetchReminderTrips the conditions live as a real Postgres query in the
  // adapter, checked in the integration test.
  fetchTripStartTrips(today: string): Promise<StoreResult<TripRow[]>>;
  // CAS on the marker (… where start_push_sent_at is null): null means 0
  // rows, another run was faster, no second push.
  markStartPush(tripId: string): Promise<StoreResult<{ start_push_sent_at: string }>>;
```

(`StoreResult` steht bereits in der Import-Liste aus `'../reveal-trip/reveal.ts'`.)

e) Nach `performReminder` die neue Funktion anfuegen:

```ts
// Pushes to ALL members on the morning of the first trip day (Spec
// 2026-08-20-reisebeginn-push-design.md): the calendar triggers it, no
// person, so triggeringUserId is null and nobody gets filtered. CAS on the
// marker makes a double run harmless; only the winner sends. Should the
// send fail AFTER the marker is set, the push is simply missed (no retry):
// it is a convenience, the trip runs regardless. A trip created on its
// start day after the cron run gets no push either: the next run sees
// start_date < today and the equality condition no longer matches.
export async function performTripStart(
  store: ScheduleStore,
  sendFn: SendFn,
  today: string,
  report: ReportFn = NO_REPORTER,
): Promise<ScheduleResult> {
  const { data: trips, error } = await store.fetchTripStartTrips(today);
  if (error || !trips) {
    console.error('reveal-schedule: selecting the trip starts failed', error);
    await report(error ?? new Error('reveal-schedule: trip start selection returned no data.'), { today });
    return { status: 500, body: { error: 'Auswahl fehlgeschlagen.' } };
  }

  let processed = 0;
  for (const trip of trips) {
    const { data: marked, error: markerError } = await store.markStartPush(trip.id);
    if (markerError) {
      console.error('reveal-schedule: setting the trip start marker failed', markerError);
      await report(markerError, { trip_id: trip.id, today });
      continue;
    }
    if (!marked) continue;
    processed++;

    try {
      await sendTripPush(
        store,
        sendFn,
        trip,
        `Heute beginnt eure Reise «${trip.name}». Sendet eure ersten Momente ein!`,
        null,
      );
    } catch (err) {
      console.error('reveal-schedule: sending the trip start push failed', err);
      await report(err, { trip_id: trip.id, today });
    }
  }
  return { status: 200, body: { ok: true, processed } };
}
```

- [ ] **Step 4: scheduleStore.ts erweitern**

Im Rueckgabeobjekt von `createScheduleStore` nach `markReminder` einsetzen:

```ts
    async fetchTripStartTrips(today) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select(TRIP_COLUMNS)
        .eq('status', 'active')
        .eq('start_date', today)
        .is('start_push_sent_at', null);
      return { data: data as TripRow[] | null, error };
    },

    // 'now' like in revealStore.ts: the timestamp comes from the DB clock.
    // CAS and status condition like markReminder: a trip revealed between
    // selection and this update must not get the start push anymore.
    async markStartPush(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .update({ start_push_sent_at: 'now' })
        .eq('id', tripId)
        .eq('status', 'active')
        .is('start_push_sent_at', null)
        .select('start_push_sent_at')
        .maybeSingle();
      return { data: data as { start_push_sent_at: string } | null, error };
    },
```

Im Header-Kommentar der Datei «the three schedule-specific queries» zu «the five schedule-specific queries» nachfuehren.

- [ ] **Step 5: Tests laufen lassen, Gruen pruefen**

Run: `cd supabase/functions/reveal-schedule && npx deno test schedule_test.ts`
Expected: PASS, alle bisherigen plus die 10 neuen Faelle.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/reveal-schedule/schedule.ts supabase/functions/reveal-schedule/scheduleStore.ts supabase/functions/reveal-schedule/schedule_test.ts
git commit -m "feat(push): performTripStart mit Marker-CAS und Push an alle Mitglieder"
```

---

### Task 4: Verdrahtung, Integrationstests und Gesamtlauf

**Files:**
- Modify: `supabase/functions/reveal-schedule/index.ts` (Dispatch + Vertragskommentar)
- Test: `supabase/functions/reveal-schedule/scheduleStore_integration_test.ts`

**Interfaces:**
- Consumes: `performTripStart` aus Task 3; Spalte und Cron-Job aus Task 1.
- Produces: die Edge Function beantwortet `{task: 'trip_start', today}`; damit ist die Kette SQL-Cron -> Function -> Push komplett.

- [ ] **Step 1: Integrationstests schreiben**

In `scheduleStore_integration_test.ts`:

a) Den `newTrip`-Helfer um ein Startdatum erweitern (bestehende Aufrufer bleiben gueltig):

```ts
async function newTrip(endDate: string, startDate = '2026-01-01'): Promise<string> {
```

und im Body `start_date: startDate,` statt des Literals verwenden.

b) Den Header-Kommentar der Datei um die zwei neuen Queries ergaenzen (Punkte 4 und 5: `fetchTripStartTrips` mit Gleichheit auf start_date, `markStartPush` mit CAS und Status-Bedingung).

c) Am Dateiende anfuegen:

```ts
Deno.test({
  name: 'fetchTripStartTrips: start_date = today, active only, marker empty',
  ignore: !stackReady,
  fn: async () => {
    const store = createScheduleStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await newTrip('2026-01-10', '2026-01-02');
    try {
      const due = await store.fetchTripStartTrips('2026-01-02');
      assert(due.data !== null, String(due.error));
      assert(due.data.some((t) => t.id === tripId), 'a trip with start_date = today gets the push');

      // The day before and the day after: the equality does not match.
      const dayBefore = await store.fetchTripStartTrips('2026-01-01');
      assert(dayBefore.data !== null, String(dayBefore.error));
      assertEquals(dayBefore.data.some((t) => t.id === tripId), false);
      const dayAfter = await store.fetchTripStartTrips('2026-01-03');
      assert(dayAfter.data !== null, String(dayAfter.error));
      assertEquals(dayAfter.data.some((t) => t.id === tripId), false);

      // Marker set: no second selection.
      await store.markStartPush(tripId);
      const marked = await store.fetchTripStartTrips('2026-01-02');
      assert(marked.data !== null, String(marked.error));
      assertEquals(marked.data.some((t) => t.id === tripId), false);
    } finally {
      await deleteTrip(tripId);
    }
  },
});

Deno.test({
  name: 'markStartPush: CAS in the real update, second call 0 rows, revealed blocks',
  ignore: !stackReady,
  fn: async () => {
    const store = createScheduleStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    const tripId = await newTrip('2026-01-10', '2026-01-02');
    const tripId2 = await newTrip('2026-01-10', '2026-01-02');
    try {
      const first = await store.markStartPush(tripId);
      assert(first.data !== null, String(first.error));
      const second = await store.markStartPush(tripId);
      assertEquals(second.data, null);
      assertEquals(second.error, null);

      // Revealed between selection and marker: `status = 'active'` in the
      // real update condition blocks the push.
      await store.updateIfActive(tripId2);
      const afterReveal = await store.markStartPush(tripId2);
      assertEquals(afterReveal, { data: null, error: null });
    } finally {
      await deleteTrip(tripId);
      await deleteTrip(tripId2);
    }
  },
});
```

- [ ] **Step 2: Integrationstests laufen lassen**

Run: `cd supabase/functions/reveal-schedule && npx deno test --allow-net --allow-run=supabase scheduleStore_integration_test.ts`
Expected: PASS, sofern der lokale Stack laeuft und Task 1 migriert ist (die neuen Queries existieren seit Task 3, die Spalte seit Task 1). Laeuft der Stack nicht, meldet die Datei «skipped, needs supabase start»: dann `supabase start` und erneut.

- [ ] **Step 3: index.ts verdrahten**

a) Den Dispatch ersetzen:

```ts
  const { task, today } = admission.request;
  const result = task === 'reveal'
    ? await performAutoReveal(store, send, today, report)
    : task === 'reminder'
      ? await performReminder(store, send, today, report)
      : await performTripStart(store, send, today, report);
  return json(result.body, result.status);
```

b) Import ergaenzen: in der Import-Liste aus `'./schedule.ts'` zusaetzlich `performTripStart` aufnehmen.

c) Im Header-Kommentar den Wire-Vertrag nachfuehren: die Task-Werte `'reveal'/'reminder'/'trip_start'` und die Migrationen `20260820090000`/`20260820120000`.

- [ ] **Step 4: Live-Beweis gegen die lokale Function**

Die Function lokal bedienen (falls nicht schon aktiv: `supabase functions serve` im Hintergrund) und den neuen Task einmal echt aufrufen. CRON_SECRET steht in `supabase/functions/.env`:

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/reveal-schedule \
  -H "x-cron-secret: $(grep '^CRON_SECRET=' supabase/functions/.env | cut -d= -f2)" \
  -H "content-type: application/json" \
  -d '{"task":"trip_start","today":"2026-08-20"}'
```

Expected: `{"ok":true,"processed":N}` mit Status 200 (N haengt von den Seed-Reisen ab; entscheidend ist 200 statt 400 «Ungültige Anfrage»).

- [ ] **Step 5: Gesamtlauf aller betroffenen Suiten**

Run: `cd supabase/functions/reveal-schedule && npx deno test --allow-net --allow-run=supabase`
Expected: PASS (Unit + Integration).
Run: `cd ../reveal-trip && npx deno test reveal_test.ts`
Expected: PASS.
Run: `supabase test db`
Expected: alle pgTAP-Dateien gruen.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/reveal-schedule/index.ts supabase/functions/reveal-schedule/scheduleStore_integration_test.ts
git commit -m "feat(push): reveal-schedule beantwortet trip_start, Integrationsbeweis fuer Auswahl und Marker"
```

---

## Nacharbeiten ausserhalb dieses Plans

- TODO.md: den Punkt «Push beim Reisebeginn» abhaken (beim Merge).
- Hosted-Rollout: gehoert zur ohnehin offenen reveal-schedule-Deploy-Liste (Function mit `--no-verify-jwt` deployen, `supabase db push`); Vault-Secrets `project_url`/`cron_secret` und das Function-Secret `CRON_SECRET` sind dort Teil des bestehenden Rollout-Rezepts.
