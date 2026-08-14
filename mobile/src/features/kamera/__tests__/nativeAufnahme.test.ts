// Der Zugriffspunkt kapselt das native Modul: fehlt es (Android, Simulator,
// alter Build), antwortet er mit false/null statt zu werfen — die Kamera
// fällt dann auf den recordAsync-Weg zurück (Spec: Rückfallebene).
const mockModul = {
  aufnahmeStarten: jest.fn(async (_s: number) => {}),
  aufnahmeStoppen: jest.fn(async () => ({ uri: 'file://a.mov', dauerS: 3.2 })),
  dateiAbwarten: jest.fn(async () => {}),
  verwerfen: jest.fn(async () => {}),
};
let mockVorhanden = true;

// Nur die eine Funktion ersetzen, der Rest bleibt echt: `jest.resetModules()`
// unten stösst Expos Winter-Runtime an (der `fetch`-Global wird faul
// nachgeladen), und die braucht `requireNativeModule` aus demselben Paket.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => (mockVorhanden ? mockModul : null),
}));

// Das Modul merkt sich den nativen Zugang beim ersten Zugriff, deshalb muss
// jeder Test mit frischem Registrierungsstand beginnen.
function nativeAufnahme() {
  return require('../nativeAufnahme') as typeof import('../nativeAufnahme');
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockVorhanden = true;
});

test('aufnahmeStarten meldet true, wenn das Modul startet', async () => {
  await expect(nativeAufnahme().aufnahmeStarten(90)).resolves.toBe(true);
  expect(mockModul.aufnahmeStarten).toHaveBeenCalledWith(90);
});

test('ohne Modul meldet aufnahmeStarten false statt zu werfen', async () => {
  mockVorhanden = false;
  await expect(nativeAufnahme().aufnahmeStarten(90)).resolves.toBe(false);
});

test('ein nativer Startfehler wird zu false (Rückfallebene), nicht zum Absturz', async () => {
  mockModul.aufnahmeStarten.mockRejectedValueOnce(new Error('läuft schon'));
  await expect(nativeAufnahme().aufnahmeStarten(90)).resolves.toBe(false);
});

test('aufnahmeStoppen reicht uri und dauerS durch', async () => {
  await expect(nativeAufnahme().aufnahmeStoppen()).resolves.toEqual({
    uri: 'file://a.mov',
    dauerS: 3.2,
  });
});

test('scheitert das Stoppen, kommt null (die Kamera zeigt dann den Fehlerweg)', async () => {
  mockModul.aufnahmeStoppen.mockRejectedValueOnce(new Error('kein writer'));
  await expect(nativeAufnahme().aufnahmeStoppen()).resolves.toBeNull();
});

test('dateiFertig reicht die Ablehnung des Schreibens unverändert weiter', async () => {
  const fehler = new Error('voller Speicher');
  mockModul.dateiAbwarten.mockRejectedValueOnce(fehler);
  await expect(nativeAufnahme().dateiFertig()).rejects.toBe(fehler);
});
