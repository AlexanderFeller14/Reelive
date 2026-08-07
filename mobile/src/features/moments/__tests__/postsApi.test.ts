// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also VOR den
// const-Zuweisungen. Zugriff auf die Mocks deshalb erst zur Aufrufzeit (Muster wie in
// tripsApi.test.ts).
const mockGetSession = jest.fn();
const mockInsert = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

// medien zieht expo-file-system und expo-image-manipulator nach — hier wird
// davon nur die Endungs-Ableitung gebraucht (Important 5: posts.media_ext).
jest.mock('../medien', () => ({
  endungAus: (uri: string) => uri.slice(uri.lastIndexOf('.') + 1).toLowerCase(),
}));

import { momentAnlegen, aktuelleAutorId, uploadBestaetigen } from '../postsApi';
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

// Final-Review, Important 5: die Edge Function leitet den Speicherschlüssel aus
// GENAU DIESER Spalte ab. Sie steht schon im Schlüssel und wird von dort
// gelesen, statt ein zweites Mal im Job zu stehen und auseinanderlaufen zu
// können.
test('media_ext kommt aus dem Speicherschlüssel (iOS liefert mov, Android mp4)', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await momentAnlegen({ ...job, typ: 'video', storage_key: 'trips/t1/p1.mov', duration_s: 8 });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ media_ext: 'mov' }));

  mockInsert.mockResolvedValueOnce({ error: null });
  await momentAnlegen(job);
  expect(mockInsert).toHaveBeenLastCalledWith(expect.objectContaining({ media_ext: 'jpg' }));
});

// === Final-Review, Important 4 ===
// Antwortet confirm mit 409, liegt im Speicher kein vollständiges Objekt. Das
// ist der einzige Fehlschlag, bei dem ERNEUT HOCHLADEN hilft statt nur erneut
// zu bestätigen — ohne diese Unterscheidung übersprang der Worker die Uploads
// und rief für immer nur wieder confirm.
describe('uploadBestaetigen', () => {
  const httpFehler = (status: number, body: unknown) => ({
    data: null,
    error: Object.assign(new Error('http'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify(body), { status }),
    }),
  });

  test('Erfolg', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(uploadBestaetigen('p1')).resolves.toEqual({ error: null });
  });

  test('409 wird als unvollständig gemeldet, mit dem Klartext der Function', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(409, { fehler: 'Upload ist noch nicht vollständig.' }));
    const ergebnis = await uploadBestaetigen('p1');
    expect(ergebnis.unvollstaendig).toBe(true);
    expect(ergebnis.error).toBe('Upload ist noch nicht vollständig.');
  });

  test('409 ohne verwertbaren Body gilt trotzdem als unvollständig', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('http'), {
        name: 'FunctionsHttpError',
        context: new Response('kein json', { status: 409 }),
      }),
    });
    const ergebnis = await uploadBestaetigen('p1');
    expect(ergebnis.unvollstaendig).toBe(true);
    expect(ergebnis.error).not.toBeNull();
  });

  test('jeder andere HTTP-Fehler ist NICHT unvollständig — die Uploads bleiben erledigt', async () => {
    mockInvoke.mockResolvedValueOnce(httpFehler(500, { fehler: 'Bestätigen fehlgeschlagen.' }));
    const ergebnis = await uploadBestaetigen('p1');
    expect(ergebnis.unvollstaendig).toBe(false);
    expect(ergebnis.error).toBe('Bestätigen fehlgeschlagen.');
  });

  test('ein Netzwerkfehler benennt Offline als Ursache und ist nicht unvollständig', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: { message: 'Network request failed' } },
    });
    const ergebnis = await uploadBestaetigen('p1');
    expect(ergebnis.unvollstaendig).toBeUndefined();
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });
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
