// Der lokale Rückfall hinter dem Offline-Versprechen (Final-Review, Critical 1
// und Important 6). Jest-Hoisting: Variablen in jest.mock-Factories MÜSSEN mit
// "mock" beginnen (gleiches Muster wie inviteLink.test.ts).
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

import {
  gemerkteReisen,
  gemerkteZaehler,
  reisenMerken,
  zaehlerMerken,
  type GemerkteReise,
} from '../tripsCache';

const reise = (over: Partial<GemerkteReise> = {}): GemerkteReise => ({
  id: 't1',
  name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01',
  end_date: '2026-08-14',
  status: 'active',
  my_post_count: 4,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

test('gemerkte Reisen kommen unverändert zurück', async () => {
  await reisenMerken('u1', [reise()]);
  const [, roh] = mockSetItem.mock.calls[0];
  mockGetItem.mockResolvedValueOnce(roh);
  await expect(gemerkteReisen('u1')).resolves.toEqual([reise()]);
});

// Auf einem geteilten Gerät darf B offline nie A's Reisen sehen, deshalb
// trägt der Schlüssel die Benutzer-Kennung.
test('der Bestand ist pro Person getrennt', async () => {
  await reisenMerken('person-a', [reise({ name: 'Nur für A' })]);
  const [schluesselA] = mockSetItem.mock.calls[0];

  await reisenMerken('person-b', [reise({ name: 'Nur für B' })]);
  const [schluesselB] = mockSetItem.mock.calls[1];

  expect(schluesselA).not.toBe(schluesselB);
});

test('ohne Benutzer-Kennung wird weder gelesen noch geschrieben', async () => {
  await reisenMerken(null, [reise()]);
  expect(mockSetItem).not.toHaveBeenCalled();
  await expect(gemerkteReisen(null)).resolves.toBeNull();
  expect(mockGetItem).not.toHaveBeenCalled();
});

// Der entscheidende Unterschied für den Kamera-Screen: nur `null` («noch nie
// erfolgreich geladen») rechtfertigt die Fehlerseite. Ein leerer Bestand ist
// eine Aussage und führt auf «Keine laufende Reise».
test('nichts Vorgehaltenes liefert null, ein leerer Bestand ein leeres Array', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(gemerkteReisen('u1')).resolves.toBeNull();

  mockGetItem.mockResolvedValueOnce('[]');
  await expect(gemerkteReisen('u1')).resolves.toEqual([]);
});

test('beschädigte Einträge werden verworfen statt als halbe Reise ausgegeben', async () => {
  mockGetItem.mockResolvedValueOnce(JSON.stringify([reise(), { id: 't2' }, null, 'kaputt']));
  await expect(gemerkteReisen('u1')).resolves.toEqual([reise()]);

  mockGetItem.mockResolvedValueOnce('{kein json');
  await expect(gemerkteReisen('u1')).resolves.toBeNull();
});

test('ein Speicherfehler lässt den Aufrufer nicht scheitern', async () => {
  mockSetItem.mockRejectedValueOnce(new Error('voll'));
  await expect(reisenMerken('u1', [reise()])).resolves.toBeUndefined();

  mockGetItem.mockRejectedValueOnce(new Error('kaputt'));
  await expect(gemerkteReisen('u1')).resolves.toBeNull();
});

test('Zählerstände kommen als Zuordnung zurück, Unbrauchbares fliegt raus', async () => {
  await zaehlerMerken('u1', { t1: 40, t2: 3 });
  const [, roh] = mockSetItem.mock.calls[0];
  mockGetItem.mockResolvedValueOnce(roh);
  await expect(gemerkteZaehler('u1')).resolves.toEqual({ t1: 40, t2: 3 });

  mockGetItem.mockResolvedValueOnce(JSON.stringify({ t1: 40, t2: 'viele', t3: null }));
  await expect(gemerkteZaehler('u1')).resolves.toEqual({ t1: 40 });
});

test('ohne gemerkte Zählerstände kommt ein leeres Objekt statt eines Fehlers', async () => {
  mockGetItem.mockResolvedValueOnce(null);
  await expect(gemerkteZaehler('u1')).resolves.toEqual({});

  mockGetItem.mockResolvedValueOnce('[1,2,3]');
  await expect(gemerkteZaehler('u1')).resolves.toEqual({});
});
