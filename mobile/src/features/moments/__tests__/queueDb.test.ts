// In-Memory-Nachbau von expo-sqlite: prüft, dass queueDb korrekt SQL absetzt und
// Zeilen sauber in QueueJob zurückwandelt. Die Datenbank selbst ist nicht unser
// Testgegenstand, die Übersetzung schon.
const zeilen: Record<string, unknown>[] = [];
const mockRunAsync = jest.fn(async (..._args: unknown[]) => {});
const mockGetAllAsync = jest.fn(async (..._args: unknown[]) => zeilen);
const mockExecAsync = jest.fn(async (..._args: unknown[]) => {});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: (...a: unknown[]) => mockExecAsync(...a),
    runAsync: (...a: unknown[]) => mockRunAsync(...a),
    getAllAsync: (...a: unknown[]) => mockGetAllAsync(...a),
  })),
}));

import { initQueue, jobHinzufuegen, alleJobs, jobAktualisieren, jobEntfernen } from '../queueDb';
import type { QueueJob } from '../types';

const job: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: 'Hallo', captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: 47.1, lng: 8.2, place_name: 'Luzern', duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

beforeEach(() => {
  zeilen.length = 0;
  jest.clearAllMocks();
});

test('initQueue legt die Tabelle an', async () => {
  await initQueue();
  expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('create table if not exists'));
});

test('jobHinzufuegen schreibt alle Felder', async () => {
  await jobHinzufuegen(job);
  const [sql, werte] = mockRunAsync.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('insert');
  expect(werte).toContain('j1');
  expect(werte).toContain('trips/t1/p1.jpg');
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
