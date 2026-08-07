import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { JobZustand, QueueJob } from './types';

// Einzige Stelle im Projekt, die zwischen SQLite-Zeile und QueueJob übersetzt.
// Booleans liegen als 0/1, Zeiten als Zahl — siehe Task-3-Brief.

const DB_NAME = 'upload_queue.db';

// Lazy: die Datenbank wird erst beim ersten Zugriff geöffnet, nie beim Import.
// Sonst bricht jeder Test, der dieses Modul nur lädt.
let datenbank: Promise<SQLiteDatabase> | null = null;

function holeDatenbank(): Promise<SQLiteDatabase> {
  if (!datenbank) {
    datenbank = SQLite.openDatabaseAsync(DB_NAME);
  }
  return datenbank;
}

// Spaltenreihenfolge ist die einzige Quelle der Wahrheit für insert/update —
// sql-Text und Werte-Array werden beide daraus gebaut, damit sie nie auseinanderlaufen.
const SPALTEN = [
  'id',
  'post_id',
  'trip_id',
  'typ',
  'medium_uri',
  'thumb_uri',
  'storage_key',
  'thumb_key',
  'caption',
  'captured_at',
  'captured_tz',
  'lat',
  'lng',
  'place_name',
  'duration_s',
  'zustand',
  'versuche',
  'naechster_versuch',
  'zeile_angelegt',
  'medium_geladen',
  'thumb_geladen',
] as const;

type Spalte = (typeof SPALTEN)[number];
type Zeile = Record<Spalte, string | number | null>;

function zuZeile(job: QueueJob): Zeile {
  return {
    id: job.id,
    post_id: job.post_id,
    trip_id: job.trip_id,
    typ: job.typ,
    medium_uri: job.medium_uri,
    thumb_uri: job.thumb_uri,
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

function zuJob(zeile: Record<string, unknown>): QueueJob {
  return {
    id: zeile.id as string,
    post_id: zeile.post_id as string,
    trip_id: zeile.trip_id as string,
    typ: zeile.typ as QueueJob['typ'],
    medium_uri: zeile.medium_uri as string,
    thumb_uri: zeile.thumb_uri as string,
    storage_key: zeile.storage_key as string,
    thumb_key: zeile.thumb_key as string,
    caption: (zeile.caption as string | null) ?? null,
    captured_at: zeile.captured_at as string,
    captured_tz: zeile.captured_tz as string,
    lat: (zeile.lat as number | null) ?? null,
    lng: (zeile.lng as number | null) ?? null,
    place_name: (zeile.place_name as string | null) ?? null,
    duration_s: (zeile.duration_s as number | null) ?? null,
    zustand: zeile.zustand as JobZustand,
    versuche: zeile.versuche as number,
    naechster_versuch: zeile.naechster_versuch as number,
    zeile_angelegt: Boolean(zeile.zeile_angelegt),
    medium_geladen: Boolean(zeile.medium_geladen),
    thumb_geladen: Boolean(zeile.thumb_geladen),
  };
}

function werteFuer(zeile: Zeile, spalten: readonly Spalte[]): (string | number | null)[] {
  return spalten.map((spalte) => zeile[spalte]);
}

export async function initQueue(): Promise<void> {
  const db = await holeDatenbank();
  try {
    await db.execAsync(`
      create table if not exists upload_queue (
        id text primary key,
        post_id text not null,
        trip_id text not null,
        typ text not null,
        medium_uri text not null,
        thumb_uri text not null,
        storage_key text not null,
        thumb_key text not null,
        caption text,
        captured_at text not null,
        captured_tz text not null,
        lat real,
        lng real,
        place_name text,
        duration_s real,
        zustand text not null,
        versuche integer not null,
        naechster_versuch integer not null,
        zeile_angelegt integer not null,
        medium_geladen integer not null,
        thumb_geladen integer not null
      );
    `);
  } catch (fehler) {
    console.error('[queueDb] initQueue fehlgeschlagen', fehler);
    throw fehler;
  }
}

export async function jobHinzufuegen(job: QueueJob): Promise<void> {
  const db = await holeDatenbank();
  const zeile = zuZeile(job);
  const platzhalter = SPALTEN.map(() => '?').join(', ');
  try {
    await db.runAsync(
      `insert into upload_queue (${SPALTEN.join(', ')}) values (${platzhalter})`,
      werteFuer(zeile, SPALTEN)
    );
  } catch (fehler) {
    console.error('[queueDb] jobHinzufuegen fehlgeschlagen', fehler);
    throw fehler;
  }
}

export async function alleJobs(): Promise<QueueJob[]> {
  const db = await holeDatenbank();
  try {
    const zeilen = await db.getAllAsync<Record<string, unknown>>('select * from upload_queue', []);
    return zeilen.map(zuJob);
  } catch (fehler) {
    console.error('[queueDb] alleJobs fehlgeschlagen', fehler);
    throw fehler;
  }
}

// Schreibt den vollständigen Job zurück (kein Teil-Update) — einfacher und ohne
// Race, solange nur der Worker schreibt (siehe Task-3-Brief).
export async function jobAktualisieren(job: QueueJob): Promise<void> {
  const db = await holeDatenbank();
  const zeile = zuZeile(job);
  const setSpalten = SPALTEN.filter((spalte) => spalte !== 'id');
  const setClause = setSpalten.map((spalte) => `${spalte} = ?`).join(', ');
  try {
    await db.runAsync(`update upload_queue set ${setClause} where id = ?`, [
      ...werteFuer(zeile, setSpalten),
      zeile.id,
    ]);
  } catch (fehler) {
    console.error('[queueDb] jobAktualisieren fehlgeschlagen', fehler);
    throw fehler;
  }
}

export async function jobEntfernen(id: string): Promise<void> {
  const db = await holeDatenbank();
  try {
    await db.runAsync('delete from upload_queue where id = ?', [id]);
  } catch (fehler) {
    console.error('[queueDb] jobEntfernen fehlgeschlagen', fehler);
    throw fehler;
  }
}
