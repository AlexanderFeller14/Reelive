// Integration test for the `read` action, the system's first read path.
//
// Why this test weighs more than its line count suggests: until Phase 5 the
// seal was protected by the fact that `media-urls` only ever issued PUT
// URLs. There simply was no way to get at anyone's bytes, foreign or your
// own. Now there is one, and what holds it back is a check chain in
// TypeScript instead of a missing function. This test is the evidence that
// the chain holds, above all case 1: **before the reveal there is no URL,
// not even for the moment's own author.** That is not an edge case, that is
// the product.
//
// Covered (numbers as in the task brief):
//   1. Before the reveal, `read` responds with 403, even for the author.
//   2. For a non-member, 403, checked AFTER the reveal, otherwise the seal
//      would already reject and the membership check would stay untested.
//   3. After the reveal a member gets URLs, and a GET against them returns
//      the uploaded bytes.
//   4. A PUT against a read URL fails (SigV4 takes the HTTP method as the
//      first line of the canonical request), and the object is
//      demonstrably unchanged afterwards.
//   5. Moments with upload_status='pending' are missing from the response.
// Plus, because they are cheap and obvious from an attacker's perspective:
// unknown trip_id -> 404, archived trip -> still readable, read URL
// validity = 3600s against 600s for upload, thumb_url is absent when
// thumb_key = null, and three attack rows: one whose stored thumb_key
// points at a FOREIGN trip still only gets the derived thumb_url of its own
// trip (row D); one whose storage_key points there falls out of the
// response entirely and is counted in `skipped` (row E); and one that sits
// in a different trip but carries a storage_key matching OUR trip is the
// only row that can even show the trip scoping of the select (row F).
//
// Structured like confirm_integration_test.ts: not a unit test (index.ts
// deliberately exports nothing, Deno.serve sits directly in the module),
// but real HTTP calls against a running local stack. Without a stack, the
// test skips itself with a log line, instead of turning a machine with no
// Docker red.
//
// To run (leave terminal 1 open: `supabase functions serve media-urls
// --env-file supabase/functions/.env`), then in terminal 2:
//   cd supabase/functions/media-urls
//   npx deno test --allow-net --allow-run=supabase read_integration_test.ts
//
// If the function happens to run elsewhere (e.g. directly on the host,
// because the edge runtime container is currently serving a different
// working folder's sources), MEDIA_URLS_URL points the test there, plus
// --allow-env. Without that permission the test silently falls back to the
// default path instead of hanging on a permission prompt.

import { assert, assertEquals, assertExists, assertFalse } from 'jsr:@std/assert';
import { expectedKeys } from './keys.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';
// Ben is created in seed.sql but not a member of any trip, exactly the role
// needed here. His case also covers the removed fellow traveller: a missing
// `trip_members` row means the same as never having been there, regardless
// of whether they know the trip_id.
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const BUCKET = 'media';
const MEDIUM_CONTENT = 'echte-jpeg-bytes-fuer-den-lesetest';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

// Self-signed HS256 JWT against the local project secret, the same
// technique as in confirm_integration_test.ts (auth.sms.test_otp in
// config.toml only covers two numbers and would not deliver a token for an
// automated run anyway).
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

// NEVER hardcode values here: they differ per project/machine. `supabase
// status` is the only source.
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

// Without --allow-env, Deno.env.get throws; that is not an error here, but
// the normal case (see the header).
function envOrNull(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    return null;
  }
}

// Detects specifically OUR function (JSON with an "error" field), not just
// any response from Kong.
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
const FUNCTION_URL = envOrNull('MEDIA_URLS_URL') ?? `${SUPABASE_URL}/functions/v1/media-urls`;

const stackReady = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET &&
    (await functionReachable(FUNCTION_URL, ANON_KEY)),
);

if (!stackReady) {
  console.warn(
    'lesen_test: übersprungen, braucht `supabase start` UND ' +
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

type ReadResponse = {
  media: Array<{ post_id: string; medium_url: string; thumb_url?: string }>;
  valid_until: string;
  skipped: number;
};

Deno.test({
  name: 'read only hands out media after the reveal, and only to members',
  ignore: !stackReady,
  async fn() {
    // Its own trip + its own moments instead of seed.sql fixtures: robust
    // against changes to seed.sql, leaves no trace there. The
    // trips_add_owner_membership trigger creates Lea's trip_members row
    // automatically. The trip starts with status='active', sealed.
    const tripRes = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        name: 'Integrationstest media-urls lesen',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
        owner_id: LEA_ID,
      }),
    });
    const [trip] = (await expectJson(tripRes, 201)) as Array<{ id: string; status: string }>;
    const tripId: string = trip.id;
    assertEquals(trip.status, 'active');

    const leaJwt = await mintJwt(JWT_SECRET, LEA_ID);
    const benJwt = await mintJwt(JWT_SECRET, BEN_ID);
    const leaHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${leaJwt}`, 'content-type': 'application/json' };
    const benHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${benJwt}`, 'content-type': 'application/json' };

    const read = (headers: Record<string, string>, id: string) =>
      fetch(FUNCTION_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'read', trip_id: id }),
      });

    // Keys of the uploaded moment, for cleanup in the finally block.
    let uploadedKeys: string[] = [];
    // Second trip that only exists for case F, cleaned up in the finally
    // block too.
    let neighborTripId: string | null = null;

    try {
      // --- Fixtures -------------------------------------------------------
      // A: a real, fully uploaded moment (the only one with bytes in
      //    storage). captured_at deliberately the earliest of the three.
      const postARes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: 'trips/falsch/platzhalter.jpg',
          captured_at: '2026-01-01T08:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [postA] = (await expectJson(postARes, 201)) as Array<{ id: string }>;

      // B: submitted but never finished uploading, must not appear in any
      //    response (case 5). No object exists for it.
      const postBRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: `trips/${tripId}/pending.jpg`,
          captured_at: '2026-01-01T09:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [postB] = (await expectJson(postBRes, 201)) as Array<{ id: string; upload_status: string }>;
      assertEquals(postB.upload_status, 'pending');

      // C: uploaded, but with no thumb_key. This state can no longer arise
      //    via `confirm` today (it always writes both keys), but the column
      //    is nullable, and that is exactly what the test targets: no URL
      //    may ever be signed for "null". The id is given here up front, so
      //    the storage_key is the same derived path `confirm` would also
      //    write, an otherwise normal row.
      const postCId = crypto.randomUUID();
      const postCRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          id: postCId,
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: expectedKeys(tripId, postCId, 'photo', 'jpg').storage_key,
          thumb_key: null,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T10:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [postC] = (await expectJson(postCRes, 201)) as Array<{ id: string }>;

      // The two attack cases. No `authenticated` person can create rows
      // like these today, upload_status is excluded from the column grant
      // (20260803090600_role_hardening.sql, pinned down in
      // supabase/tests/07_role_hardening_test.sql and
      // 12_upload_status_test.sql) and there is no UPDATE on posts at all;
      // here in the test the service role writes them instead. The test
      // records what MUST happen if this guarantee is ever lifted,
      // otherwise a single loosened migration would be enough to read
      // arbitrary foreign media through your own trip.
      const FOREIGN_TRIP = '00000000-0000-4000-8000-00000000dead';

      // D: storage_key is fine, but thumb_key points at a foreign trip. So
      //    the entry stays in the response, and this is exactly what proves
      //    that the THUMB path too is derived and not taken from the
      //    column. A thumbnail is the content of a moment in miniature;
      //    security-wise the same is at stake here as with the medium.
      const postDId = crypto.randomUUID();
      const postDRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          id: postDId,
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: expectedKeys(tripId, postDId, 'photo', 'jpg').storage_key,
          thumb_key: `trips/${FOREIGN_TRIP}/00000000-0000-4000-8000-00000000beef_t.jpg`,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T11:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      await expectJson(postDRes, 201);

      // E: storage_key itself points at a foreign trip. Nothing to salvage
      //    here: the derived path would be a URL to nothing, the stored one
      //    must never be signed. So the moment drops out of the response
      //    entirely, and the function logs an error row. Rows from a
      //    foreign key scheme get the same treatment, which is why
      //    supabase/seed.sql has written its keys in the derived scheme
      //    since Phase 5.
      const postEId = crypto.randomUUID();
      const postERes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          id: postEId,
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: `trips/${FOREIGN_TRIP}/00000000-0000-4000-8000-00000000beef.jpg`,
          thumb_key: null,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T12:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      await expectJson(postERes, 201);

      // F: sits in an ANOTHER trip, but carries a storage_key pointing at
      //    OUR trip, namely exactly the path the derivation would produce
      //    for this post_id within our trip. That makes F the only row that
      //    can show the trip scoping of the select at all: drop
      //    `.eq('trip_id', …)` and the function scans the whole posts
      //    table, and F slips through the derivation comparison into the
      //    response, every other foreign moment would still be sorted out
      //    there. Without this fixture one of the action's core guarantees
      //    stays untested, and correctness would rest on the tripwire
      //    alone.
      const neighborRes = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          name: 'Integrationstest media-urls Nachbarreise',
          start_date: '2026-01-01',
          end_date: '2026-01-02',
          owner_id: LEA_ID,
        }),
      });
      const [neighbor] = (await expectJson(neighborRes, 201)) as Array<{ id: string }>;
      neighborTripId = neighbor.id;

      const postFId = crypto.randomUUID();
      const postFRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          id: postFId,
          trip_id: neighborTripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: expectedKeys(tripId, postFId, 'photo', 'jpg').storage_key,
          thumb_key: null,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T13:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      await expectJson(postFRes, 201);

      // Actually upload A, via the same path as the app: sign, PUT, confirm.
      // Only after that does the row carry the server-derived keys, and
      // only those may `read` sign.
      const signRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: leaHeaders,
        body: JSON.stringify({ action: 'sign', post_id: postA.id }),
      });
      const uploadUrls = (await expectJson(signRes, 200)) as { medium_url: string; thumb_url: string };
      uploadedKeys = [
        new URL(uploadUrls.medium_url).pathname.split(`/${BUCKET}/`)[1],
        new URL(uploadUrls.thumb_url).pathname.split(`/${BUCKET}/`)[1],
      ];

      // The upload URL's validity is right there in the URL itself, direct
      // evidence that the upload constant's 600s stays untouched, with no
      // dependency on clocks or run time.
      assertEquals(new URL(uploadUrls.medium_url).searchParams.get('X-Amz-Expires'), '600');

      for (const [url, content] of [
        [uploadUrls.medium_url, MEDIUM_CONTENT],
        [uploadUrls.thumb_url, 'echte-thumb-bytes'],
      ]) {
        const put = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: content });
        assertEquals(put.status, 200, await put.text());
      }
      const confirmRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: leaHeaders,
        body: JSON.stringify({ action: 'confirm', post_id: postA.id }),
      });
      assertEquals(await expectJson(confirmRes, 200), { ok: true });

      // --- Case 1: no URL before the reveal, not even for the author -----
      // Lea owns the trip, is a member, and is the author of all three
      // moments. If anyone were allowed to see anything before the reveal,
      // it would be her, exactly why 403 belongs here. The bytes
      // demonstrably sit in storage at this point (confirm above
      // succeeded): nothing is missing except permission.
      const sealed = await read(leaHeaders, tripId);
      assertEquals(await expectJson(sealed, 403), { error: 'Diese Reise ist noch versiegelt.' });

      // Unknown trip: 404, before anything else is even checked.
      const unknownTrip = await read(leaHeaders, '00000000-0000-4000-8000-0000000000ff');
      assertEquals(await expectJson(unknownTrip, 404), { error: 'Reise nicht gefunden.' });

      // --- Reveal ---------------------------------------------------------
      // Directly via the service role instead of through reveal-trip: this
      // test checks `read`, not the status change, and should not depend on
      // a second served function. The table's check constraint requires
      // both columns together.
      const revealRes = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ status: 'revealed', revealed_at: 'now' }),
      });
      await expectJson(revealRes, 200);

      // --- Case 2: non-member ----------------------------------------------
      // The trip is open now, so the seal no longer rejects Ben. What
      // rejects him is exclusively the missing trip_members row.
      const nonMember = await read(benHeaders, tripId);
      assertEquals(await expectJson(nonMember, 403), { error: 'Kein Zugriff auf diese Reise.' });

      // --- Case 3 + 5: a member gets URLs, pending is missing --------------
      const beforeTimestamp = Date.now();
      const okRes = await read(leaHeaders, tripId);
      const response = (await expectJson(okRes, 200)) as ReadResponse;

      // Exactly A, C and D, in captured_at order. B is missing (pending), E
      // is missing (storage_key does not match the derivation), and F is
      // missing because it belongs to a different trip, three different
      // reasons, one guarantee.
      assertEquals(response.media.map((m) => m.post_id), [postA.id, postC.id, postDId]);

      // E being skipped is visible to the app, instead of silently
      // shortening the recap. F does NOT count here: it simply does not
      // belong to this trip, so nothing is missing.
      assertEquals(response.skipped, 1);

      const entryA = response.media[0];
      const entryC = response.media[1];
      const entryD = response.media[2];

      // thumb_key = null => no thumb_url field, instead of a signature for
      // ".../null".
      assertExists(entryA.thumb_url);
      assertEquals(entryC.thumb_url, undefined);
      assertFalse(entryC.medium_url.includes('null'));

      // Not a single URL in the response points into the foreign trip,
      // neither as a medium nor as a thumbnail, and not through an entry
      // that gets overlooked while counting either.
      for (const entry of response.media) {
        assertFalse(
          entry.medium_url.includes(FOREIGN_TRIP) || (entry.thumb_url ?? '').includes(FOREIGN_TRIP),
          `lesen hat einen gespeicherten (fremden) Pfad signiert: ${JSON.stringify(entry)}`,
        );
      }

      // Row D specifically: the stored thumb_key points into the foreign
      // trip, the issued thumb_url still has to be this trip's derived
      // path. Without this guarantee the derivation would only be pinned
      // down for medium_url, and a thumbnail of a foreign, sealed trip is
      // its content in miniature.
      const expectedD = expectedKeys(tripId, postDId, 'photo', 'jpg');
      assertExists(entryD.thumb_url);
      assertEquals(new URL(entryD.thumb_url).pathname.endsWith(expectedD.thumb_key), true);
      assertEquals(new URL(entryD.medium_url).pathname.endsWith(expectedD.storage_key), true);

      // And the normal row C points exactly where it should, the derivation
      // matches the column for legitimate data.
      assert(
        new URL(entryC.medium_url).pathname.endsWith(
          expectedKeys(tripId, postC.id, 'photo', 'jpg').storage_key,
        ),
        `unerwarteter Pfad: ${entryC.medium_url}`,
      );

      // Validity: 3600s, read directly off the signed URL, the second
      // number, separate from the upload constant.
      assertEquals(new URL(entryA.medium_url).searchParams.get('X-Amz-Expires'), '3600');
      assertEquals(new URL(entryA.thumb_url).searchParams.get('X-Amz-Expires'), '3600');

      // valid_until matches, and is never later than the real expiry. The
      // window is deliberately wide: the function runs in a container, the
      // test on the host, a few seconds of clock skew are normal, 600
      // against 3600 still tells them apart beyond doubt.
      const secondsLeft = (Date.parse(response.valid_until) - beforeTimestamp) / 1000;
      assert(
        secondsLeft > 3000 && secondsLeft <= 3601,
        `valid_until liegt ${secondsLeft}s in der Zukunft, erwartet ~3600s`,
      );

      // The GET really returns the uploaded bytes, not just a status code
      // that could also come from an error page.
      const getMedium = await fetch(entryA.medium_url);
      assertEquals(getMedium.status, 200);
      assertEquals(await getMedium.text(), MEDIUM_CONTENT);
      const getThumb = await fetch(entryA.thumb_url);
      assertEquals(getThumb.status, 200);
      assertEquals(await getThumb.text(), 'echte-thumb-bytes');

      // --- Case 4: PUT against a read URL ----------------------------------
      // SigV4 takes the HTTP method as the first line into the canonical
      // request; its hash feeds the string-to-sign. The server therefore
      // computes a different signature for a PUT than the one in the URL
      // and rejects it. The URL carries the method nowhere visibly, this is
      // the evidence that it is bound to it regardless.
      const putAttempt = await fetch(entryA.medium_url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: 'ueberschrieben-durch-angreifer',
      });
      assert(
        putAttempt.status >= 400,
        `PUT auf eine Lese-URL wurde mit ${putAttempt.status} angenommen`,
      );
      const putText = await putAttempt.text();
      assert(
        /SignatureDoesNotMatch/i.test(putText) || putAttempt.status === 403,
        `PUT scheiterte, aber nicht an der Signatur: ${putAttempt.status} ${putText}`,
      );

      // And the decisive proof: the object is unchanged.
      const afterPut = await fetch(entryA.medium_url);
      assertEquals(afterPut.status, 200);
      assertEquals(await afterPut.text(), MEDIUM_CONTENT);

      // --- Archive stays readable ------------------------------------------
      // "Archived" means put away, not locked away (the same set as in
      // posts_select_revealed_members).
      const archiveRes = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ status: 'archived' }),
      });
      await expectJson(archiveRes, 200);

      const archived = await read(leaHeaders, tripId);
      const archiveResponse = (await expectJson(archived, 200)) as ReadResponse;
      assertEquals(archiveResponse.media.map((m) => m.post_id), [postA.id, postC.id, postDId]);

      // In the archive, a non-member stays a non-member.
      const nonMemberInArchive = await read(benHeaders, tripId);
      assertEquals(await expectJson(nonMemberInArchive, 403), { error: 'Kein Zugriff auf diese Reise.' });
    } finally {
      // Remove the test objects from the bucket, so repeated runs do not
      // leave anything behind. Deliberately leaner headers than
      // restHeaders(): a "content-type: application/json" without a body
      // gets the storage API (Fastify) to respond with 400. Failures are
      // reported, not swallowed.
      for (const key of uploadedKeys) {
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

      // Cascade cleans up trip_members and posts of the test trips too.
      for (const id of [tripId, neighborTripId]) {
        if (id === null) continue;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`, {
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
    }
  },
});

// ---------------------------------------------------------------------------
// Page boundary
// ---------------------------------------------------------------------------
// Its own test, because it needs its own, deliberately large fixture.
// PostgREST caps every response at max_rows (supabase/config.toml: 1000),
// silently, no error, without supabase-js seeing any of it. A `read` with no
// paging would therefore give a trip with 1001 moments exactly 1000 and
// conceal the rest: of all things the recap the product builds towards
// would lose content, without anything anywhere turning red.
//
// 1001 rows is deliberately the smallest fixture that shows this. This case
// needs no objects in the bucket, what is checked is WHAT comes back, not
// whether it can be downloaded (the test above covers that).
Deno.test({
  name: 'read pages past the max_rows boundary and loses no moment',
  ignore: !stackReady,
  async fn() {
    const ROW_COUNT = 1001;

    const tripRes = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        name: 'Integrationstest media-urls Seitengrenze',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
        owner_id: LEA_ID,
      }),
    });
    const [trip] = (await expectJson(tripRes, 201)) as Array<{ id: string }>;
    const tripId: string = trip.id;

    try {
      // Keys in the derived scheme, otherwise the function would rightfully
      // leave the rows out and the test would check something other than
      // intended. captured_at strictly ascending: so the order of the
      // response simultaneously proves that paging swaps or duplicates
      // nothing.
      const base = Date.parse('2026-01-01T00:00:00Z');
      const expectedOrder: string[] = [];
      const rows = Array.from({ length: ROW_COUNT }, (_, i) => {
        const id = crypto.randomUUID();
        expectedOrder.push(id);
        return {
          id,
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: expectedKeys(tripId, id, 'photo', 'jpg').storage_key,
          thumb_key: null,
          upload_status: 'uploaded',
          captured_at: new Date(base + i * 60_000).toISOString(),
          captured_tz: 'Europe/Zurich',
        };
      });

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify(rows),
      });
      assertEquals(insertRes.status, 201, await insertRes.text());

      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'revealed', revealed_at: 'now' }),
        }),
        200,
      );

      const jwt = await mintJwt(JWT_SECRET, LEA_ID);
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'read', trip_id: tripId }),
      });
      const response = (await expectJson(res, 200)) as ReadResponse;

      // Without paging this would read 1000, the silent loss this is about.
      assertEquals(response.media.length, ROW_COUNT);
      assertEquals(response.media.map((m) => m.post_id), expectedOrder);
      // Nothing skipped, and no duplicate: the order comparison above checks
      // position by position, a moment delivered twice would show up there.
      assertEquals(response.skipped, 0);
      assertEquals(new Set(response.media.map((m) => m.post_id)).size, ROW_COUNT);
    } finally {
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
