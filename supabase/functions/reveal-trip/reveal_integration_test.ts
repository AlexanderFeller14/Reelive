// End-to-End-Rauchtest für reveal-trip: echte HTTP-Aufrufe gegen die
// laufende Function, nicht nur gegen die herausgelösten Bausteine. Die
// eigentliche Verzweigungslogik ist bereits in reveal_test.ts (ohne Docker)
// und die beiden DB-kritischen Abfragen in revealStore_integration_test.ts
// (ohne HTTP) bewiesen — diese Datei bestätigt zusätzlich, dass die
// Verdrahtung selbst stimmt: Deno.serve → fuehreRevealAus → der echte
// RevealStore, End-to-End über echtes JWT/HTTP, exakt wie die App es tut.
//
// Deckt die vier im Final-Review als Minimum genannten Fälle END-TO-END:
// Nicht-Owner -> 403, zweiter (sequenzieller) Aufruf -> gleicher revealed_at,
// archived -> 409. Der vierte Fall (fehlschlagender Push -> trotzdem 200)
// läuft hier implizit mit: die Test-Reise hat Mitglieder ohne
// push_tokens-Zeilen, `versendeRevealPush` bricht darum früh ab (keine
// Tokens) — das ECHTE "Push wirft" wird deterministisch (ohne Abhängigkeit
// von echtem Netz zu Expo) bereits in reveal_test.ts geprüft.
//
// Ohne laufenden Stack UND einen `supabase functions serve`-Prozess für
// reveal-trip überspringt sich der Test mit einer Log-Zeile (Muster wie
// ../media-urls/lesen_test.ts).
//
// Ausführen (Terminal 1: `supabase functions serve --env-file
// supabase/functions/.env`), dann in Terminal 2:
//   cd supabase/functions/reveal-trip
//   npx deno test --allow-net --allow-run=supabase reveal_integration_test.ts

import { assertEquals, assertExists } from 'jsr:@std/assert';

const LEA_ID = '11111111-1111-4111-8111-111111111111'; // Owner (seed.sql)
const MIRA_ID = '33333333-3333-4333-8333-333333333333'; // Mitglied (seed.sql)

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
const FUNCTION_URL = envOderNull('REVEAL_TRIP_URL') ?? `${SUPABASE_URL}/functions/v1/reveal-trip`;

const stackBereit = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET &&
    (await functionErreichbar(FUNCTION_URL, ANON_KEY)),
);

if (!stackBereit) {
  console.warn(
    'reveal_integration_test: übersprungen — braucht `supabase start` UND ' +
      '`supabase functions serve --env-file supabase/functions/.env` in einem zweiten Terminal.',
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

Deno.test({
  name: 'reveal-trip End-to-End: Nicht-Owner 403, Owner reveals, zweiter Aufruf idempotent',
  ignore: !stackBereit,
  async fn() {
    const tripRes = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        name: 'Integrationstest reveal-trip',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
        owner_id: LEA_ID,
      }),
    });
    const [trip] = (await erwarteJson(tripRes, 201)) as Array<{ id: string; status: string }>;
    const tripId: string = trip.id;
    assertEquals(trip.status, 'active');

    try {
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trip_members`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ trip_id: tripId, user_id: MIRA_ID, role: 'member' }),
        }),
        201,
      );

      const leaJwt = await mintJwt(JWT_SECRET, LEA_ID);
      const miraJwt = await mintJwt(JWT_SECRET, MIRA_ID);
      const leaHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${leaJwt}`, 'content-type': 'application/json' };
      const miraHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${miraJwt}`, 'content-type': 'application/json' };

      const reveal = (headers: Record<string, string>) =>
        fetch(FUNCTION_URL, { method: 'POST', headers, body: JSON.stringify({ trip_id: tripId }) });

      // --- Nicht-Owner -> 403, Zustand unverändert ------------------------
      const nichtOwner = await reveal(miraHeaders);
      assertEquals(await erwarteJson(nichtOwner, 403), {
        fehler: 'Nur wer die Reise angelegt hat, kann sie abschliessen.',
      });
      const nachNichtOwner = (await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}&select=status`, { headers: restHeaders() }),
        200,
      )) as Array<{ status: string }>;
      assertEquals(nachNichtOwner[0].status, 'active');

      // --- Owner reveals -> 200 -------------------------------------------
      const ersterAufruf = await reveal(leaHeaders);
      const ersteAntwort = (await erwarteJson(ersterAufruf, 200)) as { ok: boolean; revealed_at: string };
      assertEquals(ersteAntwort.ok, true);
      assertExists(ersteAntwort.revealed_at);

      // --- zweiter (sequenzieller) Aufruf -> derselbe revealed_at ---------
      const zweiterAufruf = await reveal(leaHeaders);
      const zweiteAntwort = (await erwarteJson(zweiterAufruf, 200)) as { ok: boolean; revealed_at: string };
      assertEquals(zweiteAntwort.revealed_at, ersteAntwort.revealed_at);

      // --- archived -> 409 --------------------------------------------------
      await erwarteJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'archived' }),
        }),
        200,
      );
      const archivAufruf = await reveal(leaHeaders);
      assertEquals(await erwarteJson(archivAufruf, 409), { fehler: 'Diese Reise ist schon archiviert.' });
    } finally {
      await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch((err) => console.warn('Aufräumen der Test-Reise fehlgeschlagen (Netzwerk):', err));
    }
  },
});
