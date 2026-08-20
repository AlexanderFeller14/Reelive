// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// reveal-trip, the ONLY place a trip ever changes status. `authenticated`
// has no column grant at all on `trips.status`/`revealed_at`
// (supabase/migrations/20260803090200_membership_rls.sql), so this function
// is not an additional path next to a client update, it is the only one
// that exists.
//
// Structure and error format mirror supabase/functions/media-urls/index.ts:
// the same json()/errorResponse() helpers, identity exclusively from the
// Authorization header (supabaseAdmin.auth.getUser(token)), never from the
// body.
//
// Since the Phase 5 final review (this function had zero automated tests),
// the content is split into two testable building blocks:
//   - reveal.ts: the pure decision and send logic (owner check, idempotent
//     response, archive conflict, CAS update, push only in the winner
//     branch, follow-up read in the loser branch) over a narrow
//     `RevealStore` interface, unit-testable with no Docker
//     (reveal_test.ts).
//   - revealStore.ts: the real adapter for that interface against
//     supabaseAdmin, including the two queries no unit test can replace
//     (CAS condition, recipient restriction on token deletion), checked in
//     revealStore_integration_test.ts directly against the real stack.
// This handler now only translates HTTP: method, configuration, identity
// from the JWT, body parsing, the result of `performReveal` into a
// Response.
import { send } from './push.ts';
import { performReveal } from './reveal.ts';
import { createAdminClient, createRevealStore } from './revealStore.ts';
import { createErrorReporter } from '../_shared/errorReporter.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Spec §9 / Phase 6 final review: a thin error reporter over `fetch`, no
// package (reasoning and privacy rules in _shared/errorReporter.ts). Without
// SENTRY_DSN a complete no-op.
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const report = createErrorReporter(SENTRY_DSN, 'reveal-trip');

type RequestBody = { trip_id?: unknown };

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Error responses are German plain text for the app, never a raw provider
// error (those only end up in the server log via console.error).
function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return errorResponse('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('reveal-trip: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.');
    await report(new Error('reveal-trip: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing.'));
    return errorResponse('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Identity comes exclusively from the JWT in the Authorization header,
  // never from the body. The body only contains trip_id.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return errorResponse('Nicht angemeldet.', 401);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse('Nicht angemeldet.', 401);
  }
  const requestingUserId = userData.user.id;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }

  const tripId = body.trip_id;
  if (typeof tripId !== 'string' || tripId.length === 0) {
    return errorResponse('trip_id fehlt.', 400);
  }

  const store = createRevealStore(supabaseAdmin);
  const result = await performReveal(store, send, tripId, requestingUserId, report);
  return json(result.body, result.status);
});
