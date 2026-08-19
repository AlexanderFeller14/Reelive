// Task-10-Brief, promise W10 (Spec §4): "Without a Sentry DSN the app
// behaves exactly as it does today." Same principle as pushApi.ts in
// Phase 5: every failure/missing configuration is a NORMAL CASE, not an
// error, and none of it may show: no Sentry.init(), no network call, no
// console warning.
//
// NO `import * as Sentry from '@sentry/react-native'` at module level, on
// purpose: a test proved (see the report) that merely LOADING the package
// already starts an internal `setInterval` (AsyncExpiringMap in its
// tracing integration, regardless of whether `Sentry.init()` is ever
// called). A module-level import would create this timer on EVERY app
// start, DSN or not, which would be demonstrably NOT the case for "today"
// (without any Sentry code) and would literally violate W10.
// `require()` inside initErrorReporter()/reportError() only loads the
// package once `active` is actually true (see below); without a DSN the
// `@sentry/react-native` file is never executed and the timer never
// appears.
type SentryModule = typeof import('@sentry/react-native');
function loadSentry(): SentryModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@sentry/react-native');
}

// The single source of truth for whether initialization ever happened;
// both initErrorReporter() and reportError() read it instead of trusting
// that @sentry/react-native itself stays "quiet" when called without a
// prior init() (an implementation detail of the third-party library that
// could change with a new version, see the "mock replaces the mechanism"
// warning in the plan: if reportError() blindly called captureException(),
// no test could prove anymore that WITHOUT a DSN nothing really happens,
// only that the third-party library currently behaves).
let active = false;

// Sets `active = true` on the very first call with a DSN set; every further
// call (with or without a DSN) is then a no-op. The root layout calls this
// function exactly once on module load (see _layout.tsx); the guard here
// is still needed because the brief (step 4) explicitly requires "with a
// DSN, initialization happens exactly once" - a second call (e.g. through
// Fast Refresh during development) must not trigger a second
// Sentry.init() (and therefore not a second require() of a file that is
// already loaded).
// Final-Review point 3: `init({ dsn })` alone runs with ALL default
// integrations, including `breadcrumbsIntegration` with `xhr: true` and
// `console: true` (see node_modules/@sentry/react-native/dist/js/
// integrations/breadcrumbs.js). That would make Sentry capture two
// categories that never belong here:
//   - `xhr: true` logs every requested URL as a breadcrumb, including the
//     signed S3 read URLs from media-urls (credentials valid for one hour
//     on private photos/videos, see media-urls/keys.ts). A Sentry event
//     would then forward these credentials to a third system, regardless
//     of whether the caller ever thought about that.
//   - `console: true` logs the content of EVERY `console.error` call as a
//     breadcrumb, verbatim, e.g. queueDb.ts, which (before this fix)
//     logged an entire queue row including `caption`/`lat`/`lng`/
//     `place_name`. `console.error` is a diagnostic channel across the
//     whole project, not a contract about what may appear in it; passing
//     it through to Sentry unfiltered turns every future `console.error`
//     call site into an unintentional Sentry data source.
//
// Decision: turn BOTH categories off entirely (`console: false, xhr:
// false`), not filter them afterwards via `beforeBreadcrumb`. A filter
// would have to recognize every conceivable form of a signed URL (S3/R2
// query parameters differ by provider) and every conceivable
// `console.error` call across the whole (including future) codebase; an
// off-switch at the source doesn't require that and can't be undermined
// by a new call site that doesn't know about the filter. The remaining
// default integrations (crash capture, `captureException` itself
// including the stack trace) stay unchanged; this is only about
// automatically captured console/network breadcrumbs.
export function initErrorReporter(): void {
  if (active) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  active = true;
  const sentry = loadSentry();
  sentry.init({
    dsn,
    integrations: (defaults) =>
      defaults.map((integration) =>
        integration.name === 'Breadcrumbs'
          ? sentry.breadcrumbsIntegration({ console: false, xhr: false })
          : integration
      ),
  });
}

// `error` is deliberately `unknown`: the typical call site is a catch
// block, and TypeScript strict types its parameter as `unknown`, not
// `Error` (it could be anything `throw` throws). `context` is optional:
// extra details useful for debugging (e.g. which screen, which trip_id)
// end up as `extra` data on the Sentry event.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!active) return;
  loadSentry().captureException(error, context ? { extra: context } : undefined);
}
