// Integration test for `confirm`, automates exactly the two things that so
// far only a manual curl run has checked (Task-5 review fix round 1):
//   1. Key write-back: after `confirm`, posts.storage_key/thumb_key carry
//      the server-derived values, no longer the (deliberately wrong) client
//      value from the insert.
//   2. 0-byte rejection: an object with content-length 0 does not count as
//      uploaded, `confirm` responds with 409, `upload_status` stays
//      `pending`.
//
// Not a unit test: `index.ts` deliberately exports nothing (Deno.serve
// directly in the module, see the security reasoning there) and was NOT
// touched for this task ("Nicht ändern: den Code der Function selbst").
// This test therefore calls the function over real HTTP, exactly like a
// client, and so needs a running local instance AND a running
// `supabase functions serve media-urls` process with a valid S3 environment
// (supabase/functions/.env, see .env.example). Without both, the test skips
// itself (with a log line) instead of failing, it should not turn a machine
// with no running stack red.
//
// Fixture: its own trip + its own post, created/cleaned up in the test
// itself (author: the seed.sql user Lea, whose profile already exists). The
// Norway seed data from seed.sql stays untouched.
//
// To run (leave in terminal 1: `supabase functions serve media-urls
// --env-file supabase/functions/.env`), then in terminal 2:
//   cd supabase/functions/media-urls
//   npx deno test --allow-net --allow-run=supabase confirm_integration_test.ts

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import { expectedKeys } from './keys.ts';

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

// Self-signed HS256 JWT against the local project secret, the same
// technique used to check the security rules during this task's manual live
// test already (auth.sms.test_otp in config.toml covers only two numbers,
// not the one needed here).
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

// NEVER hardcode values here (not even as a "practical" fallback), that was
// exactly finding 1 of this fix round: they differ per project/machine.
// `supabase status` is the only source.
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

// Detects specifically OUR function (JSON with an "error" field), not just
// any response from Kong; a 404 from Kong, because nothing is being served,
// is otherwise easily mistaken for "the function is running, it just
// reports an error".
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
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/media-urls`;

const stackReady = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET &&
    (await functionReachable(FUNCTION_URL, ANON_KEY)),
);

if (!stackReady) {
  console.warn(
    'confirm_integration_test: übersprungen, braucht `supabase start` UND ' +
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

// Reads the body exactly once (as text), checks the status with it as the
// error message, and only then parses as JSON; .json() AND .text() on the
// same Response would be "Body already consumed".
async function expectJson(res: Response, expectedStatus: number): Promise<unknown> {
  const text = await res.text();
  assertEquals(res.status, expectedStatus, text);
  return text.length > 0 ? JSON.parse(text) : null;
}

Deno.test({
  name: 'confirm writes storage_key/thumb_key back and rejects 0-byte objects',
  ignore: !stackReady,
  async fn() {
    // Its own trip + its own post instead of seed.sql fixtures: robust
    // against changes to seed.sql, leaves no trace there. The
    // trips_add_owner_membership trigger creates Lea's trip_members row
    // automatically.
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
    const [trip] = (await expectJson(tripRes, 201)) as Array<{ id: string }>;
    const tripId: string = trip.id;

    try {
      const postRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          // Deliberately wrong, exactly the state fix round 1 addresses: a
          // client value that does not match the server-derived path and
          // that `confirm` must overwrite after the fix.
          storage_key: 'trips/falsch/platzhalter.jpg',
          thumb_key: null,
          captured_at: new Date().toISOString(),
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [post] = (await expectJson(postRes, 201)) as Array<{ id: string }>;
      const postId: string = post.id;

      const expected = expectedKeys(tripId, postId, 'photo', 'jpg');
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
          body: JSON.stringify({ action: 'sign', post_id: postId }),
        });
        const { medium_url, thumb_url } = (await expectJson(signRes, 200)) as {
          medium_url: string;
          thumb_url: string;
        };

        // 2) upload the medium with real content, the thumb deliberately
        // with 0 bytes. Set content-type explicitly: the bucket is
        // restricted to image/jpeg and video/mp4 (config.toml), otherwise
        // fetch would send "text/plain;charset=UTF-8" and the storage API
        // would reject it.
        const mediumPut = await fetch(medium_url, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: 'echte-jpeg-bytes',
        });
        assertEquals(mediumPut.status, 200, await mediumPut.text());
        const emptyThumbPut = await fetch(thumb_url, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: '',
        });
        assertEquals(emptyThumbPut.status, 200, await emptyThumbPut.text());

        // 3) confirm must reject, a 0-byte object does not count as proof
        const confirmBefore = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ action: 'confirm', post_id: postId }),
        });
        await expectJson(confirmBefore, 409);

        const midway = await fetch(
          `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=upload_status`,
          { headers: restHeaders() },
        );
        const [midwayRow] = (await expectJson(midway, 200)) as Array<
          { upload_status: string }
        >;
        assertEquals(midwayRow.upload_status, 'pending');

        // 4) deliver real thumb content afterwards, confirm must now accept
        const realThumbPut = await fetch(thumb_url, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: 'echte-thumb-bytes',
        });
        assertEquals(realThumbPut.status, 200, await realThumbPut.text());

        const confirmAfter = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ action: 'confirm', post_id: postId }),
        });
        assertEquals(await expectJson(confirmAfter, 200), { ok: true });

        // 5) key write-back: the row must now carry the server-derived
        // path, no longer the placeholder.
        const finalState = await fetch(
          `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=storage_key,thumb_key,upload_status`,
          { headers: restHeaders() },
        );
        const [finalRow] = (await expectJson(finalState, 200)) as Array<
          { storage_key: string; thumb_key: string; upload_status: string }
        >;
        assertEquals(finalRow.storage_key, expected.storage_key);
        assertEquals(finalRow.thumb_key, expected.thumb_key);
        assertNotEquals(finalRow.storage_key, 'trips/falsch/platzhalter.jpg');
        assertEquals(finalRow.upload_status, 'uploaded');
      } finally {
        // Remove the test objects from the bucket, so repeated runs do not
        // leave anything behind. No "content-type: application/json"
        // without a body: the storage API (Fastify) rejects that with 400
        // ("Body cannot be empty when content-type is set to..."), hence
        // deliberately leaner headers instead of restHeaders(), and the
        // status is checked instead of silently discarded, otherwise
        // exactly the kind of unnoticed failure this whole fix-round cycle
        // addresses would reopen.
        for (const key of [expected.storage_key, expected.thumb_key]) {
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
      // Cascade cleans up trip_members and posts of the test trip too.
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
