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

// Gleiches Lazy-Muster wie holeDatenbank() oben: alleJobs() ruft dies bei
// JEDEM Aufruf auf (auch bei jedem 5-Sekunden-Tick des Workers), `create
// table if not exists` soll dafür aber nicht jedes Mal erneut ausgeführt
// werden — genau die Last, die uploadWorker mit seinem eigenen
// `sicherstellenInitialisiert` bereits bewusst vermeidet (Task-13-Fix-Runde-1,
// Minor). Ein fehlgeschlagener Versuch wird NICHT gecacht — initQueue() wirft
// dann beim nächsten Aufruf erneut, statt die Warteschlange nach einem
// einmaligen Fehler für den Rest des Prozesses tot zu lassen.
let tabelleSichergestellt = false;
async function sicherstellenTabelle(): Promise<void> {
  if (tabelleSichergestellt) return;
  await initQueue();
  tabelleSichergestellt = true;
}

// Einzige Quelle der Wahrheit für das Spaltenschema: Name, SQLite-Typ und ob die
// Spalte Pflicht ist (not null). `create table`, die Spaltenreihenfolge für
// insert/update UND die Pflichtfeld-Prüfung beim Lesen (siehe zuJob) werden alle
// aus diesem einen Array abgeleitet — sie können dadurch nicht mehr auseinanderlaufen.
const SPALTEN_SCHEMA = [
  { name: 'id', typ: 'text', pflicht: true },
  { name: 'post_id', typ: 'text', pflicht: true },
  { name: 'trip_id', typ: 'text', pflicht: true },
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

type Spalte = (typeof SPALTEN_SCHEMA)[number]['name'];
type Zeile = Record<Spalte, string | number | null>;

const SPALTEN: readonly Spalte[] = SPALTEN_SCHEMA.map((s) => s.name);

const ERLAUBTE_ZUSTAENDE: readonly JobZustand[] = ['wartet', 'laeuft', 'fertig'];
const ERLAUBTE_TYPEN: readonly QueueJob['typ'][] = ['photo', 'video'];

function spaltenDefinitionSql(def: (typeof SPALTEN_SCHEMA)[number]): string {
  if (def.name === 'id') return `${def.name} ${def.typ} primary key`;
  return `${def.name} ${def.typ}${def.pflicht ? ' not null' : ''}`;
}

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

// Schutz gegen stillen Datenverlust: eine Zeile mit fehlendem Pflichtfeld oder
// ungültigem zustand (z. B. nach einem Absturz mitten im Schreiben oder einer
// `create table if not exists`, die nicht mitgewachsen ist) darf nicht als gültiger
// QueueJob durchgehen — sonst wandert der Schaden stillschweigend in queueLogic
// und Task 6 weiter.
function istVollstaendig(zeile: Record<string, unknown>): boolean {
  for (const def of SPALTEN_SCHEMA) {
    if (def.pflicht && (zeile[def.name] === null || zeile[def.name] === undefined)) {
      return false;
    }
  }
  if (!ERLAUBTE_ZUSTAENDE.includes(zeile.zustand as JobZustand)) return false;
  if (!ERLAUBTE_TYPEN.includes(zeile.typ as QueueJob['typ'])) return false;
  return true;
}

// Gibt null zurück statt zu werfen: eine einzelne kaputte Zeile darf die übrige
// Warteschlange nicht mitreissen (siehe alleJobs).
function zuJob(zeile: Record<string, unknown>): QueueJob | null {
  if (!istVollstaendig(zeile)) return null;
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
  const spalten = SPALTEN_SCHEMA.map(spaltenDefinitionSql).join(',\n        ');
  try {
    await db.execAsync(`
      create table if not exists upload_queue (
        ${spalten}
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

// Ein frisch installiertes Gerät (oder eines, auf dem der Worker noch nie
// gestartet ist, weil Sitzung/Profil fehlen — siehe uploadWorker/_layout.tsx)
// hat die Tabelle noch nicht angelegt. Lesen darf davon nie einen Screen mit
// einem SQLite-Fehler ("no such table") blockieren — deshalb stellt alleJobs
// die Tabelle selbst sicher (`create table if not exists` ist billig genug),
// statt jeden Aufrufer (Reise-Detail, Zähler, ...) einzeln defensiv zu machen.
export async function alleJobs(): Promise<QueueJob[]> {
  await sicherstellenTabelle();
  const db = await holeDatenbank();
  try {
    const zeilen = await db.getAllAsync<Record<string, unknown>>('select * from upload_queue', []);
    const jobs: QueueJob[] = [];
    for (const zeile of zeilen) {
      const job = zuJob(zeile);
      if (job) {
        jobs.push(job);
      } else {
        console.error('[queueDb] beschädigte Zeile übersprungen', zeile);
      }
    }
    return jobs;
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
