// Jest-Hoisting: jest.mock wandert über die Importe (gleiches Muster wie
// sozialApi.test.ts/tripsApi.test.ts).
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { meldeMoment, fetchMeldungen, verwirfMeldung, entferneMoment } from '../meldenApi';

const SESSION_OK = { data: { session: { user: { id: 'u1' } } }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION_OK);
});

// reports: .insert(values)
function insertKette(ergebnis: { error: unknown }) {
  const insert = jest.fn(async () => ergebnis);
  mockFrom.mockReturnValue({ insert });
  return { insert };
}

// reports: .select(…).eq('posts.trip_id', …).is('erledigt_am', null).order(…)
function meldungenKette(ergebnis: { data: unknown; error: unknown }) {
  const order = jest.fn(async () => ergebnis);
  const is = jest.fn(() => ({ order }));
  const eq = jest.fn(() => ({ is }));
  const select = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ select });
  return { select, eq, is, order };
}

// reports: .update(values).eq('id', …)
function updateKette(ergebnis: { error: unknown }) {
  const eq = jest.fn(async () => ergebnis);
  const update = jest.fn((_payload: Record<string, unknown>) => ({ eq }));
  mockFrom.mockReturnValue({ update });
  return { update, eq };
}

// posts: .delete().eq('id', …)
function deleteKette(ergebnis: { error: unknown }) {
  const eq = jest.fn(async () => ergebnis);
  const del = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ delete: del });
  return { delete: del, eq };
}

describe('meldeMoment', () => {
  test('Erfolg: sendet den getrimmten Grund mit der eigenen reporter_id', async () => {
    const kette = insertKette({ error: null });
    const ergebnis = await meldeMoment('p1', '  Unpassend  ');
    expect(ergebnis).toEqual({ error: null });
    expect(mockFrom).toHaveBeenCalledWith('reports');
    expect(kette.insert).toHaveBeenCalledWith({ post_id: 'p1', reporter_id: 'u1', reason: 'Unpassend' });
  });

  test('leerer Grund wird VOR jedem Aufruf abgefangen, keine Sitzung nötig, kein Insert', async () => {
    const ergebnis = await meldeMoment('p1', '');
    expect(ergebnis.error).toBe('Beschreib kurz, worum es geht, bevor du meldest.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('nur Leerzeichen zählt wie leer', async () => {
    const ergebnis = await meldeMoment('p1', '   ');
    expect(ergebnis.error).toBe('Beschreib kurz, worum es geht, bevor du meldest.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // Der Datenbank-Check erlaubt genau 1–500 Zeichen (wie der Kommentar-Check),
  // 500 muss durchgehen, 501 muss VOR dem Netzwerkaufruf abgefangen werden.
  test('genau 500 Zeichen ist erlaubt', async () => {
    const kette = insertKette({ error: null });
    const text = 'a'.repeat(500);
    const ergebnis = await meldeMoment('p1', text);
    expect(ergebnis).toEqual({ error: null });
    expect(kette.insert).toHaveBeenCalledWith({ post_id: 'p1', reporter_id: 'u1', reason: text });
  });

  test('501 Zeichen wird VOR dem Absenden abgefangen, kein Aufruf an Supabase', async () => {
    const ergebnis = await meldeMoment('p1', 'a'.repeat(501));
    expect(ergebnis.error).toBe('Deine Begründung darf höchstens 500 Zeichen haben.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('ohne Sitzung: kein Insert, klare deutsche Meldung', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const ergebnis = await meldeMoment('p1', 'Unpassend');
    expect(ergebnis.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('Netzwerkfehler beim Insert → Offline-Hinweis', async () => {
    insertKette({ error: { message: 'Network request failed' } });
    const ergebnis = await meldeMoment('p1', 'Unpassend');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('anderer Fehler beim Insert → generische deutsche Meldung', async () => {
    insertKette({ error: { message: 'kaputt' } });
    const ergebnis = await meldeMoment('p1', 'Unpassend');
    expect(ergebnis.error).toBe('Deine Meldung konnte nicht gesendet werden. Probier es gleich nochmal.');
  });
});

describe('fetchMeldungen', () => {
  test('Erfolg: liest offene Meldungen EINER Reise, chronologisch aufsteigend', async () => {
    const kette = meldungenKette({
      data: [
        { id: 'r1', post_id: 'p1', reason: 'Unpassend', created_at: '2026-08-10T09:00:00.000Z' },
      ],
      error: null,
    });
    const ergebnis = await fetchMeldungen('t1');
    expect(ergebnis.error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('reports');
    expect(kette.eq).toHaveBeenCalledWith('posts.trip_id', 't1');
    expect(kette.is).toHaveBeenCalledWith('erledigt_am', null);
    expect(kette.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(ergebnis.data).toEqual([
      { id: 'r1', post_id: 'p1', reason: 'Unpassend', created_at: '2026-08-10T09:00:00.000Z' },
    ]);
  });

  // Ungefiltert liesse sich der eq('posts.trip_id', …)-Filter unbemerkt
  // entfernen, kein anderer Test in dieser Datei sieht dem select-Aufruf auf
  // die Finger (gleiches Prinzip wie Phase-5-Final-Review, Punkt 8, in
  // sozialApi.test.ts).
  test('fragt den eingebetteten Join über posts!inner mit ab (Voraussetzung für den trip_id-Filter)', async () => {
    const kette = meldungenKette({ data: [], error: null });
    await fetchMeldungen('t1');
    expect(kette.select).toHaveBeenCalledWith(expect.stringContaining('posts!inner(trip_id)'));
  });

  test('Netzwerkfehler → Offline-Hinweis, leere Liste statt eines Wurfs', async () => {
    meldungenKette({ data: null, error: { message: 'Network request failed' } });
    const ergebnis = await fetchMeldungen('t1');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(ergebnis.data).toEqual([]);
  });

  test('anderer Fehler → generische deutsche Meldung', async () => {
    meldungenKette({ data: null, error: { message: 'kaputt' } });
    const ergebnis = await fetchMeldungen('t1');
    expect(ergebnis.error).toBe('Die Meldungen konnten nicht geladen werden. Probier es gleich nochmal.');
  });
});

describe('verwirfMeldung', () => {
  test('Erfolg: setzt AUSSCHLIESSLICH erledigt_am für genau diese Meldung', async () => {
    const kette = updateKette({ error: null });
    const ergebnis = await verwirfMeldung('r1');
    expect(ergebnis).toEqual({ error: null });
    expect(mockFrom).toHaveBeenCalledWith('reports');
    // Der Spalten-Grant (grant update (erledigt_am) …) lässt ein Update mit
    // einem zweiten Feld komplett scheitern (16_reports_test.sql, Fall 7),
    // dieser Aufruf darf darum NIE ein zweites Feld im selben Objekt tragen.
    const [payload] = kette.update.mock.calls[0];
    expect(Object.keys(payload)).toEqual(['erledigt_am']);
    expect(typeof payload.erledigt_am).toBe('string');
    expect(kette.eq).toHaveBeenCalledWith('id', 'r1');
  });

  test('Netzwerkfehler → Offline-Hinweis', async () => {
    updateKette({ error: { message: 'Network request failed' } });
    const ergebnis = await verwirfMeldung('r1');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('anderer Fehler → generische deutsche Meldung', async () => {
    updateKette({ error: { message: 'kaputt' } });
    const ergebnis = await verwirfMeldung('r1');
    expect(ergebnis.error).toBe('Die Meldung konnte nicht verworfen werden. Probier es gleich nochmal.');
  });
});

// Ein FunctionsHttpError, wie functions-js ihn baut: die Antwort steckt als
// echte `Response` in `context`, der Klartext im JSON-Body.
function httpFehler(status: number, body: unknown) {
  const antwort = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  return { name: 'FunctionsHttpError', message: `Edge Function returned ${status}`, context: antwort };
}

describe('entferneMoment', () => {
  // Der eigentliche Grund fuer diese Function: der frueher direkte
  // `from('posts').delete()` loeschte NUR die Zeile, das Medium und sein
  // Thumbnail blieben fuer immer im Speicher liegen. Ein Test, der nur «kein
  // Fehler» prueft, haette diesen Wechsel nicht bemerkt, deshalb steht hier
  // ausdruecklich, dass der Client die Tabelle NICHT mehr selbst anfasst.
  test('Erfolg: geht ueber die Function, nicht mehr ueber die Tabelle', async () => {
    mockInvoke.mockResolvedValue({ data: { entfernt: true }, error: null });
    const ergebnis = await entferneMoment('p1');
    expect(ergebnis).toEqual({ error: null });
    expect(mockInvoke).toHaveBeenCalledWith('moment-entfernen', { body: { post_id: 'p1' } });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // Die Function nennt Ursache und Loesung bereits in Du-Form, der Client
  // erfindet nichts dazu.
  test('den Klartext der Function reicht der Client unveraendert durch', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpFehler(403, { fehler: 'Dieser Moment lässt sich nicht entfernen.' }),
    });
    const ergebnis = await entferneMoment('p1');
    expect(ergebnis.error).toBe('Dieser Moment lässt sich nicht entfernen.');
  });

  // Und die Grenze davon: ohne JSON im Body gibt es keinen Klartext, dann
  // springt der eigene Text ein, statt eine leere Meldung zu zeigen.
  test('eine Antwort ohne JSON faellt auf die eigene Meldung zurueck', async () => {
    const antwort = new Response('<html>502</html>', { status: 502 });
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', message: 'Edge Function returned 502', context: antwort },
    });
    const ergebnis = await entferneMoment('p1');
    expect(ergebnis.error).toBe('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.');
  });

  // functions-js ersetzt einen echten Netzwerkfehler durch einen festen
  // englischen Satz und legt die urspruengliche Fetch-Meldung in `context` ab,
  // beide Stellen muessen geprueft werden (gleiches Muster wie urlVorrat.ts).
  test('Netzwerkfehler → Offline-Hinweis, auch aus dem context heraus', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: { message: 'Network request failed' } },
    });
    const ergebnis = await entferneMoment('p1');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('Netzwerkfehler direkt in message → Offline-Hinweis', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const ergebnis = await entferneMoment('p1');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('anderer Fehler → generische deutsche Meldung', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'kaputt' } });
    const ergebnis = await entferneMoment('p1');
    expect(ergebnis.error).toBe('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.');
  });
});
