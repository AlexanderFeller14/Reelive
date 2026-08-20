// Integration test for the four store paths of the share notification, i.e.
// exactly the part `notification_test.ts` CANNOT prove: there a fake
// store dictates the answers, here they come from real Postgres.
//
// What gets checked is what a fake store by definition cannot show:
//   1. `fetchMembers` returns the members of EXACTLY this trip, not another
//      one's (the `.eq('trip_id', …)` clause).
//   2. `fetchTokens` returns only the tokens of the given people.
//   3. `deleteTokens` carries `.in('user_id', userIds)` IN ADDITION to
//      `.in('token', tokens)`: a token outside the notified circle stays
//      untouched, even if its value sits in `tokens`. Same guarantee, same
//      reason as in reveal-trip/revealStore_integration_test.ts, and the
//      same reason it has its own test there: a position-based ticket
//      mapping must not clear half the table on failure.
//   4. `fetchDisplayName` returns the right person's name.
//
// Deliberately WITHOUT HTTP and without Expo: the store is called directly,
// it only needs a running `supabase start`, no `functions serve`.
//
// Without a stack the test skips itself with a log line, instead of turning
// a machine with no Docker red.
//
// To run:
//   cd supabase/functions
//   deno test --allow-net --allow-run=supabase share-link/notificationStore_integration_test.ts

import { assertEquals } from 'jsr:@std/assert@1';
import { createAdminClient, createShareStore } from './store.ts';

// From supabase/seed.sql.
const LEA = '11111111-1111-4111-8111-111111111111';
const MIRA = '33333333-3333-4333-8333-333333333333';
const JONAS = '44444444-4444-4444-8444-444444444444';
// Sofia is in Norway and Sardinia, but NOT in Lisbon. That is exactly what
// makes her the useful counter-check: the other three are in both trips, a
// missing trip_id clause would not be detectable through them.
const SOFIA = '55555555-5555-4555-8555-555555555555';
const LISBON = 'aaaaaaaa-0000-4000-8000-000000000002';
const NORWAY = 'aaaaaaaa-0000-4000-8000-000000000001';

async function supabaseStatusEnv(): Promise<Record<string, string> | null> {
  try {
    const cmd = new Deno.Command('supabase', {
      args: ['status', '-o', 'env'],
      stdout: 'piped',
      stderr: 'null',
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return null;
    const env: Record<string, string> = {};
    for (const line of new TextDecoder().decode(stdout).split('\n')) {
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
    'notificationStore_integration_test: skipped, needs `supabase start`. Details in the file header.',
  );
}

function store() {
  return createShareStore(createAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY));
}

// The test tokens carry their own prefix and are cleaned up before AND
// after every test: an aborted run should not taint the next one.
const PREFIX = 'IntegrationstestToken';

async function clearTokens(): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=like.${PREFIX}*`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
}

async function createToken(userId: string, token: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: userId, token, platform: 'ios' }),
  });
  if (!res.ok) throw new Error(`push_tokens-Insert: ${res.status} ${await res.text()}`);
}

Deno.test({
  name: 'fetchMembers returns the members of EXACTLY this trip',
  ignore: !stackReady,
  async fn() {
    const { data, error } = await store().fetchMembers(LISBON);
    assertEquals(error, null);
    const ids = (data ?? []).map((m) => m.user_id).sort();
    assertEquals(ids, [LEA, MIRA, JONAS].sort());

    // The counter-check, and it hinges on Sofia: she is in Norway, but not
    // in Lisbon. Without a trip_id clause she would show up in the list
    // above too.
    assertEquals(ids.includes(SOFIA), false);
    const other = await store().fetchMembers(NORWAY);
    assertEquals(other.error, null);
    assertEquals((other.data ?? []).map((m) => m.user_id).includes(SOFIA), true);
  },
});

Deno.test({
  name: 'fetchTokens returns only the tokens of the given people',
  ignore: !stackReady,
  async fn() {
    await clearTokens();
    try {
      await createToken(MIRA, `${PREFIX}[mira]`);
      await createToken(JONAS, `${PREFIX}[jonas]`);
      await createToken(LEA, `${PREFIX}[lea]`);

      const { data, error } = await store().fetchTokens([MIRA, JONAS]);
      assertEquals(error, null);
      const tokens = (data ?? []).map((t) => t.token).sort();
      assertEquals(tokens, [`${PREFIX}[jonas]`, `${PREFIX}[mira]`]);
    } finally {
      await clearTokens();
    }
  },
});

// The most important test in this file. The ticket-to-token mapping in
// push.ts is purely position-based; should Expo ever return a shifted
// block, `tokens` would hold a value belonging to a completely different
// person. The second restriction limits the damage to the notified circle.
Deno.test({
  name: 'deleteTokens clears ONLY within the notified circle',
  ignore: !stackReady,
  async fn() {
    await clearTokens();
    try {
      await createToken(MIRA, `${PREFIX}[mira]`);
      await createToken(LEA, `${PREFIX}[lea]`);

      // Both tokens reported "dead", but only Mira was notified.
      const { error } = await store().deleteTokens(
        [`${PREFIX}[mira]`, `${PREFIX}[lea]`],
        [MIRA],
      );
      assertEquals(error, null);

      const remaining = await store().fetchTokens([MIRA, LEA]);
      assertEquals((remaining.data ?? []).map((t) => t.token), [`${PREFIX}[lea]`]);
    } finally {
      await clearTokens();
    }
  },
});

Deno.test({
  name: 'fetchDisplayName returns the right person\'s name',
  ignore: !stackReady,
  async fn() {
    const mira = await store().fetchDisplayName(MIRA);
    assertEquals(mira.error, null);
    assertEquals(typeof mira.data, 'string');

    const lea = await store().fetchDisplayName(LEA);
    assertEquals(lea.error, null);
    // Two different people, two different names: without this counter-check
    // even a query with no id filter would pass.
    assertEquals(mira.data === lea.data, false);
  },
});

// A person that does not exist has no name, and that is NOT an error:
// `sendSharePush` then sends the notification with no name, instead of
// withholding it.
Deno.test({
  name: 'an unknown account returns null instead of an error',
  ignore: !stackReady,
  async fn() {
    const { data, error } = await store().fetchDisplayName('00000000-0000-4000-8000-000000000000');
    assertEquals(error, null);
    assertEquals(data, null);
  },
});
