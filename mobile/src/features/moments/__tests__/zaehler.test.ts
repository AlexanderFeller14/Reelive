// Der Zähler ist vor dem Reveal die einzige Information über versiegelte
// Momente überhaupt (siehe Task-9-Auftrag), er darf nach einer Offline-
// Aufnahme nie rückwärts springen. Deshalb zählt er den Serverstand PLUS die
// eigenen, noch nicht hochgeladenen Momente derselben Reise aus der
// Warteschlange. Genau das prüfen die drei Fälle unten.
jest.mock('@/features/trips/tripsApi', () => ({
  eigeneZaehler: jest.fn(async () => ({ data: { t1: 5 }, error: null })),
}));
jest.mock('../queueDb', () => ({ alleJobs: jest.fn(async () => []) }));
jest.mock('../postsApi', () => ({ aktuelleAutorId: jest.fn(async () => 'u1') }));
jest.mock('@/features/trips/tripsCache', () => ({
  gemerkteZaehler: jest.fn(async () => ({})),
  zaehlerMerken: jest.fn(async () => {}),
}));

import { eigenerZaehler } from '../zaehler';
import * as queueDb from '../queueDb';
import * as tripsApi from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks räumt nur die Historie ab, nicht die per mockResolvedValue
  // gesetzte Implementierung, die Standardwerte hier wiederherstellen.
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValue({ data: { t1: 5 }, error: null });
  (tripsCache.gemerkteZaehler as jest.Mock).mockResolvedValue({});
});

test('ohne wartende Momente zählt nur der Serverstand', async () => {
  await expect(eigenerZaehler('t1')).resolves.toBe(5);
});

test('wartende Momente derselben Reise zählen mit', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet' },
    { trip_id: 't1', zustand: 'laeuft' },
  ]);
  await expect(eigenerZaehler('t1')).resolves.toBe(7);
});

test('wartende Momente anderer Reisen zählen nicht mit', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([{ trip_id: 't2', zustand: 'wartet' }]);
  await expect(eigenerZaehler('t1')).resolves.toBe(5);
});

test('eine Reise ohne Serverstand (noch nie eingesendet) startet bei 0 statt undefined', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([{ trip_id: 't9', zustand: 'wartet' }]);
  await expect(eigenerZaehler('t9')).resolves.toBe(1);
});

// === Fix-Runde 1: Doppelzählung, sobald die posts-Zeile schon angelegt ist ===
// uploadWorker.verarbeiteJob setzt zeile_angelegt: true, SOBALD die posts-Zeile
// existiert, der Job bleibt aber bis zur bestätigten Fertigstellung (Medien-
// UND Thumbnail-Upload) in der Warteschlange, weil beide unabhängig
// mehrfach fehlschlagen und erneut versucht werden können. my_post_counts()
// zählt diese Zeile serverseitig bereits mit. Zählt eigenerZaehler einen
// solchen Job zusätzlich dazu, springt die Zahl zurück, sobald der Job
// schliesslich verschwindet, genau das Verhalten, das der Zähler laut
// Auftrag nie zeigen darf.

test('ein wartender Job mit bereits angelegter Zeile erhöht die Zahl NICHT (steckt schon im Serverstand)', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: true },
  ]);
  await expect(eigenerZaehler('t1')).resolves.toBe(5);
});

test('ein wartender Job OHNE angelegte Zeile erhöht die Zahl (für den Server noch unsichtbar)', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
  ]);
  await expect(eigenerZaehler('t1')).resolves.toBe(6);
});

test('ein Mix aus beidem zählt nur die Jobs ohne angelegte Zeile dazu', async () => {
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: true },
    { trip_id: 't1', zustand: 'laeuft', zeile_angelegt: true },
  ]);
  await expect(eigenerZaehler('t1')).resolves.toBe(6);
});

test('die Zahl bleibt über den ganzen Ablauf monoton: eingereiht, Zeile angelegt, Job entfernt', async () => {
  const mockEigeneZaehler = tripsApi.eigeneZaehler as jest.Mock;
  const mockAlleJobs = queueDb.alleJobs as jest.Mock;

  // Vor dem Einsenden: Server kennt 5, Warteschlange ist für diese Reise leer.
  mockEigeneZaehler.mockResolvedValueOnce({ data: { t1: 5 }, error: null });
  mockAlleJobs.mockResolvedValueOnce([]);
  await expect(eigenerZaehler('t1')).resolves.toBe(5);

  // Eingereiht: Job wartet, Zeile noch nicht angelegt, zählt lokal dazu.
  mockEigeneZaehler.mockResolvedValueOnce({ data: { t1: 5 }, error: null });
  mockAlleJobs.mockResolvedValueOnce([{ trip_id: 't1', zustand: 'wartet', zeile_angelegt: false }]);
  await expect(eigenerZaehler('t1')).resolves.toBe(6);

  // Zeile angelegt, Medien-Upload noch nicht bestätigt (z.B. wiederholt
  // gescheitert): der Server zählt die Zeile jetzt schon selbst mit, lokal
  // fällt der Job darum aus der Zählung, die Summe bleibt gleich.
  mockEigeneZaehler.mockResolvedValueOnce({ data: { t1: 6 }, error: null });
  mockAlleJobs.mockResolvedValueOnce([{ trip_id: 't1', zustand: 'wartet', zeile_angelegt: true }]);
  await expect(eigenerZaehler('t1')).resolves.toBe(6);

  // Upload bestätigt, Job aus der Warteschlange entfernt.
  mockEigeneZaehler.mockResolvedValueOnce({ data: { t1: 6 }, error: null });
  mockAlleJobs.mockResolvedValueOnce([]);
  await expect(eigenerZaehler('t1')).resolves.toBe(6);
});

// === Final-Review, Important 6: ein Fehlschlag ist nicht «null» ===
// Vorher verschluckte tripsApi den rpc-Fehler und lieferte eine leere
// Zuordnung. Wer 40 versiegelte Momente hatte und im Flugmodus einen aufnahm,
// sah 0 + 1 = 1, der Rückwärtssprung, den Spec §7 ausschliesst, und
// ausgerechnet im Offline-Fall, für den diese Phase existiert.

test('ein erfolgreicher Abruf schreibt den Serverstand fort', async () => {
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValueOnce({ data: { t1: 40 }, error: null });
  await expect(eigenerZaehler('t1')).resolves.toBe(40);
  expect(tripsCache.zaehlerMerken).toHaveBeenCalledWith('u1', { t1: 40 });
});

test('ein gescheiterter Abruf greift auf den zuletzt bekannten Stand zurück statt auf 0', async () => {
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValueOnce({ data: {}, error: 'Offline' });
  (tripsCache.gemerkteZaehler as jest.Mock).mockResolvedValueOnce({ t1: 40 });
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
  ]);

  // 40 versiegelte Momente, einer davon frisch im Flugmodus aufgenommen: 41.
  // Vor dem Fix stand hier 1.
  await expect(eigenerZaehler('t1')).resolves.toBe(41);
  // Ein Fehlschlag darf den vorgehaltenen Stand nie überschreiben.
  expect(tripsCache.zaehlerMerken).not.toHaveBeenCalled();
});

test('ohne vorgehaltenen Stand bleibt es beim reinen Warteschlangen-Anteil', async () => {
  (tripsApi.eigeneZaehler as jest.Mock).mockResolvedValueOnce({ data: {}, error: 'Offline' });
  (tripsCache.gemerkteZaehler as jest.Mock).mockResolvedValueOnce({});
  (queueDb.alleJobs as jest.Mock).mockResolvedValueOnce([
    { trip_id: 't1', zustand: 'wartet', zeile_angelegt: false },
  ]);
  await expect(eigenerZaehler('t1')).resolves.toBe(1);
});
