// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// reveal-trip, die EINZIGE Stelle, an der eine Reise je ihren Status
// wechselt. `authenticated` hat auf `trips.status`/`revealed_at` gar kein
// Spalten-Grant (supabase/migrations/20260803090200_membership_rls.sql),
// diese Function ist deshalb kein zusätzlicher Weg neben einem Client-Update,
// sondern der einzige, der existiert.
//
// Aufbau und Fehlerformat spiegeln supabase/functions/media-urls/index.ts:
// dieselben json()/fehler()-Helfer, Identität ausschliesslich aus dem
// Authorization-Header (supabaseAdmin.auth.getUser(token)), nie aus dem Body.
//
// Seit dem Phase-5-Abschluss-Review (diese Function hatte null automatisierte
// Tests) ist der Inhalt auf zwei testbare Bausteine aufgeteilt:
//   - reveal.ts: die reine Entscheidungs- und Versandlogik (Owner-Check,
//     idempotente Antwort, Archiv-Konflikt, CAS-Update, Push nur im
//     Gewinner-Zweig, Nachlesen im Verlierer-Zweig) über einer schmalen
//     `RevealStore`-Schnittstelle, unit-testbar ohne Docker
//     (reveal_test.ts).
//   - revealStore.ts: der reale Adapter dieser Schnittstelle gegen
//     supabaseAdmin, inklusive der zwei Abfragen, die kein Unit-Test
//     ersetzen kann (CAS-Bedingung, Empfänger-Einschränkung bei der
//     Token-Löschung), geprüft in revealStore_integration_test.ts direkt
//     gegen den echten Stack, ohne Umweg über HTTP oder Expo.
// Dieser Handler übersetzt nur noch HTTP: Methode, Konfiguration, Identität
// aus dem JWT, Body-Parsing, das Ergebnis von `fuehreRevealAus` in eine
// Response.
import { sende } from './push.ts';
import { fuehreRevealAus } from './reveal.ts';
import { erstelleAdminClient, erstelleRevealStore } from './revealStore.ts';
import { erstelleFehlermelder } from '../_shared/fehlermelder.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Spec §9 / Abschluss-Review Phase 6: ein schlanker Fehler-Melder über
// `fetch`, ohne Paket (Begründung und Privacy-Regeln in
// _shared/fehlermelder.ts). Ohne SENTRY_DSN ein vollständiger No-Op.
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const melde = erstelleFehlermelder(SENTRY_DSN, 'reveal-trip');

type AnfrageBody = { trip_id?: unknown };

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Fehlerantworten sind deutsche Klartexte für die App, nie rohe
// Provider-Fehler (die landen nur im Server-Log via console.error).
function fehler(nachricht: string, status: number): Response {
  return json({ fehler: nachricht }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return fehler('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('reveal-trip: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    await melde(new Error('reveal-trip: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.'));
    return fehler('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Identität kommt ausschliesslich aus dem JWT im Authorization-Header,
  // nie aus dem Body. Der Body enthält nur trip_id.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return fehler('Nicht angemeldet.', 401);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return fehler('Nicht angemeldet.', 401);
  }
  const anfragendeId = userData.user.id;

  let body: AnfrageBody;
  try {
    body = await req.json();
  } catch {
    return fehler('Ungültige Anfrage.', 400);
  }

  const tripId = body.trip_id;
  if (typeof tripId !== 'string' || tripId.length === 0) {
    return fehler('trip_id fehlt.', 400);
  }

  const store = erstelleRevealStore(supabaseAdmin);
  const ergebnis = await fuehreRevealAus(store, sende, tripId, anfragendeId, melde);
  return json(ergebnis.body, ergebnis.status);
});
