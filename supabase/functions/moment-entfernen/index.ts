// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// moment-entfernen: einen einzelnen Moment löschen, MITSAMT seinen Medien.
//
// ---------------------------------------------------------------------------
// Warum es diese Function gibt
// ---------------------------------------------------------------------------
// Bis hierher löschte der Client die posts-Zeile direkt
// (`supabase.from('posts').delete()`, features/recap/meldenApi.ts). Die Zeile
// war damit weg, die beiden Objekte im Speicher blieben liegen: das Medium und
// sein Thumbnail. Niemand kennt ihren Pfad danach noch, denn er leitet sich aus
// der gelöschten Zeile ab. Sie liegen für immer im Bucket und kosten Geld,
// unsichtbar. Bei einer Moderation ist es zusätzlich das Gegenteil dessen, was
// die Handlung verspricht: der gemeldete Inhalt verschwindet aus der App, aber
// nicht aus dem Speicher.
//
// Ein Client kann das nicht selbst: Objekte löschen verlangt die
// S3-Zugangsdaten, und die gehören nie in eine App.
//
// ---------------------------------------------------------------------------
// Reihenfolge: Speicher zuerst, Datenbank danach
// ---------------------------------------------------------------------------
// Dieselbe Reihenfolge und dieselbe Begründung wie in konto-loeschen/ablauf.ts:
// Ein Objekt ohne Datenbankzeile ist Müll, den niemand mehr findet. Eine Zeile
// ohne Objekt ist eine Kachel, die ins Leere lädt, aber ein zweiter Versuch
// räumt sie ab (das Löschen im Speicher ist idempotent, ein bereits gelöschter
// Schlüssel ist kein Fehler). Von den beiden Fehlerrichtungen ist die erste die
// schlimmere, weil sie unsichtbar und unumkehrbar ist.
//
// Bei einer Moderation kommt ein zweites Argument dazu: bricht der Lauf nach
// dem Speicherschritt ab, ist der gemeldete Inhalt bereits nicht mehr abrufbar.
// Das ist der bessere Zwischenzustand.
//
// Und daraus folgt die Prüfung VOR dem Speicherschritt (zugriff.ts): käme die
// Berechtigung erst beim DELETE zur Sprache, liesse sich mit einer fremden
// post_id ein fremder Moment unbrauchbar machen.
//
// ---------------------------------------------------------------------------
// Die Pfade werden ABGELEITET, nie aus der Zeile übernommen
// ---------------------------------------------------------------------------
// `posts.storage_key` ist client-geschrieben (siehe media-urls/keys.ts). Ein
// aus der Spalte übernommener Pfad machte diese Function zu einem Werkzeug,
// mit dem sich beliebige fremde Objekte löschen lassen: wer beim Einsenden
// einen fremden Pfad in die Spalte schreibt und danach den eigenen Moment
// entfernt, nimmt das fremde Objekt mit. `erwarteteSchluessel` leitet aus
// trip_id, post_id und Typ ab, genau wie media-urls, share-link und
// konto-loeschen.
import { AwsClient } from 'npm:aws4fetch@1';
import { createClient } from '@supabase/supabase-js';
import { erwarteteSchluessel } from '../media-urls/keys.ts';
import { erstelleS3Loescher } from '../konto-loeschen/store.ts';
import { darfEntfernen, type PostZeile, type TripZeile } from './zugriff.ts';
import { erstelleFehlermelder } from '../_shared/fehlermelder.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Dieselben fünf S3-Variablen wie media-urls, share-link und konto-loeschen.
const S3_ENDPOINT = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/$/, '');
const S3_REGION = Deno.env.get('S3_REGION') ?? '';
const S3_BUCKET = Deno.env.get('S3_BUCKET') ?? '';
const S3_ACCESS_KEY = Deno.env.get('S3_ACCESS_KEY') ?? '';
const S3_SECRET_KEY = Deno.env.get('S3_SECRET_KEY') ?? '';

const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const melde = erstelleFehlermelder(SENTRY_DSN, 'moment-entfernen');

// EINE Ablehnung für «gibt es nicht» und für «darfst du nicht», byte-gleich.
// Dieselbe Haltung wie bei den vier Ablehnungen von share-link/aufloesen: eine
// Function, die zwischen den beiden unterscheidet, beantwortet die Frage «gibt
// es diesen Moment?» für jede beliebige id, und das ist eine Auskunft, die
// niemandem zusteht, der ihn nicht sehen darf.
const ABLEHNUNG = 'Dieser Moment lässt sich nicht entfernen.';

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fehler(nachricht: string, status: number): Response {
  return json({ fehler: nachricht }, status);
}

function s3KonfigVollstaendig(): boolean {
  return Boolean(S3_ENDPOINT && S3_REGION && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

type AnfrageBody = { post_id?: unknown };

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return fehler('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('moment-entfernen: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    await melde(new Error('moment-entfernen: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.'));
    return fehler('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Die Identität kommt aus dem JWT, nie aus dem Body. `verify_jwt = true` am
  // Gateway ist die erste Hürde, das hier die zweite: der Anon-Key allein
  // reicht dem Gateway, dieser Prüfung nicht.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return fehler('Nicht angemeldet.', 401);

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) return fehler('Nicht angemeldet.', 401);
  const anfragendeId = userData.user.id;

  let body: AnfrageBody = {};
  try {
    body = (await req.json()) as AnfrageBody;
  } catch {
    return fehler('Ungültige Anfrage.', 400);
  }
  const postId = typeof body.post_id === 'string' ? body.post_id.trim() : '';
  if (!postId) return fehler('post_id fehlt.', 400);

  if (!s3KonfigVollstaendig()) {
    console.error('moment-entfernen: S3-Umgebungsvariablen unvollständig.');
    await melde(new Error('moment-entfernen: S3-Umgebungsvariablen unvollständig.'), {
      user_id: anfragendeId,
    });
    return fehler('Server nicht konfiguriert.', 500);
  }

  // Mit dem ADMIN-Client gelesen, nicht mit dem der Person: die Regel steht in
  // zugriff.ts und wird hier angewandt, RLS auf SELECT beantwortet eine andere
  // Frage (wer den Moment SEHEN darf) und deckt sich nicht mit der, um die es
  // geht. Der Admin-Client sieht alles, die Regel muss deshalb vollständig
  // sein, und genau deshalb steht sie als reine Funktion nebenan.
  const { data: post, error: postError } = await supabaseAdmin
    .from('posts')
    .select('id, trip_id, author_id, type, media_ext')
    .eq('id', postId)
    .maybeSingle<PostZeile>();
  if (postError) {
    console.error('moment-entfernen: posts-Select fehlgeschlagen', postError);
    await melde(postError, { user_id: anfragendeId });
    return fehler('Der Moment konnte nicht geprüft werden.', 500);
  }
  // Kein eigener 404: siehe ABLEHNUNG.
  if (!post) return fehler(ABLEHNUNG, 403);

  const { data: trip, error: tripError } = await supabaseAdmin
    .from('trips')
    .select('status, owner_id')
    .eq('id', post.trip_id)
    .maybeSingle<TripZeile>();
  if (tripError) {
    console.error('moment-entfernen: trips-Select fehlgeschlagen', tripError);
    await melde(tripError, { user_id: anfragendeId });
    return fehler('Der Moment konnte nicht geprüft werden.', 500);
  }
  if (!trip || !darfEntfernen(post, trip, anfragendeId)) {
    return fehler(ABLEHNUNG, 403);
  }

  // Schritt 1: der Speicher. Beide Objekte, abgeleitet, nie aus der Zeile.
  const { storage_key, thumb_key } = erwarteteSchluessel(
    post.trip_id,
    post.id,
    post.type,
    post.media_ext,
  );
  const loescheEins = erstelleS3Loescher(
    new AwsClient({
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
      region: S3_REGION,
      service: 's3',
    }),
    S3_ENDPOINT,
    S3_BUCKET,
  );
  for (const schluessel of [storage_key, thumb_key]) {
    const ergebnis = await loescheEins(schluessel);
    if (!ergebnis.ok) {
      // Die Datenbank bleibt unangetastet. Ein zweiter Versuch läuft sauber
      // durch, weil ein bereits gelöschter Schlüssel kein Fehler ist.
      console.error('moment-entfernen: S3-DELETE fehlgeschlagen', ergebnis.status);
      await melde(ergebnis.fehler ?? new Error(`S3 DELETE: HTTP ${ergebnis.status}`), {
        user_id: anfragendeId,
      });
      return fehler('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.', 502);
    }
  }

  // Schritt 2: die Zeile. Reaktionen, Kommentare und Meldungen dazu hängen per
  // Fremdschlüssel mit ON DELETE CASCADE daran und gehen mit.
  const { error: deleteError } = await supabaseAdmin.from('posts').delete().eq('id', postId);
  if (deleteError) {
    console.error('moment-entfernen: posts-Delete fehlgeschlagen', deleteError);
    await melde(deleteError, { user_id: anfragendeId });
    return fehler('Der Moment konnte nicht entfernt werden. Probier es gleich nochmal.', 500);
  }

  return json({ entfernt: true }, 200);
});
