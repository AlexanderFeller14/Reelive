// Versprechen W10 (Spec §4, Task-10-Brief): «Ohne Sentry-DSN verhält sich die
// App exakt wie heute» — kein Init, kein Netz, keine Warnung. Jeder Test lädt
// das Modul frisch (jest.resetModules() + require()), weil `aktiv` reiner
// Modulzustand ist (gleiches Muster wie secureSessionStorage.test.ts,
// "Neustart-Simulation") — sonst würde ein früherer Test mit DSN den
// Zustand für einen späteren ohne DSN verfälschen.
const mockInit = jest.fn();
const mockCaptureException = jest.fn();
jest.mock('@sentry/react-native', () => ({
  init: (...a: unknown[]) => mockInit(...a),
  captureException: (...a: unknown[]) => mockCaptureException(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
type FehlermelderModul = typeof import('../fehlermelder');

function frischesModul(): FehlermelderModul {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../fehlermelder');
}

const DSN_KEY = 'EXPO_PUBLIC_SENTRY_DSN';
const alterDsn = process.env[DSN_KEY];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env[DSN_KEY];
});

afterAll(() => {
  if (alterDsn === undefined) delete process.env[DSN_KEY];
  else process.env[DSN_KEY] = alterDsn;
});

describe('ohne EXPO_PUBLIC_SENTRY_DSN: vollständiger No-Op', () => {
  test('initFehlermelder() ruft Sentry.init nie auf', () => {
    const { initFehlermelder } = frischesModul();
    initFehlermelder();
    expect(mockInit).not.toHaveBeenCalled();
  });

  test('meldeFehler() ruft Sentry.captureException nie auf — auch nach initFehlermelder()', () => {
    const { initFehlermelder, meldeFehler } = frischesModul();
    initFehlermelder();
    meldeFehler(new Error('kaputt'), { screen: 'recap' });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  test('keine Konsolen-Ausgabe (kein log/warn/error)', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { initFehlermelder, meldeFehler } = frischesModul();
      initFehlermelder();
      meldeFehler(new Error('kaputt'));
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe('mit EXPO_PUBLIC_SENTRY_DSN gesetzt', () => {
  beforeEach(() => {
    process.env[DSN_KEY] = 'https://beispiel@o0.ingest.sentry.io/1';
  });

  test('initFehlermelder() initialisiert genau einmal — auch bei mehrfachem Aufruf', () => {
    const { initFehlermelder } = frischesModul();
    initFehlermelder();
    initFehlermelder();
    initFehlermelder();
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith({ dsn: 'https://beispiel@o0.ingest.sentry.io/1' });
  });

  test('meldeFehler() VOR initFehlermelder() bleibt ein No-Op, selbst mit gesetztem DSN', () => {
    const { meldeFehler } = frischesModul();
    meldeFehler(new Error('zu früh'));
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  test('meldeFehler() NACH initFehlermelder() meldet den Fehler samt Kontext als extra', () => {
    const { initFehlermelder, meldeFehler } = frischesModul();
    initFehlermelder();
    const fehler = new Error('kaputt');
    meldeFehler(fehler, { screen: 'recap', tripId: 't1' });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(fehler, { extra: { screen: 'recap', tripId: 't1' } });
  });

  test('meldeFehler() ohne Kontext übergibt keinen extra-Block', () => {
    const { initFehlermelder, meldeFehler } = frischesModul();
    initFehlermelder();
    const fehler = new Error('ohne kontext');
    meldeFehler(fehler);
    expect(mockCaptureException).toHaveBeenCalledWith(fehler, undefined);
  });
});
