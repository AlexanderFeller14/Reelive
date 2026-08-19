// Integration test for share-link, the second layer under
// resolution_test.ts, never the only one.
//
// What can be proven here and ONLY here (everything else lives in
// resolution_test.ts and runs with no Docker):
//   1. The public call gets through the gateway with NO HEADERS AT ALL, no
//      Authorization, no apikey. That is the guarantee that makes verify_jwt
//      = false necessary in the first place (Spec §4, W5).
//   2. The issued URLs point at real bytes: a GET against them returns what
//      was uploaded, with X-Amz-Expires = 3600.
//   3. The SQL filters really apply: only `upload_status = 'uploaded'`, only
//      moments of THIS trip (W1), sorted by captured_at/id.
//   4. Revoking and expiring produce a byte-identical response to an
//      unknown token, compared here against the real HTTP bytes, not
//      against a TypeScript object (W2).
//   5. A link for an `active` trip can neither be created nor (should it
//      come into being via the service role anyway) resolved (W3, both
//      halves).
//   6. `revoke` is no oracle: a foreign token and a non-existent one return
//      the same response.
//   7. The response nowhere contains author_id, invite_code, or owner_id,
//      checked against the raw response text, including the real UUID
//      values. The UUID half of that has been tied to the fixture since the
//      profile picture feature (2026-08-12): had Lea a profile picture, her
//      uid would sit as part of `author_avatar_key`
//      (`profiles/<author_id>/<32 hex>.jpg`) in the response text. That is
//      accepted deliberately, see the place itself.
//   8. Paging past the max_rows boundary against real PostgREST.
//
// To run (leave terminal 1 open):
//   supabase functions serve --env-file supabase/functions/.env
// then in terminal 2:
//   cd supabase/functions/share-link
//   npx deno test --allow-net --allow-run=supabase share_link_integration_test.ts
//
// Without a running stack the test skips itself with a log line, instead of
// turning a machine with no Docker red. That is defensible here, BECAUSE the
// actual security guarantees (byte-identical rejections, response shape,
// key derivation, paging) additionally live in resolution_test.ts and always
// run there.
//
// SHARE_LINK_URL points the test at a function served elsewhere (then also
// needs --allow-env).

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { expectedKeys } from '../media-urls/keys.ts';

// seed.sql accounts: Lea owns the test trips. Ben has an auth.users row but
// NO profile, he can sign in and is therefore exactly the "some signed-in
// outsider" needed here; he does not work as a moment's author (posts.author_id
// references profiles). Sofia is used for that instead: a real profile that
// is not a member of any of the test trips.
const LEA_ID = '11111111-1111-4111-8111-111111111111';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const SOFIA_ID = '55555555-5555-4555-8555-555555555555';
const BUCKET = 'media';
const MEDIUM_CONTENT = 'echte-jpeg-bytes-fuer-den-share-link-test';
const THUMB_CONTENT = 'echte-thumb-bytes-fuer-den-share-link-test';

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

// NEVER hardcode values here: they differ per project/machine.
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

async function functionReachable(url: string): Promise<boolean> {
  try {
    // Deliberately with no apikey: if even the reachability check gets
    // through with no header at all, that already tests the first
    // guarantee.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
const FUNCTION_URL = envOrNull('SHARE_LINK_URL') ?? `${SUPABASE_URL}/functions/v1/share-link`;

const stackReady = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET && (await functionReachable(FUNCTION_URL)),
);

if (!stackReady) {
  console.warn(
    'share_link_integration_test: übersprungen, braucht `supabase start` UND ' +
      '`supabase functions serve --env-file supabase/functions/.env` in einem zweiten Terminal. ' +
      'Die Sicherheitszusicherungen der Prüfkette laufen ohne Stack in resolution_test.ts.',
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

// The public call: WITHOUT Authorization, WITHOUT apikey. Exactly how a
// browser with no account would make it.
async function resolve(token: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'resolve', token }),
  });
  return { status: res.status, text: await res.text() };
}

function withJwt(jwt: string): Record<string, string> {
  return { apikey: ANON_KEY, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
}

async function call(headers: Record<string, string>, body: unknown): Promise<Response> {
  return await fetch(FUNCTION_URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function createTrip(name: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ name, start_date: '2026-01-01', end_date: '2026-01-02', owner_id: LEA_ID }),
  });
  const [trip] = (await expectJson(res, 201)) as Array<{ id: string }>;
  return trip.id;
}

async function reveal(tripId: string): Promise<void> {
  await expectJson(
    await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
      method: 'PATCH',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ status: 'revealed', revealed_at: 'now' }),
    }),
    200,
  );
}

async function cleanUp(tripIds: Array<string | null>, keys: string[]): Promise<void> {
  for (const key of keys) {
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

type ResolveResponse = {
  trip: { name: string; start_date: string; end_date: string };
  media: Array<{
    post_id: string;
    author_name: string;
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
  valid_until: string;
  skipped: number;
};

Deno.test({
  name: 'share-link: erstellen, auflösen ohne Anmeldung, widerrufen, und keine Auskunft an Unbefugte',
  ignore: !stackReady,
  async fn() {
    const tripId = await createTrip('Integrationstest share-link');
    let neighborTripId: string | null = null;
    let activeTripId: string | null = null;
    const uploaded: string[] = [];

    try {
      const leaJwt = await mintJwt(JWT_SECRET, LEA_ID);
      const benJwt = await mintJwt(JWT_SECRET, BEN_ID);

      // --- W3, first half: no link exists for a sealed trip ---------------
      const tooEarly = await call(withJwt(leaJwt), { action: 'create', trip_id: tripId });
      assertEquals(await expectJson(tooEarly, 409), { error: 'Diese Reise ist noch versiegelt.' });

      // --- Fixtures ---------------------------------------------------------
      // A: a real, fully uploaded moment (the only one with bytes).
      const postAId = crypto.randomUUID();
      const keysA = expectedKeys(tripId, postAId, 'photo', 'jpg');
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postAId,
            trip_id: tripId,
            author_id: LEA_ID,
            type: 'photo',
            storage_key: keysA.storage_key,
            thumb_key: keysA.thumb_key,
            upload_status: 'uploaded',
            captured_at: '2026-01-01T08:00:00+01:00',
            captured_tz: 'Europe/Zurich',
            place_name: 'Zürich',
            // A carries coordinates, C (further below) does not, so ONE pass
            // shows both directions: that lat/lng really come from the
            // select list, and that a moment with no place still sits in
            // the film roll.
            lat: 47.3769,
            lng: 8.5417,
            caption: 'Der erste Moment',
          }),
        }),
        201,
      );

      // Store bytes directly via the storage API, this test checks
      // share-link, not media-urls's upload path.
      for (const [key, content] of [
        [keysA.storage_key, MEDIUM_CONTENT],
        [keysA.thumb_key, THUMB_CONTENT],
      ]) {
        const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            'content-type': 'image/jpeg',
          },
          body: content,
        });
        assertEquals(put.status, 200, await put.text());
        uploaded.push(key);
      }

      // B: submitted, never finished uploading, must not appear in any
      //    response.
      const postBId = crypto.randomUUID();
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postBId,
            trip_id: tripId,
            author_id: LEA_ID,
            type: 'photo',
            storage_key: expectedKeys(tripId, postBId, 'photo', 'jpg').storage_key,
            captured_at: '2026-01-01T09:00:00+01:00',
            captured_tz: 'Europe/Zurich',
          }),
        }),
        201,
      );

      // C: finished, but with no thumbnail, thumb_url has to become null.
      const postCId = crypto.randomUUID();
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
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
        }),
        201,
      );

      // D: sits in an ANOTHER trip, but carries a storage_key that fits
      //    exactly OUR trip. The only row that can even show the trip
      //    scoping of the select: drop `.eq('trip_id', …)` and D slips
      //    through the derivation comparison into the response, every other
      //    foreign moment would still be sorted out there. This is W1 in
      //    its sharpest form.
      neighborTripId = await createTrip('Integrationstest share-link Nachbarreise');
      const postDId = crypto.randomUUID();
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postDId,
            trip_id: neighborTripId,
            author_id: LEA_ID,
            type: 'photo',
            storage_key: expectedKeys(tripId, postDId, 'photo', 'jpg').storage_key,
            thumb_key: null,
            upload_status: 'uploaded',
            captured_at: '2026-01-01T11:00:00+01:00',
            captured_tz: 'Europe/Zurich',
          }),
        }),
        201,
      );

      await reveal(tripId);

      // --- create: only the owner -------------------------------------------
      const noJwt = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', trip_id: tripId }),
      });
      assertEquals(await expectJson(noJwt, 401), { error: 'Nicht angemeldet.' });

      // The anon key is a syntactically valid, correctly signed JWT, and
      // still not a person. Since the gateway no longer pre-checks here,
      // this case is the evidence that the function's own check catches it.
      const withAnonKey = await call(withJwt(ANON_KEY), { action: 'create', trip_id: tripId });
      assertEquals(await expectJson(withAnonKey, 401), { error: 'Nicht angemeldet.' });

      const foreign = await call(withJwt(benJwt), { action: 'create', trip_id: tripId });
      assertEquals(await expectJson(foreign, 403), {
        error: 'Nur wer die Reise angelegt hat, kann den Recap teilen.',
      });

      const created = (await expectJson(
        await call(withJwt(leaJwt), { action: 'create', trip_id: tripId }),
        200,
      )) as { token: string; url: string };
      assert(created.token.length >= 16, `unerwarteter Token: ${created.token}`);
      assert(created.url.endsWith(`/share/${created.token}`), created.url);

      // --- resolve with NO sign-in at all -----------------------------------
      const beforeTimestamp = Date.now();
      const open = await resolve(created.token);
      assertEquals(open.status, 200, open.text);
      const response = JSON.parse(open.text) as ResolveResponse;

      assertEquals(response.trip, {
        name: 'Integrationstest share-link',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
      });

      // Exactly A and C, in captured_at order. B is missing (pending), D is
      // missing (different trip), two different reasons, one guarantee.
      assertEquals(response.media.map((m) => m.post_id), [postAId, postCId]);
      assertEquals(response.skipped, 0);

      const entryA = response.media[0];
      assertEquals(entryA.author_name, 'Lea');
      assertEquals(entryA.caption, 'Der erste Moment');
      assertEquals(entryA.place_name, 'Zürich');
      assertEquals(entryA.captured_tz, 'Europe/Zurich');
      assertEquals(entryA.duration_s, null);
      // Spec R4: the shared recap shows the same map as the app. Only here
      // can it be checked that the two columns really leave the real
      // PostgREST query, resolution_test.ts does not see the select list.
      assertEquals(entryA.lat, 47.3769);
      assertEquals(entryA.lng, 8.5417);
      // And C, submitted with no location sharing: null, but present. A
      // moment with no place must not fall out of the recap.
      assertEquals(response.media[1].lat, null);
      assertEquals(response.media[1].lng, null);
      assertEquals(response.media[1].thumb_url, null);
      assertFalse(response.media[1].medium_url.includes('null'));

      // Validity: 3600s, read directly off the signed URL.
      assertEquals(new URL(entryA.medium_url).searchParams.get('X-Amz-Expires'), '3600');
      assertEquals(new URL(entryA.thumb_url!).searchParams.get('X-Amz-Expires'), '3600');
      const secondsLeft = (Date.parse(response.valid_until) - beforeTimestamp) / 1000;
      assert(
        secondsLeft > 3000 && secondsLeft <= 3601,
        `gueltig_bis liegt ${secondsLeft}s in der Zukunft, erwartet ~3600s`,
      );

      // The URLs point at real bytes, not just at a status code an error
      // page could also deliver.
      const getMedium = await fetch(entryA.medium_url);
      assertEquals(getMedium.status, 200);
      assertEquals(await getMedium.text(), MEDIUM_CONTENT);
      const getThumb = await fetch(entryA.thumb_url!);
      assertEquals(getThumb.status, 200);
      assertEquals(await getThumb.text(), THUMB_CONTENT);

      // A PUT against a public read URL fails: SigV4 binds the method into
      // the signature. A shared link can never be repurposed for writing.
      const putAttempt = await fetch(entryA.medium_url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: 'ueberschrieben-durch-angreifer',
      });
      assert(putAttempt.status >= 400, `PUT auf eine Lese-URL wurde mit ${putAttempt.status} angenommen`);
      assertEquals(await (await fetch(entryA.medium_url)).text(), MEDIUM_CONTENT);

      // --- What must NOT be in the response ----------------------------------
      // Against the raw text, not the parsed object: that also catches a
      // field smuggled in through a nested object.
      for (const field of ['author_id', 'invite_code', 'owner_id', 'reaktionen', 'kommentare', 'mitglieder', 'status']) {
        assertFalse(open.text.includes(field), `die Antwort enthält "${field}"`);
      }
      // And the real values, not just the field names: LEA_ID is the
      // author_id of every moment and at the same time the trip's
      // owner_id.
      //
      // This line has been tied to the fixture since the profile picture
      // feature (2026-08-12): Lea has NO profile picture here,
      // `author_avatar_key` is therefore null. Were she to get one, her uid
      // would sit as part of the key (`profiles/<author_id>/<32 hex>.jpg`)
      // in the response text, and the guarantee would fail, not because of
      // a regression, but because it would then ask a different question
      // than the one it is meant to answer (no plaintext owner_id, no
      // passed-through author_id FIELD). The disclosure of the uid via the
      // avatar key is accepted deliberately: addendum in
      // docs/superpowers/specs/2026-08-08-phase-6-teilen-export-store-design.md
      // §5.1. Whoever ever extends the fixture with a picture should
      // replace this line with a check for owner_id/invite_code in plain
      // text.
      assertFalse(open.text.includes(LEA_ID), 'die Antwort enthält die author_id/owner_id im Klartext');
      const [tripRow] = (await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}&select=invite_code`, {
          headers: restHeaders(),
        }),
        200,
      )) as Array<{ invite_code: string }>;
      assertFalse(open.text.includes(tripRow.invite_code), 'die Antwort enthält den invite_code');

      // --- W1: a second link shows its own trip, not this one --------------
      // E is the only regularly stored moment of the neighbor trip. D also
      // sits there, but carries the storage_key matching OUR trip, so for
      // the neighbor trip the derivation does not match, and D drops out
      // here for a different reason than above: not because of the
      // trip_id, but because of the comparison. Both barriers show up on
      // the same row this way, each in a different response.
      const postEId = crypto.randomUUID();
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({
            id: postEId,
            trip_id: neighborTripId,
            author_id: SOFIA_ID,
            type: 'photo',
            storage_key: expectedKeys(neighborTripId, postEId, 'photo', 'jpg').storage_key,
            thumb_key: null,
            upload_status: 'uploaded',
            captured_at: '2026-01-01T12:00:00+01:00',
            captured_tz: 'Europe/Zurich',
          }),
        }),
        201,
      );

      await reveal(neighborTripId);
      const neighborLink = (await expectJson(
        await call(withJwt(leaJwt), { action: 'create', trip_id: neighborTripId }),
        200,
      )) as { token: string };
      const neighborOpen = await resolve(neighborLink.token);
      assertEquals(neighborOpen.status, 200, neighborOpen.text);
      const neighborResponse = JSON.parse(neighborOpen.text) as ResolveResponse;
      assertEquals(neighborResponse.trip.name, 'Integrationstest share-link Nachbarreise');
      assertEquals(neighborResponse.media.map((m) => m.post_id), [postEId]);
      // D is counted, but not delivered, the app sees the gap instead of
      // getting a silently shorter recap.
      assertEquals(neighborResponse.skipped, 1);
      // The author name comes from profiles, not from the owner row: here
      // Sofia submitted the moment, not Lea.
      assertEquals(neighborResponse.media[0].author_name, 'Sofia');
      // And no URL in this response points into the other trip.
      for (const entry of neighborResponse.media) {
        assertFalse(entry.medium_url.includes(tripId), entry.medium_url);
      }

      // --- The byte-identical rejections, against real HTTP bytes ----------
      const unknown = await resolve('0000000000000000000000000000dead');

      // a) revoked
      const expiringToken = (await expectJson(
        await call(withJwt(leaJwt), { action: 'create', trip_id: tripId, valid_days: 7 }),
        200,
      )) as { token: string };

      assertEquals(
        await expectJson(await call(withJwt(leaJwt), { action: 'revoke', token: created.token }), 200),
        { ok: true },
      );
      const revoked = await resolve(created.token);
      assertEquals([revoked.status, revoked.text], [unknown.status, unknown.text]);

      // Idempotent: a second revoke is not an error.
      assertEquals(
        await expectJson(await call(withJwt(leaJwt), { action: 'revoke', token: created.token }), 200),
        { ok: true },
      );

      // b) expired, push expires_at into the past via the service role (the
      //    function itself can only ever issue a future date).
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/share_links?token=eq.${expiringToken.token}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ expires_at: '2020-01-01T00:00:00Z' }),
        }),
        200,
      );
      const expired = await resolve(expiringToken.token);
      assertEquals([expired.status, expired.text], [unknown.status, unknown.text]);

      // c) trip not revealed, W3, second half. The link is created here via
      //    the service role (past RLS and past `create`), because that is
      //    exactly the case resolution itself has to catch: the create
      //    check is not the only barrier.
      activeTripId = await createTrip('Integrationstest share-link versiegelt');
      const [sealedLink] = (await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/share_links`, {
          method: 'POST',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ trip_id: activeTripId }),
        }),
        201,
      )) as Array<{ token: string }>;
      const sealed = await resolve(sealedLink.token);
      assertEquals([sealed.status, sealed.text], [unknown.status, unknown.text]);

      // d) an absurdly long token, the same response, no signal of its own.
      const tooLong = await resolve('a'.repeat(2000));
      assertEquals([tooLong.status, tooLong.text], [unknown.status, unknown.text]);

      // --- revoke is no oracle -----------------------------------------------
      // The neighbor link exists, but does not belong to Ben. For him this
      // has to be the same as a token that never existed, otherwise a
      // token's existence could be probed with any own account, while
      // `resolve` goes to great lengths to reveal nothing.
      const bensRealAttempt = await call(withJwt(benJwt), { action: 'revoke', token: neighborLink.token });
      const bensMadeUpAttempt = await call(withJwt(benJwt), {
        action: 'revoke',
        token: '0000000000000000000000000000beef',
      });
      const realText = await bensRealAttempt.text();
      const madeUpText = await bensMadeUpAttempt.text();
      assertEquals([bensRealAttempt.status, realText], [bensMadeUpAttempt.status, madeUpText]);
      assertEquals(bensRealAttempt.status, 404);

      // And the link really stayed untouched.
      const [afterBen] = (await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/share_links?token=eq.${neighborLink.token}&select=revoked`, {
          headers: restHeaders(),
        }),
        200,
      )) as Array<{ revoked: boolean }>;
      assertEquals(afterBen.revoked, false);

      // --- Archived: readable, and revoking still succeeds ------------------
      // "Put away is not locked away", but the owner still has to be able
      // to switch the link off afterwards too (migration 20260808130000).
      await expectJson(
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${neighborTripId}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'archived' }),
        }),
        200,
      );
      const inArchive = await resolve(neighborLink.token);
      assertEquals(inArchive.status, 200, inArchive.text);

      // A NEW link no longer gets created for an archived trip.
      const newInArchive = await call(withJwt(leaJwt), { action: 'create', trip_id: neighborTripId });
      assertEquals(await expectJson(newInArchive, 409), {
        error: 'Diese Reise ist archiviert. Für sie entsteht kein neuer Link mehr.',
      });

      // But the existing one can still be revoked, and after that it shows
      // nothing anymore.
      assertEquals(
        await expectJson(await call(withJwt(leaJwt), { action: 'revoke', token: neighborLink.token }), 200),
        { ok: true },
      );
      const archiveRevoked = await resolve(neighborLink.token);
      assertEquals([archiveRevoked.status, archiveRevoked.text], [unknown.status, unknown.text]);

      // --- Small stuff obvious from an attacker's perspective -----------------
      assertEquals((await resolve(undefined)).status, 400);
      assertEquals((await resolve(42)).status, 400);
      const unknownAction = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'alles_zeigen', token: created.token }),
      });
      // Unknown actions run into the JWT branch and fail there with no
      // sign-in, not at a switch that could have let them through.
      assertEquals(await expectJson(unknownAction, 401), { error: 'Nicht angemeldet.' });
      assertEquals(
        await expectJson(await call(withJwt(leaJwt), { action: 'alles_zeigen' }), 400),
        { error: 'Unbekannte Aktion.' },
      );

      // CORS: without these headers the public web player would fail in the
      // browser, even though the function responds correctly, it runs on a
      // different origin than the Supabase instance.
      //
      // Checked against the REAL response, not the preflight: the local
      // Kong answers OPTIONS itself (HTTP 200 with a very generous method
      // list), so the request never even reaches the function. On a hosted
      // project that is not the case, there the function has to answer
      // OPTIONS itself, and that is exactly what the branch in index.ts is
      // for. What BOTH environments show: the headers on the POST response,
      // and those demonstrably come from the function (Kong does not set
      // access-control-allow-headers to this value).
      const withOrigin = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://beispiel.test' },
        body: JSON.stringify({ action: 'resolve', token: 'gibtesnicht' }),
      });
      await withOrigin.text();
      assertEquals(withOrigin.headers.get('access-control-allow-origin'), '*');
      assertEquals(
        withOrigin.headers.get('access-control-allow-headers'),
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
      await cleanUp([tripId, neighborTripId, activeTripId], uploaded);
    }
  },
});

// ---------------------------------------------------------------------------
// Page boundary against real PostgREST
// ---------------------------------------------------------------------------
// The loop itself is checked with no Docker in resolution_test.ts. What is
// added here: that max_rows in supabase/config.toml really caps at 1000 and
// the page size in store.ts matches it. 1001 rows is the smallest fixture
// that shows this.
Deno.test({
  name: 'share-link: aufloesen blättert über die max_rows-Grenze und verliert keinen Moment',
  ignore: !stackReady,
  async fn() {
    const ROW_COUNT = 1001;
    const tripId = await createTrip('Integrationstest share-link Seitengrenze');

    try {
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

      await reveal(tripId);
      const leaJwt = await mintJwt(JWT_SECRET, LEA_ID);
      const { token } = (await expectJson(
        await call(withJwt(leaJwt), { action: 'create', trip_id: tripId }),
        200,
      )) as { token: string };

      const open = await resolve(token);
      assertEquals(open.status, 200, open.text.slice(0, 500));
      const response = JSON.parse(open.text) as ResolveResponse;

      // Without paging this would read 1000, the silent loss this is about.
      assertEquals(response.media.length, ROW_COUNT);
      assertEquals(response.media.map((m) => m.post_id), expectedOrder);
      assertEquals(response.skipped, 0);
      assertEquals(new Set(response.media.map((m) => m.post_id)).size, ROW_COUNT);
    } finally {
      await cleanUp([tripId], []);
    }
  },
});
