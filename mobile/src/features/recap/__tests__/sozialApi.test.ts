// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also VOR den
// const-Zuweisungen. Zugriff auf die Mocks deshalb erst zur Aufrufzeit (Muster wie in
// postsApi.test.ts/tripsApi.test.ts).
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  fetchReaktionen,
  setzeReaktion,
  entferneReaktion,
  fetchKommentare,
  schreibeKommentar,
} from '../sozialApi';

const SESSION_OK = { data: { session: { user: { id: 'u1' } } }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION_OK);
});

// reactions: .select('post_id, user_id, emoji').in('post_id', […]).order('created_at', …)
function reaktionenKette(ergebnis: { data: unknown; error: unknown }) {
  const order = jest.fn(async () => ergebnis);
  const inFn = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ in: inFn }));
  mockFrom.mockReturnValue({ select });
  return { select, in: inFn, order };
}

// reactions: .upsert(values, options)
type UpsertOptionen = { onConflict?: string; ignoreDuplicates?: boolean };
function upsertKette(ergebnis: { error: unknown }) {
  const upsert = jest.fn(async (_values: unknown, _options: UpsertOptionen) => ergebnis);
  mockFrom.mockReturnValue({ upsert });
  return { upsert };
}

// reactions: .delete().eq('post_id', …).eq('user_id', …).eq('emoji', …)
function deleteKette(ergebnis: { error: unknown }) {
  const eq3 = jest.fn(async () => ergebnis);
  const eq2 = jest.fn(() => ({ eq: eq3 }));
  const eq1 = jest.fn(() => ({ eq: eq2 }));
  const del = jest.fn(() => ({ eq: eq1 }));
  mockFrom.mockReturnValue({ delete: del });
  return { delete: del, eq1, eq2, eq3 };
}

// comments: .select(…).eq('post_id', …).order('created_at', …)
function kommentareKette(ergebnis: { data: unknown; error: unknown }) {
  const order = jest.fn(async () => ergebnis);
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ select });
  return { select, eq, order };
}

// comments: .insert(values)
function insertKette(ergebnis: { error: unknown }) {
  const insert = jest.fn(async () => ergebnis);
  mockFrom.mockReturnValue({ insert });
  return { insert };
}

describe('fetchReaktionen', () => {
  test('holt Reaktionen für mehrere Momente in EINEM Aufruf und gruppiert sie nach post_id', async () => {
    const kette = reaktionenKette({
      data: [
        { post_id: 'p1', user_id: 'u1', emoji: '❤️' },
        { post_id: 'p1', user_id: 'u2', emoji: '😂' },
        { post_id: 'p2', user_id: 'u1', emoji: '👏' },
      ],
      error: null,
    });
    const ergebnis = await fetchReaktionen(['p1', 'p2']);
    expect(mockFrom).toHaveBeenCalledTimes(1); // EIN Aufruf für beide Momente, nicht zwei
    expect(kette.select).toHaveBeenCalledWith('post_id, user_id, emoji');
    expect(kette.in).toHaveBeenCalledWith('post_id', ['p1', 'p2']);
    // Review-Fund (Klein 4B/4C aus Fix-Runde 1): ungeprüft liesse sich sowohl
    // die abgefragte Spaltenliste als auch die Sortierung unbemerkt entfernen
    // — kein anderer Test in dieser Datei sieht dem `select`/`order`-Aufruf
    // von fetchReaktionen auf die Finger.
    expect(kette.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(ergebnis.error).toBeNull();
    expect(ergebnis.data).toEqual({
      p1: [
        { post_id: 'p1', user_id: 'u1', emoji: '❤️' },
        { post_id: 'p1', user_id: 'u2', emoji: '😂' },
      ],
      p2: [{ post_id: 'p2', user_id: 'u1', emoji: '👏' }],
    });
  });

  test('ein Moment ganz ohne Reaktionen bekommt gar keinen Schlüssel (kein leeres Array-Rauschen)', async () => {
    reaktionenKette({ data: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }], error: null });
    const ergebnis = await fetchReaktionen(['p1', 'p2']);
    expect(ergebnis.data).toEqual({ p1: [{ post_id: 'p1', user_id: 'u1', emoji: '❤️' }] });
    expect('p2' in ergebnis.data).toBe(false);
  });

  test('eine leere Liste ruft Supabase gar nicht erst auf', async () => {
    const ergebnis = await fetchReaktionen([]);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(ergebnis).toEqual({ data: {}, error: null });
  });

  test('Netzwerkfehler → Offline-Hinweis', async () => {
    reaktionenKette({ data: null, error: { message: 'Network request failed' } });
    const ergebnis = await fetchReaktionen(['p1']);
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(ergebnis.data).toEqual({});
  });

  test('anderer Fehler → generische deutsche Meldung', async () => {
    reaktionenKette({ data: null, error: { message: 'kaputt' } });
    const ergebnis = await fetchReaktionen(['p1']);
    expect(ergebnis.error).toBe('Die Reaktionen konnten nicht geladen werden. Probier es gleich nochmal.');
  });
});

describe('setzeReaktion', () => {
  test('Erfolg: upsert mit ignoreDuplicates statt eines rohen Inserts', async () => {
    const kette = upsertKette({ error: null });
    const ergebnis = await setzeReaktion('p1', '❤️');
    expect(ergebnis).toEqual({ error: null });
    expect(kette.upsert).toHaveBeenCalledWith(
      { post_id: 'p1', user_id: 'u1', emoji: '❤️' },
      { onConflict: 'post_id,user_id,emoji', ignoreDuplicates: true }
    );
  });

  // Ein Mutant, der ignoreDuplicates auf false (oder weg) setzt, würde
  // serverseitig ein ON-CONFLICT-DO-UPDATE erzeugen — genau das würde am
  // fehlenden UPDATE-Grant scheitern (siehe Kommentar in sozialApi.ts).
  // Diese exakte Objektprüfung fängt eine solche stille Regression ab dem
  // ersten Lauf ab, nicht erst am (in Tests unsichtbaren) DB-Grant.
  test('ignoreDuplicates ist wörtlich true, nicht nur truthy', async () => {
    const kette = upsertKette({ error: null });
    await setzeReaktion('p1', '❤️');
    const [, optionen] = kette.upsert.mock.calls[0];
    expect(optionen.ignoreDuplicates).toBe(true);
  });

  test('ohne Sitzung: kein Aufruf, klare deutsche Meldung', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const ergebnis = await setzeReaktion('p1', '❤️');
    expect(ergebnis.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('Netzwerkfehler → Offline-Hinweis', async () => {
    upsertKette({ error: { message: 'Network request failed' } });
    const ergebnis = await setzeReaktion('p1', '❤️');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('anderer Fehler → generische deutsche Meldung', async () => {
    upsertKette({ error: { message: 'kaputt' } });
    const ergebnis = await setzeReaktion('p1', '❤️');
    expect(ergebnis.error).toBe('Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.');
  });
});

describe('entferneReaktion', () => {
  test('Erfolg: löscht exakt post_id + eigene user_id + emoji, in dieser Reihenfolge', async () => {
    const kette = deleteKette({ error: null });
    const ergebnis = await entferneReaktion('p1', '❤️');
    expect(ergebnis).toEqual({ error: null });
    expect(kette.eq1).toHaveBeenCalledWith('post_id', 'p1');
    expect(kette.eq2).toHaveBeenCalledWith('user_id', 'u1');
    expect(kette.eq3).toHaveBeenCalledWith('emoji', '❤️');
  });

  test('ohne Sitzung: kein Aufruf, klare deutsche Meldung', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const ergebnis = await entferneReaktion('p1', '❤️');
    expect(ergebnis.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('Netzwerkfehler → Offline-Hinweis', async () => {
    deleteKette({ error: { message: 'Network request failed' } });
    const ergebnis = await entferneReaktion('p1', '❤️');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('anderer Fehler → generische deutsche Meldung', async () => {
    deleteKette({ error: { message: 'kaputt' } });
    const ergebnis = await entferneReaktion('p1', '❤️');
    expect(ergebnis.error).toBe('Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.');
  });
});

describe('fetchKommentare', () => {
  test('Erfolg: Autorenname kommt aus dem profiles-Join', async () => {
    kommentareKette({
      data: [
        {
          id: 'c1', post_id: 'p1', user_id: 'u1', text: 'Schön hier!',
          created_at: '2026-08-10T09:05:00.000Z', profiles: { display_name: 'Lea' },
        },
      ],
      error: null,
    });
    const ergebnis = await fetchKommentare('p1');
    expect(ergebnis.error).toBeNull();
    expect(ergebnis.data).toEqual([
      {
        id: 'c1', post_id: 'p1', user_id: 'u1', text: 'Schön hier!',
        created_at: '2026-08-10T09:05:00.000Z', autor_name: 'Lea',
      },
    ]);
  });

  test('fehlendes Profil → leerer Autorenname statt eines Absturzes', async () => {
    kommentareKette({
      data: [{ id: 'c1', post_id: 'p1', user_id: 'u1', text: 'x', created_at: 't', profiles: null }],
      error: null,
    });
    const ergebnis = await fetchKommentare('p1');
    expect(ergebnis.data[0].autor_name).toBe('');
  });

  test('fragt genau den einen übergebenen Moment ab, chronologisch aufsteigend', async () => {
    const kette = kommentareKette({ data: [], error: null });
    await fetchKommentare('p7');
    expect(kette.eq).toHaveBeenCalledWith('post_id', 'p7');
    expect(kette.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  // Review-Fund (Klein 4B aus Fix-Runde 1): der Erfolgstest oben füttert
  // `profiles` unabhängig von der tatsächlich abgefragten Spaltenliste in
  // die Mock-Antwort — ein Streichen von `profiles(display_name)` aus dem
  // echten `select()`-Aufruf bliebe unbemerkt grün, obwohl in Produktion
  // dann jeder Autorenname leer wäre. Diese Prüfung sieht dem Aufruf selbst
  // auf die Finger.
  test('fragt den Autorennamen über den profiles-Join mit ab', async () => {
    const kette = kommentareKette({ data: [], error: null });
    await fetchKommentare('p1');
    expect(kette.select).toHaveBeenCalledWith(expect.stringContaining('profiles(display_name)'));
  });

  test('Netzwerkfehler → Offline-Hinweis, leere Liste statt eines Wurfs', async () => {
    kommentareKette({ data: null, error: { message: 'Network request failed' } });
    const ergebnis = await fetchKommentare('p1');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
    expect(ergebnis.data).toEqual([]);
  });
});

describe('schreibeKommentar', () => {
  test('Erfolg: sendet den getrimmten Text mit der eigenen user_id', async () => {
    const kette = insertKette({ error: null });
    const ergebnis = await schreibeKommentar('p1', '  Toller Moment!  ');
    expect(ergebnis).toEqual({ error: null });
    expect(kette.insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', text: 'Toller Moment!' });
  });

  test('leerer Text wird VOR jedem Aufruf abgefangen — keine Sitzung nötig, kein Insert', async () => {
    const ergebnis = await schreibeKommentar('p1', '');
    expect(ergebnis.error).toBe('Schreib etwas, bevor du sendest.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('nur Leerzeichen zählt wie leer', async () => {
    const ergebnis = await schreibeKommentar('p1', '    ');
    expect(ergebnis.error).toBe('Schreib etwas, bevor du sendest.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // Der Datenbank-Check erlaubt genau 1–500 Zeichen — 500 muss durchgehen,
  // 501 muss VOR dem Netzwerkaufruf abgefangen werden. Ein Mutant, der `>`
  // durch `>=` ersetzt, liesse den ersten Test fallen; einer, der die
  // Prüfung ganz entfernt, liesse den zweiten fallen (insert würde
  // aufgerufen).
  test('genau 500 Zeichen ist erlaubt', async () => {
    const kette = insertKette({ error: null });
    const text = 'a'.repeat(500);
    const ergebnis = await schreibeKommentar('p1', text);
    expect(ergebnis).toEqual({ error: null });
    expect(kette.insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', text });
  });

  test('501 Zeichen wird VOR dem Absenden abgefangen, kein Aufruf an Supabase', async () => {
    const ergebnis = await schreibeKommentar('p1', 'a'.repeat(501));
    expect(ergebnis.error).toBe('Kommentare dürfen höchstens 500 Zeichen haben.');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('ohne Sitzung: kein Insert, klare deutsche Meldung', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const ergebnis = await schreibeKommentar('p1', 'Hallo');
    expect(ergebnis.error).toBe('Du bist nicht angemeldet. Melde dich an und probier es nochmal.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('Netzwerkfehler beim Insert → Offline-Hinweis', async () => {
    insertKette({ error: { message: 'Network request failed' } });
    const ergebnis = await schreibeKommentar('p1', 'Hallo');
    expect(ergebnis.error).toBe('Du bist offline. Verbinde dich und probier es nochmal.');
  });

  test('anderer Fehler beim Insert → generische deutsche Meldung', async () => {
    insertKette({ error: { message: 'kaputt' } });
    const ergebnis = await schreibeKommentar('p1', 'Hallo');
    expect(ergebnis.error).toBe('Dein Kommentar konnte nicht gesendet werden. Probier es gleich nochmal.');
  });
});
