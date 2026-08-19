// Gleiches Mock-Muster wie tripsCache.test.ts: Jest-Hoisting verlangt, dass
// Variablen in jest.mock()-Factories mit "mock" beginnen.
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

import { revealGesehen, merkeRevealGesehen } from '../gesehen';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

test('eine nie gemerkte Reise gilt als noch nicht gesehen', async () => {
  await expect(revealGesehen('t1')).resolves.toBe(false);
});

test('nach dem Merken gilt dieselbe Reise als gesehen', async () => {
  await merkeRevealGesehen('t1');
  const [, geschrieben] = mockSetItem.mock.calls[0];
  mockGetItem.mockResolvedValueOnce(geschrieben);
  await expect(revealGesehen('t1')).resolves.toBe(true);
});

// Ohne diese Prüfung könnte revealGesehen() `true` liefern, ohne den
// Speicher überhaupt zu befragen, der Test oben würde das nicht auffangen
// (mockGetItem.mockResolvedValueOnce liefert unabhängig davon einen Wert).
test('revealGesehen fragt tatsächlich den Speicher ab', async () => {
  await revealGesehen('t1');
  expect(mockGetItem).toHaveBeenCalledTimes(1);
});

test('der Schlüssel trägt die Reise-Kennung und ist zwischen zwei Reisen unterschiedlich', async () => {
  await merkeRevealGesehen('reise-a');
  const [schluesselA] = mockSetItem.mock.calls[0];
  await merkeRevealGesehen('reise-b');
  const [schluesselB] = mockSetItem.mock.calls[1];

  expect(schluesselA).not.toBe(schluesselB);
  expect(schluesselA).toContain('reise-a');
  expect(schluesselB).toContain('reise-b');

  await revealGesehen('reise-a');
  expect(mockGetItem).toHaveBeenCalledWith(schluesselA);
});

// Das Merken einer anderen Reise darf revealGesehen für DIESE Reise nicht
// beeinflussen, ein Test, der nur mit EINER Reise arbeitet, könnte eine
// Implementierung übersehen, die z. B. nur EINEN globalen Schlüssel schreibt.
test('als gesehen gemerkt gilt nur die gemerkte Reise, keine andere', async () => {
  await merkeRevealGesehen('reise-a');
  const [, geschriebenA] = mockSetItem.mock.calls[0];
  mockGetItem.mockImplementation(async (key: string) =>
    key.endsWith('reise-a') ? geschriebenA : null
  );

  await expect(revealGesehen('reise-a')).resolves.toBe(true);
  await expect(revealGesehen('reise-b')).resolves.toBe(false);
});

test('ein Schreibfehler lässt merkeRevealGesehen nicht scheitern', async () => {
  mockSetItem.mockRejectedValueOnce(new Error('Speicher voll'));
  await expect(merkeRevealGesehen('t1')).resolves.toBeUndefined();
});

// Ein kaputter Speicher darf die Inszenierung nicht dauerhaft verhindern,
// «noch nicht gesehen» ist der sichere Rückfall, kein geworfener Fehler.
test('ein Lesefehler zählt als "noch nicht gesehen", nicht als Ausnahme', async () => {
  mockGetItem.mockRejectedValueOnce(new Error('Speicher kaputt'));
  await expect(revealGesehen('t1')).resolves.toBe(false);
});

