// Integration test for delete-account, the second layer under
// process_test.ts, never the only one.
//
// What can be proven here and ONLY here:
//   1. That the cascades really clear everything. The test counts EACH of
//      the nine tables in `public` individually after the deletion,
//      instead of relying on the foreign key declarations.
//   2. That `trips.owner_id -> profiles` as on-delete-restrict really
//      bites: a direct deleteUser with no prior trip deletion fails.
//      Without this proof, the whole order would be speculation.
//   3. That the objects in the bucket are gone, including those of FOREIGN
//      authors in an own trip, and the own ones in a FOREIGN trip.
//   4. That the foreign trip itself survives and its invite_code does NOT
//      rotate, the reason `leaveForeignTrips` runs with the person's own
//      JWT and not the service role.
//   5. That `counts` tells the truth.
//   6. That a second call with the same (now dead) JWT achieves nothing
//      more.
//
// To run (leave terminal 1 open):
//   supabase functions serve --env-file supabase/functions/.env
// then in terminal 2:
//   cd supabase/functions/delete-account
//   npx deno test --allow-net --allow-run=supabase delete_account_integration_test.ts
//
// Without a running stack the test skips itself with a log line. That is
// defensible, BECAUSE the core guarantee (W7: should the storage step
// fail, the database stays untouched) lives in process_test.ts and always
// runs there.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { expectedKeys } from '../media-urls/keys.ts';

const BUCKET = 'media';
// A foreign person with her own trip, to which our test account gets
// invited. From seed.sql, so the test needs no second throwaway identity.
const MIRA_ID = '33333333-3333-4333-8333-333333333333';

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
const FUNCTION_URL = envOrNull('DELETE_ACCOUNT_URL') ?? `${SUPABASE_URL}/functions/v1/delete-account`;

const stackReady = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET && (await functionReachable(FUNCTION_URL, ANON_KEY)),
);

if (!stackReady) {
  console.warn(
    'delete_account_integration_test: skipped, needs `supabase start` AND ' +
      '`supabase functions serve --env-file supabase/functions/.env` in a second terminal. ' +
      'The core guarantee W7 runs without a stack in process_test.ts.',
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

async function rest(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: restHeaders(),
    ...init,
  });
  const text = await res.text();
  assert(res.ok, `${path}: HTTP ${res.status} ${text}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

// Counts rows via the Content-Range header, works for any table, with no
// need for the test to know its columns.
async function count(path: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&select=*`, {
    headers: restHeaders({ Prefer: 'count=exact', Range: '0-0' }),
  });
  const text = await res.text();
  assert(res.ok, `${path}: HTTP ${res.status} ${text}`);
  const range = res.headers.get('content-range') ?? '';
  const total = range.split('/')[1];
  return Number(total);
}

async function objectExists(key: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await res.body?.cancel();
  return res.status === 200;
}

async function putObject(key: string, content: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'image/jpeg',
    },
    body: content,
  });
  assertEquals(res.status, 200, await res.text());
}

// A fresh throwaway account: auth.users + profiles. Throwaway, because the
// test really deletes it at the end, burning a seed.sql account would
// break every further run and every manual check in the simulator.
async function createAccount(number: string): Promise<{ id: string; jwt: string }> {
  const id = crypto.randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify({
      id,
      email: `loeschtest-${number}-${id.slice(0, 8)}@test.local`,
      password: 'loeschtest-passwort',
      email_confirm: true,
    }),
  });
  const user = (await expectJson(res, 200)) as { id: string };
  await rest('profiles', {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      id: user.id,
      username: `loeschtest${number}${user.id.slice(0, 6).replace(/-/g, '')}`.toLowerCase().slice(0, 20),
      display_name: `Löschtest ${number}`,
    }),
  });
  return { id: user.id, jwt: await mintJwt(JWT_SECRET, user.id) };
}

async function createPost(row: Record<string, unknown>): Promise<void> {
  await rest('posts', {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
}

Deno.test({
  name: 'delete-account clears rows and objects, and leaves other people\'s trips untouched',
  ignore: !stackReady,
  async fn() {
    const account = await createAccount('a');
    // A second account that is a member of the first's trip: her moment
    // sits in a FOREIGN (namely our) trip and has to go along on deletion,
    // objects included. Exactly the case from Spec §3 ("get deleted along
    // with it, media of every member included").
    const companion = await createAccount('b');

    const objects: string[] = [];
    let ownTripId: string | null = null;
    let foreignTripId: string | null = null;

    try {
      // --- Own trip with two moments (one of them from someone else) -----
      const [own] = (await rest('trips', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          name: 'Eigene Reise des Löschkontos',
          start_date: '2026-01-01',
          end_date: '2026-01-02',
          owner_id: account.id,
        }),
      })) as Array<{ id: string }>;
      ownTripId = own.id;
      await rest('trip_members', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ trip_id: ownTripId, user_id: companion.id }),
      });

      const ownPost = crypto.randomUUID();
      const foreignPostInOwnTrip = crypto.randomUUID();
      for (const [postId, author] of [[ownPost, account.id], [foreignPostInOwnTrip, companion.id]]) {
        const keys = expectedKeys(ownTripId, postId, 'photo', 'jpg');
        await createPost({
          id: postId,
          trip_id: ownTripId,
          author_id: author,
          type: 'photo',
          storage_key: keys.storage_key,
          thumb_key: keys.thumb_key,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T08:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        });
        await putObject(keys.storage_key, `medium-${postId}`);
        await putObject(keys.thumb_key, `thumb-${postId}`);
        objects.push(keys.storage_key, keys.thumb_key);
      }

      // --- Foreign trip (Mira), where the account is only a member --------
      const [foreign] = (await rest('trips', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          name: 'Fremde Reise, in der das Löschkonto nur mitfährt',
          start_date: '2026-02-01',
          end_date: '2026-02-02',
          owner_id: MIRA_ID,
        }),
      })) as Array<{ id: string; invite_code: string }>;
      foreignTripId = foreign.id;
      const inviteBefore = foreign.invite_code;
      await rest('trip_members', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ trip_id: foreignTripId, user_id: account.id }),
      });

      const ownPostElsewhere = crypto.randomUUID();
      const keysElsewhere = expectedKeys(foreignTripId, ownPostElsewhere, 'video', 'mov');
      await createPost({
        id: ownPostElsewhere,
        trip_id: foreignTripId,
        author_id: account.id,
        type: 'video',
        media_ext: 'mov',
        duration_s: 12,
        storage_key: keysElsewhere.storage_key,
        thumb_key: keysElsewhere.thumb_key,
        upload_status: 'uploaded',
        captured_at: '2026-02-01T08:00:00+01:00',
        captured_tz: 'Europe/Zurich',
      });
      await putObject(keysElsewhere.storage_key, 'medium-anderswo');
      await putObject(keysElsewhere.thumb_key, 'thumb-anderswo');
      objects.push(keysElsewhere.storage_key, keysElsewhere.thumb_key);

      // A moment of Mira's in her own trip, it has to survive EVERYTHING.
      const miraPost = crypto.randomUUID();
      const keysMira = expectedKeys(foreignTripId, miraPost, 'photo', 'jpg');
      await createPost({
        id: miraPost,
        trip_id: foreignTripId,
        author_id: MIRA_ID,
        type: 'photo',
        storage_key: keysMira.storage_key,
        thumb_key: keysMira.thumb_key,
        upload_status: 'uploaded',
        captured_at: '2026-02-01T09:00:00+01:00',
        captured_tz: 'Europe/Zurich',
      });
      await putObject(keysMira.storage_key, 'medium-mira');
      objects.push(keysMira.storage_key);

      // --- Push token, reaction, comment, report --------------------------
      await rest('push_tokens', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ user_id: account.id, token: `ExponentPushToken[${account.id.slice(0, 12)}]`, platform: 'ios' }),
      });
      // Reveal both trips, so a reaction/comment/report would even be
      // allowed in the first place (set here via the service role, like in
      // the other integration tests).
      for (const id of [ownTripId, foreignTripId]) {
        await rest(`trips?id=eq.${id}`, {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'revealed', revealed_at: 'now' }),
        });
      }
      await rest('reactions', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ post_id: miraPost, user_id: account.id, emoji: '🔥' }),
      });
      await rest('comments', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ post_id: miraPost, user_id: account.id, text: 'Schönes Bild' }),
      });
      await rest('reports', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ post_id: miraPost, reporter_id: account.id, reason: 'Testmeldung' }),
      });
      // A share link for the own (now revealed) trip, it has to cascade via
      // share_links.trip_id -> trips.
      await rest('share_links', {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ trip_id: ownTripId }),
      });

      // --- counts: does the dialog tell the truth? -------------------------
      const countsRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${account.jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'counts' }),
      });
      assertEquals(await expectJson(countsRes, 200), {
        own_trips: 1,
        // BOTH moments of the own trip, including the foreign one, it goes
        // along.
        moments_in_own_trips: 2,
        // Only the fellow traveller's account; the person herself does not
        // count.
        affected_people: 1,
        own_moments_elsewhere: 1,
      });

      // --- The proof that the order is necessary --------------------------
      // A deleteUser with NO prior trip deletion has to fail, otherwise the
      // whole order would be speculation. 23503 = foreign_key_violation
      // from trips_owner_id_fkey (on delete restrict).
      const direct = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${account.id}`, {
        method: 'DELETE',
        headers: restHeaders(),
      });
      const directText = await direct.text();
      assert(
        direct.status >= 400,
        `deleteUser ohne vorherige Reise-Löschung wurde mit ${direct.status} angenommen: ${directText}`,
      );

      // --- Delete -----------------------------------------------------------
      const deleteRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${account.jwt}`, 'content-type': 'application/json' },
        body: '{}',
      });
      assertEquals(await expectJson(deleteRes, 200), { ok: true });

      // --- Nine tables, counted individually --------------------------------
      // Not "the cascades will apply", but row by row.
      assertEquals(await count(`profiles?id=eq.${account.id}`), 0, 'profiles');
      assertEquals(await count(`trips?owner_id=eq.${account.id}`), 0, 'trips');
      assertEquals(await count(`trips?id=eq.${ownTripId}`), 0, 'trips (die eigene Reise)');
      assertEquals(await count(`trip_members?user_id=eq.${account.id}`), 0, 'trip_members');
      assertEquals(await count(`posts?author_id=eq.${account.id}`), 0, 'posts (eigene, überall)');
      assertEquals(await count(`posts?trip_id=eq.${ownTripId}`), 0, 'posts (in der eigenen Reise)');
      assertEquals(await count(`reactions?user_id=eq.${account.id}`), 0, 'reactions');
      assertEquals(await count(`comments?user_id=eq.${account.id}`), 0, 'comments');
      assertEquals(await count(`reports?reporter_id=eq.${account.id}`), 0, 'reports');
      assertEquals(await count(`push_tokens?user_id=eq.${account.id}`), 0, 'push_tokens');
      assertEquals(await count(`share_links?trip_id=eq.${ownTripId}`), 0, 'share_links');
      // And the auth user herself.
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${account.id}`, { headers: restHeaders() });
      await authRes.body?.cancel();
      assertEquals(authRes.status, 404, 'auth.users');

      // --- No object stays behind --------------------------------------------
      const keysOwn = expectedKeys(ownTripId, ownPost, 'photo', 'jpg');
      const keysForeignInOwn = expectedKeys(ownTripId, foreignPostInOwnTrip, 'photo', 'jpg');
      for (const key of [
        keysOwn.storage_key,
        keysOwn.thumb_key,
        // The moment of ANOTHER person in our trip, its objects go too,
        // otherwise they would stay in storage with no database row at
        // all.
        keysForeignInOwn.storage_key,
        keysForeignInOwn.thumb_key,
        // The own moment in the FOREIGN trip: the trip stays, the object
        // goes.
        keysElsewhere.storage_key,
        keysElsewhere.thumb_key,
      ]) {
        assertFalse(await objectExists(key), `Objekt blieb liegen: ${key}`);
      }

      // --- What has to survive ------------------------------------------------
      assertEquals(await count(`trips?id=eq.${foreignTripId}`), 1, 'die fremde Reise überlebt');
      assertEquals(await count(`posts?id=eq.${miraPost}`), 1, 'Miras Moment überlebt');
      assert(await objectExists(keysMira.storage_key), 'Miras Objekt blieb erhalten');
      assertEquals(await count(`profiles?id=eq.${companion.id}`), 1, 'das mitreisende Konto überlebt');

      // The invite_code of the foreign trip must NOT have rotated.
      // Otherwise an account deletion tears the link out from under every
      // other invitee, exactly the damage 20260807090000 was written
      // against. Only possible because leaveForeignTrips runs with the
      // person's own JWT and not the service role.
      const [foreignAfter] = (await rest(
        `trips?id=eq.${foreignTripId}&select=invite_code`,
      )) as Array<{ invite_code: string }>;
      assertEquals(
        foreignAfter.invite_code,
        inviteBefore,
        'der Einladungscode der fremden Reise wurde durch die Kontolöschung rotiert',
      );

      // --- A second call achieves nothing more --------------------------------
      // The JWT is still validly signed, but the user no longer exists:
      // getUser fails, the function responds 401. For the app that means:
      // "no longer signed in" after a deletion is the success case.
      const again = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${account.jwt}`, 'content-type': 'application/json' },
        body: '{}',
      });
      assertEquals(await expectJson(again, 401), { error: 'Nicht angemeldet.' });
    } finally {
      for (const key of objects) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        }).catch(() => null);
      }
      for (const id of [ownTripId, foreignTripId]) {
        if (id === null) continue;
        await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`, {
          method: 'DELETE',
          headers: restHeaders(),
        }).catch(() => null);
      }
      for (const id of [account.id, companion.id]) {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
          method: 'DELETE',
          headers: restHeaders(),
        }).catch(() => null);
      }
    }
  },
});

Deno.test({
  name: 'delete-account: without a login and with a bare anon key nothing happens at all',
  ignore: !stackReady,
  async fn() {
    const withoutAuth = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
      body: '{}',
    });
    assertEquals(await expectJson(withoutAuth, 401), { error: 'Nicht angemeldet.' });

    // The anon key is a valid, correctly signed JWT, but not a person. It
    // gets through the gateway and has to fail at the function's own
    // check.
    const withAnonKey = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assertEquals(await expectJson(withAnonKey, 401), { error: 'Nicht angemeldet.' });

    const wrongAction = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${await mintJwt(JWT_SECRET, MIRA_ID)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'alles_loeschen' }),
    });
    assertEquals(await expectJson(wrongAction, 400), { error: 'Unbekannte Aktion.' });
  },
});

Deno.test({
  name: 'delete-account: an account without own trips and without moments deletes cleanly',
  ignore: !stackReady,
  async fn() {
    // The edge case where an `in.()` filter with an empty list would
    // trigger a PostgREST syntax error, and where a deletion still has to
    // work.
    const account = await createAccount('c');
    const countsRes = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${account.jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'counts' }),
    });
    assertEquals(await expectJson(countsRes, 200), {
      own_trips: 0,
      moments_in_own_trips: 0,
      affected_people: 0,
      own_moments_elsewhere: 0,
    });

    const deleteRes = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${account.jwt}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assertEquals(await expectJson(deleteRes, 200), { ok: true });
    assertEquals(await count(`profiles?id=eq.${account.id}`), 0, 'profiles');
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${account.id}`, { headers: restHeaders() });
    await authRes.body?.cancel();
    assertEquals(authRes.status, 404, 'auth.users');
  },
});
