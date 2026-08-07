// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// Erste Edge Function des Projekts: stellt kurzlebige presigned PUT-URLs für
// S3 aus und bestätigt fertige Uploads. Sie ist der einzige Ort im System,
// der die S3-Zugangsdaten kennt.
//
// Nicht verhandelbare Regeln (Task-Brief §Sicherheitsregeln):
//   1. Ausschliesslich schreibende (PUT) URLs. Lesen bricht die Versiegelung
//      und kommt frühestens mit Phase 5, mit ganz anderen Bedingungen.
//   2. Schlüssel werden aus der `posts`-Zeile abgeleitet (erwarteteSchluessel
//      in ./keys.ts), nie aus dem Client-Body übernommen — sonst könnte
//      jemand eine Signatur für einen fremden Pfad erschleichen. Das gilt
//      auch rückwirkend: `confirm` schreibt dieselben abgeleiteten Schlüssel
//      in `posts.storage_key`/`thumb_key`, statt den ungeprüften Client-Wert
//      (aus dem Insert) stehen zu lassen — sonst würde eine künftige
//      Lese-URL-Function (Phase 5) genau diesen Client-Pfad signieren.
//   3. Identität kommt ausschliesslich aus dem JWT im Authorization-Header
//      (supabaseAdmin.auth.getUser(token)), nie aus dem Body. Signiert wird
//      nur, wenn die aufrufende Person Autor des Posts UND Mitglied der
//      Reise ist.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1';
import { erwarteteSchluessel } from './keys.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const S3_ENDPOINT = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/$/, '');
const S3_REGION = Deno.env.get('S3_REGION') ?? '';
const S3_BUCKET = Deno.env.get('S3_BUCKET') ?? '';
const S3_ACCESS_KEY = Deno.env.get('S3_ACCESS_KEY') ?? '';
const S3_SECRET_KEY = Deno.env.get('S3_SECRET_KEY') ?? '';

// Presigned PUT-URLs bleiben knapp gültig — sie sollen genau einen
// Upload-Versuch abdecken, keine Vorratshaltung von Signaturen.
const URL_GUELTIGKEIT_SEKUNDEN = 600;

type PostZeile = {
  id: string;
  trip_id: string;
  author_id: string;
  type: 'photo' | 'video';
};

type AnfrageBody = { aktion?: unknown; post_id?: unknown };

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

function s3Client(): AwsClient {
  return new AwsClient({
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
    service: 's3',
  });
}

function s3ObjektUrl(key: string): URL {
  return new URL(`${S3_ENDPOINT}/${S3_BUCKET}/${key}`);
}

async function presignedPutUrl(aws: AwsClient, key: string): Promise<string> {
  const url = s3ObjektUrl(key);
  url.searchParams.set('X-Amz-Expires', String(URL_GUELTIGKEIT_SEKUNDEN));
  const signed = await aws.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });
  return signed.url;
}

// Liefert die Objektgrösse in Bytes, oder null, wenn das Objekt (noch) nicht
// existiert oder keine verwertbare Content-Length trägt. Ein blosses "HEAD
// war ok" reicht nicht: ein 0-Byte- oder abgebrochener Upload würde sonst
// als vollständig durchgehen — und danach gibt es keinen Weg zurück, der
// Queue-Job ist weg. Darum zählt erst eine Grösse > 0 als Nachweis.
async function objektGroesse(aws: AwsClient, key: string): Promise<number | null> {
  const signed = await aws.sign(s3ObjektUrl(key).toString(), {
    method: 'HEAD',
    aws: { signQuery: true },
  });
  const antwort = await fetch(signed);
  if (!antwort.ok) return null;
  const contentLength = antwort.headers.get('content-length');
  if (contentLength === null) return null;
  const groesse = Number(contentLength);
  return Number.isFinite(groesse) ? groesse : null;
}

function s3KonfigVollstaendig(): boolean {
  return Boolean(S3_ENDPOINT && S3_REGION && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return fehler('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('media-urls: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    return fehler('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Identität kommt ausschliesslich aus dem JWT im Authorization-Header —
  // nie aus dem Body. Der Body darf post_id enthalten, aber keine Identität.
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

  const aktion = body.aktion;
  const postId = body.post_id;
  if (typeof postId !== 'string' || postId.length === 0) {
    return fehler('post_id fehlt.', 400);
  }
  if (aktion !== 'sign' && aktion !== 'confirm') {
    return fehler('Unbekannte Aktion.', 400);
  }

  // Die Function glaubt dem Client keinen Pfad: Sie liest die posts-Zeile
  // selbst und leitet den erwarteten Schlüssel daraus ab (siehe keys.ts).
  const { data: post, error: postError } = await supabaseAdmin
    .from('posts')
    .select('id, trip_id, author_id, type')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    console.error('media-urls: posts-Select fehlgeschlagen', postError);
    return fehler('Moment konnte nicht geladen werden.', 500);
  }
  if (!post) {
    return fehler('Moment nicht gefunden.', 404);
  }
  const postZeile = post as PostZeile;
  if (postZeile.author_id !== anfragendeId) {
    return fehler('Kein Zugriff auf diesen Moment.', 403);
  }

  // is_trip_member() beantwortet seit der Oracle-Guard-Migration nur noch
  // Fragen über den Aufrufer selbst (auth.uid() = p_user_id) und liefert für
  // service_role-Aufrufe deshalb immer false (kein auth.uid()-Claim) —
  // absichtlich, siehe supabase/migrations/20260803090700_membership_oracle_guard.sql.
  // Edge Functions lesen trip_members darum direkt (RLS via Service-Role umgangen).
  const { data: mitgliedschaft, error: mitgliedError } = await supabaseAdmin
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', postZeile.trip_id)
    .eq('user_id', anfragendeId)
    .maybeSingle();
  if (mitgliedError || !mitgliedschaft) {
    return fehler('Kein Zugriff auf diesen Moment.', 403);
  }

  const { storage_key, thumb_key } = erwarteteSchluessel(
    postZeile.trip_id,
    postZeile.id,
    postZeile.type,
  );

  if (!s3KonfigVollstaendig()) {
    console.error('media-urls: S3-Umgebungsvariablen unvollständig.');
    return fehler('Server nicht konfiguriert.', 500);
  }

  if (aktion === 'sign') {
    try {
      const aws = s3Client();
      const [medium_url, thumb_url] = await Promise.all([
        presignedPutUrl(aws, storage_key),
        presignedPutUrl(aws, thumb_key),
      ]);
      return json({ medium_url, thumb_url }, 200);
    } catch (err) {
      console.error('media-urls: Signieren fehlgeschlagen', err);
      return fehler('Signieren fehlgeschlagen.', 502);
    }
  }

  // aktion === 'confirm': erst per HEAD nachweisen (inkl. Grösse > 0), dann
  // upload_status setzen.
  let mediumGroesse: number | null;
  let thumbGroesse: number | null;
  try {
    const aws = s3Client();
    [mediumGroesse, thumbGroesse] = await Promise.all([
      objektGroesse(aws, storage_key),
      objektGroesse(aws, thumb_key),
    ]);
  } catch (err) {
    console.error('media-urls: Prüfung fehlgeschlagen', err);
    return fehler('Prüfung fehlgeschlagen.', 502);
  }

  if (mediumGroesse === null || mediumGroesse <= 0 || thumbGroesse === null || thumbGroesse <= 0) {
    return fehler('Upload ist noch nicht vollständig.', 409);
  }

  // Nur die Service-Role darf upload_status setzen — authenticated hat seit
  // Phase 1 kein Update-Recht auf posts (supabase/migrations/20260803090300_sealing_rls.sql).
  // storage_key/thumb_key werden hier bewusst MIT gesetzt, nicht nur der
  // Status: die Spalten stammen ursprünglich vom Client (er braucht die
  // Schlüssel vor dem Insert, siehe medien.ts) und sind ungeprüft. Erst mit
  // diesem Schreibvorgang benennt die Zeile garantiert das Objekt, das
  // tatsächlich unter dem server-abgeleiteten Pfad liegt — sonst würde eine
  // spätere Lese-URL-Function (Phase 5) den ungeprüften Client-Pfad aus
  // storage_key signieren und genau die Lücke wiedereröffnen, die diese
  // Function beim Signieren schliesst.
  const { error: updateError } = await supabaseAdmin
    .from('posts')
    .update({ upload_status: 'uploaded', storage_key, thumb_key })
    .eq('id', postZeile.id);

  if (updateError) {
    console.error('media-urls: Bestätigen fehlgeschlagen', updateError);
    return fehler('Bestätigen fehlgeschlagen.', 500);
  }

  return json({ ok: true }, 200);
});
