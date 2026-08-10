// In-Memory-Nachbau von expo-sqlite: prüft, dass queueDb korrekt SQL absetzt und
// Zeilen sauber in QueueJob zurückwandelt. Die Datenbank selbst ist nicht unser
// Testgegenstand, die Übersetzung schon.
const zeilen: Record<string, unknown>[] = [];
// Bildet nach, dass eine "select" auf einer noch nie angelegten SQLite-Tabelle
// wirft ("no such table") statt eine leere Liste zu liefern, genau der
// Zustand eines frisch installierten Geräts, bevor initQueue() je gelaufen
// ist (Task 13). mockExecAsync steht für "create table if not exists" und
// schaltet die Tabelle frei.
let tabelleAngelegt = false;
// PRAGMA table_info(upload_queue): welche Spalten die (fiktive) Tabelle schon
// hat, BEVOR initQueue() in diesem Testlauf läuft, simuliert eine
// Bestandsinstallation (Task-13-Fix-Runde-2, spaltenNachziehen). Standard:
// vollständig, kein ALTER TABLE nötig; ein dedizierter Migrations-Test
// überschreibt das gezielt.
const ALLE_SPALTEN = [
  'id', 'post_id', 'trip_id', 'author_id', 'typ', 'medium_uri', 'thumb_uri',
  'storage_key', 'thumb_key', 'caption', 'captured_at', 'captured_tz', 'lat',
  'lng', 'place_name', 'duration_s', 'zustand', 'versuche', 'naechster_versuch',
  'zeile_angelegt', 'medium_geladen', 'thumb_geladen',
];
let vorhandeneSpalten: string[] = [...ALLE_SPALTEN];
// Zweite Tabelle derselben Datenbank (Final-Review, Important 9): dauerhaft
// verworfene Momente, damit die App sie erklären kann statt sie wortlos
// verschwinden zu lassen.
const verworfenZeilen: Record<string, unknown>[] = [];
const mockRunAsync = jest.fn(async (..._args: unknown[]) => {});
const mockGetAllAsync = jest.fn(async (..._args: unknown[]) => {
  const sql = _args[0];
  if (typeof sql === 'string' && sql.includes('pragma table_info')) {
    return vorhandeneSpalten.map((name) => ({ name }));
  }
  if (!tabelleAngelegt) throw new Error('no such table: upload_queue');
  if (typeof sql === 'string' && sql.includes('verworfene_momente')) return verworfenZeilen;
  return zeilen;
});
const mockExecAsync = jest.fn(async (..._args: unknown[]) => {
  tabelleAngelegt = true;
});
// Greifbar statt inline, damit ein Öffnen (oder Nicht-Öffnen) beim Import
// nachweisbar bleibt, siehe Test weiter unten.
const mockOpenDatabaseAsync = jest.fn(async (..._args: unknown[]) => ({
  execAsync: (...a: unknown[]) => mockExecAsync(...a),
  runAsync: (...a: unknown[]) => mockRunAsync(...a),
  getAllAsync: (...a: unknown[]) => mockGetAllAsync(...a),
}));

jest.mock('expo-sqlite', () => ({
  // Verzögerter Aufruf wie bei den anderen drei Methoden: mockOpenDatabaseAsync
  // erst beim tatsächlichen Aufruf lesen, nicht schon beim Auswerten der Factory
  // (die läuft durch jest-hoist früh, vor der const-Initialisierung oben).
  openDatabaseAsync: (...a: unknown[]) => mockOpenDatabaseAsync(...a),
}));

import {
  initQueue,
  jobHinzufuegen,
  alleJobs,
  jobAktualisieren,
  jobEntfernen,
  verworfenenMerken,
  verworfene,
  verworfeneQuittieren,
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

// Liest die Spaltenliste aus einem "insert into upload_queue (a, b, c) values (...)"-
// Statement, damit Tests die Position eines Feldes im Werte-Array nachweisen können,
// ohne SPALTEN aus der Implementierung zu importieren.
function spaltenAusInsertSql(sql: string): string[] {
  const treffer = sql.match(/\(([^)]+)\)\s*values/i);
  if (!treffer) throw new Error(`Konnte Spaltenliste nicht aus SQL lesen: ${sql}`);
  return treffer[1].split(',').map((s) => s.trim());
}

beforeEach(() => {
  zeilen.length = 0;
  verworfenZeilen.length = 0;
  vorhandeneSpalten = [...ALLE_SPALTEN];
  jest.clearAllMocks();
});

test('initQueue legt die Tabelle an', async () => {
  await initQueue();
  expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('create table if not exists'));
});

// Finding 1: create table und insert/update müssen aus derselben Quelle stammen.
// Dieser Test beisst: fehlt eine Spalte im generierten create-table-Text (weil
// jemand wieder eine handgeschriebene, abweichende Liste einführt), schlägt er fehl.
test('initQueue legt jedes Feld von QueueJob als Spalte an', async () => {
  await initQueue();
  const [sql] = mockExecAsync.mock.calls[0] as [string];
  for (const feld of Object.keys(job)) {
    expect(sql).toMatch(new RegExp(`\\b${feld}\\b`));
  }
});

// Task-13-Fix-Runde-2: `create table if not exists` legt nur eine NEUE
// Tabelle mit vollem Schema an, eine Bestandsinstallation (Tabelle existiert
// schon, ohne die neue author_id-Spalte) wandert dadurch NICHT nach.
test('initQueue zieht eine fehlende Spalte einer Bestandsinstallation per ALTER TABLE nach, ohne "not null"', async () => {
  vorhandeneSpalten = ALLE_SPALTEN.filter((s) => s !== 'author_id');
  await initQueue();
  const alterAufrufe = mockExecAsync.mock.calls
    .map(([sql]) => sql as string)
    .filter((sql) => /alter table/i.test(sql));
  expect(alterAufrufe).toHaveLength(1);
  expect(alterAufrufe[0]).toMatch(/alter table upload_queue add column author_id/i);
  // Bewusst ohne "not null", obwohl author_id im Schema Pflicht ist: SQLite
  // verweigert eine NOT-NULL-Spalte ohne DEFAULT auf einer befüllten Tabelle.
  expect(alterAufrufe[0]).not.toMatch(/not null/i);
});

test('initQueue lässt eine bereits vollständige Tabelle unangetastet (kein ALTER TABLE)', async () => {
  await initQueue();
  const hatAlter = mockExecAsync.mock.calls.some(([sql]) => /alter table/i.test(sql as string));
  expect(hatAlter).toBe(false);
});

// Eine per ALTER TABLE nachgezogene Spalte ist nullable, Alt-Zeilen bekommen
// author_id: null. istVollstaendig() (Pflichtfeld-Prüfung) verwirft sie beim
// Lesen als unvollständig, statt sie unter der aktuell angemeldeten Person zu
// verarbeiten. Das ist Absicht, nicht ein Nebeneffekt: ein Alt-Moment ohne
// bekannte Autoren-Kennung darf nie unter fremdem Namen landen.
test('alleJobs verwirft eine Alt-Zeile ohne author_id (Migration von vor Task 13)', async () => {
  zeilen.push({ ...job, id: 'alt-1', author_id: null });
  const jobs = await alleJobs();
  expect(jobs).toHaveLength(0);
});

test('jobHinzufuegen schreibt alle Felder', async () => {
  await jobHinzufuegen(job);
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('insert');
  expect(werte).toContain('j1');
  expect(werte).toContain('trips/t1/p1.jpg');
});

// Finding 3a: Boolean-Übersetzung positionsgenau und in beide Richtungen geprüft
// (vorher: `toContain(1)` war positionslos und traf zufällig andere Einsen; `false → 0`
// war gar nicht geprüft).
test('jobHinzufuegen schreibt Booleans positionsgenau als 0/1 in beide Richtungen', async () => {
  await jobHinzufuegen({ ...job, zeile_angelegt: true, medium_geladen: false, thumb_geladen: true });
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  const spalten = spaltenAusInsertSql(sql);
  expect(werte[spalten.indexOf('zeile_angelegt')]).toBe(1);
  expect(werte[spalten.indexOf('medium_geladen')]).toBe(0);
  expect(werte[spalten.indexOf('thumb_geladen')]).toBe(1);
});

// Finding 3b: echter Rundreise-Test. Die tatsächlich von jobHinzufuegen geschriebenen
// Spalten/Werte werden in eine Zeile zusammengesetzt (so, wie SQLite sie speichern
// würde) und über alleJobs zurückgelesen, muss unversehrt herauskommen.
test('Job übersteht eine Rundreise durch jobHinzufuegen und alleJobs unversehrt', async () => {
  const original: QueueJob = {
    ...job,
    id: 'rt-1',
    zeile_angelegt: true,
    medium_geladen: false,
    thumb_geladen: true,
  };
  await jobHinzufuegen(original);
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  const spalten = spaltenAusInsertSql(sql);
  const gespeicherteZeile: Record<string, unknown> = {};
  spalten.forEach((spalte, i) => {
    gespeicherteZeile[spalte] = werte[i];
  });
  zeilen.push(gespeicherteZeile);

  const [wiederhergestellt] = await alleJobs();
  expect(wiederhergestellt).toEqual(original);
});

test('alleJobs wandelt 0/1 zurück in Booleans', async () => {
  zeilen.push({
    ...job, zeile_angelegt: 1, medium_geladen: 0, thumb_geladen: 1,
  });
  const [geladen] = await alleJobs();
  expect(geladen.zeile_angelegt).toBe(true);
  expect(geladen.medium_geladen).toBe(false);
  expect(geladen.thumb_geladen).toBe(true);
});

// Finding 2: eine Zeile mit fehlendem Pflichtfeld darf nicht als gültiger Job
// durchgehen, und darf die übrige Warteschlange nicht mitreissen.
test('alleJobs überspringt eine Zeile mit fehlendem Pflichtfeld, behält die übrigen', async () => {
  const { post_id: _weg, ...kaputt } = job;
  zeilen.push({ ...kaputt, id: 'kaputt-1' });
  zeilen.push({ ...job, id: 'j2' });

  const jobs = await alleJobs();

  expect(jobs).toHaveLength(1);
  expect(jobs[0].id).toBe('j2');
});

// Finding 2: ein ungültiger zustand-Wert (z. B. durch eine nicht migrierte
// Schema-Änderung) darf ebenfalls nicht als gültiger Job durchgehen.
test('alleJobs überspringt eine Zeile mit ungültigem zustand', async () => {
  zeilen.push({ ...job, id: 'kaputt-2', zustand: 'explodiert' });

  const jobs = await alleJobs();

  expect(jobs).toHaveLength(0);
});

test('jobAktualisieren schreibt den Fortschritt zurück', async () => {
  await jobAktualisieren({ ...job, versuche: 3, zeile_angelegt: true });
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('update');
  expect(werte).toContain(3);
  expect(werte).toContain(1); // true → 1
});

test('jobEntfernen löscht über die id', async () => {
  await jobEntfernen('j1');
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('delete');
  expect(werte).toEqual(['j1']);
});

// Finding 3c: "nicht beim Import geöffnet" war zuvor unbelegt, mockOpenDatabaseAsync
// war in der Mock-Factory eingeschlossen und für den Test nicht greifbar, und
// jest.clearAllMocks() in beforeEach hätte einen Aufruf beim Import ohnehin
// weggewischt. Fix: frisches Modul nach jest.resetModules() laden (Registry-Reset
// invalidiert nicht die oben registrierte Mock-Factory) und die Aufrufe direkt danach
// prüfen, bevor irgendetwas anderes den Mock zurücksetzen könnte.
test('öffnet die Datenbank nicht beim Import, sondern erst beim ersten Zugriff', async () => {
  jest.resetModules();
  const frischesModul: typeof import('../queueDb') = require('../queueDb');

  expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();

  await frischesModul.initQueue();

  expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
});

// Task 13: der Worker (und mit ihm initQueue()) läuft erst ab signedIn, ein
// frisch installiertes Gerät oder eines ohne Session/Profil hat die Tabelle
// also noch nicht. alleJobs() wird trotzdem direkt von aussen gerufen (Reise-
// Detail, Zähler) und darf diese Aufrufer nie mit einem SQLite-Fehler
// blockieren, sondern muss die Tabelle selbst sicherstellen.
//
// Frisches Modul nach jest.resetModules() wie im Test direkt oberhalb, sonst
// hätte ein früherer Test in dieser Datei (z.B. der erste initQueue-Aufruf)
// `tabelleAngelegt` bereits dauerhaft auf true gesetzt und dieser Test würde
// nichts mehr beweisen. `tabelleAngelegt` wird bewusst NICHT in beforeEach
// zurückgesetzt (siehe oben), es bildet eine reale, für die Prozesslaufzeit
// einmal angelegte SQLite-Tabelle nach, kein Pro-Test-Zurücksetzen.
test('alleJobs liefert auf einer noch nie angelegten Tabelle eine leere Liste statt zu werfen', async () => {
  jest.resetModules();
  tabelleAngelegt = false;
  const frischesModul: typeof import('../queueDb') = require('../queueDb');

  await expect(frischesModul.alleJobs()).resolves.toEqual([]);
  expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('create table if not exists'));
});

// === Final-Review, Important 9: verworfene Momente ===
// Spec §8 verspricht «mit Erklärung verworfen». Der Eintrag muss denselben
// Neustart überleben wie die Warteschlange, deshalb dieselbe SQLite-Datei,
// eigene Tabelle.

test('initQueue legt auch die Tabelle für verworfene Momente an', async () => {
  await initQueue();
  expect(mockExecAsync).toHaveBeenCalledWith(
    expect.stringContaining('create table if not exists verworfene_momente')
  );
});

// insert or replace: ein Wiederanlauf nach Absturz darf denselben Moment nicht
// zweimal melden.
test('verworfenenMerken schreibt idempotent', async () => {
  await verworfenenMerken({
    id: 'p9',
    trip_id: 't1',
    author_id: 'u1',
    grund: 'Nach dem Reveal aufgenommen.',
    verworfen_am: 1234,
  });
  const [sql, werte] = mockRunAsync.mock.calls[0] as unknown as [string, unknown[]];
  expect(sql).toContain('insert or replace into verworfene_momente');
  expect(werte).toEqual(['p9', 't1', 'u1', 'Nach dem Reveal aufgenommen.', 1234]);
});

// Auf einem geteilten Gerät geht ein verworfener Moment niemanden ausser die
// Person an, die ihn aufgenommen hat.
test('verworfene liest nur die eigenen Einträge dieser Reise', async () => {
  verworfenZeilen.push({ id: 'p9', trip_id: 't1', author_id: 'u1', grund: 'Grund', verworfen_am: 1 });
  await expect(verworfene('t1', 'u1')).resolves.toEqual([
    { id: 'p9', trip_id: 't1', author_id: 'u1', grund: 'Grund', verworfen_am: 1 },
  ]);
  const [sql, werte] = mockGetAllAsync.mock.calls.at(-1) as unknown as [string, unknown[]];
  expect(sql).toContain('where trip_id = ? and author_id = ?');
  expect(werte).toEqual(['t1', 'u1']);
});

test('verworfeneQuittieren löscht nur die eigenen Einträge dieser Reise', async () => {
  await verworfeneQuittieren('t1', 'u1');
  const [sql, werte] = mockRunAsync.mock.calls[0] as unknown as [string, unknown[]];
  expect(sql).toContain('delete from verworfene_momente');
  expect(werte).toEqual(['t1', 'u1']);
});
