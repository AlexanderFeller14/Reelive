// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also VOR den
// const-Zuweisungen. Zugriff auf die Mocks deshalb erst zur Aufrufzeit (Muster wie in
// tripsApi.test.ts).
const mockGetSession = jest.fn();
const mockInsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
  },
}));

import { momentAnlegen, aktuelleAutorId } from '../postsApi';
import type { QueueJob } from '../types';

const job: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
});

// Task-13-Fix-Runde-2: author_id kommt jetzt vom Job (beim Einreihen in
// preview.tsx festgehalten), nicht mehr aus der Sitzung zum Zeitpunkt des
// Schreibens — sonst könnte ein Moment, der bloss in der Warteschlange lag,
// unter dem Namen der nächsten angemeldeten Person landen.
test('Erfolg: legt an, author_id kommt vom Job, typ wird auf type umbenannt', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  const ergebnis = await momentAnlegen(job);
  expect(ergebnis).toEqual({ error: null });
  expect(mockInsert).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'p1', author_id: 'u1', type: 'photo' })
  );
  expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('typ');
  // Kein Sitzungs-Lookup mehr für die Autorenschaft.
  expect(mockGetSession).not.toHaveBeenCalled();
});

// Ein Job, dessen author_id NICHT zur aktuell angemeldeten Person passt, wird
// von uploadWorker.naechsterJob() gar nicht erst ausgewählt (siehe
// queueLogic.test.ts) — momentAnlegen selbst vertraut deshalb bewusst der
// gespeicherten Kennung und rät nicht mehr selbst.
test('author_id eines anderen Nutzers wird unverändert durchgereicht (die Auswahl davor ist die Absicherung)', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await momentAnlegen({ ...job, author_id: 'jemand-anders' });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ author_id: 'jemand-anders' }));
});

test('Primärschlüssel schon vorhanden (23505): Wiederanlauf gilt als Erfolg', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key value' } });
  const ergebnis = await momentAnlegen(job);
  expect(ergebnis).toEqual({ error: null });
});

// Fix-Runde 1: SQLSTATE 42501 allein ist mehrdeutig (insufficient_privilege deckt sowohl
// RLS-Verletzung als auch einen fehlenden GRANT ab). Beide Richtungen müssen stimmen —
// im Zweifel wiederholen, nicht verwerfen.
test('echte RLS-Ablehnung (Reveal-Regel) → dauerhaftAbgelehnt, Job darf verworfen werden', async () => {
  mockInsert.mockResolvedValueOnce({
    error: { code: '42501', message: 'new row violates row-level security policy for table "posts"' },
  });
  const ergebnis = await momentAnlegen(job);
  expect(ergebnis.dauerhaftAbgelehnt).toBe(true);
  expect(ergebnis.error).not.toBeNull();
});

test('42501 aus einem fehlenden GRANT ("permission denied") → kein dauerhaftAbgelehnt, wird wiederholt', async () => {
  mockInsert.mockResolvedValueOnce({
    error: { code: '42501', message: 'permission denied for table posts' },
  });
  const ergebnis = await momentAnlegen(job);
  expect(ergebnis.dauerhaftAbgelehnt).toBeUndefined();
  expect(ergebnis.error).not.toBeNull();
});

test('jeder andere Fehler wird wiederholt, nicht verworfen', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '53300', message: 'too many connections' } });
  const ergebnis = await momentAnlegen(job);
  expect(ergebnis.dauerhaftAbgelehnt).toBeUndefined();
  expect(ergebnis.error).not.toBeNull();
});

// aktuelleAutorId(): genutzt vom Worker VOR der Job-Auswahl (Task-13-Fix-Runde-2).
describe('aktuelleAutorId', () => {
  test('liefert die user id aus der aktiven Sitzung', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } }, error: null });
    await expect(aktuelleAutorId()).resolves.toBe('u1');
  });

  test('keine Sitzung → null', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(aktuelleAutorId()).resolves.toBeNull();
  });

  test('Sitzungs-Fehler → null statt zu werfen', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: { message: 'kaputt' } });
    await expect(aktuelleAutorId()).resolves.toBeNull();
  });

  test('getSession() rejected (z.B. Storage-Fehler) → null statt zu werfen', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('Storage kaputt'));
    await expect(aktuelleAutorId()).resolves.toBeNull();
  });
});
