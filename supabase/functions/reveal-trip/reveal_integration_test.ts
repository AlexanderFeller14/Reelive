// End-to-end smoke test for reveal-trip: real HTTP calls against the
// running function, not just against the extracted building blocks. The
// actual branching logic is already proven in reveal_test.ts (with no
// Docker) and the two DB-critical queries in
// revealStore_integration_test.ts (with no HTTP), this file additionally
// confirms that the wiring itself is right: Deno.serve -> performReveal ->
// the real RevealStore, end-to-end over real JWT/HTTP, exactly the way the
// app does it.
//
// Covers the four cases named as a minimum in the final review END-TO-END:
// non-owner -> 403, second (sequential) call -> same revealed_at, archived
// -> 409. The fourth case (a failing push -> still 200) runs here
// implicitly: the test trip has members with no push_tokens rows,
// `sendRevealPush` therefore aborts early (no tokens), the REAL "push
// throws" is already checked deterministically (with no dependency on real
// network to Expo) in reveal_test.ts.
//
// Without a running stack AND a `supabase functions serve` process for
// reveal-trip, the test skips itself with a log line (pattern like
// ../media-urls/read_integration_test.ts).
//
// To run (terminal 1: `supabase functions serve --env-file
// supabase/functions/.env`), then in terminal 2:
//   cd supabase/functions/reveal-trip
//   npx deno test --allow-net --allow-run=supabase reveal_integration_test.ts

import { assertEquals, assertExists } from 'jsr:@std/assert';

const LEA_ID = '11111111-1111-4111-8111-111111111111'; // owner (seed.sql)
const MIRA_ID = '33333333-3333-4333-8333-333333333333'; // member (seed.sql)

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

function envOrNull(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    return null;
  }
}

async function functionReachable(url: string, anonKey: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json().catch(() => null);
    return Boolean(data && typeof data === 'object' && 'error' in data);
  } catch {
    return false;
  }
}

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = statusEnv?.ANON_KEY ?? '';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';
const JWT_SECRET = statusEnv?.JWT_SECRET ?? '';
const FUNCTION_URL = envOrNull('REVEAL_TRIP_URL') ?? `${SUPABASE_URL}/functions/v1/reveal-trip`;

const stackReady = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET &&
    (await functionReachable(FUNCTION_URL, ANON_KEY)),
);

if (!stackReady) {
  console.warn(
    'reveal_integration_test: übersprungen, braucht `supabase start` UND ' +
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

async function expectJson(res: Response, expectedStatus: number): Promise<unknown> {
  const text = await res.text();
  assertEquals(res.status, expectedStatus, text);
  return text.length > 0 ? JSON.parse(text) : null;
}

Deno.test({
  name: 'reveal-trip End-to-End: Nicht-Owner 403, Owner reveals, zweiter Aufruf idempotent',
  ignore: !stackReady,
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
    const [trip] = (await expectJson(tripRes, 201)) as Array<{ id: string; status: string }>;
    const tripId: string = trip.id;
    assertEquals(trip.status, 'active');

    try {
      await expectJson(
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

      // --- Non-owner -> 403, state unchanged --------------------------------
      const nonOwner = await reveal(miraHeaders);
      assertEquals(await expectJson(nonOwner, 403), {
        error: 'Nur wer die Reise angelegt hat, kann sie abschliessen.',
      });
      const afterNonOwner = (await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}&select=status`, { headers: restHeaders() }),
        200,
      )) as Array<{ status: string }>;
      assertEquals(afterNonOwner[0].status, 'active');

      // --- Owner reveals -> 200 ----------------------------------------------
      const firstCall = await reveal(leaHeaders);
      const firstResponse = (await expectJson(firstCall, 200)) as { ok: boolean; revealed_at: string };
      assertEquals(firstResponse.ok, true);
      assertExists(firstResponse.revealed_at);

      // --- second (sequential) call -> same revealed_at ----------------------
      const secondCall = await reveal(leaHeaders);
      const secondResponse = (await expectJson(secondCall, 200)) as { ok: boolean; revealed_at: string };
      assertEquals(secondResponse.revealed_at, firstResponse.revealed_at);

      // --- re-review finding: non-owner stays 403, even AFTER the reveal ----
      // The owner check has to apply before the status branches, not just
      // before the CAS update, otherwise any authenticated person who knows
      // the trip_id would get 200 instead of 403 for an already-revealed
      // trip (slipping into someone else's idempotent branch).
      const nonOwnerAfterReveal = await reveal(miraHeaders);
      assertEquals(await expectJson(nonOwnerAfterReveal, 403), {
        error: 'Nur wer die Reise angelegt hat, kann sie abschliessen.',
      });

      // --- archived -> 409 --------------------------------------------------
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'archived' }),
        }),
        200,
      );
      const archiveCall = await reveal(leaHeaders);
      assertEquals(await expectJson(archiveCall, 409), { error: 'Diese Reise ist schon archiviert.' });

      // --- non-owner stays 403, even for an archived trip --------------------
      const nonOwnerAfterArchive = await reveal(miraHeaders);
      assertEquals(await expectJson(nonOwnerAfterArchive, 403), {
        error: 'Nur wer die Reise angelegt hat, kann sie abschliessen.',
      });
    } finally {
      await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch((err) => console.warn('Aufräumen der Test-Reise fehlgeschlagen (Netzwerk):', err));
    }
  },
});
