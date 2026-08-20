// Promise W10 (Spec §4, Task-10-Brief): "Without a Sentry DSN the app
// behaves exactly as it does today", no init, no network, no warning.
// Every test loads the module fresh (jest.resetModules() + require())
// because `active` is pure module state (same pattern as
// secureSessionStorage.test.ts, "restart simulation"), otherwise an
// earlier test with a DSN would contaminate the state for a later one
// without a DSN.
const mockInit = jest.fn();
const mockCaptureException = jest.fn();
const mockBreadcrumbsIntegration = jest.fn((...a: unknown[]) => ({ name: 'Breadcrumbs', options: a[0] }));

// Final-Review point 4: the actual fix (errorReporter.ts) is a LAZY
// `require('@sentry/react-native')` instead of a top-level import; merely
// loading the real package otherwise starts an internal `setInterval`
// (AsyncExpiringMap), independent of `init()`. This mock REPLACES the
// package entirely, so a test against it can't show WHETHER the package
// was loaded, only what happens once it is loaded. Hence this flag: it
// trips exactly when Jest actually runs the factory below, i.e. whenever
// any code calls `require('@sentry/react-native')` (whether the real
// package or, as here, its mock; `jest.resetModules()` in freshModule()
// makes sure the factory runs again after every test, as soon as the
// module is needed again). A reverted top-level import in errorReporter.ts
// would trigger this factory as early as the `require('../errorReporter')`
// call itself; the tests below, which require `sentryModuleLoaded ===
// false` WITHOUT a DSN, would catch that.
let sentryModuleLoaded = false;
jest.mock('@sentry/react-native', () => {
  sentryModuleLoaded = true;
  return {
    init: (...a: unknown[]) => mockInit(...a),
    captureException: (...a: unknown[]) => mockCaptureException(...a),
    breadcrumbsIntegration: (...a: unknown[]) => mockBreadcrumbsIntegration(...a),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
type ErrorReporterModule = typeof import('../errorReporter');

function freshModule(): ErrorReporterModule {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../errorReporter');
}

const DSN_KEY = 'EXPO_PUBLIC_SENTRY_DSN';
const previousDsn = process.env[DSN_KEY];

beforeEach(() => {
  jest.clearAllMocks();
  sentryModuleLoaded = false;
  delete process.env[DSN_KEY];
});

afterAll(() => {
  if (previousDsn === undefined) delete process.env[DSN_KEY];
  else process.env[DSN_KEY] = previousDsn;
});

describe('without EXPO_PUBLIC_SENTRY_DSN: fully a no-op', () => {
  test('initErrorReporter() never calls Sentry.init', () => {
    const { initErrorReporter } = freshModule();
    initErrorReporter();
    expect(mockInit).not.toHaveBeenCalled();
  });

  test('reportError() never calls Sentry.captureException, even after initErrorReporter()', () => {
    const { initErrorReporter, reportError } = freshModule();
    initErrorReporter();
    reportError(new Error('kaputt'), { screen: 'recap' });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  test('no console output (no log/warn/error)', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { initErrorReporter, reportError } = freshModule();
      initErrorReporter();
      reportError(new Error('kaputt'));
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  // Final-Review point 4, the actual guard: without a DSN,
  // `@sentry/react-native` must not even be REQUIRE'd, not just "stay
  // unused". A reverted top-level import would set `sentryModuleLoaded` to
  // true through the mere `require('../errorReporter')` in
  // freshModule(), long before initErrorReporter() ever runs; this
  // assertion would catch that, where the three tests above (which only
  // check Sentry calls/console) could not.
  test('@sentry/react-native is never loaded (module guard)', () => {
    const { initErrorReporter, reportError } = freshModule();
    expect(sentryModuleLoaded).toBe(false);
    initErrorReporter();
    reportError(new Error('kaputt'));
    expect(sentryModuleLoaded).toBe(false);
  });
});

describe('with EXPO_PUBLIC_SENTRY_DSN set', () => {
  beforeEach(() => {
    process.env[DSN_KEY] = 'https://beispiel@o0.ingest.sentry.io/1';
  });

  test('initErrorReporter() initializes exactly once, even when called repeatedly', () => {
    const { initErrorReporter } = freshModule();
    initErrorReporter();
    initErrorReporter();
    initErrorReporter();
    expect(mockInit).toHaveBeenCalledTimes(1);
    // `dsn` checked exactly, `integrations` only checked to "is a
    // function"; the actual content (breadcrumbs hardening) has its own
    // test below.
    expect(mockInit).toHaveBeenCalledWith({
      dsn: 'https://beispiel@o0.ingest.sentry.io/1',
      integrations: expect.any(Function),
    });
  });

  // Final-Review point 4, cross-check for the module guard above: with a
  // DSN the package MUST be loaded, otherwise the guard would just be a
  // constant that always returns `false`, no matter what happens.
  test('initErrorReporter() actually loads @sentry/react-native', () => {
    const { initErrorReporter } = freshModule();
    expect(sentryModuleLoaded).toBe(false);
    initErrorReporter();
    expect(sentryModuleLoaded).toBe(true);
  });

  // Final-Review point 3: `init({ dsn })` alone would run with ALL default
  // integrations, including `breadcrumbsIntegration` with `console: true,
  // xhr: true` (signed media URLs, console content). This test checks the
  // actual replacement: the `integrations` function passed to
  // `Sentry.init` must replace EXACTLY the entry named "Breadcrumbs" with
  // an instance carrying `{ console: false, xhr: false }` and leave every
  // other default integration unchanged.
  test('initErrorReporter() replaces the default breadcrumbs integration with one without console/xhr', () => {
    const { initErrorReporter } = freshModule();
    initErrorReporter();

    const options = mockInit.mock.calls[0]?.[0] as {
      integrations: (defaults: { name: string }[]) => unknown[];
    };
    const other = { name: 'Something else' };
    const replaced = options.integrations([{ name: 'Breadcrumbs' }, other]);

    expect(mockBreadcrumbsIntegration).toHaveBeenCalledWith({ console: false, xhr: false });
    expect(replaced).toEqual([{ name: 'Breadcrumbs', options: { console: false, xhr: false } }, other]);
  });

  test('reportError() before initErrorReporter() stays a no-op, even with a DSN set', () => {
    const { reportError } = freshModule();
    reportError(new Error('zu früh'));
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  test('reportError() after initErrorReporter() reports the error together with context as extra', () => {
    const { initErrorReporter, reportError } = freshModule();
    initErrorReporter();
    const error = new Error('kaputt');
    reportError(error, { screen: 'recap', tripId: 't1' });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(error, { extra: { screen: 'recap', tripId: 't1' } });
  });

  test('reportError() without context passes no extra block', () => {
    const { initErrorReporter, reportError } = freshModule();
    initErrorReporter();
    const error = new Error('ohne kontext');
    reportError(error);
    expect(mockCaptureException).toHaveBeenCalledWith(error, undefined);
  });
});
