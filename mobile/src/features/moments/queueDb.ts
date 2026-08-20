import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { forStorage, forReading } from './queuePaths';
import type { JobZustand, QueueJob, DiscardedMoment } from './types';

// Only place in the project that translates between an SQLite row and
// QueueJob. Booleans are stored as 0/1, times as numbers, see Task-3-Brief.

const DB_NAME = 'upload_queue.db';

let database: Promise<SQLiteDatabase> | null = null;

function getDatabase(): Promise<SQLiteDatabase> {
  if (!database) {
    database = SQLite.openDatabaseAsync(DB_NAME);
  }
  return database;
}

// Same lazy pattern as getDatabase() above: allJobs() calls this on EVERY
// call (including every 5-second tick of the worker), but `create table if
// not exists` shouldn't have to run again every single time for that,
// exactly the load that uploadWorker already deliberately avoids with its
// own `ensureInitialized` (Task-13-Fix-Runde-1, Minor). A failed attempt is
// NOT cached, initQueue() then throws again on the next call instead of
// leaving the queue dead for the rest of the process after a single
// failure.
let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await initQueue();
  tableEnsured = true;
}

const COLUMN_SCHEMA = [
  { name: 'id', typ: 'text', pflicht: true },
  { name: 'post_id', typ: 'text', pflicht: true },
  { name: 'trip_id', typ: 'text', pflicht: true },
  { name: 'author_id', typ: 'text', pflicht: true },
  { name: 'typ', typ: 'text', pflicht: true },
  { name: 'medium_uri', typ: 'text', pflicht: true },
  { name: 'thumb_uri', typ: 'text', pflicht: true },
  { name: 'storage_key', typ: 'text', pflicht: true },
  { name: 'thumb_key', typ: 'text', pflicht: true },
  { name: 'caption', typ: 'text', pflicht: false },
  { name: 'captured_at', typ: 'text', pflicht: true },
  { name: 'captured_tz', typ: 'text', pflicht: true },
  { name: 'lat', typ: 'real', pflicht: false },
  { name: 'lng', typ: 'real', pflicht: false },
  { name: 'place_name', typ: 'text', pflicht: false },
  { name: 'duration_s', typ: 'real', pflicht: false },
  { name: 'zustand', typ: 'text', pflicht: true },
  { name: 'versuche', typ: 'integer', pflicht: true },
  { name: 'naechster_versuch', typ: 'integer', pflicht: true },
  { name: 'zeile_angelegt', typ: 'integer', pflicht: true },
  { name: 'medium_geladen', typ: 'integer', pflicht: true },
  { name: 'thumb_geladen', typ: 'integer', pflicht: true },
] as const;

type Column = (typeof COLUMN_SCHEMA)[number]['name'];
type Row = Record<Column, string | number | null>;

const COLUMNS: readonly Column[] = COLUMN_SCHEMA.map((s) => s.name);

const ALLOWED_STATES: readonly JobZustand[] = ['wartet', 'laeuft', 'fertig'];
const ALLOWED_TYPES: readonly QueueJob['typ'][] = ['photo', 'video'];

function columnDefinitionSql(def: (typeof COLUMN_SCHEMA)[number]): string {
  if (def.name === 'id') return `${def.name} ${def.typ} primary key`;
  return `${def.name} ${def.typ}${def.pflicht ? ' not null' : ''}`;
}

function toRow(job: QueueJob): Row {
  return {
    id: job.id,
    post_id: job.post_id,
    trip_id: job.trip_id,
    author_id: job.author_id,
    typ: job.typ,
    medium_uri: forStorage(job.medium_uri),
    thumb_uri: forStorage(job.thumb_uri),
    storage_key: job.storage_key,
    thumb_key: job.thumb_key,
    caption: job.caption,
    captured_at: job.captured_at,
    captured_tz: job.captured_tz,
    lat: job.lat,
    lng: job.lng,
    place_name: job.place_name,
    duration_s: job.duration_s,
    zustand: job.zustand,
    versuche: job.versuche,
    naechster_versuch: job.naechster_versuch,
    zeile_angelegt: job.zeile_angelegt ? 1 : 0,
    medium_geladen: job.medium_geladen ? 1 : 0,
    thumb_geladen: job.thumb_geladen ? 1 : 0,
  };
}

function isComplete(row: Record<string, unknown>): boolean {
  for (const def of COLUMN_SCHEMA) {
    if (def.pflicht && (row[def.name] === null || row[def.name] === undefined)) {
      return false;
    }
  }
  if (!ALLOWED_STATES.includes(row.zustand as JobZustand)) return false;
  if (!ALLOWED_TYPES.includes(row.typ as QueueJob['typ'])) return false;
  return true;
}

function toJob(row: Record<string, unknown>): QueueJob | null {
  if (!isComplete(row)) return null;
  return {
    id: row.id as string,
    post_id: row.post_id as string,
    trip_id: row.trip_id as string,
    author_id: row.author_id as string,
    typ: row.typ as QueueJob['typ'],
    medium_uri: forReading(row.medium_uri as string),
    thumb_uri: forReading(row.thumb_uri as string),
    storage_key: row.storage_key as string,
    thumb_key: row.thumb_key as string,
    caption: (row.caption as string | null) ?? null,
    captured_at: row.captured_at as string,
    captured_tz: row.captured_tz as string,
    lat: (row.lat as number | null) ?? null,
    lng: (row.lng as number | null) ?? null,
    place_name: (row.place_name as string | null) ?? null,
    duration_s: (row.duration_s as number | null) ?? null,
    zustand: row.zustand as JobZustand,
    versuche: row.versuche as number,
    naechster_versuch: row.naechster_versuch as number,
    zeile_angelegt: Boolean(row.zeile_angelegt),
    medium_geladen: Boolean(row.medium_geladen),
    thumb_geladen: Boolean(row.thumb_geladen),
  };
}

function valuesFor(row: Row, columns: readonly Column[]): (string | number | null)[] {
  return columns.map((column) => row[column]);
}

// SQLite refuses a NOT-NULL column without a DEFAULT on an already
// populated table, so the ALTER TABLE below deliberately omits "not null"
// even though COLUMN_SCHEMA lists the column as required. Existing rows
// get NULL, isComplete() (see toJob) rejects them on read as incomplete:
// a legacy moment without a known author identity must never land under a
// stranger's name, not even by simply attributing it to the person
// currently using the device.
async function migrateColumns(db: SQLiteDatabase): Promise<void> {
  const existingColumns = await db.getAllAsync<{ name: string }>('pragma table_info(upload_queue)', []);
  const names = new Set(existingColumns.map((s) => s.name));
  for (const def of COLUMN_SCHEMA) {
    if (!names.has(def.name)) {
      await db.execAsync(`alter table upload_queue add column ${def.name} ${def.typ}`);
    }
  }
}

export async function initQueue(): Promise<void> {
  const db = await getDatabase();
  const columns = COLUMN_SCHEMA.map(columnDefinitionSql).join(',\n        ');
  try {
    await db.execAsync(`
      create table if not exists upload_queue (
        ${columns}
      );
    `);
    // Second table, same database (Final-Review, Important 9): a
    // permanently discarded moment is the only message the app will ever
    // send about it, it has to survive the same restart as the queue
    // itself. `id` is the post_id of the discarded moment, so a second
    // attempt (restart after a crash) doesn't create a duplicate entry.
    await db.execAsync(`
      create table if not exists discarded_moments (
        id text primary key,
        trip_id text not null,
        author_id text not null,
        grund text not null,
        verworfen_am integer not null
      );
    `);
    await migrateColumns(db);
  } catch (error) {
    console.error('[queueDb] initQueue failed', error);
    throw error;
  }
}

export async function addJob(job: QueueJob): Promise<void> {
  const db = await getDatabase();
  const row = toRow(job);
  const placeholders = COLUMNS.map(() => '?').join(', ');
  try {
    await db.runAsync(
      `insert into upload_queue (${COLUMNS.join(', ')}) values (${placeholders})`,
      valuesFor(row, COLUMNS)
    );
  } catch (error) {
    console.error('[queueDb] addJob failed', error);
    throw error;
  }
}

// allJobs ensures the table itself instead of making every caller (trip
// detail, counter, ...) defensive individually.
export async function allJobs(): Promise<QueueJob[]> {
  await ensureTable();
  const db = await getDatabase();
  try {
    const rows = await db.getAllAsync<Record<string, unknown>>('select * from upload_queue', []);
    const jobs: QueueJob[] = [];
    for (const row of rows) {
      const job = toJob(row);
      if (job) {
        jobs.push(job);
      } else {
        // ONLY the id (Final-Review point 3): `row` is the full SQLite row
        // including `caption`/`lat`/`lng`/`place_name`, which doesn't
        // belong in a diagnostic log that Sentry's console breadcrumb
        // (without a DSN: nobody at all; see errorReporter.ts) would pick
        // up in case of an error. The id is enough to look up the broken
        // row in `upload_queue` specifically.
        console.error('[queueDb] corrupted row skipped', { id: row.id });
      }
    }
    return jobs;
  } catch (error) {
    console.error('[queueDb] allJobs failed', error);
    throw error;
  }
}

// Writes the complete job back (no partial update), simpler and without a
// race as long as only the worker writes (see Task-3-Brief).
export async function updateJob(job: QueueJob): Promise<void> {
  const db = await getDatabase();
  const row = toRow(job);
  const setColumns = COLUMNS.filter((column) => column !== 'id');
  const setClause = setColumns.map((column) => `${column} = ?`).join(', ');
  try {
    await db.runAsync(`update upload_queue set ${setClause} where id = ?`, [
      ...valuesFor(row, setColumns),
      row.id,
    ]);
  } catch (error) {
    console.error('[queueDb] updateJob failed', error);
    throw error;
  }
}

export async function removeJob(id: string): Promise<void> {
  const db = await getDatabase();
  try {
    await db.runAsync('delete from upload_queue where id = ?', [id]);
  } catch (error) {
    console.error('[queueDb] removeJob failed', error);
    throw error;
  }
}

// === Discarded moments (Final-Review, Important 9) ===
// Spec §8 promises that a moment captured after the reveal gets "discarded
// with an explanation". In practice the worker deleted the job and wrote a
// console line, the affected person never learned that their capture is
// gone. The same path also applies when someone's membership gets revoked
// mid-upload.

export async function rememberDiscarded(entry: DiscardedMoment): Promise<void> {
  await ensureTable();
  const db = await getDatabase();
  try {
    await db.runAsync(
      'insert or replace into discarded_moments (id, trip_id, author_id, grund, verworfen_am) values (?, ?, ?, ?, ?)',
      [entry.id, entry.trip_id, entry.author_id, entry.grund, entry.verworfen_am]
    );
  } catch (error) {
    console.error('[queueDb] rememberDiscarded failed', error);
    throw error;
  }
}

export async function discardedMoments(tripId: string, authorId: string): Promise<DiscardedMoment[]> {
  await ensureTable();
  const db = await getDatabase();
  try {
    const rows = await db.getAllAsync<DiscardedMoment>(
      'select id, trip_id, author_id, grund, verworfen_am from discarded_moments where trip_id = ? and author_id = ? order by verworfen_am',
      [tripId, authorId]
    );
    return rows;
  } catch (error) {
    console.error('[queueDb] discardedMoments failed', error);
    throw error;
  }
}

// Only once someone has actually seen and acknowledged the explanation.
export async function acknowledgeDiscarded(tripId: string, authorId: string): Promise<void> {
  await ensureTable();
  const db = await getDatabase();
  try {
    await db.runAsync('delete from discarded_moments where trip_id = ? and author_id = ?', [
      tripId,
      authorId,
    ]);
  } catch (error) {
    console.error('[queueDb] acknowledgeDiscarded failed', error);
    throw error;
  }
}
