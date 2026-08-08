// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// Erste Edge Function des Projekts: stellt kurzlebige presigned PUT-URLs für
// S3 aus, bestätigt fertige Uploads und gibt seit Phase 5 Lese-URLs für den
// Recap heraus. Sie ist der einzige Ort im System, der die S3-Zugangsdaten
// kennt.
//
// Nicht verhandelbare Regeln (Task-Brief §Sicherheitsregeln):
//   1. Schreibende (PUT) URLs für den Upload, lesende (GET) URLs nur über die
//      Aktion `lesen` — und die ist der Ort, an dem die Versiegelung hängt.
//      Bis Phase 5 war sie dadurch geschützt, dass es überhaupt keinen
//      Leseweg gab; jetzt schützt sie eine Prüfkette, die genauso hart sein
//      muss: Reise existiert → Status ist 'revealed' oder 'archived' →
//      aufrufende Person ist Mitglied. Erst danach entsteht eine Signatur.
//      Vor dem Reveal bekommt niemand eine Lese-URL, auch nicht die Autorin
//      des Moments (dieselbe Regel wie posts_select_revealed_members in
//      supabase/migrations/20260806120100_counts_and_archived.sql — nur dass
//      die Function mit Service-Role an RLS vorbeiliest und die Prüfung
//      deshalb selbst führen muss).
//   2. Schlüssel werden aus der `posts`-Zeile abgeleitet (erwarteteSchluessel
//      in ./keys.ts), nie aus dem Client-Body übernommen — sonst könnte
//      jemand eine Signatur für einen fremden Pfad erschleichen. Auch die
//      Container-Endung (iOS nimmt .mov auf, Android .mp4) kommt aus der
//      Zeile — Spalte `media_ext`, per Check-Constraint auf eine geschlossene
//      Liste beschränkt und nach dem Insert unveränderlich. Das gilt
//      auch rückwirkend: `confirm` schreibt dieselben abgeleiteten Schlüssel
//      in `posts.storage_key`/`thumb_key`, statt den ungeprüften Client-Wert
//      (aus dem Insert) stehen zu lassen. `lesen` leitet aus demselben Grund
//      ebenfalls ab, statt storage_key zu übernehmen: keine der drei
//      Aktionen signiert je einen Pfad, den ein Client geschrieben hat.
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
// Upload-Versuch abdecken, keine Vorratshaltung von Signaturen. Der Client
// holt sich unmittelbar vor dem Hochladen eine frische URL; scheitert der
// Upload, wiederholt der Queue-Job den ganzen Schritt inklusive `sign`.
const UPLOAD_URL_GUELTIGKEIT_SEKUNDEN = 600;

// Lese-URLs brauchen deutlich mehr Luft: Eine Antwort deckt eine ganze
// Filmrolle ab, der Player lädt im Voraus, pausiert, springt zurück, und das
// Telefon wandert zwischendurch in die Tasche. Mit 600 s müsste die App
// mitten im Recap neu signieren lassen. Eine Stunde überdauert einen
// Durchlauf, ohne dass eine weitergereichte URL zu einem dauerhaften Zugang
// wird: nach Ablauf führt der einzige Weg zurück durch die Prüfkette dieser
// Function — und die fragt Status und Mitgliedschaft neu.
const LESE_URL_GUELTIGKEIT_SEKUNDEN = 3600;

// Seitengrösse beim Einsammeln der Momente. Orientiert an max_rows aus
// supabase/config.toml (1000): grösser hat keine Wirkung, weil PostgREST dort
// ohnehin kappt, kleiner kostet nur Round-Trips. Die Richtigkeit der Schleife
// hängt aber NICHT daran, dass die beiden Zahlen gleich sind — siehe dort.
//
// Zur Grössenordnung, damit sie jemand bewusst entschieden hat: Eine Reise mit
// 1000 fertigen Momenten bedeutet 2000 Signaturen und rund ein Megabyte JSON
// pro Aufruf. Das ist ungefähr die Obergrenze dessen, was diese Antwort in
// einem Stück tragen sollte. Wird das je der Normalfall, gehört ein Fenster in
// die Aktion (Task 6 hält den Vorrat auf Client-Seite ohnehin schon) — aber
// ein Fenster ist eine Entscheidung mit einem Parameter und einer Anzeige für
// die App, kein stiller Abschnitt bei genau 1000.
const POSTS_SEITENGROESSE = 1000;

type TripStatus = 'active' | 'revealed' | 'archived';

type TripZeile = {
  id: string;
  status: TripStatus;
};

type PostZeile = {
  id: string;
  trip_id: string;
  author_id: string;
  type: 'photo' | 'video';
  // Die tatsächliche Container-Endung der Aufnahme (iOS: mov, Android: mp4).
  // Kommt aus der Zeile, nie aus dem Anfrage-Body — siehe keys.ts.
  media_ext: string | null;
};

// Zeile für die Lese-Antwort. storage_key ist in der Tabelle `not null`,
// thumb_key nicht (supabase/migrations/20260803090100_content_tables.sql);
// thumb_key dient hier deshalb als Ja/Nein, nicht als Pfad.
type MedienZeile = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
  storage_key: string;
  thumb_key: string | null;
};

// thumb_url ist optional, weil thumb_key null sein kann — siehe `lesen`.
type MedienEintrag = {
  post_id: string;
  medium_url: string;
  thumb_url?: string;
};

// `sign`/`confirm` arbeiten auf einem Moment (post_id), `lesen` auf einer
// ganzen Reise (trip_id) — absichtlich verschiedene Parameter.
type AnfrageBody = { aktion?: unknown; post_id?: unknown; trip_id?: unknown };

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
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_GUELTIGKEIT_SEKUNDEN));
  const signed = await aws.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });
  return signed.url;
}

// Die Methode ist Teil der Signatur: SigV4 setzt sie als erste Zeile des
// Canonical Request, dessen SHA-256 in den String-to-Sign eingeht. Eine hier
// erzeugte URL taugt darum nur zum GET — ein PUT auf dieselbe URL berechnet
// serverseitig einen anderen Canonical Request und scheitert mit
// SignatureDoesNotMatch. Eine Lese-URL kann also nie zum Überschreiben
// fremder Momente umgewidmet werden (Beleg: Fall 4 in lesen_test.ts).
async function presignedGetUrl(aws: AwsClient, key: string): Promise<string> {
  const url = s3ObjektUrl(key);
  url.searchParams.set('X-Amz-Expires', String(LESE_URL_GUELTIGKEIT_SEKUNDEN));
  const signed = await aws.sign(url.toString(), {
    method: 'GET',
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

  // `lesen` zweigt hier ab, VOR der post_id-Prüfung: es arbeitet auf einer
  // trip_id, nicht auf einem Moment. Dadurch bleibt der Weg von `sign` und
  // `confirm` darunter unverändert — inklusive der Reihenfolge seiner
  // Prüfungen und der Fehlertexte.
  if (aktion === 'lesen') {
    const tripId = body.trip_id;
    if (typeof tripId !== 'string' || tripId.length === 0) {
      return fehler('trip_id fehlt.', 400);
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .select('id, status')
      .eq('id', tripId)
      .maybeSingle();

    if (tripError) {
      console.error('media-urls: trips-Select fehlgeschlagen', tripError);
      return fehler('Reise konnte nicht geladen werden.', 500);
    }
    if (!trip) {
      return fehler('Reise nicht gefunden.', 404);
    }
    const tripZeile = trip as TripZeile;

    // Die Versiegelung. 'active' heisst: noch niemand sieht etwas, auch nicht
    // die Autorin ihres eigenen Moments — das ist der ganze Punkt des
    // Produkts, nicht eine Bequemlichkeit der Oberfläche. 'archived' bleibt
    // lesbar: weggelegt ist nicht zugesperrt (dieselbe Menge wie in
    // posts_select_revealed_members).
    if (tripZeile.status !== 'revealed' && tripZeile.status !== 'archived') {
      return fehler('Diese Reise ist noch versiegelt.', 403);
    }

    // is_trip_member() ist hier unbrauchbar — siehe die ausführliche
    // Begründung weiter unten im sign/confirm-Zweig: Der Oracle-Guard
    // (20260803090700) liefert für Service-Role immer false. Also direkt
    // lesen. Wer aus der Reise entfernt wurde, hat keine trip_members-Zeile
    // mehr und fällt damit ab hier heraus, auch wenn er die trip_id kennt.
    const { data: mitgliedschaft, error: mitgliedError } = await supabaseAdmin
      .from('trip_members')
      .select('user_id')
      .eq('trip_id', tripZeile.id)
      .eq('user_id', anfragendeId)
      .maybeSingle();
    if (mitgliedError) {
      console.error('media-urls: trip_members-Select fehlgeschlagen', mitgliedError);
      return fehler('Kein Zugriff auf diese Reise.', 403);
    }
    if (!mitgliedschaft) {
      return fehler('Kein Zugriff auf diese Reise.', 403);
    }

    // Nur fertige Uploads: ein Moment mit upload_status 'pending' hat kein
    // vollständiges Objekt im Speicher, eine URL darauf wäre ein 404 in der
    // Filmrolle. Reihenfolge nach captured_at aufsteigend, id als zweites
    // Kriterium für eine stabile Sortierung bei gleicher Zeit (Global
    // Constraint: nie nach created_at).
    //
    // Geblättert, und das ist keine Vorsicht auf Vorrat: PostgREST kappt jede
    // Antwort bei max_rows (supabase/config.toml, 1000) — ohne Fehler, ohne
    // Hinweis im Ergebnis, ohne dass supabase-js etwas davon merkt. Ein
    // einzelner Select würde einer Reise mit mehr als 1000 Momenten
    // stillschweigend den Rest des Recaps abschneiden, ausgerechnet bei der
    // Antwort, auf die das ganze Produkt hinausläuft. Es wird darum gezählt
    // und geblättert, bis eine Seite nicht mehr voll ist.
    //
    // `type` und `media_ext` kommen mit, weil der Pfad hier NEU abgeleitet
    // wird statt aus storage_key übernommen — siehe unten.
    const postZeilen: MedienZeile[] = [];
    let gezaehlt: number | null = null;
    for (;;) {
      // Der Versatz ist immer «so viele habe ich schon». Bewusst nicht
      // Seitennummer × Seitengrösse: dann hinge die Richtigkeit daran, dass
      // eine volle Seite auch wirklich POSTS_SEITENGROESSE Zeilen bringt —
      // also daran, dass max_rows in config.toml genau diesen Wert hat. Wird
      // es dort je kleiner gesetzt, blättert diese Schleife trotzdem korrekt
      // weiter, statt bei der ersten kürzeren Seite abzubrechen.
      const von = postZeilen.length;
      const { data, error: postsError, count } = await supabaseAdmin
        .from('posts')
        // Gezählt wird nur beim ersten Durchgang: der count ist eine eigene
        // Aggregation, und ihn pro Seite zu wiederholen kostet ohne Nutzen.
        .select('id, type, media_ext, storage_key, thumb_key', gezaehlt === null ? { count: 'exact' } : undefined)
        .eq('trip_id', tripZeile.id)
        .eq('upload_status', 'uploaded')
        .order('captured_at', { ascending: true })
        .order('id', { ascending: true })
        .range(von, von + POSTS_SEITENGROESSE - 1);

      if (postsError) {
        console.error('media-urls: posts-Select für lesen fehlgeschlagen', postsError);
        return fehler('Momente konnten nicht geladen werden.', 500);
      }
      if (gezaehlt === null) gezaehlt = count ?? null;

      const seitenZeilen = (data ?? []) as MedienZeile[];
      postZeilen.push(...seitenZeilen);

      // Leere Seite: mehr gibt es nicht. Diese Bedingung beendet die Schleife
      // auch dann, wenn die Zählung fehlt — und sie terminiert sicher, weil
      // jeder andere Durchgang den Versatz um mindestens eine Zeile schiebt.
      if (seitenZeilen.length === 0) break;
      // Vollzählig laut Zählung des ersten Durchgangs. Spart den sonst
      // nötigen letzten, leeren Abruf.
      if (gezaehlt !== null && postZeilen.length >= gezaehlt) break;
    }

    // Quergeprüft gegen die Zählung: Kommen am Ende weniger Zeilen zusammen,
    // als die erste Seite versprochen hat, ist unterwegs etwas verlorengegangen
    // — etwa ein Nachzügler-Insert, der die Seitengrenzen verschoben hat. Die
    // Antwort geht trotzdem raus (ein unvollständiger Recap ist besser als
    // gar keiner), aber die Lücke steht im Log statt niemandem aufzufallen.
    if (gezaehlt !== null && postZeilen.length < gezaehlt) {
      console.error('media-urls: lesen hat weniger Momente eingesammelt als gezählt.', {
        trip_id: tripZeile.id,
        gezaehlt,
        eingesammelt: postZeilen.length,
      });
    }

    if (!s3KonfigVollstaendig()) {
      console.error('media-urls: S3-Umgebungsvariablen unvollständig.');
      return fehler('Server nicht konfiguriert.', 500);
    }

    // gueltig_bis wird VOR dem Signieren gestempelt. Jede Signatur läuft ab
    // ihrem eigenen X-Amz-Date, das nie früher liegt als dieser Moment — der
    // Wert ist damit konservativ (nie später als die echte Ablaufzeit), und
    // die App erneuert lieber eine Sekunde zu früh als eine zu spät.
    const gueltigBis = new Date(Date.now() + LESE_URL_GUELTIGKEIT_SEKUNDEN * 1000).toISOString();

    let medien: MedienEintrag[];
    try {
      const aws = s3Client();
      const eintraege = await Promise.all(
        postZeilen.map(async (zeile): Promise<MedienEintrag | null> => {
          // Der signierte Pfad wird abgeleitet (keys.ts), nicht aus
          // storage_key übernommen. Beide sind heute identisch: `confirm`
          // schreibt genau diese abgeleiteten Werte in die Zeile, und
          // upload_status kann kein Client setzen (Spalten-Grant in
          // supabase/migrations/20260803090600_role_hardening.sql, dazu kein
          // UPDATE-Recht auf posts). Beides ist in pgTAP festgenagelt:
          // supabase/tests/07_role_hardening_test.sql (Insert mit
          // upload_status → 42501) und supabase/tests/12_upload_status_test.sql
          // (Update auf upload_status → 42501). Eine Zeile mit
          // upload_status='uploaded' trägt deshalb server-abgeleitete
          // Schlüssel — zusätzlich belegt in confirm_integration_test.ts.
          //
          // Trotzdem wird hier abgeleitet, denn die Zusicherung wird
          // anderswo gehalten: von einem Spalten-Grant, einem fehlenden
          // UPDATE-Recht und den beiden pgTAP-Dateien, die sie bewachen.
          // Eine Migration, die den Grant für ein späteres Feature lockert,
          // lässt zwar jene Tests fallen — aber wer sie dann anpasst, sieht
          // dieser Function nicht an, dass er ihr gerade die Grundlage
          // entzieht. Ein Import-Job mit Service-Role umginge sie ganz.
          // storage_key ist der EINZIGE Bestandteil des Pfades, den je ein
          // Client geschrieben hat; ihn nicht zu benutzen macht den Leseweg
          // unabhängig von allem ausserhalb dieser Datei. tripZeile.id statt
          // der Spalte trip_id: nach dieser Reise wurde gefiltert, ein
          // Objekt einer anderen Reise kann so gar nicht erst adressiert
          // werden.
          const abgeleitet = erwarteteSchluessel(
            tripZeile.id,
            zeile.id,
            zeile.type,
            zeile.media_ext,
          );

          // Weicht der gespeicherte Pfad von der Ableitung ab, fällt der
          // Eintrag heraus — samt Log. Zwei Dinge können das auslösen, und
          // für beide ist Auslassen die richtige Antwort: eine
          // untergeschobene Zeile (die darf erst recht keine URL bekommen)
          // oder eine Zeile aus einem anderen Schlüsselschema (dann liegen
          // die Bytes woanders, und die abgeleitete URL zeigte ins Nichts —
          // eine kaputte Kachel statt einer ehrlichen Lücke).
          //
          // Dass hier ausgelassen und nicht nur geloggt wird, hat einen
          // zweiten Grund: Ein Alarm, der im Normalbetrieb mitläuft, wird
          // gelernt zu überlesen, und ein echter Treffer geht darin unter.
          // Der Normalbetrieb muss deshalb still sein — supabase/seed.sql
          // schreibt seine Schlüssel seit Phase 5 im selben Schema.
          if (zeile.storage_key !== abgeleitet.storage_key) {
            console.error(
              'media-urls: storage_key weicht vom abgeleiteten Pfad ab, Moment wird ausgelassen.',
              { post_id: zeile.id, gespeichert: zeile.storage_key, abgeleitet: abgeleitet.storage_key },
            );
            return null;
          }

          const eintrag: MedienEintrag = {
            post_id: zeile.id,
            medium_url: await presignedGetUrl(aws, abgeleitet.storage_key),
          };
          // thumb_key ist nullable und wird hier nur als Ja/Nein gelesen: ob
          // es überhaupt ein Thumbnail gibt. Ohne diese Abfrage entstünde bei
          // null eine Signatur auf den Pfad ".../null" — eine gültige URL auf
          // ein Objekt, das es nicht gibt. Der Eintrag lässt thumb_url dann
          // weg, damit die App den Fall sieht statt ihn zu laden. Der Pfad
          // kommt auch hier aus der Ableitung und nie aus der Spalte: ein
          // Thumbnail ist der Inhalt eines Moments in klein, für die
          // Versiegelung also nichts Geringeres als das Medium selbst.
          if (zeile.thumb_key) {
            eintrag.thumb_url = await presignedGetUrl(aws, abgeleitet.thumb_key);
          }
          return eintrag;
        }),
      );
      medien = eintraege.filter((eintrag): eintrag is MedienEintrag => eintrag !== null);
    } catch (err) {
      console.error('media-urls: Signieren der Lese-URLs fehlgeschlagen', err);
      return fehler('Signieren fehlgeschlagen.', 502);
    }

    return json({ medien, gueltig_bis: gueltigBis }, 200);
  }

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
    .select('id, trip_id, author_id, type, media_ext')
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
    postZeile.media_ext,
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
  // tatsächlich unter dem server-abgeleiteten Pfad liegt. `lesen` verlässt
  // sich seit Phase 5 nicht mehr darauf — es leitet selbst ab —, aber die
  // Spalte bleibt damit die Wahrheit über den Ablageort, und der
  // Abgleich-Stolperdraht dort schlägt nur an, wenn wirklich etwas schief
  // ist.
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
