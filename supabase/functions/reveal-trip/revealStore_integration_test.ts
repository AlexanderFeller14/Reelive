// Integration test for revealStore.ts, exactly the two queries no fake
// store in reveal_test.ts can prove, because it dictates the CAS semantics
// itself instead of deriving them from real Postgres:
//   1. updateIfActive carries `.eq('status','active')` in the real update,
//      two GENUINELY parallel calls may only ever produce one winner
//      (final-review mutation 2: removing this clause would let a race let
//      both calls commit, with different timestamps).
//   2. deleteTokens carries `.in('user_id', userIds)` in addition to
//      `.in('token', tokens)`, a token that does not belong to the notified
//      recipient circle stays untouched, even if its value sits in
//      `tokens` (final-review mutation 6).
//
// Deliberately with NO detour through HTTP or Expo: `createRevealStore` is
// called directly, no `Deno.serve`, no `functions serve` process needed,
// only a running `supabase start` (Postgres + PostgREST + Auth). That makes
// the test faster and more robust than a call through the real function,
// without checking the two queries themselves any less thoroughly: these
// are exactly the same store methods index.ts calls through reveal.ts.
//
// Without a running stack the test skips itself with a log line, instead of
// turning a machine with no Docker red (pattern like read_integration_test.ts /
// confirm_integration_test.ts in ../media-urls).
//
// To run:
//   cd supabase/functions/reveal-trip
//   npx deno test --allow-net --allow-run=supabase revealStore_integration_test.ts

import { assert, assertEquals } from 'jsr:@std/assert';
import { createAdminClient, createRevealStore } from './revealStore.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';
const MIRA_ID = '33333333-3333-4333-8333-333333333333';
const JONAS_ID = '44444444-4444-4444-8444-444444444444';

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

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';

// Check reachability directly via the REST API, this file needs no served
// edge function, only Postgres/PostgREST/Auth.
async function restReachable(): Promise<boolean> {
  if (!SERVICE_ROLE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?select=id&limit=1`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const stackReady = Boolean(statusEnv && SERVICE_ROLE_KEY && (await restReachable()));

if (!stackReady) {
  console.warn(
    'revealStore_integration_test: übersprungen, braucht `supabase start`. Details im Datei-Header.',
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

async function newTrip(status: 'active' | 'revealed' | 'archived' = 'active'): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      name: 'Integrationstest revealStore',
      start_date: '2026-01-01',
      end_date: '2026-01-02',
      owner_id: LEA_ID,
      status,
      ...(status !== 'active' ? { revealed_at: '2026-01-03T00:00:00Z' } : {}),
    }),
  });
  const [trip] = (await expectJson(res, 201)) as Array<{ id: string }>;
  return trip.id;
}

async function deleteTrip(tripId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, { method: 'DELETE', headers: restHeaders() }).catch(
    () => null,
  );
}

// --- 1. CAS race: two genuinely parallel calls, only one winner -----------
Deno.test({
  name: 'updateIfActive: zwei parallele Aufrufe committen nur einmal (CAS-Bedingung im echten Update)',
  ignore: !stackReady,
  async fn() {
    const tripId = await newTrip('active');
    try {
      const supabaseAdmin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const store = createRevealStore(supabaseAdmin);

      // Several parallel calls instead of just two: raises the odds of
      // actually hitting the window in which both (or more) see the
      // starting state 'active' before the first one commits.
      const RESULTS = await Promise.all(
        Array.from({ length: 6 }, () => store.updateIfActive(tripId)),
      );

      const winners = RESULTS.filter((r) => r.data !== null);
      const losers = RESULTS.filter((r) => r.data === null && r.error === null);

      assertEquals(winners.length, 1, `genau ein Aufruf darf gewinnen, tatsächlich: ${winners.length}`);
      assertEquals(
        losers.length,
        5,
        `die übrigen fünf müssen 0 Zeilen (data:null, kein Fehler) sehen, tatsächlich: ${losers.length}`,
      );

      // The committed state matches the winner, no second, later write
      // overwrote it.
      const { data: after } = await store.fetchRevealedAtFollowUp(tripId);
      assertEquals(after?.revealed_at, winners[0].data?.revealed_at);
    } finally {
      await deleteTrip(tripId);
    }
  },
});

Deno.test({
  name: 'updateIfActive: eine bereits revealed Reise liefert data:null (CAS greift nicht mehr)',
  ignore: !stackReady,
  async fn() {
    const tripId = await newTrip('revealed');
    try {
      const supabaseAdmin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const store = createRevealStore(supabaseAdmin);

      const { data, error } = await store.updateIfActive(tripId);
      assertEquals(data, null);
      assertEquals(error, null);
    } finally {
      await deleteTrip(tripId);
    }
  },
});

// --- 2. Recipient restriction when deleting tokens --------------------------
Deno.test({
  name: 'deleteTokens: ein Token ausserhalb der userIds-Einschränkung bleibt unangetastet, selbst wenn sein Wert in tokens steht',
  ignore: !stackReady,
  async fn() {
    const supabaseAdmin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const store = createRevealStore(supabaseAdmin);

    const TOKEN_MIRA = `tok-integration-mira-${crypto.randomUUID()}`;
    const TOKEN_JONAS = `tok-integration-jonas-${crypto.randomUUID()}`;

    await expectJson(
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify([
          { token: TOKEN_MIRA, user_id: MIRA_ID, platform: 'ios' },
          { token: TOKEN_JONAS, user_id: JONAS_ID, platform: 'android' },
        ]),
      }),
      201,
    );

    try {
      // tokens contains BOTH values, but userIds restricts to Mira alone,
      // exactly the situation from mutation 6: Jonas's token must not drop,
      // even if its value had (wrongly, or via a shifted Expo response)
      // ended up in `tokens` too.
      const { error } = await store.deleteTokens([TOKEN_MIRA, TOKEN_JONAS], [MIRA_ID]);
      assertEquals(error, null);

      const after = (await expectJson(
        await fetch(
          `${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})&select=token,user_id`,
          { headers: restHeaders() },
        ),
        200,
      )) as Array<{ token: string; user_id: string }>;

      assertEquals(after.map((r) => r.token), [TOKEN_JONAS], 'nur Jonas’ Token überlebt, Miras wurde gelöscht');
      assert(
        !after.some((r) => r.token === TOKEN_MIRA),
        'Miras Token (innerhalb der userIds-Einschränkung) wurde tatsächlich gelöscht',
      );
    } finally {
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch(() => null);
    }
  },
});

Deno.test({
  name: 'deleteTokens: liegen beide Tokens innerhalb der userIds-Einschränkung, werden beide gelöscht',
  ignore: !stackReady,
  async fn() {
    const supabaseAdmin = createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const store = createRevealStore(supabaseAdmin);

    const TOKEN_MIRA = `tok-integration-mira-${crypto.randomUUID()}`;
    const TOKEN_JONAS = `tok-integration-jonas-${crypto.randomUUID()}`;

    await expectJson(
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify([
          { token: TOKEN_MIRA, user_id: MIRA_ID, platform: 'ios' },
          { token: TOKEN_JONAS, user_id: JONAS_ID, platform: 'android' },
        ]),
      }),
      201,
    );

    try {
      const { error } = await store.deleteTokens([TOKEN_MIRA, TOKEN_JONAS], [MIRA_ID, JONAS_ID]);
      assertEquals(error, null);

      const after = (await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})&select=token`, {
          headers: restHeaders(),
        }),
        200,
      )) as Array<{ token: string }>;
      assertEquals(after, []);
    } finally {
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=in.(${TOKEN_MIRA},${TOKEN_JONAS})`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch(() => null);
    }
  },
});
