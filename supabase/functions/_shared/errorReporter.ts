// The server-side counterpart to mobile/src/lib/errorReporter.ts, Spec §9:
// "In the Edge Functions a thin error reporter over `fetch`, no package, an
// npm import in Deno for two lines would be disproportionate." This had not
// been carried over in Task 10 of the plan (see abschluss-fix-server.md) and
// is caught up here, as its own module under `_shared/`, so all seven
// Functions share one implementation instead of several slightly different
// copies.
//
// ---------------------------------------------------------------------------
// Same property as on the client: without a DSN, a complete no-op
// ---------------------------------------------------------------------------
// That is not just symmetry with the app, it is necessary: these Functions
// run in every local development environment today without SENTRY_DSN (see
// supabase/functions/.env.example), and an error reporter that behaves
// differently there than "nothing happens" would be a new bug in itself.
//
// ---------------------------------------------------------------------------
// What may go into an error report, and what must NOT
// ---------------------------------------------------------------------------
// The client-side final review found that Sentry's default behaviour
// (breadcrumbs) collects signed S3 read URLs and moment content (caption,
// coordinates, place name), data an error report must never contain: a
// signed URL is an access token with an expiry, not a diagnostic value, and
// moment content is exactly what Reelive seals. Server-side the risk is
// structurally different (no automatic breadcrumb tracking, because no SDK
// runs), but the same mistake could still be made by hand, by throwing an
// entire database row or a raw Response object into `context`. Hence two
// hard rules, both enforced in the type system, not just by convention:
//
//   1. `context` is restricted to flat primitives (string/number/boolean/
//      null). No object, no array, no nested structure can be passed
//      through; TypeScript already rejects the type at the call site, long
//      before anything would be signed or sent. Callers pass IDs and counts
//      (user_id, trip_id, count), never storage_key lists, never signed
//      URLs, never caption/place/coordinates.
//   2. The actual error (first parameter, `unknown`, typically a Postgres
//      or S3 error object) is NOT serialized raw. `messageFrom()` reads
//      only `.message` (Error instances) or a string `message` field from
//      an error object, and discards the rest. Postgres errors sometimes
//      carry column values in `.detail` ("Key (id)=(…) already exists."),
//      that field never reaches Sentry, only the short message does.
//
// What this rules out: these Functions never sign a read URL before
// returning it, and never report a result object from a successful S3 call;
// the call sites in the seven `index.ts` files pass `report()` only error
// objects and the primitives described above. No caller has to enforce this
// rule itself, it follows from the signature.
//
// ---------------------------------------------------------------------------
// Why the Sentry "Store" API and not the Envelope format
// ---------------------------------------------------------------------------
// `@sentry/react-native` (client) and a hypothetical `@sentry/deno` speak
// the newer Envelope format (multi-part, with its own framing syntax). For
// "an error text plus a few primitives" that is more format than the
// purpose calls for, the same argument as in Spec §9 against a package also
// applies against that package's wire format. The older Store API
// (`POST /api/<project>/store/`, a single JSON object, authenticated via
// the `X-Sentry-Auth` header), still served by sentry.io and self-hosted
// instances, covers the same purpose with a single `fetch` call.
//
// ---------------------------------------------------------------------------
// This reporter must never fail visibly
// ---------------------------------------------------------------------------
// A broken DSN, an unreachable Sentry, a timeout: none of that may delay or
// break the Function's actual response. `report()` therefore never throws,
// every failure case (parsing, network, timeout) is swallowed, at most
// acknowledged with its own console.error line. A two-second timeout keeps
// a hanging Sentry from holding up an error response indefinitely; the
// callers in the `index.ts` files `await` `report()` so the report is safely
// sent before the Function instance could be torn down after the response
// (Edge Functions offer no guaranteed survival of un-awaited promises past
// the response return).

export type ErrorContext = Record<string, string | number | boolean | null>;

// One function name per module (media-urls, share-link, reveal-trip,
// delete-account, ...), sent along as a Sentry tag, so the sources stay
// distinguishable in one shared Sentry project without every caller having
// to add that itself.
export type ReportFn = (error: unknown, context?: ErrorContext) => Promise<void>;

const TIMEOUT_MS = 2000;

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return String(error);
}

type ParsedDsn = { postUrl: string; publicKey: string };

// DSN shape: `https://<public_key>@<host>[:<port>]/[<path-prefix>/]<project-id>`.
// Self-hosted instances sometimes put the ingest endpoint behind a path
// prefix (reverse proxy); only the LAST path segment is therefore treated
// as the project id, everything before it is kept as the prefix.
// `url.username` is the public key, Sentry DSNs carry no password (the
// second part before the "@" stays empty).
function parseDsn(dsn: string): ParsedDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const publicKey = url.username;
  const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!publicKey || !path) return null;
  const segments = path.split('/');
  const project = segments[segments.length - 1];
  const prefix = segments.slice(0, -1).join('/');
  const postUrl = `${url.protocol}//${url.host}/${prefix ? prefix + '/' : ''}api/${project}/store/`;
  return { postUrl, publicKey };
}

// A factory instead of a module-wide singleton: every Function builds its
// own reporter from its own `Deno.env.get('SENTRY_DSN')` read (same style as
// `createAdminClient`/`createAccountStore` in the function folders), and
// tests can pass in their own injected `fetchImpl`, with no real network at
// all (same style as `send(messages, fetchImpl)` in reveal-trip/push.ts).
export function createErrorReporter(
  dsn: string,
  functionName: string,
  fetchImpl: typeof fetch = fetch,
): ReportFn {
  if (!dsn) {
    return async () => {};
  }

  const parsed = parseDsn(dsn);
  if (!parsed) {
    // Unlike a missing DSN, this is a configuration error (a DSN that is
    // set but unusable); the Function stays functional (the reporter
    // becomes a no-op), but ops should still see it in the log, the same
    // way any other "X is missing/incomplete" is logged in these Functions.
    console.error(`${functionName}: SENTRY_DSN is set but could not be resolved.`);
    return async () => {};
  }

  return async (error, context) => {
    const event = {
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'other',
      level: 'error',
      logger: 'edge-function',
      message: { message: messageFrom(error) },
      tags: { function: functionName },
      extra: context,
    };
    try {
      const response = await fetchImpl(parsed.postUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Sentry-Auth':
            `Sentry sentry_version=7, sentry_client=reelive-edge/1.0, sentry_key=${parsed.publicKey}`,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await response.body?.cancel();
    } catch (err) {
      // This reporter must never itself become a failure someone would have
      // to report all over again, see header comment.
      console.error(`${functionName}: failed to send error report to Sentry.`, err);
    }
  };
}
