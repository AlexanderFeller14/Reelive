// Integrationstest für share-link, die zweite Schicht unter
// aufloesung_test.ts, nie die einzige.
//
// Was hier und NUR hier belegt werden kann (alles andere steht in
// aufloesung_test.ts und läuft ohne Docker):
//   1. Der öffentliche Aufruf kommt OHNE JEDEN Header durch das Gateway,
//      kein Authorization, kein apikey. Das ist die Zusicherung, die
//      verify_jwt = false überhaupt erst nötig macht (Spec §4, W5).
//   2. Die ausgestellten URLs zeigen auf echte Bytes: ein GET darauf gibt
//      zurück, was hochgeladen wurde, mit X-Amz-Expires = 3600.
//   3. Die SQL-Filter greifen wirklich: nur `upload_status = 'uploaded'`, nur
//      Momente DIESER Reise (W1), sortiert nach captured_at/id.
//   4. Widerrufen und Ablaufen liefern eine byte-gleiche Antwort zum
//      unbekannten Token, hier gegen die echten HTTP-Bytes verglichen, nicht
//      gegen ein TypeScript-Objekt (W2).
//   5. Ein Link auf eine `active` Reise lässt sich weder anlegen noch (falls
//      er per Service-Role doch entsteht) auflösen (W3, beide Hälften).
//   6. `widerrufen` ist kein Orakel: ein fremder Token und ein nicht
//      existierender liefern dieselbe Antwort.
//   7. Die Antwort enthält nirgends author_id, invite_code oder owner_id,
//      geprüft am rohen Antworttext, inklusive der echten UUID-Werte. Die
//      UUID-Hälfte davon hängt seit dem Profilbild-Feature (2026-08-12) an der
//      Fixture: hätte Lea ein Profilbild, stünde ihre uid als Teil von
//      `autor_avatar_key` (`profiles/<author_id>/<32 hex>.jpg`) im Text. Das
//      ist bewusst so akzeptiert, siehe die Stelle selbst.
//   8. Das Blättern über die max_rows-Grenze gegen echtes PostgREST.
//
// Ausführen (Terminal 1 offen lassen):
//   supabase functions serve --env-file supabase/functions/.env
// dann in Terminal 2:
//   cd supabase/functions/share-link
//   npx deno test --allow-net --allow-run=supabase share_link_integration_test.ts
//
// Ohne laufenden Stack überspringt sich der Test mit einer Log-Zeile, statt
// einen Rechner ohne Docker rot zu färben. Das ist hier vertretbar, WEIL die
// eigentlichen Sicherheitszusicherungen (byte-gleiche Ablehnungen, Form der
// Antwort, Ableitung der Schlüssel, Blättern) zusätzlich in aufloesung_test.ts
// stehen und dort immer laufen.
//
// SHARE_LINK_URL zeigt den Test auf eine woanders servierte Function (dann
// zusätzlich --allow-env).

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { erwarteteSchluessel } from '../media-urls/keys.ts';

// seed.sql-Konten: Lea ist Owner der Testreisen. Ben hat eine auth.users-Zeile,
// aber KEIN Profil, er kann sich anmelden und ist damit genau der «irgendein
// angemeldeter Fremder», den es hier braucht; als Autor eines Moments taugt er
// nicht (posts.author_id verweist auf profiles). Dafür Sofia: ein echtes
// Profil, das in keiner der Testreisen Mitglied ist.
const LEA_ID = '11111111-1111-4111-8111-111111111111';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const SOFIA_ID = '55555555-5555-4555-8555-555555555555';
const BUCKET = 'media';
const MEDIUM_INHALT = 'echte-jpeg-bytes-fuer-den-share-link-test';
const THUMB_INHALT = 'echte-thumb-bytes-fuer-den-share-link-test';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function mintJwt(secret: string, userId: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: 'authenticated', exp: now + 3600, iat: now, sub: userId, role: 'authenticated' };
  const data = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

// Werte NIE hier fest eintippen: sie unterscheiden sich pro Projekt/Rechner.
async function supabaseStatusEnv(): Promise<Record<string, string> | null> {
  try {
    const cmd = new Deno.Command('supabase', { args: ['status', '-o', 'env'], stdout: 'piped', stderr: 'null' });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return null;
    const text = new TextDecoder().decode(stdout);
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return null;
  }
}

function envOderNull(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    return null;
  }
}

async function functionErreichbar(url: string): Promise<boolean> {
  try {
    // Bewusst ohne apikey: Wenn schon der Erreichbarkeits-Check ohne jeden
    // Header durchkommt, ist damit gleich die erste Zusicherung angetestet.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    const daten = await res.json().catch(() => null);
    return Boolean(daten && typeof daten === 'object' && 'fehler' in daten);
  } catch {
    return false;
  }
}

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = statusEnv?.ANON_KEY ?? '';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';
const JWT_SECRET = statusEnv?.JWT_SECRET ?? '';
const FUNCTION_URL = envOderNull('SHARE_LINK_URL') ?? `${SUPABASE_URL}/functions/v1/share-link`;

const stackBereit = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET && (await functionErreichbar(FUNCTION_URL)),
);

if (!stackBereit) {
  console.warn(
    'share_link_integration_test: übersprungen, braucht `supabase start` UND ' +
      '`supabase functions serve --env-file supabase/functions/.env` in einem zweiten Terminal. ' +
      'Die Sicherheitszusicherungen der Prüfkette laufen ohne Stack in aufloesung_test.ts.',
  );
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function erwarteJson(res: Response, erwarteterStatus: number): Promise<unknown> {
  const text = await res.text();
  assertEquals(res.status, erwarteterStatus, text);
  return text.length > 0 ? JSON.parse(text) : null;
}

// Der öffentliche Aufruf: OHNE Authorization, OHNE apikey. Genau so, wie ein
// Browser ohne Konto ihn macht.
async function aufloesen(token: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aktion: 'aufloesen', token }),
  });
  return { status: res.status, text: await res.text() };
}

function mitJwt(jwt: string): Record<string, string> {
  return { apikey: ANON_KEY, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
}

async function rufe(headers: Record<string, string>, body: unknown): Promise<Response> {
  return await fetch(FUNCTION_URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function legeTripAn(name: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ name, start_date: '2026-01-01', end_date: '2026-01-02', owner_id: LEA_ID }),
  });
  const [trip] = (await erwarteJson(res, 201)) as Array<{ id: string }>;
  return trip.id;
}

async function reveal(tripId: string): Promise<void> {
  await erwarteJson(
    await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
      method: 'PATCH',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ status: 'revealed', revealed_at: 'now' }),
    }),
    200,
  );
}

async function raeumeAuf(tripIds: Array<string | null>, schluessel: string[]): Promise<void> {
  for (const key of schluessel) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }).catch(() => null);
    if (res && !res.ok) console.warn(`Aufräumen von ${key} fehlgeschlagen: HTTP ${res.status}`);
  }
  for (const id of tripIds) {
    if (id === null) continue;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`, {
      method: 'DELETE',
      headers: restHeaders(),
    }).catch(() => null);
    if (res && !res.ok) console.warn(`Aufräumen der Test-Reise fehlgeschlagen: HTTP ${res.status}`);
  }
}

type AufloesungsAntwort = {
  reise: { name: string; start_date: string; end_date: string };
  medien: Array<{
    post_id: string;
    autor_name: string;
    type: string;
    captured_at: string;
    captured_tz: string;
    place_name: string | null;
    lat: number | null;
    lng: number | null;
    caption: string | null;
    duration_s: number | null;
    medium_url: string;
    thumb_url: string | null;
  }>;
  gueltig_bis: string;
  ausgelassen: number;
};

Deno.test({
  name: 'share-link: erstellen, auflösen ohne Anmeldung, widerrufen, und keine Auskunft an Unbefugte',
  ignore: !stackBereit,
  async fn() {
    const tripId = await legeTripAn('Integrationstest share-link');
    let nachbarTripId: string | null = null;
    let aktiveTripId: string | null = null;
    const hochgeladen: string[] = [];

    try {
      const leaJwt = await mintJwt(JWT_SECRET, LEA_ID);
      const benJwt = await mintJwt(JWT_SECRET, BEN_ID);

      // --- W3, erste Hälfte: für eine versiegelte Reise gibt es keinen Link -
      const zuFrueh = await rufe(mitJwt(leaJwt), { aktion: 'erstellen', trip_id: tripId });
      assertEquals(await erwarteJson(zuFrueh, 409), { fehler: 'Diese Reise ist noch versiegelt.' });

      // --- Fixtures ------------------------------------------------------
      // A: ein echter, fertig hochgeladener Moment (der einzige mit Bytes).
      const postAId = crypto.randomUUID();
      const schluesselA = erwarteteSchluessel(tripId, postAId, 'photo', 'jpg');
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postAId,
            trip_id: tripId,
            author_id: LEA_ID,
            type: 'photo',
            storage_key: schluesselA.storage_key,
            thumb_key: schluesselA.thumb_key,
            upload_status: 'uploaded',
            captured_at: '2026-01-01T08:00:00+01:00',
            captured_tz: 'Europe/Zurich',
            place_name: 'Zürich',
            // A trägt Koordinaten, C (weiter unten) nicht, damit zeigt EIN
            // Durchgang beide Richtungen: dass lat/lng wirklich aus der
            // Select-Liste kommen, und dass ein Moment ohne Ort trotzdem in
            // der Filmrolle steht.
            lat: 47.3769,
            lng: 8.5417,
            caption: 'Der erste Moment',
          }),
        }),
        201,
      );

      // Bytes direkt über die Storage-API ablegen, dieser Test prüft
      // share-link, nicht den Upload-Weg von media-urls.
      for (const [key, inhalt] of [
        [schluesselA.storage_key, MEDIUM_INHALT],
        [schluesselA.thumb_key, THUMB_INHALT],
      ]) {
        const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            'content-type': 'image/jpeg',
          },
          body: inhalt,
        });
        assertEquals(put.status, 200, await put.text());
        hochgeladen.push(key);
      }

      // B: eingesendet, nie fertig hochgeladen, darf in keiner Antwort
      //    auftauchen.
      const postBId = crypto.randomUUID();
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postBId,
            trip_id: tripId,
            author_id: LEA_ID,
            type: 'photo',
            storage_key: erwarteteSchluessel(tripId, postBId, 'photo', 'jpg').storage_key,
            captured_at: '2026-01-01T09:00:00+01:00',
            captured_tz: 'Europe/Zurich',
          }),
        }),
        201,
      );

      // C: fertig, aber ohne Thumbnail, thumb_url muss null werden.
      const postCId = crypto.randomUUID();
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postCId,
            trip_id: tripId,
            author_id: LEA_ID,
            type: 'photo',
            storage_key: erwarteteSchluessel(tripId, postCId, 'photo', 'jpg').storage_key,
            thumb_key: null,
            upload_status: 'uploaded',
            captured_at: '2026-01-01T10:00:00+01:00',
            captured_tz: 'Europe/Zurich',
          }),
        }),
        201,
      );

      // D: liegt in einer ANDEREN Reise, trägt aber einen storage_key, der
      //    genau auf UNSERE Reise passt. Die einzige Zeile, an der sich die
      //    Reise-Eingrenzung des Selects überhaupt zeigen kann: Fällt
      //    `.eq('trip_id', …)` weg, rutscht D durch den Ableitungs-Abgleich
      //    hindurch in die Antwort, jeder andere fremde Moment würde dort
      //    noch aussortiert. Das ist W1 in seiner schärfsten Form.
      nachbarTripId = await legeTripAn('Integrationstest share-link Nachbarreise');
      const postDId = crypto.randomUUID();
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postDId,
            trip_id: nachbarTripId,
            author_id: LEA_ID,
            type: 'photo',
            storage_key: erwarteteSchluessel(tripId, postDId, 'photo', 'jpg').storage_key,
            thumb_key: null,
            upload_status: 'uploaded',
            captured_at: '2026-01-01T11:00:00+01:00',
            captured_tz: 'Europe/Zurich',
          }),
        }),
        201,
      );

      await reveal(tripId);

      // --- erstellen: nur die Owner-Person ---------------------------------
      const ohneJwt = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aktion: 'erstellen', trip_id: tripId }),
      });
      assertEquals(await erwarteJson(ohneJwt, 401), { fehler: 'Nicht angemeldet.' });

      // Der Anon-Key ist ein syntaktisch gültiges, korrekt signiertes JWT,
      // und trotzdem keine Person. Weil das Gateway hier nicht mehr vorprüft,
      // ist dieser Fall der Beleg, dass die eigene Prüfung ihn abfängt.
      const mitAnonKey = await rufe(mitJwt(ANON_KEY), { aktion: 'erstellen', trip_id: tripId });
      assertEquals(await erwarteJson(mitAnonKey, 401), { fehler: 'Nicht angemeldet.' });

      const fremd = await rufe(mitJwt(benJwt), { aktion: 'erstellen', trip_id: tripId });
      assertEquals(await erwarteJson(fremd, 403), {
        fehler: 'Nur wer die Reise angelegt hat, kann den Recap teilen.',
      });

      const erstellt = (await erwarteJson(
        await rufe(mitJwt(leaJwt), { aktion: 'erstellen', trip_id: tripId }),
        200,
      )) as { token: string; url: string };
      assert(erstellt.token.length >= 16, `unerwarteter Token: ${erstellt.token}`);
      assert(erstellt.url.endsWith(`/share/${erstellt.token}`), erstellt.url);

      // --- aufloesen OHNE jede Anmeldung ----------------------------------
      const vorherStempel = Date.now();
      const offen = await aufloesen(erstellt.token);
      assertEquals(offen.status, 200, offen.text);
      const antwort = JSON.parse(offen.text) as AufloesungsAntwort;

      assertEquals(antwort.reise, {
        name: 'Integrationstest share-link',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
      });

      // Genau A und C, in captured_at-Reihenfolge. B fehlt (pending), D fehlt
      // (andere Reise), zwei verschiedene Gründe, eine Zusicherung.
      assertEquals(antwort.medien.map((m) => m.post_id), [postAId, postCId]);
      assertEquals(antwort.ausgelassen, 0);

      const eintragA = antwort.medien[0];
      assertEquals(eintragA.autor_name, 'Lea');
      assertEquals(eintragA.caption, 'Der erste Moment');
      assertEquals(eintragA.place_name, 'Zürich');
      assertEquals(eintragA.captured_tz, 'Europe/Zurich');
      assertEquals(eintragA.duration_s, null);
      // Spec R4: der geteilte Recap zeigt dieselbe Karte wie die App. Nur
      // hier lässt sich prüfen, dass die zwei Spalten die echte
      // PostgREST-Abfrage überhaupt verlassen, aufloesung_test.ts sieht die
      // Select-Liste nicht.
      assertEquals(eintragA.lat, 47.3769);
      assertEquals(eintragA.lng, 8.5417);
      // Und C, ohne Ortsfreigabe eingesendet: null, aber vorhanden. Ein
      // Moment ohne Ort darf nicht aus dem Recap fallen.
      assertEquals(antwort.medien[1].lat, null);
      assertEquals(antwort.medien[1].lng, null);
      assertEquals(antwort.medien[1].thumb_url, null);
      assertFalse(antwort.medien[1].medium_url.includes('null'));

      // Gültigkeit: 3600 s, direkt aus der signierten URL abgelesen.
      assertEquals(new URL(eintragA.medium_url).searchParams.get('X-Amz-Expires'), '3600');
      assertEquals(new URL(eintragA.thumb_url!).searchParams.get('X-Amz-Expires'), '3600');
      const restSekunden = (Date.parse(antwort.gueltig_bis) - vorherStempel) / 1000;
      assert(
        restSekunden > 3000 && restSekunden <= 3601,
        `gueltig_bis liegt ${restSekunden}s in der Zukunft, erwartet ~3600s`,
      );

      // Die URLs zeigen auf echte Bytes, nicht nur auf einen Statuscode, den
      // auch eine Fehlerseite liefern könnte.
      const getMedium = await fetch(eintragA.medium_url);
      assertEquals(getMedium.status, 200);
      assertEquals(await getMedium.text(), MEDIUM_INHALT);
      const getThumb = await fetch(eintragA.thumb_url!);
      assertEquals(getThumb.status, 200);
      assertEquals(await getThumb.text(), THUMB_INHALT);

      // Ein PUT auf eine öffentliche Lese-URL scheitert: SigV4 bindet die
      // Methode in die Signatur. Ein geteilter Link kann nie zum Schreiben
      // umgewidmet werden.
      const putVersuch = await fetch(eintragA.medium_url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: 'ueberschrieben-durch-angreifer',
      });
      assert(putVersuch.status >= 400, `PUT auf eine Lese-URL wurde mit ${putVersuch.status} angenommen`);
      assertEquals(await (await fetch(eintragA.medium_url)).text(), MEDIUM_INHALT);

      // --- Was NICHT in der Antwort stehen darf ---------------------------
      // Am rohen Text, nicht am geparsten Objekt: so fällt auch ein Feld auf,
      // das über ein verschachteltes Objekt hineingerät.
      for (const feld of ['author_id', 'invite_code', 'owner_id', 'reaktionen', 'kommentare', 'mitglieder', 'status']) {
        assertFalse(offen.text.includes(feld), `die Antwort enthält "${feld}"`);
      }
      // Und die echten Werte, nicht nur die Feldnamen: LEA_ID ist die
      // author_id aller Momente und zugleich owner_id der Reise.
      //
      // Diese Zeile ist seit dem Profilbild-Feature (2026-08-12) an die
      // Fixture gebunden: Lea hat hier KEIN Profilbild, `autor_avatar_key` ist
      // deshalb null. Bekäme sie eines, stünde ihre uid als Teil des
      // Schlüssels (`profiles/<author_id>/<32 hex>.jpg`) im Antworttext, und
      // die Zusicherung fiele — nicht wegen einer Regression, sondern weil sie
      // dann eine andere Frage stellte als die, die sie beantworten soll (kein
      // Klartext-owner_id, kein durchgereichtes author_id-FELD). Die
      // Preisgabe der uid über den Avatar-Schlüssel ist bewusst akzeptiert:
      // Nachtrag in
      // docs/superpowers/specs/2026-08-08-phase-6-teilen-export-store-design.md
      // §5.1. Wer die Fixture je um ein Bild erweitert, ersetzt diese Zeile
      // durch eine Prüfung auf owner_id/invite_code im Klartext.
      assertFalse(offen.text.includes(LEA_ID), 'die Antwort enthält die author_id/owner_id im Klartext');
      const [tripZeile] = (await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}&select=invite_code`, {
          headers: restHeaders(),
        }),
        200,
      )) as Array<{ invite_code: string }>;
      assertFalse(offen.text.includes(tripZeile.invite_code), 'die Antwort enthält den invite_code');

      // --- W1: ein zweiter Link zeigt seine eigene Reise, nicht diese -----
      // E ist der einzige regulär abgelegte Moment der Nachbarreise. D liegt
      // ebenfalls dort, trägt aber den auf UNSERE Reise passenden
      // storage_key, für die Nachbarreise stimmt die Ableitung damit nicht,
      // und D fällt hier aus dem anderen Grund heraus als oben: nicht wegen
      // der trip_id, sondern wegen des Abgleichs. Beide Schranken zeigen sich
      // so an derselben Zeile, jede in einer anderen Antwort.
      const postEId = crypto.randomUUID();
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postEId,
            trip_id: nachbarTripId,
            author_id: SOFIA_ID,
            type: 'photo',
            storage_key: erwarteteSchluessel(nachbarTripId, postEId, 'photo', 'jpg').storage_key,
            thumb_key: null,
            upload_status: 'uploaded',
            captured_at: '2026-01-01T12:00:00+01:00',
            captured_tz: 'Europe/Zurich',
          }),
        }),
        201,
      );

      await reveal(nachbarTripId);
      const nachbarLink = (await erwarteJson(
        await rufe(mitJwt(leaJwt), { aktion: 'erstellen', trip_id: nachbarTripId }),
        200,
      )) as { token: string };
      const nachbarOffen = await aufloesen(nachbarLink.token);
      assertEquals(nachbarOffen.status, 200, nachbarOffen.text);
      const nachbarAntwort = JSON.parse(nachbarOffen.text) as AufloesungsAntwort;
      assertEquals(nachbarAntwort.reise.name, 'Integrationstest share-link Nachbarreise');
      assertEquals(nachbarAntwort.medien.map((m) => m.post_id), [postEId]);
      // D ist gezählt, aber nicht ausgeliefert, die App sieht die Lücke,
      // statt einen stillschweigend kürzeren Recap zu bekommen.
      assertEquals(nachbarAntwort.ausgelassen, 1);
      // Der Autorenname kommt aus profiles, nicht aus der Owner-Zeile: hier
      // hat Sofia den Moment eingesendet, nicht Lea.
      assertEquals(nachbarAntwort.medien[0].autor_name, 'Sofia');
      // Und keine URL dieser Antwort zeigt in die andere Reise.
      for (const eintrag of nachbarAntwort.medien) {
        assertFalse(eintrag.medium_url.includes(tripId), eintrag.medium_url);
      }

      // --- Die byte-gleichen Ablehnungen, gegen echte HTTP-Bytes ----------
      const unbekannt = await aufloesen('0000000000000000000000000000dead');

      // a) widerrufen
      const abgelaufenToken = (await erwarteJson(
        await rufe(mitJwt(leaJwt), { aktion: 'erstellen', trip_id: tripId, gueltig_tage: 7 }),
        200,
      )) as { token: string };

      assertEquals(
        await erwarteJson(await rufe(mitJwt(leaJwt), { aktion: 'widerrufen', token: erstellt.token }), 200),
        { ok: true },
      );
      const widerrufen = await aufloesen(erstellt.token);
      assertEquals([widerrufen.status, widerrufen.text], [unbekannt.status, unbekannt.text]);

      // Idempotent: ein zweiter Widerruf ist kein Fehler.
      assertEquals(
        await erwarteJson(await rufe(mitJwt(leaJwt), { aktion: 'widerrufen', token: erstellt.token }), 200),
        { ok: true },
      );

      // b) abgelaufen, expires_at per Service-Role in die Vergangenheit
      //    schieben (die Function selbst kann nur Zukunft ausstellen).
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/share_links?token=eq.${abgelaufenToken.token}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ expires_at: '2020-01-01T00:00:00Z' }),
        }),
        200,
      );
      const abgelaufen = await aufloesen(abgelaufenToken.token);
      assertEquals([abgelaufen.status, abgelaufen.text], [unbekannt.status, unbekannt.text]);

      // c) Reise nicht aufgedeckt, W3, zweite Hälfte. Der Link entsteht hier
      //    per Service-Role (an RLS und an `erstellen` vorbei), weil genau das
      //    der Fall ist, den die Auflösung selbst abfangen muss: die
      //    Erstellungs-Prüfung ist nicht die einzige Schranke.
      aktiveTripId = await legeTripAn('Integrationstest share-link versiegelt');
      const [versiegelterLink] = (await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/share_links`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ trip_id: aktiveTripId }),
        }),
        201,
      )) as Array<{ token: string }>;
      const versiegelt = await aufloesen(versiegelterLink.token);
      assertEquals([versiegelt.status, versiegelt.text], [unbekannt.status, unbekannt.text]);

      // d) ein absurd langer Token, dieselbe Antwort, kein eigenes Signal.
      const zuLang = await aufloesen('a'.repeat(2000));
      assertEquals([zuLang.status, zuLang.text], [unbekannt.status, unbekannt.text]);

      // --- widerrufen ist kein Orakel -------------------------------------
      // Nachbarlink existiert, gehört aber nicht Ben. Für ihn muss das
      // dasselbe sein wie ein Token, den es nie gab, sonst liesse sich die
      // Existenz eines Tokens mit einem beliebigen eigenen Konto prüfen,
      // während `aufloesen` sich alle Mühe gibt, nichts zu verraten.
      const bensVersuchEcht = await rufe(mitJwt(benJwt), { aktion: 'widerrufen', token: nachbarLink.token });
      const bensVersuchErfunden = await rufe(mitJwt(benJwt), {
        aktion: 'widerrufen',
        token: '0000000000000000000000000000beef',
      });
      const textEcht = await bensVersuchEcht.text();
      const textErfunden = await bensVersuchErfunden.text();
      assertEquals([bensVersuchEcht.status, textEcht], [bensVersuchErfunden.status, textErfunden]);
      assertEquals(bensVersuchEcht.status, 404);

      // Und der Link ist wirklich unangetastet geblieben.
      const [nachBen] = (await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/share_links?token=eq.${nachbarLink.token}&select=revoked`, {
          headers: restHeaders(),
        }),
        200,
      )) as Array<{ revoked: boolean }>;
      assertEquals(nachBen.revoked, false);

      // --- Archiviert: lesbar, und der Widerruf gelingt weiterhin ---------
      // «Weggelegt ist nicht zugesperrt», aber die Owner-Person muss den
      // Link auch danach noch abschalten können (Migration 20260808130000).
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${nachbarTripId}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'archived' }),
        }),
        200,
      );
      const imArchiv = await aufloesen(nachbarLink.token);
      assertEquals(imArchiv.status, 200, imArchiv.text);

      // Ein NEUER Link entsteht für eine archivierte Reise nicht mehr.
      const neuImArchiv = await rufe(mitJwt(leaJwt), { aktion: 'erstellen', trip_id: nachbarTripId });
      assertEquals(await erwarteJson(neuImArchiv, 409), {
        fehler: 'Diese Reise ist archiviert. Für sie entsteht kein neuer Link mehr.',
      });

      // Der bestehende lässt sich aber widerrufen, und danach zeigt er
      // nichts mehr.
      assertEquals(
        await erwarteJson(await rufe(mitJwt(leaJwt), { aktion: 'widerrufen', token: nachbarLink.token }), 200),
        { ok: true },
      );
      const archivWiderrufen = await aufloesen(nachbarLink.token);
      assertEquals([archivWiderrufen.status, archivWiderrufen.text], [unbekannt.status, unbekannt.text]);

      // --- Kleinkram, der aus der Angreifersicht naheliegt -----------------
      assertEquals((await aufloesen(undefined)).status, 400);
      assertEquals((await aufloesen(42)).status, 400);
      const unbekannteAktion = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aktion: 'alles_zeigen', token: erstellt.token }),
      });
      // Unbekannte Aktionen laufen in den JWT-Zweig und scheitern dort ohne
      // Anmeldung, nicht an einer Verzweigung, die sie hätte durchlassen
      // können.
      assertEquals(await erwarteJson(unbekannteAktion, 401), { fehler: 'Nicht angemeldet.' });
      assertEquals(
        await erwarteJson(await rufe(mitJwt(leaJwt), { aktion: 'alles_zeigen' }), 400),
        { fehler: 'Unbekannte Aktion.' },
      );

      // CORS: Ohne diese Kopfzeilen scheitert der öffentliche Web-Player im
      // Browser, obwohl die Function korrekt antwortet, er läuft auf einer
      // anderen Herkunft als die Supabase-Instanz.
      //
      // Geprüft wird an der ECHTEN Antwort, nicht am Preflight: Das lokale
      // Kong beantwortet OPTIONS selbst (HTTP 200 mit einer sehr grosszügigen
      // Methodenliste), die Anfrage erreicht die Function also gar nicht. Auf
      // einem gehosteten Projekt ist das nicht so, dort muss die Function
      // OPTIONS selbst beantworten, und genau dafür steht der Zweig in
      // index.ts. Was BEIDE Umgebungen zeigen: die Kopfzeilen auf der
      // POST-Antwort, und die kommen nachweislich aus der Function (Kong
      // setzt access-control-allow-headers nicht auf diesen Wert).
      const mitHerkunft = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://beispiel.test' },
        body: JSON.stringify({ aktion: 'aufloesen', token: 'gibtesnicht' }),
      });
      await mitHerkunft.text();
      assertEquals(mitHerkunft.headers.get('access-control-allow-origin'), '*');
      assertEquals(
        mitHerkunft.headers.get('access-control-allow-headers'),
        'authorization, apikey, content-type, x-client-info',
      );

      const preflight = await fetch(FUNCTION_URL, {
        method: 'OPTIONS',
        headers: { origin: 'https://beispiel.test', 'access-control-request-method': 'POST' },
      });
      await preflight.body?.cancel();
      assert(
        preflight.status === 204 || preflight.status === 200,
        `Preflight antwortete mit ${preflight.status}`,
      );
      assertEquals(preflight.headers.get('access-control-allow-origin'), '*');
    } finally {
      await raeumeAuf([tripId, nachbarTripId, aktiveTripId], hochgeladen);
    }
  },
});

// ---------------------------------------------------------------------------
// Seitengrenze gegen echtes PostgREST
// ---------------------------------------------------------------------------
// Die Schleife selbst ist in aufloesung_test.ts ohne Docker geprüft. Was hier
// dazukommt: dass max_rows in supabase/config.toml wirklich bei 1000 kappt und
// die Seitengrösse in store.ts dazu passt. 1001 Zeilen sind die kleinste
// Fixture, die das zeigt.
Deno.test({
  name: 'share-link: aufloesen blättert über die max_rows-Grenze und verliert keinen Moment',
  ignore: !stackBereit,
  async fn() {
    const ANZAHL = 1001;
    const tripId = await legeTripAn('Integrationstest share-link Seitengrenze');

    try {
      const basis = Date.parse('2026-01-01T00:00:00Z');
      const erwarteteReihenfolge: string[] = [];
      const zeilen = Array.from({ length: ANZAHL }, (_, i) => {
        const id = crypto.randomUUID();
        erwarteteReihenfolge.push(id);
        return {
          id,
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: erwarteteSchluessel(tripId, id, 'photo', 'jpg').storage_key,
          thumb_key: null,
          upload_status: 'uploaded',
          captured_at: new Date(basis + i * 60_000).toISOString(),
          captured_tz: 'Europe/Zurich',
        };
      });
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify(zeilen),
      });
      assertEquals(insertRes.status, 201, await insertRes.text());

      await reveal(tripId);
      const leaJwt = await mintJwt(JWT_SECRET, LEA_ID);
      const { token } = (await erwarteJson(
        await rufe(mitJwt(leaJwt), { aktion: 'erstellen', trip_id: tripId }),
        200,
      )) as { token: string };

      const offen = await aufloesen(token);
      assertEquals(offen.status, 200, offen.text.slice(0, 500));
      const antwort = JSON.parse(offen.text) as AufloesungsAntwort;

      // Ohne Blättern stünde hier 1000, der stille Verlust, um den es geht.
      assertEquals(antwort.medien.length, ANZAHL);
      assertEquals(antwort.medien.map((m) => m.post_id), erwarteteReihenfolge);
      assertEquals(antwort.ausgelassen, 0);
      assertEquals(new Set(antwort.medien.map((m) => m.post_id)).size, ANZAHL);
    } finally {
      await raeumeAuf([tripId], []);
    }
  },
});
