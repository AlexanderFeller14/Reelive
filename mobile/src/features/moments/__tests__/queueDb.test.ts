// In-memory rebuild of expo-sqlite: checks that queueDb issues correct SQL
// and cleanly translates rows back into QueueJob. The database itself isn't
// what we're testing, the translation is.
const rows: Record<string, unknown>[] = [];
// Mirrors that a "select" on a table that was never created throws ("no
// such table") instead of returning an empty list, exactly the state of a
// freshly installed device before initQueue() has ever run (Task 13).
// mockExecAsync stands for "create table if not exists" and unlocks the
// table.
let tableCreated = false;
// PRAGMA table_info(upload_queue): which columns the (fictional) table
// already has BEFORE initQueue() runs in this test run, simulates an
// existing install (Task-13-Fix-Runde-2, migrateColumns). Default:
// complete, no ALTER TABLE needed; a dedicated migration test overrides
// this deliberately.
const ALL_COLUMNS = [
  'id', 'post_id', 'trip_id', 'author_id', 'typ', 'medium_uri', 'thumb_uri',
  'storage_key', 'thumb_key', 'caption', 'captured_at', 'captured_tz', 'lat',
  'lng', 'place_name', 'duration_s', 'zustand', 'versuche', 'naechster_versuch',
  'zeile_angelegt', 'medium_geladen', 'thumb_geladen',
];
let existingColumns: string[] = [...ALL_COLUMNS];
// Second table in the same database (Final-Review, Important 9):
// permanently discarded moments, so the app can explain them instead of
// letting them vanish silently.
const discardedRows: Record<string, unknown>[] = [];
const mockRunAsync = jest.fn(async (..._args: unknown[]) => {});
const mockGetAllAsync = jest.fn(async (..._args: unknown[]) => {
  const sql = _args[0];
  if (typeof sql === 'string' && sql.includes('pragma table_info')) {
    return existingColumns.map((name) => ({ name }));
  }
  if (!tableCreated) throw new Error('no such table: upload_queue');
  if (typeof sql === 'string' && sql.includes('verworfene_momente')) return discardedRows;
  return rows;
});
const mockExecAsync = jest.fn(async (..._args: unknown[]) => {
  tableCreated = true;
});
// Kept accessible instead of inline, so an opening (or not opening) on
// import stays provable, see the test further below.
const mockOpenDatabaseAsync = jest.fn(async (..._args: unknown[]) => ({
  execAsync: (...a: unknown[]) => mockExecAsync(...a),
  runAsync: (...a: unknown[]) => mockRunAsync(...a),
  getAllAsync: (...a: unknown[]) => mockGetAllAsync(...a),
}));

jest.mock('expo-sqlite', () => ({
  // Delayed call like the other three methods: only read mockOpenDatabaseAsync
  // at the actual call, not already while evaluating the factory (which runs
  // early via jest-hoist, before the const initialization above).
  openDatabaseAsync: (...a: unknown[]) => mockOpenDatabaseAsync(...a),
}));

// Fixed Documents location for the path translation (queuePaths.ts): the
// tests below check the reverse translation against exactly this anchor.
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///container-NEU/Documents/' } },
}));

import {
  initQueue,
  addJob,
  allJobs,
  updateJob,
  removeJob,
  rememberDiscarded,
  discardedMoments,
  acknowledgeDiscarded,
} from '../queueDb';
import type { QueueJob } from '../types';

const job: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: 'Hallo', captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: 47.1, lng: 8.2, place_name: 'Luzern', duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

// Reads the column list from an "insert into upload_queue (a, b, c) values
// (...)" statement, so tests can prove a field's position in the values
// array without importing COLUMNS from the implementation.
function columnsFromInsertSql(sql: string): string[] {
  const match = sql.match(/\(([^)]+)\)\s*values/i);
  if (!match) throw new Error(`Konnte Spaltenliste nicht aus SQL lesen: ${sql}`);
  return match[1].split(',').map((s) => s.trim());
}

beforeEach(() => {
  rows.length = 0;
  discardedRows.length = 0;
  existingColumns = [...ALL_COLUMNS];
  jest.clearAllMocks();
});

test('initQueue creates the table', async () => {
  await initQueue();
  expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('create table if not exists'));
});

// Finding 1: create table and insert/update must come from the same
// source. This test bites: if a column is missing in the generated
// create-table text (because someone introduces a hand-written, diverging
// list again), it fails.
test('initQueue creates every field of QueueJob as a column', async () => {
  await initQueue();
  const [sql] = mockExecAsync.mock.calls[0] as [string];
  for (const field of Object.keys(job)) {
    expect(sql).toMatch(new RegExp(`\\b${field}\\b`));
  }
});

// Task-13-Fix-Runde-2: `create table if not exists` only creates a NEW
// table with the full schema, an existing install (table already exists,
// without the new author_id column) does NOT grow along with it.
test('initQueue carries a missing column of an existing install forward via ALTER TABLE, without "not null"', async () => {
  existingColumns = ALL_COLUMNS.filter((s) => s !== 'author_id');
  await initQueue();
  const schemaChangeCalls = mockExecAsync.mock.calls
    .map(([sql]) => sql as string)
    .filter((sql) => /alter table/i.test(sql));
  expect(schemaChangeCalls).toHaveLength(1);
  expect(schemaChangeCalls[0]).toMatch(/alter table upload_queue add column author_id/i);
  // Deliberately without "not null", even though author_id is required in
  // the schema: SQLite refuses a NOT-NULL column without a DEFAULT on a
  // populated table.
  expect(schemaChangeCalls[0]).not.toMatch(/not null/i);
});

test('initQueue leaves an already complete table untouched (no ALTER TABLE)', async () => {
  await initQueue();
  const hasSchemaChange = mockExecAsync.mock.calls.some(([sql]) => /alter table/i.test(sql as string));
  expect(hasSchemaChange).toBe(false);
});

// A column carried forward via ALTER TABLE is nullable, legacy rows get
// author_id: null. isComplete() (required-field check) rejects them on read
// as incomplete, instead of processing them under the currently signed-in
// person. That's deliberate, not a side effect: a legacy moment without a
// known author identity must never land under a stranger's name.
test('allJobs rejects a legacy row without author_id (migration from before Task 13)', async () => {
  rows.push({ ...job, id: 'alt-1', author_id: null });
  const jobs = await allJobs();
  expect(jobs).toHaveLength(0);
});

test('addJob writes every field', async () => {
  await addJob(job);
  const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('insert');
  expect(values).toContain('j1');
  expect(values).toContain('trips/t1/p1.jpg');
});

// === Relative paths (fix 2026-08-18) ===
// The container UUID in the Documents path changes with every app rebuild;
// absolutely stored paths pointed into nothing afterwards, and on
// 2026-08-17 the worker discarded four pending moments this way as "file
// missing". The database therefore only holds the part below Documents
// (queuePaths.ts) and resolves it on read against the current location.
test('addJob stores medium and thumb path relative to Documents', async () => {
  await addJob({
    ...job,
    medium_uri: 'file:///container-NEU/Documents/momente/p1/medium.jpg',
    thumb_uri: 'file:///container-NEU/Documents/momente/p1/thumb.jpg',
  });
  const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  const columns = columnsFromInsertSql(sql);
  expect(values[columns.indexOf('medium_uri')]).toBe('momente/p1/medium.jpg');
  expect(values[columns.indexOf('thumb_uri')]).toBe('momente/p1/thumb.jpg');
});

test('allJobs resolves relative paths against the current Documents location', async () => {
  rows.push({
    ...job,
    medium_uri: 'momente/p1/medium.jpg',
    thumb_uri: 'momente/p1/thumb.jpg',
  });
  const [read] = await allJobs();
  expect(read.medium_uri).toBe('file:///container-NEU/Documents/momente/p1/medium.jpg');
  expect(read.thumb_uri).toBe('file:///container-NEU/Documents/momente/p1/thumb.jpg');
});

// Legacy rows from before the fix carry the absolute path of the THEN
// CURRENT install. They get re-anchored on read — iOS does carry the files
// under Documents along on update, only the container UUID in the path no
// longer matches.
test('allJobs re-anchors absolute legacy rows at the current Documents location', async () => {
  rows.push({
    ...job,
    medium_uri: 'file:///container-ALT/Documents/momente/p1/medium.jpg',
    thumb_uri: 'file:///container-ALT/Documents/momente/p1/thumb.jpg',
  });
  const [read] = await allJobs();
  expect(read.medium_uri).toBe('file:///container-NEU/Documents/momente/p1/medium.jpg');
  expect(read.thumb_uri).toBe('file:///container-NEU/Documents/momente/p1/thumb.jpg');
});

// Finding 3a: boolean translation checked position-accurately and in both
// directions (before: `toContain(1)` was positionless and coincidentally
// hit other ones; `false → 0` wasn't checked at all).
test('addJob writes booleans position-accurately as 0/1 in both directions', async () => {
  await addJob({ ...job, zeile_angelegt: true, medium_geladen: false, thumb_geladen: true });
  const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  const columns = columnsFromInsertSql(sql);
  expect(values[columns.indexOf('zeile_angelegt')]).toBe(1);
  expect(values[columns.indexOf('medium_geladen')]).toBe(0);
  expect(values[columns.indexOf('thumb_geladen')]).toBe(1);
});

// Finding 3b: genuine round-trip test. The columns/values actually written
// by addJob are assembled into a row (the way SQLite would store it) and
// read back via allJobs, must come out unscathed.
test('a job survives a round trip through addJob and allJobs unscathed', async () => {
  const original: QueueJob = {
    ...job,
    id: 'rt-1',
    zeile_angelegt: true,
    medium_geladen: false,
    thumb_geladen: true,
  };
  await addJob(original);
  const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  const columns = columnsFromInsertSql(sql);
  const storedRow: Record<string, unknown> = {};
  columns.forEach((column, i) => {
    storedRow[column] = values[i];
  });
  rows.push(storedRow);

  const [restored] = await allJobs();
  expect(restored).toEqual(original);
});

test('allJobs converts 0/1 back into booleans', async () => {
  rows.push({
    ...job, zeile_angelegt: 1, medium_geladen: 0, thumb_geladen: 1,
  });
  const [loaded] = await allJobs();
  expect(loaded.zeile_angelegt).toBe(true);
  expect(loaded.medium_geladen).toBe(false);
  expect(loaded.thumb_geladen).toBe(true);
});

// Finding 2: a row with a missing required field must not pass as a valid
// job, and must not take the rest of the queue down with it.
test('allJobs skips a row with a missing required field, keeps the rest', async () => {
  const { post_id: _discarded, ...broken } = job;
  rows.push({ ...broken, id: 'kaputt-1' });
  rows.push({ ...job, id: 'j2' });

  const jobs = await allJobs();

  expect(jobs).toHaveLength(1);
  expect(jobs[0].id).toBe('j2');
});

// Finding 2: an invalid zustand value (e.g. from an unmigrated schema
// change) must not pass as a valid job either.
test('allJobs skips a row with an invalid zustand', async () => {
  rows.push({ ...job, id: 'kaputt-2', zustand: 'explodiert' });

  const jobs = await allJobs();

  expect(jobs).toHaveLength(0);
});

test('updateJob writes the progress back', async () => {
  await updateJob({ ...job, versuche: 3, zeile_angelegt: true });
  const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('update');
  expect(values).toContain(3);
  expect(values).toContain(1); // true → 1
});

test('removeJob deletes via the id', async () => {
  await removeJob('j1');
  const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('delete');
  expect(values).toEqual(['j1']);
});

// Finding 3c: "not opened on import" was previously unproven,
// mockOpenDatabaseAsync was enclosed in the mock factory and inaccessible
// to the test, and jest.clearAllMocks() in beforeEach would have wiped a
// call on import anyway. Fix: load a fresh module after
// jest.resetModules() (a registry reset doesn't invalidate the mock
// factory registered above) and check the calls right afterwards, before
// anything else could reset the mock.
test('does not open the database on import, only on first access', async () => {
  jest.resetModules();
  const freshModule: typeof import('../queueDb') = require('../queueDb');

  expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();

  await freshModule.initQueue();

  expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
});

// Task 13: the worker (and with it initQueue()) only runs from signedIn
// onwards, a freshly installed device or one without session/profile
// therefore doesn't have the table yet. allJobs() still gets called
// directly from outside (trip detail, counter) and must never block those
// callers with an SQLite error, but has to ensure the table itself.
//
// Fresh module after jest.resetModules() like in the test directly above,
// otherwise an earlier test in this file (e.g. the first initQueue call)
// would already have permanently set `tableCreated` to true and this test
// would no longer prove anything. `tableCreated` is deliberately NOT reset
// in beforeEach (see above), it mirrors a real SQLite table created once
// for the process runtime, no per-test reset.
test('allJobs returns an empty list instead of throwing on a table that was never created', async () => {
  jest.resetModules();
  tableCreated = false;
  const freshModule: typeof import('../queueDb') = require('../queueDb');

  await expect(freshModule.allJobs()).resolves.toEqual([]);
  expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('create table if not exists'));
});

// === Final-Review, Important 9: discarded moments ===
// Spec §8 promises "discarded with an explanation". The entry has to
// survive the same restart as the queue, hence the same SQLite file, its
// own table.

test('initQueue also creates the table for discarded moments', async () => {
  await initQueue();
  expect(mockExecAsync).toHaveBeenCalledWith(
    expect.stringContaining('create table if not exists verworfene_momente')
  );
});

// insert or replace: a restart after a crash must not report the same
// moment twice.
test('rememberDiscarded writes idempotently', async () => {
  await rememberDiscarded({
    id: 'p9',
    trip_id: 't1',
    author_id: 'u1',
    grund: 'Nach dem Reveal aufgenommen.',
    verworfen_am: 1234,
  });
  const [sql, values] = mockRunAsync.mock.calls[0] as unknown as [string, unknown[]];
  expect(sql).toContain('insert or replace into verworfene_momente');
  expect(values).toEqual(['p9', 't1', 'u1', 'Nach dem Reveal aufgenommen.', 1234]);
});

// On a shared device, a discarded moment is nobody's business except the
// person who captured it.
test('discardedMoments only reads this trip’s own entries', async () => {
  discardedRows.push({ id: 'p9', trip_id: 't1', author_id: 'u1', grund: 'Grund', verworfen_am: 1 });
  await expect(discardedMoments('t1', 'u1')).resolves.toEqual([
    { id: 'p9', trip_id: 't1', author_id: 'u1', grund: 'Grund', verworfen_am: 1 },
  ]);
  const [sql, values] = mockGetAllAsync.mock.calls.at(-1) as unknown as [string, unknown[]];
  expect(sql).toContain('where trip_id = ? and author_id = ?');
  expect(values).toEqual(['t1', 'u1']);
});

test('acknowledgeDiscarded only deletes this trip’s own entries', async () => {
  await acknowledgeDiscarded('t1', 'u1');
  const [sql, values] = mockRunAsync.mock.calls[0] as unknown as [string, unknown[]];
  expect(sql).toContain('delete from verworfene_momente');
  expect(values).toEqual(['t1', 'u1']);
});
