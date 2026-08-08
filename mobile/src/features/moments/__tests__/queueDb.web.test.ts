// Web-Fassung von queueDb: keine echte Datenbank, also kein SQLite-Mock nötig.
// Testet nur den Vertrag, den uploadWorker.ts, zaehler.ts und
// reise/[id]/index.tsx über den Namespace-Import erwarten (siehe queueDb.web.ts).
import {
  initQueue,
  jobHinzufuegen,
  alleJobs,
  jobAktualisieren,
  jobEntfernen,
  verworfenenMerken,
  verworfene,
  verworfeneQuittieren,
} from '../queueDb.web';
import type { QueueJob, VerworfenerMoment } from '../types';

const job: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-01T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

const verworfenerEintrag: VerworfenerMoment = {
  id: 'p1', trip_id: 't1', author_id: 'u1', grund: 'nach Reveal aufgenommen', verworfen_am: 0,
};

test('alleJobs() liefert eine leere Liste statt zu werfen — es gibt auf Web keine Warteschlange', async () => {
  await expect(alleJobs()).resolves.toEqual([]);
});

test('verworfene() liefert eine leere Liste statt zu werfen', async () => {
  await expect(verworfene('t1', 'u1')).resolves.toEqual([]);
});

test.each([
  ['initQueue', () => initQueue()],
  ['jobHinzufuegen', () => jobHinzufuegen(job)],
  ['jobAktualisieren', () => jobAktualisieren(job)],
  ['jobEntfernen', () => jobEntfernen('j1')],
  ['verworfenenMerken', () => verworfenenMerken(verworfenerEintrag)],
  ['verworfeneQuittieren', () => verworfeneQuittieren('t1', 'u1')],
])('%s wirft nie', async (_name, aufruf) => {
  await expect(aufruf()).resolves.toBeUndefined();
});
