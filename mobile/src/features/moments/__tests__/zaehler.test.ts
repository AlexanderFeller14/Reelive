// Der Zähler ist vor dem Reveal die einzige Information über versiegelte
// Momente überhaupt (siehe Task-9-Auftrag) — er darf nach einer Offline-
// Aufnahme nie rückwärts springen. Deshalb zählt er den Serverstand PLUS die
// eigenen, noch nicht hochgeladenen Momente derselben Reise aus der
// Warteschlange. Genau das prüfen die drei Fälle unten.
jest.mock('@/features/trips/tripsApi', () => ({ eigeneZaehler: jest.fn(async () => ({ t1: 5 })) }));
jest.mock('../queueDb', () => ({ alleJobs: jest.fn(async () => []) }));

import { eigenerZaehler } from '../zaehler';
import * as queueDb from '../queueDb';

beforeEach(() => jest.clearAllMocks());

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
