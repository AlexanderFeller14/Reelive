// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// share-link, der ZWEITE Leseweg auf Medien und der erste OHNE jede
// Anmeldung. Drei Aktionen:
//
//   erstellen  (JWT, Owner)  → legt eine share_links-Zeile an
//   widerrufen (JWT, Owner)  → setzt revoked = true
//   aufloesen  (ohne JWT)    → gibt heraus, was ein Aussenstehender sehen darf
//
// ---------------------------------------------------------------------------
// WARUM DIESE FUNCTION verify_jwt = false HAT, und was das nach sich zieht
// ---------------------------------------------------------------------------
// media-urls und reveal-trip stehen in supabase/config.toml mit
// `verify_jwt = true`: Ohne gültiges, korrekt signiertes JWT erreicht ein
// Aufruf sie gar nicht erst; das Gateway ist dort die erste von zwei Hürden.
//
// Hier geht das nicht. `aufloesen` ist der Weg, über den jemand OHNE Konto
// einen geteilten Recap anschaut, kein JWT, kein Anon-Key, nichts (Spec §4,
// W5: «Wer den Link hat, braucht kein Konto»). Das Gateway muss also
// durchlassen, und damit fällt die erste Hürde für ALLE drei Aktionen weg,
// nicht nur für die öffentliche.
//
// Daraus folgt zwingend: `erstellen` und `widerrufen` prüfen das JWT SELBST
// (supabaseAdmin.auth.getUser unten). Bei den anderen beiden Functions ist
// dieselbe Prüfung eine zweite Absicherung; hier ist sie die einzige. Wer sie
// entfernt oder hinter eine Bedingung stellt, macht `erstellen` für jeden
// Anonymen aufrufbar. Der Codepfad ist deshalb so gebaut, dass `aufloesen`
// oben abzweigt und ALLES darunter unbedingt durch die Identitätsprüfung
// läuft, nicht als if/else, in dem ein späterer Zweig sie versehentlich
// umgeht.
//
// ---------------------------------------------------------------------------
// Die Prüfkette von `aufloesen` liegt NICHT in dieser Datei
// ---------------------------------------------------------------------------
// Sie steht in aufloesung.ts als reine Funktion, zusammen mit dem Blättern und
// der Form der Antwort. Grund: ein Test mit `ignore: !stackBereit` ist auf
// einer Maschine ohne Docker von einem bestandenen Test nicht zu
// unterscheiden (der schwerste Befund des Phase-5-Reviews). Dieser Handler
// übersetzt nur HTTP: Methode, CORS, Konfiguration, Body, Identität, und das
// Ergebnis in eine Response.
//
// Ratenbegrenzung: Der Endpunkt ist öffentlich und nimmt einen 32-stelligen
// Hex-Token (2^128 Möglichkeiten). Raten ist dadurch sinnlos; eine eigene
// Begrenzung ist hier bewusst NICHT gebaut, sondern gehört beim ersten echten
// Deployment vor die Function (Supabase/Cloudflare), Spec §5.1.
import { AwsClient } from 'npm:aws4fetch@1';
import {
  baueAufloesungsAntwort,
  baueMedien,
  beurteileToken,
  LINK_ABLEHNUNG,
  sammleMomente,
  tokenLaengePlausibel,
} from './aufloesung.ts';
import { erstelleAdminClient, erstelleShareStore } from './store.ts';
import { berechneAblauf, beurteileErstellen, beurteileWiderrufen } from './verwaltung.ts';
import { erstelleFehlermelder } from '../_shared/fehlermelder.ts';
// Der Versand-Baustein liegt bei reveal-trip, weil er dort entstanden ist und
// nichts kennt ausser der Expo-Push-API. Ein zweiter waere eine zweite Stelle,
// an der Blockgroesse, Fehlerverhalten und das Aufraeumen abgemeldeter Tokens
// auseinanderlaufen koennten. Cross-Import zwischen Function-Ordnern ist im
// Projekt etabliert (konto-loeschen/ablauf.ts zieht media-urls/keys.ts).
import { sende } from '../reveal-trip/push.ts';
import { versendeTeilenPush } from './benachrichtigung.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const S3_ENDPOINT = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/$/, '');
const S3_REGION = Deno.env.get('S3_REGION') ?? '';
const S3_BUCKET = Deno.env.get('S3_BUCKET') ?? '';
const S3_ACCESS_KEY = Deno.env.get('S3_ACCESS_KEY') ?? '';
const S3_SECRET_KEY = Deno.env.get('S3_SECRET_KEY') ?? '';

// Spec §9 / Abschluss-Review Phase 6: ein schlanker Fehler-Melder über
// `fetch`, ohne Paket (Begründung und Privacy-Regeln in
// _shared/fehlermelder.ts). Ohne SENTRY_DSN ein vollständiger No-Op.
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const melde = erstelleFehlermelder(SENTRY_DSN, 'share-link');

// Basis des öffentlichen Web-Players (Route /teilen/[token], Plan Task 5).
// Absichtlich ohne Standardwert: ein geratener Standard ergäbe eine Antwort,
// die aussieht wie ein Link und keiner ist. Fehlt die Variable, sagt
// `erstellen` das laut (500 + Log) statt einen falschen Link auszugeben.
// Lokal in supabase/functions/.env, dokumentiert in .env.example.
const TEILEN_BASIS_URL = (Deno.env.get('TEILEN_BASIS_URL') ?? '').replace(/\/$/, '');

// Gültigkeit der ausgestellten Lese-URLs: eine Stunde, wie beim
// Mitglieder-Leseweg (media-urls, LESE_URL_GUELTIGKEIT_SEKUNDEN). Eine Antwort
// deckt eine ganze Filmrolle ab, der Player lädt vor, pausiert, springt
// zurück. Nach Ablauf führt der einzige Weg zurück durch die Prüfkette dieser
// Function, und die fragt revoked, expires_at und Reise-Status neu.
const LESE_URL_GUELTIGKEIT_SEKUNDEN = 3600;

type AnfrageBody = { aktion?: unknown; token?: unknown; trip_id?: unknown; gueltig_tage?: unknown };

// CORS: Der öffentliche Web-Player läuft im Browser auf einer ANDEREN Herkunft
// als die Supabase-Instanz, ohne diese Kopfzeilen scheitert `aufloesen` im
// Browser am Preflight, obwohl die Function selbst korrekt antwortet. Die
// anderen beiden Edge Functions brauchen das nicht: sie werden nur aus der
// nativen App aufgerufen, für die es keine Same-Origin-Regel gibt.
//
// `*` ist hier richtig und nicht bequem: `aufloesen` ist per Entwurf für jede
// Herkunft offen (der Token IST die Berechtigung). Es werden keine
// Anmeldedaten mitgeschickt (kein Access-Control-Allow-Credentials, keine
// Cookies), ein fremdes Skript kann damit nichts tun, was es nicht auch mit
// einem eigenen Server-Request könnte. `erstellen`/`widerrufen` bekommen
// dieselben Kopfzeilen: sie hängen an einem JWT im Authorization-Header, den
// ein Browser über Herkunftsgrenzen hinweg niemals von selbst mitschickt.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

// Fehlerantworten sind deutsche Klartexte für die App, nie rohe
// Provider-Fehler (die landen nur im Server-Log via console.error).
function fehler(nachricht: string, status: number): Response {
  return json({ fehler: nachricht }, status);
}

// Die eine Ablehnung, die `aufloesen` nach aussen kennt. Vier Gründe, eine
// Antwort, siehe LINK_ABLEHNUNG in aufloesung.ts.
function linkAblehnung(): Response {
  return fehler(LINK_ABLEHNUNG.nachricht, LINK_ABLEHNUNG.status);
}

function s3Client(): AwsClient {
  return new AwsClient({
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
    service: 's3',
  });
}

function s3KonfigVollstaendig(): boolean {
  return Boolean(S3_ENDPOINT && S3_REGION && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

// Die Methode ist Teil der Signatur: SigV4 setzt sie als erste Zeile des
// Canonical Request. Eine hier erzeugte URL taugt darum nur zum GET, ein PUT
// darauf scheitert mit SignatureDoesNotMatch. Für den öffentlichen Leseweg ist
// das die Zusicherung, dass ein geteilter Link nie zum Überschreiben fremder
// Momente umgewidmet werden kann.
async function presignedGetUrl(aws: AwsClient, key: string): Promise<string> {
  const url = new URL(`${S3_ENDPOINT}/${S3_BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(LESE_URL_GUELTIGKEIT_SEKUNDEN));
  const signed = await aws.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight. Muss VOR der Methodenprüfung stehen, der Browser schickt
  // OPTIONS, nicht POST.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return fehler('Nur POST erlaubt.', 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('share-link: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.');
    await melde(new Error('share-link: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen.'));
    return fehler('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const store = erstelleShareStore(supabaseAdmin);

  let body: AnfrageBody;
  try {
    body = await req.json();
  } catch {
    return fehler('Ungültige Anfrage.', 400);
  }

  const aktion = body.aktion;

  // =========================================================================
  // aufloesen, OHNE JWT. Der einzige Zweig, der keinen Authorization-Header
  // liest. Er zweigt hier ab, VOR jeder Identitätsprüfung, damit unten kein
  // Pfad an ihr vorbeiführen kann.
  // =========================================================================
  if (aktion === 'aufloesen') {
    const token = body.token;
    // Ein fehlendes Feld ist ein Programmierfehler des Aufrufers, kein
    // ungültiger Token, dafür darf es einen eigenen Text geben. Ein
    // VORHANDENER, aber unsinniger Token bekommt dagegen LINK_ABLEHNUNG wie
    // jeder unbekannte, sonst wäre die Formprüfung selbst ein Signal.
    if (typeof token !== 'string' || token.length === 0) {
      return fehler('token fehlt.', 400);
    }
    if (!tokenLaengePlausibel(token)) {
      return linkAblehnung();
    }

    const { zeile, reise, fehler: leseFehler } = await store.holeTokenMitReise(token);
    if (leseFehler) {
      console.error('share-link: share_links-Select fehlgeschlagen', leseFehler);
      // Der Token selbst geht NICHT in den Bericht, er ist die Berechtigung
      // für einen öffentlichen Recap, kein Diagnosewert (dieselbe Überlegung
      // wie bei signierten S3-URLs im Kopfkommentar von fehlermelder.ts).
      await melde(leseFehler);
      // Bewusst KEIN 500 mit eigenem Text: ein Datenbankfehler beim
      // Token-Lookup wäre sonst der einzige Weg, an dem sich ein Aufruf von
      // einem anderen unterscheiden liesse. Er wird geloggt und nach aussen
      // wie ein unbekannter Token behandelt.
      return linkAblehnung();
    }

    const urteil = beurteileToken(zeile, reise, new Date());
    if (!urteil.erlaubt) {
      return fehler(urteil.nachricht, urteil.status);
    }
    // Sicher: beurteileToken liefert erlaubt:true nur, wenn beide nicht null
    // waren (siehe dortige Zweige 1 und 4).
    const tokenZeile = zeile!;
    const reiseZeile = reise!;

    if (!s3KonfigVollstaendig()) {
      console.error('share-link: S3-Umgebungsvariablen unvollständig.');
      await melde(new Error('share-link: S3-Umgebungsvariablen unvollständig.'));
      return fehler('Server nicht konfiguriert.', 500);
    }

    // trip_id kommt aus der TOKEN-ZEILE, nie aus dem Anfrage-Body. Darin
    // steckt Versprechen W1: ein Share-Link zeigt nur die Reise, zu der er
    // gehört. Der Body dieser Aktion trägt ausser dem Token gar nichts, was
    // hier noch gelesen würde.
    const tripId = tokenZeile.trip_id;

    const { zeilen, verloren, fehler: postsFehler } = await sammleMomente(
      (von, mitZaehlung) => store.holeMomenteSeite(tripId, von, mitZaehlung),
    );
    if (postsFehler) {
      console.error('share-link: posts-Select fehlgeschlagen', postsFehler);
      await melde(postsFehler, { trip_id: tripId });
      return fehler('Momente konnten nicht geladen werden.', 500);
    }
    if (verloren > 0) {
      console.error('share-link: aufloesen hat weniger Momente eingesammelt als gezählt.', {
        trip_id: tripId,
        verloren,
      });
      await melde(new Error('share-link: aufloesen hat weniger Momente eingesammelt als gezählt.'), {
        trip_id: tripId,
        verloren,
      });
    }

    // gueltig_bis wird VOR dem Signieren gestempelt. Jede Signatur läuft ab
    // ihrem eigenen X-Amz-Date, das nie früher liegt als dieser Moment, der
    // Wert ist damit konservativ (nie später als die echte Ablaufzeit).
    const gueltigBis = new Date(Date.now() + LESE_URL_GUELTIGKEIT_SEKUNDEN * 1000).toISOString();

    let medien;
    let ausgelassen: number;
    try {
      const aws = s3Client();
      const ergebnis = await baueMedien(tripId, zeilen, (key) => presignedGetUrl(aws, key));
      medien = ergebnis.medien;
      ausgelassen = ergebnis.ausgelassen + verloren;
      // ergebnis.ausgelassen zählt NUR die storage_key-Abweichungen aus
      // baueMedien (aufloesung.ts), getrennt von `verloren`
      // (Paginierungsverlust, oben bereits eigens gemeldet). Ein
      // storage_key-Abgleich, der nicht passt, ist ein potenzielles
      // Tampering- oder Bug-Signal (siehe Kommentar in aufloesung.ts) und
      // bleibt bewusst ein einzelner, aggregierter Bericht statt einem pro
      // Moment.
      if (ergebnis.ausgelassen > 0) {
        await melde(
          new Error('share-link: öffentliche Momente wegen abweichendem Pfad ausgelassen.'),
          { trip_id: tripId, anzahl: ergebnis.ausgelassen },
        );
      }
    } catch (err) {
      console.error('share-link: Signieren der Lese-URLs fehlgeschlagen', err);
      await melde(err, { trip_id: tripId });
      return fehler('Signieren fehlgeschlagen.', 502);
    }

    return json(baueAufloesungsAntwort(reiseZeile, medien, gueltigBis, ausgelassen), 200);
  }

  // =========================================================================
  // Ab hier: nur mit Anmeldung. Weil verify_jwt = false ist, ist DIESE Prüfung
  // die einzige, am Gateway kommt jeder durch. Sie steht deshalb VOR der
  // Aktionsunterscheidung: ein neuer Zweig, den jemand später darunter
  // einhängt, ist automatisch geschützt.
  // =========================================================================
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return fehler('Nicht angemeldet.', 401);
  }

  // getUser ist die Autorität, nicht der Inhalt des Tokens: Es fragt GoTrue,
  // ob dieses JWT zu einer echten Person gehört. Ein Anon- oder
  // Service-Role-Schlüssel trägt kein `sub` und scheitert hier, obwohl beides
  // syntaktisch gültige, korrekt signierte JWTs sind. Genau dieser Unterschied
  // trägt die Function, seit das Gateway nicht mehr vorprüft.
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return fehler('Nicht angemeldet.', 401);
  }
  const anfragendeId = userData.user.id;

  // -------------------------------------------------------------------------
  // erstellen
  // -------------------------------------------------------------------------
  if (aktion === 'erstellen') {
    const tripId = body.trip_id;
    if (typeof tripId !== 'string' || tripId.length === 0) {
      return fehler('trip_id fehlt.', 400);
    }

    const ablauf = berechneAblauf(body.gueltig_tage, new Date());
    if (!ablauf.ok) {
      return fehler(ablauf.nachricht, 400);
    }

    if (!TEILEN_BASIS_URL) {
      console.error('share-link: TEILEN_BASIS_URL fehlt, ohne sie entsteht kein gültiger Link.');
      await melde(new Error('share-link: TEILEN_BASIS_URL fehlt, ohne sie entsteht kein gültiger Link.'));
      return fehler('Server nicht konfiguriert.', 500);
    }

    const { data: trip, error: tripError } = await store.holeTripFuerErstellen(tripId);
    if (tripError) {
      console.error('share-link: trips-Select fehlgeschlagen', tripError);
      await melde(tripError, { trip_id: tripId, user_id: anfragendeId });
      return fehler('Reise konnte nicht geladen werden.', 500);
    }
    // Die Service-Role schreibt an RLS vorbei (`rolbypassrls`),
    // share_links_insert_owner (20260808130000) wird bei diesem Insert gar
    // nicht ausgewertet. Und seit 20260808140000 hat `authenticated` überhaupt
    // kein Schreibrecht mehr auf share_links: DIESE Prüfung ist die einzige,
    // die «nur die Owner-Person, nur eine aufgedeckte Reise» noch erzwingt.
    // Sie liegt deshalb als reine Funktion in verwaltung.ts und ist dort ohne
    // Docker geprüft (verwaltung_test.ts), nicht nur im Integrationstest.
    const erstellUrteil = beurteileErstellen(trip, anfragendeId);
    if (!erstellUrteil.erlaubt) {
      return fehler(erstellUrteil.nachricht, erstellUrteil.status);
    }

    const { token, error: insertError } = await store.legeLinkAn(tripId, ablauf.expiresAt);
    if (insertError || !token) {
      console.error('share-link: share_links-Insert fehlgeschlagen', insertError);
      await melde(insertError, { trip_id: tripId, user_id: anfragendeId });
      return fehler('Link konnte nicht erstellt werden.', 500);
    }

    // Die Mitreisenden erfahren, dass ihr Recap jetzt hinter einer
    // oeffentlichen URL steht, samt den Orten der Momente. NACH dem Insert,
    // nie davor: eine Meldung ueber einen Link, den es nicht gibt, waere
    // schlimmer als gar keine. Und mit `await`, damit der Edge-Runtime den
    // Prozess nicht beendet, bevor der Versand hinausgeht; scheitern kann er
    // nicht, `versendeTeilenPush` wirft nie (Begruendung dort).
    await versendeTeilenPush(store, sende, erstellUrteil.daten, anfragendeId, 'erstellt');

    return json({ token, url: `${TEILEN_BASIS_URL}/teilen/${token}` }, 200);
  }

  // -------------------------------------------------------------------------
  // widerrufen
  // -------------------------------------------------------------------------
  if (aktion === 'widerrufen') {
    const token = body.token;
    if (typeof token !== 'string' || token.length === 0) {
      return fehler('token fehlt.', 400);
    }

    const { data: besitzer, error: leseFehler } = await store.holeTokenBesitzer(token);
    if (leseFehler) {
      console.error('share-link: share_links-Select für widerrufen fehlgeschlagen', leseFehler);
      // Auch hier NICHT der Token selbst im Bericht, siehe die Begründung
      // beim `aufloesen`-Zweig oben.
      await melde(leseFehler, { user_id: anfragendeId });
      return fehler('Link konnte nicht geladen werden.', 500);
    }

    // EINE Antwort für «Token gibt es nicht» und «Token gehört jemand
    // anderem», die Begründung und die gefrorene Konstante stehen in
    // verwaltung.ts, geprüft ohne Docker in verwaltung_test.ts.
    const widerrufUrteil = beurteileWiderrufen(besitzer, anfragendeId);
    if (!widerrufUrteil.erlaubt) {
      return fehler(widerrufUrteil.nachricht, widerrufUrteil.status);
    }

    // Idempotent: ein zweiter Widerruf ist kein Fehler. Das Update setzt
    // revoked = true, ob es vorher schon true war oder nicht, die App bekommt
    // beide Male dieselbe Antwort. Ein Status-Kriterium gibt es bewusst
    // nicht: widerrufen muss auf einer archivierten Reise genauso gehen.
    const { error: updateError } = await store.widerrufeLink(token);
    if (updateError) {
      console.error('share-link: share_links-Update fehlgeschlagen', updateError);
      await melde(updateError, { user_id: anfragendeId });
      return fehler('Link konnte nicht widerrufen werden.', 500);
    }

    // Die Entwarnung. Sie gehoert genauso dazu wie die Meldung beim Erstellen:
    // wer erfahren hat, dass sein Recap geteilt ist, soll auch erfahren, dass
    // er es nicht mehr ist, sonst bleibt eine Sorge stehen, die nicht mehr
    // besteht.
    //
    // Auch beim zweiten, idempotenten Widerruf. Der Alternative, nur beim
    // ersten zu melden, fehlt die Grundlage: `widerrufeLink` setzt
    // `revoked = true` ohne zu wissen, ob es vorher schon so war, und das
    // nachzuruesten hiesse, den Weg fuer eine Meldung umzubauen, die im
    // schlimmsten Fall zweimal dasselbe Richtige sagt.
    await versendeTeilenPush(
      store,
      sende,
      { id: widerrufUrteil.daten.trip_id, name: widerrufUrteil.daten.name },
      anfragendeId,
      'widerrufen',
    );

    return json({ ok: true }, 200);
  }

  return fehler('Unbekannte Aktion.', 400);
});
