// Versprechen W10 (Spec §4, Task-10-Brief): «Ohne Sentry-DSN verhält sich die
// App exakt wie heute» — kein Init, kein Netz, keine Warnung. Jeder Test lädt
// das Modul frisch (jest.resetModules() + require()), weil `aktiv` reiner
// Modulzustand ist (gleiches Muster wie secureSessionStorage.test.ts,
// "Neustart-Simulation") — sonst würde ein früherer Test mit DSN den
// Zustand für einen späteren ohne DSN verfälschen.
const mockInit = jest.fn();
const mockCaptureException = jest.fn();
const mockBreadcrumbsIntegration = jest.fn((...a: unknown[]) => ({ name: 'Breadcrumbs', optionen: a[0] }));

// Final-Review Punkt 4: der eigentliche Fix (fehlermelder.ts) ist ein
// LAZY `require('@sentry/react-native')` statt eines Top-Level-Imports —
// das blosse Laden des echten Pakets startet sonst einen internen
// `setInterval` (AsyncExpiringMap), unabhängig von `init()`. Dieser Mock
// ERSETZT das Paket komplett, ein Test gegen ihn kann also nicht zeigen, OB
// das Paket geladen wurde — nur was passiert, wenn es geladen wird. Deshalb
// dieses Flag: es schlägt genau dann an, wenn Jest die Factory unten
// tatsächlich ausführt, also wenn irgendein Code `require('@sentry/
// react-native')` aufruft (egal ob echtes Paket oder — wie hier — sein
// Mock; `jest.resetModules()` in frischesModul() sorgt dafür, dass die
// Factory nach jedem Test erneut läuft, sobald das Modul wieder gebraucht
// wird). Ein zurückgedrehter Top-Level-Import in fehlermelder.ts würde
// diese Factory schon beim `require('../fehlermelder')` selbst auslösen —
// die Tests unten, die OHNE DSN `sentryModulGeladen === false` verlangen,
// würden das aufdecken.
let sentryModulGeladen = false;
jest.mock('@sentry/react-native', () => {
  sentryModulGeladen = true;
  return {
    init: (...a: unknown[]) => mockInit(...a),
    captureException: (...a: unknown[]) => mockCaptureException(...a),
    breadcrumbsIntegration: (...a: unknown[]) => mockBreadcrumbsIntegration(...a),
  };
});

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
  sentryModulGeladen = false;
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

  // Final-Review Punkt 4, der eigentliche Wächter: ohne DSN darf
  // `@sentry/react-native` gar nicht erst REQUIRE'T werden — nicht nur
  // "unbenutzt bleiben". Ein zurückgedrehter Top-Level-Import würde
  // `sentryModulGeladen` schon durch das blosse `require('../fehlermelder')`
  // in frischesModul() auf true setzen, lange bevor initFehlermelder()
  // überhaupt läuft — diese Assertion würde das aufdecken, wo die drei
  // Tests oben (die nur Sentry-Aufrufe/Konsole prüfen) es nicht könnten.
  test('@sentry/react-native wird nie geladen (Modul-Guard)', () => {
    const { initFehlermelder, meldeFehler } = frischesModul();
    expect(sentryModulGeladen).toBe(false);
    initFehlermelder();
    meldeFehler(new Error('kaputt'));
    expect(sentryModulGeladen).toBe(false);
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
    // `dsn` exakt geprüft, `integrations` nur auf "ist eine Funktion" — der
    // eigentliche Inhalt (Breadcrumbs-Härtung) hat einen eigenen Test unten.
    expect(mockInit).toHaveBeenCalledWith({
      dsn: 'https://beispiel@o0.ingest.sentry.io/1',
      integrations: expect.any(Function),
    });
  });

  // Final-Review Punkt 4, Gegenprobe zum Modul-Guard oben: mit DSN MUSS das
  // Paket geladen werden — sonst wäre der Guard nur eine Konstante, die
  // immer `false` liefert, egal was passiert.
  test('initFehlermelder() lädt @sentry/react-native tatsächlich', () => {
    const { initFehlermelder } = frischesModul();
    expect(sentryModulGeladen).toBe(false);
    initFehlermelder();
    expect(sentryModulGeladen).toBe(true);
  });

  // Final-Review Punkt 3: `init({ dsn })` allein würde mit ALLEN
  // Default-Integrationen laufen — darunter `breadcrumbsIntegration` mit
  // `console: true, xhr: true` (signierte Medien-URLs, Konsolen-Inhalte).
  // Dieser Test prüft die tatsächliche Ersetzung: die an `Sentry.init`
  // übergebene `integrations`-Funktion muss GENAU den Eintrag namens
  // "Breadcrumbs" durch eine Instanz mit `{ console: false, xhr: false }`
  // ersetzen und alle anderen Default-Integrationen unverändert lassen.
  test('initFehlermelder() ersetzt die Default-Breadcrumbs-Integration durch eine ohne console/xhr', () => {
    const { initFehlermelder } = frischesModul();
    initFehlermelder();

    const optionen = mockInit.mock.calls[0]?.[0] as {
      integrations: (defaults: { name: string }[]) => unknown[];
    };
    const sonstige = { name: 'Sonstiges' };
    const ersetzt = optionen.integrations([{ name: 'Breadcrumbs' }, sonstige]);

    expect(mockBreadcrumbsIntegration).toHaveBeenCalledWith({ console: false, xhr: false });
    expect(ersetzt).toEqual([{ name: 'Breadcrumbs', optionen: { console: false, xhr: false } }, sonstige]);
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
