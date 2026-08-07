const jobs: Record<string, unknown>[] = [];
jest.mock('../queueDb', () => ({
  initQueue: jest.fn(async () => {}),
  jobHinzufuegen: jest.fn(async (j: Record<string, unknown>) => { jobs.push(j); }),
  alleJobs: jest.fn(async () => jobs),
  jobAktualisieren: jest.fn(async (j: Record<string, unknown>) => {
    const i = jobs.findIndex((x) => x.id === j.id);
    if (i >= 0) jobs[i] = j;
  }),
  jobEntfernen: jest.fn(async (id: string) => {
    const i = jobs.findIndex((x) => x.id === id);
    if (i >= 0) jobs.splice(i, 1);
  }),
}));
jest.mock('../postsApi', () => ({
  momentAnlegen: jest.fn(async () => ({ error: null })),
  signierteUrls: jest.fn(async () => ({ medium_url: 'https://s3/m', thumb_url: 'https://s3/t' })),
  uploadBestaetigen: jest.fn(async () => ({ error: null })),
  // Task-13-Fix-Runde-2: die gerade angemeldete Person — Standard passt zu
  // basis.author_id, einzelne Tests überschreiben mit mockResolvedValueOnce.
  aktuelleAutorId: jest.fn(async () => 'u1'),
}));
jest.mock('../einstellungen', () => ({ nurUeberWlan: jest.fn(async () => false) }));
// Final-Review, Critical 2: der Worker ist die einzige Stelle, an der ein Job
// die Warteschlange regulär verlässt — auf beiden Wegen müssen die Dateien mit.
jest.mock('../medien', () => ({ momentDateienEntfernen: jest.fn() }));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, type: 'WIFI' })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import { einenJobAbarbeiten, jobEinreihen, starte, stoppe, wartende } from '../uploadWorker';
import * as postsApi from '../postsApi';
import * as queueDb from '../queueDb';
import * as medien from '../medien';
import * as Network from 'expo-network';
import type { QueueJob } from '../types';

const basis: QueueJob = {
  id: 'j1', post_id: 'p1', trip_id: 't1', author_id: 'u1', typ: 'photo',
  medium_uri: 'file:///m.jpg', thumb_uri: 'file:///t.jpg',
  storage_key: 'trips/t1/p1.jpg', thumb_key: 'trips/t1/p1_t.jpg',
  caption: null, captured_at: '2026-08-07T10:00:00.000Z', captured_tz: 'Europe/Zurich',
  lat: null, lng: null, place_name: null, duration_s: null,
  zustand: 'wartet', versuche: 0, naechster_versuch: 0,
  zeile_angelegt: false, medium_geladen: false, thumb_geladen: false,
};

const globalFetch = jest.fn(async () => ({ ok: true }) as unknown as Response);
beforeEach(() => {
  jobs.length = 0;
  jest.clearAllMocks();
  (global as unknown as { fetch: unknown }).fetch = globalFetch;
  // jest.clearAllMocks() setzt NUR Aufruf-Historie zurück, nicht eine per
  // .mockImplementation()/.mockResolvedValue() gesetzte Implementierung —
  // zwei Tests unten hängen momentAnlegen bewusst an ein steuerbares Promise.
  // Ohne diese explizite Wiederherstellung würde das in JEDEN nachfolgenden
  // Test durchsickern und dort für immer hängen (beobachtet: Timeout).
  (postsApi.momentAnlegen as jest.Mock).mockResolvedValue({ error: null });
});

test('ein vollständiger Durchlauf legt an, lädt beides hoch, bestätigt und räumt auf', async () => {
  jobs.push({ ...basis });
  await einenJobAbarbeiten();
  expect(postsApi.momentAnlegen).toHaveBeenCalledTimes(1);
  expect(globalFetch).toHaveBeenCalledTimes(2);
  expect(postsApi.uploadBestaetigen).toHaveBeenCalledWith('p1');
  expect(queueDb.jobEntfernen).toHaveBeenCalledWith('j1');
  // Critical 2: sonst blieben Medium und Thumbnail jedes hochgeladenen
  // Moments für immer liegen — bei Video die vollen 30 Sekunden in 1080p.
  expect(medien.momentDateienEntfernen).toHaveBeenCalledWith('p1');
});

test('ein Fehlschlag lässt die Dateien liegen — der nächste Versuch braucht sie', async () => {
  globalFetch.mockResolvedValueOnce({ ok: false } as unknown as Response);
  jobs.push({ ...basis });
  await einenJobAbarbeiten();
  expect(medien.momentDateienEntfernen).not.toHaveBeenCalled();
});

test('ein Wiederanlauf legt die Zeile nicht zweimal an', async () => {
  jobs.push({ ...basis, zeile_angelegt: true, medium_geladen: true });
  await einenJobAbarbeiten();
  expect(postsApi.momentAnlegen).not.toHaveBeenCalled();
  expect(globalFetch).toHaveBeenCalledTimes(1); // nur noch das Thumbnail
});

test('ein fehlgeschlagener Upload zählt hoch statt den Job zu verlieren', async () => {
  globalFetch.mockResolvedValueOnce({ ok: false } as unknown as Response);
  jobs.push({ ...basis });
  await einenJobAbarbeiten();
  const [gespeichert] = jobs as unknown as QueueJob[];
  expect(gespeichert.versuche).toBe(1);
  expect(gespeichert.zustand).toBe('wartet');
  expect(queueDb.jobEntfernen).not.toHaveBeenCalled();
});

test('ohne fälligen Job passiert nichts', async () => {
  jobs.push({ ...basis, naechster_versuch: Number.MAX_SAFE_INTEGER });
  await einenJobAbarbeiten();
  expect(postsApi.momentAnlegen).not.toHaveBeenCalled();
});

// Spec §8 / Task-6-Brief «Reise wird währenddessen aufgedeckt»: liegt captured_at
// nach dem Reveal, lehnt posts_insert_member JEDEN Versuch dauerhaft ab (Phase 1
// erlaubt nur Nachzügler von vorher) — Wiederholen hilft nie. Das ist etwas anderes
// als ein Netzfehler: nur DIESE Ablehnung darf den Job aus der Queue werfen.
test('eine dauerhafte Ablehnung durch die Policy wird nicht wiederholt, sondern aus der Queue entfernt', async () => {
  (postsApi.momentAnlegen as jest.Mock).mockResolvedValueOnce({
    error: 'Dieser Moment wurde nach der Aufdeckung der Reise aufgenommen und kann nicht mehr eingesendet werden.',
    dauerhaftAbgelehnt: true,
  });
  jobs.push({ ...basis });
  await einenJobAbarbeiten();
  expect(queueDb.jobEntfernen).toHaveBeenCalledWith('j1');
  expect(postsApi.signierteUrls).not.toHaveBeenCalled();
  expect(globalFetch).not.toHaveBeenCalled();
  expect(queueDb.jobAktualisieren).not.toHaveBeenCalled();
  // Zweiter Weg aus der Warteschlange — auch hier müssen die Dateien mit
  // (Critical 2).
  expect(medien.momentDateienEntfernen).toHaveBeenCalledWith('p1');
});

test('jobEinreihen legt den Job in der Warteschlange ab', async () => {
  const neu: QueueJob = { ...basis, id: 'neu', post_id: 'p-neu' };
  await jobEinreihen(neu);
  expect(queueDb.jobHinzufuegen).toHaveBeenCalledWith(neu);
  expect(jobs).toContainEqual(neu);
});

test('wartende zählt alles, was noch nicht fertig ist', async () => {
  jobs.push({ ...basis, id: 'a', zustand: 'wartet' }, { ...basis, id: 'b', zustand: 'fertig' });
  await expect(wartende()).resolves.toBe(1);
});

test('starte() ist idempotent, stoppe() räumt Intervall und Netz-Listener auf', () => {
  jest.useFakeTimers();
  try {
    const entfernen = jest.fn();
    (Network.addNetworkStateListener as jest.Mock).mockReturnValue({ remove: entfernen });

    starte();
    starte(); // zweiter Aufruf darf kein zweites Abo anlegen
    expect(Network.addNetworkStateListener).toHaveBeenCalledTimes(1);

    stoppe();
    stoppe(); // zweiter Aufruf darf nicht erneut abmelden
    expect(entfernen).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

// Task-13-Fix-Runde-1: postsApi.momentAnlegen() liest die Autorenschaft erst
// BEIM AUFRUF aus der aktuell aktiven Sitzung (nicht beim Einreihen). Meldet
// sich A ab und B auf demselben Gerät an, während ein Job noch auf die
// Netzwerkantwort wartet (bei einem Video leicht mehrere Sekunden), darf die
// Aufnahme danach nicht mehr — unter wessen Sitzung auch immer — geschrieben
// werden. Der Test stellt genau diesen Moment her: momentAnlegen hängt fest,
// stoppe() kommt dazwischen, erst DANACH löst die Netzwerkantwort auf.
test('ein Job, der beim Abmelden mitten im Schreiben steckt, schreibt danach nichts mehr', async () => {
  jobs.push({ ...basis });
  let aufloesenMomentAnlegen: (v: { error: string | null }) => void = () => {};
  let momentAnlegenAufgerufen: () => void = () => {};
  const wurdeAufgerufen = new Promise<void>((resolve) => {
    momentAnlegenAufgerufen = resolve;
  });
  (postsApi.momentAnlegen as jest.Mock).mockImplementation(() => {
    momentAnlegenAufgerufen();
    return new Promise((resolve) => {
      aufloesenMomentAnlegen = resolve;
    });
  });

  starte();
  const durchlauf = einenJobAbarbeiten();
  await wurdeAufgerufen; // haengt jetzt in momentAnlegen fest — genau der vom Review beschriebene Moment
  stoppe(); // Abmelden waehrend des Uploads

  aufloesenMomentAnlegen({ error: null }); // die Netzwerkantwort kommt jetzt doch noch zurueck
  await durchlauf;

  // momentAnlegen wurde noch unter der gueltigen (alten) Generation ausgeloest
  // — das ist korrekt. Aber das Ergebnis darf danach nicht mehr persistiert
  // werden: kein posts_angelegt-Update, kein Entfernen aus der Warteschlange.
  expect(postsApi.momentAnlegen).toHaveBeenCalledTimes(1);
  expect(queueDb.jobAktualisieren).not.toHaveBeenCalled();
  expect(queueDb.jobEntfernen).not.toHaveBeenCalled();
});

// Ein noch ausklingender, überholter Durchlauf darf ein sofort folgendes
// starte() (z.B. Wechsel zu einer anderen Person auf demselben Gerät) nicht
// blockieren — der Mutex hängt an der Generation, nicht an einem einzelnen
// globalen Flag (Task-13-Fix-Runde-2).
test('ein neuer Durchlauf nach stoppe() wird nicht durch einen noch ausklingenden alten (anderer Generation) blockiert', async () => {
  jobs.push({ ...basis });
  let aufloesenMomentAnlegen: (v: { error: string | null }) => void = () => {};
  let momentAnlegenAufgerufen: () => void = () => {};
  const wurdeAufgerufen = new Promise<void>((resolve) => {
    momentAnlegenAufgerufen = resolve;
  });
  (postsApi.momentAnlegen as jest.Mock).mockImplementation(() => {
    momentAnlegenAufgerufen();
    return new Promise((resolve) => {
      aufloesenMomentAnlegen = resolve;
    });
  });

  starte();
  const ersterDurchlauf = einenJobAbarbeiten();
  await wurdeAufgerufen; // laeuft === true, haengt in momentAnlegen fest
  stoppe();

  jobs.length = 0; // sonst würde der zweite Durchlauf denselben Job erneut aufgreifen
  await einenJobAbarbeiten(); // darf NICHT als no-op durchgehen
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);

  aufloesenMomentAnlegen({ error: null }); // den ersten Durchlauf sauber auflösen
  await ersterDurchlauf;
});

// Task-13-Fix-Runde-2, DER ENTSCHEIDENDE FALL: kein Race, keine Gleichzeitig-
// keit. Ein Moment liegt bloss in der Warteschlange (zustand: 'wartet',
// längst fällig) — niemand ist mitten im Schreiben. A meldet sich ab, B an,
// und ERST DANACH läuft der nächste reguläre Tick, vollständig unter B's
// gültiger, frischer Sitzung. Der Generationscheck aus Runde 1 geht hier
// TRIVIAL durch (die Generation vergleicht sich mit sich selbst) — nur der
// author_id-Filter in naechsterJob (über aktuelleAutorId) verhindert, dass
// A's Moment unter B's Namen geschrieben wird.
test('ein Job, der bloss in der Warteschlange liegt, wird NICHT unter einer anderen, inzwischen angemeldeten Person geschrieben', async () => {
  jobs.push({ ...basis, author_id: 'person-a' });
  // Kein Abmelden-mitten-im-Schreiben nötig: aktuelleAutorId() liefert schon
  // beim ersten (und einzigen) Aufruf "person-b" — ein simpler, späterer Tick.
  (postsApi.aktuelleAutorId as jest.Mock).mockResolvedValue('person-b');

  await einenJobAbarbeiten();

  expect(postsApi.momentAnlegen).not.toHaveBeenCalled();
  expect(queueDb.jobAktualisieren).not.toHaveBeenCalled();
  expect(queueDb.jobEntfernen).not.toHaveBeenCalled();
  // Der Job bleibt unverändert und wartend liegen — kein Fehlschlag gezählt.
  const [unveraendert] = jobs as unknown as QueueJob[];
  expect(unveraendert.versuche).toBe(0);
  expect(unveraendert.zustand).toBe('wartet');
});

test('derselbe liegen gebliebene Job läuft durch, sobald die passende Person sich wieder anmeldet', async () => {
  jobs.push({ ...basis, author_id: 'person-a' });
  (postsApi.aktuelleAutorId as jest.Mock).mockResolvedValue('person-a');

  await einenJobAbarbeiten();

  expect(postsApi.momentAnlegen).toHaveBeenCalledTimes(1);
  expect(queueDb.jobEntfernen).toHaveBeenCalledWith('j1');
});

// Auf einem geteilten Gerät liegen ggf. Jobs mehrerer Personen — nur der
// zur gerade angemeldeten Person passende wird verarbeitet, der andere
// bleibt unangetastet liegen.
test('auf einem geteilten Gerät wird nur der Job der gerade angemeldeten Person verarbeitet', async () => {
  jobs.push(
    { ...basis, id: 'von-a', post_id: 'p-a', author_id: 'person-a' },
    { ...basis, id: 'von-b', post_id: 'p-b', author_id: 'person-b' }
  );
  (postsApi.aktuelleAutorId as jest.Mock).mockResolvedValue('person-b');

  await einenJobAbarbeiten();

  expect(postsApi.momentAnlegen).toHaveBeenCalledTimes(1);
  expect(queueDb.jobEntfernen).toHaveBeenCalledWith('von-b');
  expect(jobs.some((j) => j.id === 'von-a')).toBe(true); // unangetastet liegen geblieben
});
