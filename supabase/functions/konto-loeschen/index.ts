// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

// konto-loeschen, Store-Pflicht und Datenschutz-Zusage in einer Function.
// Zwei Aktionen:
//
//   zahlen   → was der Löschdialog anzeigen muss, bevor jemand zustimmt
//   loeschen → die Löschung selbst (Standard, wenn `aktion` fehlt)
//
// ---------------------------------------------------------------------------
// Die Identität kommt aus dem JWT, NIE aus dem Body
// ---------------------------------------------------------------------------
// Der Body trägt hier ausser der Aktion überhaupt nichts, keine user_id,
// keine trip_id. Ein Konto kann ausschliesslich sich selbst löschen, und das
// ist keine Prüfung, die man vergessen könnte: es gibt schlicht keinen
// Parameter, über den eine fremde Identität hereinkäme.
//
// `verify_jwt = true` in supabase/config.toml (anders als bei share-link, das
// wegen seines öffentlichen Lesewegs auf false steht): Diese Function hat
// keinen anonymen Pfad, das Gateway ist also wieder die erste von zwei Hürden.
// Der Handler prüft trotzdem selbst (supabaseAdmin.auth.getUser), der
// Anon-Key allein reicht dafür nicht.
//
// ---------------------------------------------------------------------------
// Die Reihenfolge liegt NICHT in dieser Datei
// ---------------------------------------------------------------------------
// Sie steht in ablauf.ts als reine Funktion, zusammen mit der Ableitung der
// Schlüssel, dem Wächter für client-geschriebene Pfade und dem Blättern.
// Grund: Der wichtigste Fall, «der Speicherschritt scheitert, also wird die
// Datenbank gar nicht angefasst», lässt sich gegen einen laufenden Stack kaum
// herstellen, und ein Test, den es nur im Integrationslauf gibt, überspringt
// sich auf jeder Maschine ohne Docker stillschweigend (der schwerste Befund
// des Phase-5-Reviews). ablauf_test.ts läuft immer.
//
// Worauf sich die Löschung stützt, die Kaskaden, einzeln nachgezählt gegen
// pg_constraint (14 Fremdschlüssel im Schema public):
//
//   trips.owner_id      → profiles     RESTRICT  ← die EINZIGE Ausnahme.
//                                                  Deshalb Schritt «eigene
//                                                  Reisen löschen» vor dem
//                                                  Auth-Nutzer.
//   profiles.id         → auth.users   CASCADE   ← deshalb genügt am Ende
//                                                  deleteUser
//   posts.trip_id       → trips        CASCADE   Momente der eigenen Reisen,
//                                                von ALLEN Autoren
//   posts.author_id     → profiles     CASCADE   eigene Momente überall sonst
//   trip_members.trip_id→ trips        CASCADE
//   trip_members.user_id→ profiles     CASCADE
//   share_links.trip_id → trips        CASCADE
//   reactions.post_id   → posts        CASCADE   (über die Posts oben)
//   reactions.user_id   → profiles     CASCADE
//   comments.post_id    → posts        CASCADE
//   comments.user_id    → profiles     CASCADE
//   reports.post_id     → posts        CASCADE
//   reports.reporter_id → profiles     CASCADE
//   push_tokens.user_id → profiles     CASCADE
//
// Das sind alle neun Tabellen in public. Was NICHT kaskadiert, weil es keinen
// Fremdschlüssel gibt: storage.objects, die Objekte im Bucket. Genau die
// räumt der Speicherschritt, und genau deshalb muss er zuerst laufen.
import { AwsClient } from 'npm:aws4fetch@1';
import { fuehreLoeschungAus, medienSchluessel, pfadGehoertUns, sammleAlle, type PostZeile, type Schritt } from './ablauf.ts';
import { erstelleAdminClient, erstelleKontoStore, erstellePersonenClient, erstelleS3Loescher } from './store.ts';
import { erstelleFehlermelder } from '../_shared/fehlermelder.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
// Dieselben fünf S3-Variablen wie media-urls/share-link (siehe dortige
// index.ts), seit dem Abschluss-Review von Phase 6 löscht auch diese
// Function über das S3-Protokoll, nicht mehr über die Supabase-Storage-API
// (die ausführliche Begründung steht in store.ts, Kopfkommentar). Derselbe
// Bucket-Name wie in supabase/config.toml, [storage.buckets.media].
const S3_ENDPOINT = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/$/, '');
const S3_REGION = Deno.env.get('S3_REGION') ?? '';
const S3_BUCKET = Deno.env.get('S3_BUCKET') ?? '';
const S3_ACCESS_KEY = Deno.env.get('S3_ACCESS_KEY') ?? '';
const S3_SECRET_KEY = Deno.env.get('S3_SECRET_KEY') ?? '';

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

// Spec §9 / Task-Brief "abschluss-fix-server": ein schlanker Fehler-Melder
// über `fetch`, ohne Paket (Begründung und Privacy-Regeln in
// _shared/fehlermelder.ts). Ohne SENTRY_DSN ein vollständiger No-Op, der
// heutige, unveränderte Zustand jeder lokalen Umgebung.
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
const melde = erstelleFehlermelder(SENTRY_DSN, 'konto-loeschen');

type AnfrageBody = { aktion?: unknown };

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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error('konto-loeschen: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY fehlen.');
    await melde(new Error('konto-loeschen: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY fehlen.'));
    return fehler('Server nicht konfiguriert.', 500);
  }

  const supabaseAdmin = erstelleAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return fehler('Nicht angemeldet.', 401);
  }
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return fehler('Nicht angemeldet.', 401);
  }
  const anfragendeId = userData.user.id;

  // Ein leerer Body ist der Normalfall (Interface-Vertrag: `POST` mit `{}`).
  // Auch gar kein Body soll durchgehen, die Löschung braucht keine Angaben.
  let body: AnfrageBody = {};
  try {
    const roh = await req.text();
    if (roh.trim().length > 0) body = JSON.parse(roh) as AnfrageBody;
  } catch {
    return fehler('Ungültige Anfrage.', 400);
  }

  const aktion = body.aktion ?? 'loeschen';
  if (aktion !== 'loeschen' && aktion !== 'zahlen') {
    return fehler('Unbekannte Aktion.', 400);
  }

  // `loescheEins` wird unabhängig von der Aktion gebaut (billig, nur eine
  // Closure, kein Netzaufruf), aber nur im `loeschen`-Pfad je aufgerufen.
  // `zahlen` braucht keine S3-Konfiguration; die Prüfung darauf steht deshalb
  // NICHT hier, sondern unten, unmittelbar vor dem Speicherschritt.
  const personenClient = erstellePersonenClient(SUPABASE_URL, ANON_KEY, jwt);
  const loescheEins = erstelleS3Loescher(s3Client(), S3_ENDPOINT, S3_BUCKET);
  const store = erstelleKontoStore(supabaseAdmin, personenClient, loescheEins);

  const { data: eigeneTrips, error: tripsError } = await store.holeEigeneTrips(anfragendeId);
  if (tripsError) {
    console.error('konto-loeschen: trips-Select fehlgeschlagen', tripsError);
    await melde(tripsError, { user_id: anfragendeId });
    return fehler('Dein Konto konnte nicht geprüft werden.', 500);
  }
  const trips = eigeneTrips ?? [];
  const eigeneTripIds = trips.map((t) => t.id);

  // -------------------------------------------------------------------------
  // zahlen, was der Dialog anzeigen muss
  // -------------------------------------------------------------------------
  if (aktion === 'zahlen') {
    const { data: zahlen, error: zahlenError } = await store.zaehle(anfragendeId, eigeneTripIds);
    if (zahlenError || !zahlen) {
      console.error('konto-loeschen: Zählen fehlgeschlagen', zahlenError);
      await melde(zahlenError, { user_id: anfragendeId });
      return fehler('Die Zahlen konnten nicht ermittelt werden.', 500);
    }
    return json(zahlen, 200);
  }

  // -------------------------------------------------------------------------
  // loeschen
  // -------------------------------------------------------------------------
  // Erst hier geprüft, nicht ganz oben: `zahlen` braucht keine S3-Konfiguration
  // und soll deshalb auch funktionieren, wenn sie fehlt, nur `loeschen` löscht
  // im Speicher. Ohne diese Prüfung würde ein fehlkonfiguriertes S3 erst tief
  // in loescheObjekte als kryptischer "Invalid URL"-Fehler auffallen, statt
  // hier als klare 500 (dasselbe Muster wie media-urls/share-link).
  if (!s3KonfigVollstaendig()) {
    console.error('konto-loeschen: S3-Umgebungsvariablen unvollständig.');
    await melde(new Error('konto-loeschen: S3-Umgebungsvariablen unvollständig.'), { user_id: anfragendeId });
    return fehler('Server nicht konfiguriert.', 500);
  }

  // Schritt 1: ermitteln, was weggehört. VOLLSTÄNDIG, bevor irgendetwas
  // gelöscht wird, ein Moment, der hier durchrutscht, ist nach der Kaskade
  // nicht mehr auffindbar: sein Pfad leitet sich aus der posts-Zeile ab, und
  // die ist dann weg. Deshalb wird geblättert (max_rows = 1000) und deshalb
  // bricht die Function ab, wenn beim Einsammeln etwas fehlt.
  const inEigenen = await sammleAlle<PostZeile>((von, mitZaehlung) =>
    store.holePostsSeiteInTrips(eigeneTripIds, von, mitZaehlung)
  );
  if (inEigenen.fehler) {
    console.error('konto-loeschen: posts-Select (eigene Reisen) fehlgeschlagen', inEigenen.fehler);
    await melde(inEigenen.fehler, { user_id: anfragendeId });
    return fehler('Deine Reisen konnten nicht gelesen werden.', 500);
  }

  const anderswo = await sammleAlle<PostZeile>((von, mitZaehlung) =>
    store.holeEigenePostsSeiteAusserhalb(anfragendeId, eigeneTripIds, von, mitZaehlung)
  );
  if (anderswo.fehler) {
    console.error('konto-loeschen: posts-Select (fremde Reisen) fehlgeschlagen', anderswo.fehler);
    await melde(anderswo.fehler, { user_id: anfragendeId });
    return fehler('Deine Momente konnten nicht gelesen werden.', 500);
  }

  // Ein Verlust beim Blättern ist hier ein Abbruchgrund und keine Randnotiz:
  // Würde weitergelöscht, blieben die übersehenen Objekte für immer im
  // Speicher, ohne dass irgendjemand ihren Pfad noch herleiten könnte.
  if (inEigenen.verloren > 0 || anderswo.verloren > 0) {
    console.error('konto-loeschen: beim Einsammeln der Momente sind Zeilen verlorengegangen.', {
      user_id: anfragendeId,
      in_eigenen_reisen: inEigenen.verloren,
      anderswo: anderswo.verloren,
    });
    await melde(new Error('konto-loeschen: beim Einsammeln der Momente sind Zeilen verlorengegangen.'), {
      user_id: anfragendeId,
      in_eigenen_reisen: inEigenen.verloren,
      anderswo: anderswo.verloren,
    });
    return fehler('Deine Momente konnten nicht vollständig gelesen werden. Versuch es später noch einmal.', 500);
  }

  const schluessel = [
    ...medienSchluessel(inEigenen.zeilen),
    ...medienSchluessel(anderswo.zeilen),
  ];

  // cover_key und avatar_key sind client-geschriebene Textspalten OHNE
  // Ableitung, der Wächter in ablauf.ts lässt sie nur durch, wenn sie unter
  // einem Präfix liegen, das nachweislich zu dieser Löschung gehört. Heute
  // passt kein einziger Wert (die einzigen existierenden stehen in
  // supabase/seed.sql und sehen aus wie 'covers/norwegen.jpg'), und kein
  // Codepfad schreibt diese Spalten überhaupt. Sobald ein späteres Feature ein
  // eigentümer-gebundenes Schema einführt, das einzige sichere, greift die
  // Löschung von selbst. Bis dahin bleibt ein solcher Wert liegen und wird
  // gemeldet, statt dass eine Kontolöschung zum Werkzeug gegen fremde Objekte
  // wird (die ausführliche Begründung steht bei pfadGehoertUns).
  const erlaubtePraefixe = [
    ...eigeneTripIds.map((id) => `trips/${id}/`),
    `profiles/${anfragendeId}/`,
  ];
  const ungeklaertePfade: string[] = [];
  const { data: avatarKey, error: avatarError } = await store.holeAvatarKey(anfragendeId);
  if (avatarError) {
    console.error('konto-loeschen: profiles-Select fehlgeschlagen', avatarError);
    await melde(avatarError, { user_id: anfragendeId });
    return fehler('Dein Profil konnte nicht gelesen werden.', 500);
  }
  for (const kandidat of [avatarKey, ...trips.map((t) => t.cover_key)]) {
    if (kandidat === null || kandidat === undefined || kandidat.length === 0) continue;
    if (pfadGehoertUns(kandidat, erlaubtePraefixe)) schluessel.push(kandidat);
    else ungeklaertePfade.push(kandidat);
  }
  if (ungeklaertePfade.length > 0) {
    console.error(
      'konto-loeschen: cover_key/avatar_key liegen ausserhalb der eigenen Präfixe und bleiben liegen.',
      { user_id: anfragendeId, pfade: ungeklaertePfade },
    );
    // Nur die ANZAHL geht an Sentry, nie die Pfade selbst, sie bleiben im
    // Server-Log (siehe console.error oben). Ein Storage-Pfad ist kein
    // Moment-Inhalt, aber auch kein Diagnosewert, den ein externer Dienst
    // braucht; die Zahl allein genügt, um das Muster zu erkennen.
    await melde(
      new Error('konto-loeschen: cover_key/avatar_key liegen ausserhalb der eigenen Präfixe und bleiben liegen.'),
      { user_id: anfragendeId, anzahl: ungeklaertePfade.length },
    );
  }

  // Schritt 2–5: die Reihenfolge, als reine Funktion über benannten Schritten.
  // Speicher zuerst und allein; erst danach die Datenbank, und dort streng
  // nacheinander.
  const speicher: Schritt = {
    name: 'speicher',
    ausfuehren: () => store.loescheObjekte(schluessel),
  };
  const datenbank: Schritt[] = [
    // VOR der Kaskade und im Namen der Person, sonst rotiert der
    // Einladungscode jeder Reise, in der sie Mitglied war, und reisst allen
    // anderen ihren Link weg (siehe store.ts/verlasseFremdeReisen).
    { name: 'fremde-reisen-verlassen', ausfuehren: () => store.verlasseFremdeReisen(anfragendeId, eigeneTripIds) },
    // Löst die einzige on-delete-restrict-Beziehung des Schemas auf.
    { name: 'eigene-reisen-loeschen', ausfuehren: () => store.loescheEigeneTrips(eigeneTripIds) },
    // Zum Schluss: die Kaskade profiles.id → auth.users räumt den Rest.
    { name: 'auth-nutzer-loeschen', ausfuehren: () => store.loescheAuthNutzer(anfragendeId) },
  ];

  const ergebnis = await fuehreLoeschungAus(speicher, datenbank);
  if (!ergebnis.ok) {
    console.error('konto-loeschen: Löschung abgebrochen', {
      user_id: anfragendeId,
      schritt: ergebnis.gescheitertBei,
      datenbank_beruehrt: ergebnis.datenbankBeruehrt,
      fehler: ergebnis.fehler,
    });
    // Genau der Fall aus Punkt 1 des Abschluss-Reviews: scheitert der
    // Speicherschritt (oder ein Datenbankschritt danach), bleibt W6/W7 sonst
    // ausschliesslich im Server-Log sichtbar. `ergebnis.fehler` trägt hier die
    // eigentliche Ursache; `melde()` liest daraus nur `.message` (siehe
    // fehlermelder.ts), nie die rohe Fehlerstruktur.
    await melde(ergebnis.fehler, {
      user_id: anfragendeId,
      schritt: ergebnis.gescheitertBei,
      datenbank_beruehrt: ergebnis.datenbankBeruehrt,
    });
    // Ein Text für beide Fälle: Ob die Datenbank schon angefasst wurde oder
    // nicht, ändert für die Person nichts an dem, was sie tun soll, es noch
    // einmal versuchen. Beide Wege sind wiederholbar: Das Löschen im Speicher
    // ist idempotent, eine bereits gelöschte Reise ist ein No-Op, und
    // deleteUser auf einen schon gelöschten Nutzer schlägt fehl, ohne etwas
    // kaputtzumachen. Der Unterschied steht im Log, wo er hingehört.
    return fehler('Dein Konto konnte nicht vollständig gelöscht werden. Versuch es später noch einmal.', 500);
  }

  return json({ ok: true }, 200);
});
