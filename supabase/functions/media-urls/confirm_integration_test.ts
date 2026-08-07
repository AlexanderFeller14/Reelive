// Integrationstest für `confirm` — deckt genau die beiden Dinge automatisiert
// ab, die bisher nur ein manueller curl-Durchlauf geprüft hat (Fix-Runde 1
// des Task-5-Reviews):
//   1. Schlüssel-Rückschreibung: nach `confirm` tragen posts.storage_key/
//      thumb_key die server-abgeleiteten Werte, nicht mehr den (absichtlich
//      falschen) Client-Wert aus dem Insert.
//   2. 0-Byte-Ablehnung: ein Objekt mit Content-Length 0 zählt nicht als
//      hochgeladen, `confirm` antwortet mit 409, `upload_status` bleibt
//      `pending`.
//
// Kein Unit-Test: `index.ts` exportiert bewusst nichts (Deno.serve direkt im
// Modul, siehe Sicherheitsbegründung dort) und wurde für diesen Task NICHT
// angefasst ("Nicht ändern: den Code der Function selbst"). Dieser Test ruft
// darum die Function über echtes HTTP auf, genau wie ein Client — braucht
// deshalb eine laufende lokale Instanz UND einen laufenden
// `supabase functions serve media-urls`-Prozess mit gültiger S3-Umgebung
// (supabase/functions/.env, siehe .env.example). Ohne beides überspringt der
// Test sich selbst (mit Log-Zeile), statt fehlzuschlagen — er soll einen
// Rechner ohne laufenden Stack nicht rot färben.
//
// Fixture: eigene Reise + eigener Post, angelegt/aufgeräumt im Test selbst
// (Autor: die seed.sql-Nutzerin Lea, deren Profil bereits existiert). Die
// Norwegen-Seed-Daten aus seed.sql bleiben unangetastet.
//
// Ausführen (im Terminal 1 lassen: `supabase functions serve media-urls
// --env-file supabase/functions/.env`), dann in Terminal 2:
//   cd supabase/functions/media-urls
//   npx deno test --allow-net --allow-run=supabase confirm_integration_test.ts

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import { erwarteteSchluessel } from './keys.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';
const BUCKET = 'media';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

// Selbst signiertes HS256-JWT gegen das lokale Projekt-Secret — dieselbe
// Technik, mit der die Sicherheitsregeln beim manuellen Live-Test dieses
// Tasks bereits geprüft wurden (auth.sms.test_otp deckt in config.toml nur
// zwei Nummern ab, nicht die hier gebrauchte).
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

// Werte NIE hier fest eintippen (auch nicht als "praktischer" Fallback) —
// genau das war Finding 1 dieser Fix-Runde: sie unterscheiden sich pro
// Projekt/Rechner. `supabase status` ist die einzige Quelle.
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

// Erkennt speziell UNSERE Function (JSON mit "fehler"-Feld), nicht nur
// irgendeine Antwort von Kong — ein 404 von Kong, weil nichts serviert wird,
// ist sonst leicht mit "Function läuft, meldet nur einen Fehler" verwechselt.
async function functionErreichbar(url: string, anonKey: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
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
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/media-urls`;

const stackBereit = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET &&
    (await functionErreichbar(FUNCTION_URL, ANON_KEY)),
);

if (!stackBereit) {
  console.warn(
    'confirm_integration_test: übersprungen — braucht `supabase start` UND ' +
      '`supabase functions serve media-urls --env-file supabase/functions/.env` ' +
      'in einem zweiten Terminal. Details im Datei-Header.',
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

// Liest den Body genau einmal (als Text), prüft den Status damit als
// Fehlermeldung und parst danach erst als JSON — .json() UND .text() auf
// derselben Response wäre "Body already consumed".
async function erwarteJson(res: Response, erwarteterStatus: number): Promise<unknown> {
  const text = await res.text();
  assertEquals(res.status, erwarteterStatus, text);
  return text.length > 0 ? JSON.parse(text) : null;
}

Deno.test({
  name: 'confirm schreibt storage_key/thumb_key zurück und lehnt 0-Byte-Objekte ab',
  ignore: !stackBereit,
  async fn() {
    // Eigene Reise + eigener Post statt seed.sql-Fixtures: robust gegenüber
    // Änderungen an seed.sql, hinterlässt dort keine Spuren. Der
    // trips_add_owner_membership-Trigger legt die trip_members-Zeile für
    // Lea automatisch an.
    const tripRes = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        name: 'Integrationstest media-urls',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
        owner_id: LEA_ID,
      }),
    });
    const [trip] = (await erwarteJson(tripRes, 201)) as Array<{ id: string }>;
    const tripId: string = trip.id;

    try {
      const postRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          // Absichtlich falsch — genau der Zustand, den Fix-Runde 1 behebt:
          // ein Client-Wert, der nicht dem server-abgeleiteten Pfad
          // entspricht und den `confirm` nach dem Fix überschreiben muss.
          storage_key: 'trips/falsch/platzhalter.jpg',
          thumb_key: null,
          captured_at: new Date().toISOString(),
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [post] = (await erwarteJson(postRes, 201)) as Array<{ id: string }>;
      const postId: string = post.id;

      const erwartet = erwarteteSchluessel(tripId, postId, 'photo', 'jpg');
      const jwt = await mintJwt(JWT_SECRET, LEA_ID);
      const authHeaders = {
        apikey: ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
      };

      try {
        // 1) sign
        const signRes = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ aktion: 'sign', post_id: postId }),
        });
        const { medium_url, thumb_url } = (await erwarteJson(signRes, 200)) as {
          medium_url: string;
          thumb_url: string;
        };

        // 2) medium mit echtem Inhalt hochladen, thumb absichtlich mit 0 Byte.
        // Content-Type explizit setzen: der Bucket ist auf image/jpeg und
        // video/mp4 beschränkt (config.toml), fetch würde sonst
        // "text/plain;charset=UTF-8" senden und die Storage-API lehnt ab.
        const mediumPut = await fetch(medium_url, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: 'echte-jpeg-bytes',
        });
        assertEquals(mediumPut.status, 200, await mediumPut.text());
        const thumbPutLeer = await fetch(thumb_url, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: '',
        });
        assertEquals(thumbPutLeer.status, 200, await thumbPutLeer.text());

        // 3) confirm muss ablehnen — 0-Byte-Objekt zählt nicht als Nachweis
        const confirmVorher = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ aktion: 'confirm', post_id: postId }),
        });
        await erwarteJson(confirmVorher, 409);

        const zwischenstand = await fetch(
          `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=upload_status`,
          { headers: restHeaders() },
        );
        const [zwischenzeile] = (await erwarteJson(zwischenstand, 200)) as Array<
          { upload_status: string }
        >;
        assertEquals(zwischenzeile.upload_status, 'pending');

        // 4) thumb mit echtem Inhalt nachliefern, confirm muss jetzt annehmen
        const thumbPutEcht = await fetch(thumb_url, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: 'echte-thumb-bytes',
        });
        assertEquals(thumbPutEcht.status, 200, await thumbPutEcht.text());

        const confirmNachher = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ aktion: 'confirm', post_id: postId }),
        });
        assertEquals(await erwarteJson(confirmNachher, 200), { ok: true });

        // 5) Schlüssel-Rückschreibung: die Zeile muss jetzt den
        // server-abgeleiteten Pfad tragen, nicht mehr den Platzhalter.
        const endstand = await fetch(
          `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=storage_key,thumb_key,upload_status`,
          { headers: restHeaders() },
        );
        const [endzeile] = (await erwarteJson(endstand, 200)) as Array<
          { storage_key: string; thumb_key: string; upload_status: string }
        >;
        assertEquals(endzeile.storage_key, erwartet.storage_key);
        assertEquals(endzeile.thumb_key, erwartet.thumb_key);
        assertNotEquals(endzeile.storage_key, 'trips/falsch/platzhalter.jpg');
        assertEquals(endzeile.upload_status, 'uploaded');
      } finally {
        // Test-Objekte aus dem Bucket entfernen, damit wiederholte Läufe
        // nicht liegen bleiben. Kein "content-type: application/json" ohne
        // Body: die Storage-API (Fastify) lehnt das mit 400 ab ("Body cannot
        // be empty when content-type is set to..."), darum bewusst eigene,
        // schlankere Header statt restHeaders() — und der Status wird
        // geprüft statt stillschweigend verworfen, sonst reisst genau die
        // Art von unbemerktem Fehlschlag wieder auf, die dieser ganze
        // Fix-Runde-Zyklus behebt.
        for (const key of [erwartet.storage_key, erwartet.thumb_key]) {
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
            method: 'DELETE',
            headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          }).catch((err) => {
            console.warn(`Aufräumen von ${key} fehlgeschlagen (Netzwerk):`, err);
            return null;
          });
          if (res && !res.ok) {
            console.warn(`Aufräumen von ${key} fehlgeschlagen: HTTP ${res.status}`, await res.text());
          }
        }
      }
    } finally {
      // Cascade räumt trip_members und posts der Test-Reise mit auf.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch((err) => {
        console.warn('Aufräumen der Test-Reise fehlgeschlagen (Netzwerk):', err);
        return null;
      });
      if (res && !res.ok) {
        console.warn(`Aufräumen der Test-Reise fehlgeschlagen: HTTP ${res.status}`, await res.text());
      }
    }
  },
});
