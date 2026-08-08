// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// reveal-trip — die EINZIGE Stelle, an der eine Reise je ihren Status
// wechselt. `authenticated` hat auf `trips.status`/`revealed_at` gar kein
// Spalten-Grant (supabase/migrations/20260803090200_membership_rls.sql) —
// diese Function ist deshalb kein zusätzlicher Weg neben einem Client-Update,
// sondern der einzige, der existiert.
//
// Aufbau und Fehlerformat spiegeln supabase/functions/media-urls/index.ts:
// dieselben json()/fehler()-Helfer, Identität ausschliesslich aus dem
// Authorization-Header (supabaseAdmin.auth.getUser(token)), nie aus dem Body.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sende, type PushNachricht } from './push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Fabrik statt eines direkten `createClient(...)`-Aufrufs weiter unten: nur
// so lässt sich der Rückgabetyp sauber benennen. `ReturnType<typeof
// createClient>` allein (ohne die Fabrik) inferiert an dieser Stelle einen
// ANDEREN Typ als der tatsächliche Aufruf `createClient(SUPABASE_URL,
// SERVICE_ROLE_KEY)` weiter unten — createClient hat interdependente
// generische Default-Typparameter, und `typeof createClient` referenziert
// die allgemeine Funktionssignatur, nicht die an einer konkreten Aufrufstelle
// inferierten Defaults (in der ersten Fassung dieser Function schlug
// `deno check` deshalb fehl, siehe task-2-report.md). Mit der Fabrik ist
// `AdminClient` per Konstruktion exakt der Typ, den `erstelleAdminClient()`
// zurückgibt — dieselbe Inferenz, kein zweiter Referenzpunkt, der abweichen
// könnte.
function erstelleAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}
type AdminClient = ReturnType<typeof erstelleAdminClient>;

type TripStatus = 'active' | 'revealed' | 'archived';

type TripZeile = {
  id: string;
  name: string;
  owner_id: string;
  status: TripStatus;
  revealed_at: string | null;
};

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

// Schickt die Reveal-Benachrichtigung an alle Mitglieder der Reise ausser der
// auslösenden Person und löscht Tokens, die Expo als abgemeldet meldet.
//
// WICHTIG: Der Aufrufer ruft das NUR im Gewinner-Zweig des CAS-Updates auf
// (siehe Deno.serve unten). Ein paralleler Aufruf, der den Statuswechsel
// selbst nicht ausgelöst hat (0 betroffene Zeilen, Nachlese-Zweig), darf den
// Push nicht ein zweites Mal verschicken — genau dieser Doppel-Versand war
// ein Review-Fund an der vorherigen, inline im try/catch nach dem
// if/else-Block platzierten Fassung.
//
// Wird komplett try/catch-umschlossen aufgerufen: der Statuswechsel ist zu
// diesem Zeitpunkt bereits geschehen und bleibt die Wahrheit, ein Fehler
// hier darf die Antwort an die Owner-Person nicht mehr verändern.
async function versendeRevealPush(
  supabaseAdmin: AdminClient,
  trip: TripZeile,
  ausloesendeId: string,
): Promise<void> {
  const { data: mitglieder, error: mitgliederError } = await supabaseAdmin
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', trip.id)
    .neq('user_id', ausloesendeId);

  if (mitgliederError) {
    console.error('reveal-trip: trip_members-Select fehlgeschlagen', mitgliederError);
    return;
  }
  const empfaengerIds = (mitglieder ?? []).map((m) => (m as { user_id: string }).user_id);
  if (empfaengerIds.length === 0) return;

  const { data: tokenZeilen, error: tokenError } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .in('user_id', empfaengerIds);

  if (tokenError) {
    console.error('reveal-trip: push_tokens-Select fehlgeschlagen', tokenError);
    return;
  }
  const tokens = (tokenZeilen ?? []) as Array<{ token: string }>;
  if (tokens.length === 0) return;

  const nachrichten: PushNachricht[] = tokens.map((t) => ({
    to: t.token,
    title: `✈️ Euer Recap von «${trip.name}» ist bereit!`,
    body: `✈️ Euer Recap von «${trip.name}» ist bereit!`,
    data: { trip_id: trip.id },
  }));

  const tote = await sende(nachrichten);
  if (tote.length === 0) return;

  // Zusätzlich auf `empfaengerIds` eingeschränkt (Review-Minor): die
  // Ticket->Token-Zuordnung in push.ts ist rein positionsbasiert (Ticket i
  // gehört zu Nachricht i). Käme von Expo je ein versetzter `data`-Block
  // zurück, dürfte ein fälschlich als DeviceNotRegistered gelesenes Token
  // NIE ausserhalb des gerade angeschriebenen Empfängerkreises löschen —
  // die Einschränkung begrenzt den Schaden auf genau diesen Kreis, statt
  // als Service-Role über die ganze Tabelle zu laufen.
  const { error: deleteError } = await supabaseAdmin
    .from('push_tokens')
    .delete()
    .in('token', tote)
    .in('user_id', empfaengerIds);
  if (deleteError) {
    console.error('reveal-trip: Aufräumen abgemeldeter push_tokens fehlgeschlagen', deleteError);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return fehler('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('reveal-trip: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    return fehler('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = erstelleAdminClient();

  // Identität kommt ausschliesslich aus dem JWT im Authorization-Header —
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

  const { data: trip, error: tripError } = await supabaseAdmin
    .from('trips')
    .select('id, name, owner_id, status, revealed_at')
    .eq('id', tripId)
    .maybeSingle();

  if (tripError) {
    console.error('reveal-trip: trips-Select fehlgeschlagen', tripError);
    return fehler('Reise konnte nicht geladen werden.', 500);
  }
  if (!trip) {
    return fehler('Reise nicht gefunden.', 404);
  }
  const tripZeile = trip as TripZeile;

  if (tripZeile.owner_id !== anfragendeId) {
    return fehler('Nur wer die Reise angelegt hat, kann sie abschliessen.', 403);
  }

  // Idempotent: ein zweiter Tipp auf «Reise abschliessen» (z. B. weil das
  // Netz beim ersten Mal wackelte) ist kein Fehler — die App bekommt
  // denselben revealed_at-Wert wie beim ersten erfolgreichen Aufruf.
  if (tripZeile.status === 'revealed') {
    return json({ ok: true, revealed_at: tripZeile.revealed_at }, 200);
  }
  if (tripZeile.status === 'archived') {
    return fehler('Diese Reise ist schon archiviert.', 409);
  }

  // status === 'active': einziger Statuswechsel, atomar per WHERE-Bedingung.
  //
  // `revealed_at: 'now'` ist kein Tippfehler für `new Date().toISOString()`:
  // 'now' ist in Postgres ein besonderer Datum/Zeit-Eingabewert (siehe
  // Postgres-Doku „Special Date/Time Inputs“), der beim Cast auf timestamptz
  // zur Startzeit der AUSFÜHRENDEN Transaktion aufgelöst wird — exakt
  // dasselbe Verhalten wie now()/CURRENT_TIMESTAMP in SQL, nur ausdrückbar
  // als gewöhnlicher Update-Wert über PostgREST (das keine SQL-Funktionsauf-
  // rufe im Request-Body entgegennimmt). Am lokalen Stack verifiziert: zwei
  // PATCH-Aufrufe im Abstand mehrerer Sekunden liefern unterschiedliche,
  // dem jeweiligen Ausführungszeitpunkt entsprechende Werte — der Zeitstempel
  // kommt also wirklich aus der Datenbank, nie aus Deno. Das ist relevant für
  // die Nachzügler-Regel (posts_insert_member,
  // supabase/migrations/20260803090300_sealing_rls.sql), die
  // `captured_at <= t.revealed_at` vergleicht — ABER `captured_at` ist
  // Gerätezeit: der Client setzt die Spalte selbst beim Insert (Spalten-Grant
  // in supabase/migrations/20260803090600_role_hardening.sql, Abschnitt 2).
  // Der Vergleich läuft also so oder so Gerätezeit gegen Serverzeit — dieses
  // grössere, prinzipiell unvermeidbare Delta beseitigt `now` nicht. Was
  // `now` beseitigt, ist die zusätzliche, kleinere Verschiebung, die
  // entstünde, WÜRDE Deno selbst einen Zeitstempel berechnen (z. B. `new
  // Date().toISOString()`) und ihn als Literal in dieselbe Spalte schreiben:
  // dann hinge revealed_at zusätzlich von der Uhr des Deno-Hosts ab, die von
  // der DB-Server-Uhr abweichen kann. `now` sorgt dafür, dass revealed_at
  // ausschliesslich von EINER Uhr abhängt — der des DB-Servers, derselben,
  // die auch bestimmt, wann ein `captured_at`-Wert als Nachzügler gilt.
  const { data: aktualisiert, error: updateError } = await supabaseAdmin
    .from('trips')
    .update({ status: 'revealed', revealed_at: 'now' })
    .eq('id', tripId)
    .eq('status', 'active')
    .select('revealed_at')
    .maybeSingle();

  if (updateError) {
    console.error('reveal-trip: trips-Update fehlgeschlagen', updateError);
    return fehler('Reise konnte nicht abgeschlossen werden.', 500);
  }

  let revealedAt: string | null;
  if (aktualisiert) {
    // Wir haben den Statuswechsel ausgelöst — und nur deshalb auch den Push.
    // Der Versand steht bewusst INNERHALB dieses Zweigs (Review-Fund an der
    // Vorfassung, siehe task-2-report.md): stünde er nach dem if/else, würde
    // auch der Verlierer eines Rennens (unten, 0 betroffene Zeilen) ihn
    // erneut auslösen und dieselbe Benachrichtigung ein zweites Mal an alle
    // Mitglieder verschicken, obwohl sein eigener Aufruf gar nichts
    // geändert hat.
    revealedAt = (aktualisiert as { revealed_at: string }).revealed_at;

    // Der Statuswechsel ist die Wahrheit, die Benachrichtigung nur die
    // Botschaft: ein Netzfehler gegen Expo, ein kaputtes Ticket oder eine
    // leere Empfängerliste dürfen den Reveal nicht scheitern lassen — die
    // Antwort an die Owner-Person bleibt 200 mit dem bereits ermittelten
    // revealedAt, unabhängig vom Ausgang des Versands.
    try {
      await versendeRevealPush(supabaseAdmin, tripZeile, anfragendeId);
    } catch (err) {
      console.error('reveal-trip: Push-Versand fehlgeschlagen', err);
    }
  } else {
    // 0 betroffene Zeilen: ein paralleler Aufruf war schneller und hat den
    // Status bereits von 'active' auf 'revealed' gedreht (die WHERE-Bedingung
    // status='active' griff dadurch nicht mehr). Das ist kein Fehler — die
    // Reise IST jetzt revealed, wir lesen nur nach, mit welchem Zeitstempel.
    // KEIN Push hier: der Gewinner-Zweig oben hat ihn bereits verschickt.
    const { data: nachgelesen, error: nachlesenError } = await supabaseAdmin
      .from('trips')
      .select('revealed_at')
      .eq('id', tripId)
      .maybeSingle();
    if (nachlesenError || !nachgelesen) {
      console.error('reveal-trip: Nachlesen nach paralellem Reveal fehlgeschlagen', nachlesenError);
      return fehler('Reise konnte nicht abgeschlossen werden.', 500);
    }
    revealedAt = (nachgelesen as { revealed_at: string | null }).revealed_at;
  }

  return json({ ok: true, revealed_at: revealedAt }, 200);
});
