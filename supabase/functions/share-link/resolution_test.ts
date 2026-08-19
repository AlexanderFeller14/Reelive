// Unit tests for the pure logic of `resolve`, they run WITHOUT `supabase
// start` and WITHOUT a second terminal running `functions serve`, unlike
// share_link_integration_test.ts (which needs real HTTP calls and therefore
// carries `ignore: !stackReady`).
//
// That is the binding lesson from Phase 5: a skipped test is
// indistinguishable from a passed one in any summary. No guarantee of this
// function may live exclusively in a file that skips itself without
// Docker.
//
// To run (needs no permission, no network, no stack):
//   cd supabase/functions/share-link
//   npx deno test resolution_test.ts
//
// Covered:
//   1. The FOUR rejections from evaluateToken are byte-identical, status
//      code AND serialized response body. Plus the fifth rejection (token
//      too long), which index.ts forms from the same constant.
//   2. The order of the check chain and its edge cases (expiry to the
//      second, a broken expiry date, 'archived' stays readable).
//   3. Paging past the max_rows boundary: nothing lost, nothing duplicated,
//      no infinite loop.
//   4. The keys are DERIVED, never taken from storage_key, and a row whose
//      storage_key points elsewhere is dropped.
//   5. The response carries EXACTLY the fields of the contract. Reactions,
//      comments, members, invite_code and a FIELD author_id are not among
//      them, not even when they appear in the input rows. Note: since the
//      profile picture feature (2026-08-12) this no longer holds for the
//      UUID itself: `author_avatar_key` reads
//      `profiles/<author_id>/<32 hex>.jpg`. The fixtures below set the key
//      to null, so the text check against FORBIDDEN_FIELDS still applies
//      cleanly here. Why the disclosure is acceptable: addendum in
//      docs/superpowers/specs/2026-08-08-phase-6-teilen-export-store-design.md
//      §5.1.
//   6. lat/lng have been part of it since Phase 7 (Spec R4): they pass
//      through unchanged, `null` stays `null`, and a moment with no place
//      does not disappear. That they leave ONLY behind a passed verdict
//      hinges on point 1, hence the statement lives there.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  buildResolveResponse,
  buildMedia,
  evaluateToken,
  LINK_REJECTION,
  type MomentRow,
  type PageResult,
  shapeTrip,
  collectMoments,
  type ShareLinkRow,
  TOKEN_MAX_LENGTH,
  type TokenVerdict,
  isTokenLengthPlausible,
  type ResolutionTrip,
} from './resolution.ts';
import { expectedKeys } from '../media-urls/keys.ts';

const TRIP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOW = new Date('2026-08-08T12:00:00.000Z');

function validRow(overrides: Partial<ShareLinkRow> = {}): ShareLinkRow {
  return {
    token: '7f3c1a9e2b4d6058a1c3e5f70921b8d4',
    trip_id: TRIP_ID,
    expires_at: null,
    revoked: false,
    ...overrides,
  };
}

const REVEALED: ResolutionTrip = {
  status: 'revealed',
  name: 'Lissabon Städtetrip',
  start_date: '2026-05-08',
  end_date: '2026-05-12',
};

// Exactly what the caller makes of a verdict: status code and body. The
// equality has to hold at THIS level, not at the level of a TypeScript
// object, what goes back over the wire are bytes.
function asHttpResponse(verdict: TokenVerdict): string {
  if (verdict.allowed) return 'ALLOWED';
  return `${verdict.status} ${JSON.stringify({ error: verdict.message })}`;
}

// ===========================================================================
// 1. The one guarantee everything hangs on
// ===========================================================================

Deno.test('resolve: the four rejections are byte-identical, status and body', () => {
  const cases: Array<[string, TokenVerdict]> = [
    // a) token unknown
    ['token unknown', evaluateToken(null, null, NOW)],
    // b) token revoked
    ['token revoked', evaluateToken(validRow({ revoked: true }), REVEALED, NOW)],
    // c) token expired
    [
      'token expired',
      evaluateToken(validRow({ expires_at: '2026-08-08T11:59:59.000Z' }), REVEALED, NOW),
    ],
    // d) trip not revealed
    ['trip not revealed', evaluateToken(validRow(), { ...REVEALED, status: 'active' }, NOW)],
  ];

  // First against the expected wording, otherwise four equally wrong
  // responses would also count as "equal".
  const expected = `404 ${JSON.stringify({ error: 'Dieser Link funktioniert nicht mehr.' })}`;
  for (const [name, verdict] of cases) {
    assertEquals(asHttpResponse(verdict), expected, `${name} weicht ab`);
  }

  // And then pairwise against each other: whatever collapses here can no
  // longer be an oracle.
  for (const [nameA, a] of cases) {
    for (const [nameB, b] of cases) {
      assertEquals(asHttpResponse(a), asHttpResponse(b), `${nameA} unterscheidet sich von ${nameB}`);
    }
  }
});

Deno.test('resolve: a too-long token gets the same rejection as an unknown one', () => {
  // index.ts forms this case from the same constant instead of inventing
  // its own text, otherwise the length limit itself would be a signal
  // ("this token at least has the right shape").
  assertFalse(isTokenLengthPlausible('x'.repeat(TOKEN_MAX_LENGTH + 1)));
  assert(isTokenLengthPlausible('x'.repeat(TOKEN_MAX_LENGTH)));
  assertFalse(isTokenLengthPlausible(''));

  assertEquals(
    asHttpResponse(LINK_REJECTION),
    asHttpResponse(evaluateToken(null, null, NOW)),
  );
});

Deno.test('resolve: the rejection cannot be changed by the caller', () => {
  // All four branches return the SAME value. If it were mutable, a single
  // accidental `verdict.message = …` at the call site would rewrite all
  // four at once.
  const verdict = evaluateToken(null, null, NOW);
  assertFalse(verdict.allowed);
  try {
    (verdict as { message: string }).message = 'Token existiert nicht.';
  } catch {
    // In strict mode the assignment throws, either way is fine as long as
    // the value stays unchanged afterwards.
  }
  assertEquals(
    asHttpResponse(evaluateToken(null, null, NOW)),
    `404 ${JSON.stringify({ error: 'Dieser Link funktioniert nicht mehr.' })}`,
  );
});

// ===========================================================================
// 2. Check chain and edge cases
// ===========================================================================

Deno.test('resolve: a valid token on a revealed trip is allowed', () => {
  assertEquals(evaluateToken(validRow(), REVEALED, NOW), { allowed: true });
});

Deno.test('resolve: an archived trip stays readable, put away is not locked away', () => {
  assertEquals(
    evaluateToken(validRow(), { ...REVEALED, status: 'archived' }, NOW),
    { allowed: true },
  );
});

Deno.test('resolve: expires_at in the future is valid, to the exact second it no longer is', () => {
  assertEquals(
    evaluateToken(validRow({ expires_at: '2026-08-08T12:00:00.001Z' }), REVEALED, NOW),
    { allowed: true },
  );
  // The moment of expiry no longer counts.
  assertFalse(
    evaluateToken(validRow({ expires_at: '2026-08-08T12:00:00.000Z' }), REVEALED, NOW).allowed,
  );
});

Deno.test('resolve: an unparseable expiry date counts as expired, not as "no expiry"', () => {
  // The dangerous mix-up: a value Date.parse does not understand produces
  // NaN. Every comparison with NaN is false, a naive check (`expiry <=
  // now`) would leave the link valid indefinitely.
  assertEquals(
    asHttpResponse(evaluateToken(validRow({ expires_at: 'irgendwann' }), REVEALED, NOW)),
    asHttpResponse(LINK_REJECTION),
  );
});

Deno.test('resolve: a revoked token stays rejected, even with no expiry date and on an open trip', () => {
  // Order matters: revoked is checked BEFORE expiry and BEFORE trip status,
  // so a revocation never depends on any other condition.
  assertFalse(evaluateToken(validRow({ revoked: true, expires_at: null }), REVEALED, NOW).allowed);
});

Deno.test('resolve: a token row with no trip is rejected instead of let through', () => {
  // Cannot occur today (trip_id is not null with on delete cascade), a
  // missing trip is still no reason to hand out media.
  assertEquals(asHttpResponse(evaluateToken(validRow(), null, NOW)), asHttpResponse(LINK_REJECTION));
});

Deno.test('resolve: a revoked link never reaches the coordinates', () => {
  // K15. Checks no new logic, just pins down the ORDER: since Phase 7
  // moments carry lat/lng (Spec R4), and this is the only path through
  // which coordinates reach people with no account. buildMedia, and with it
  // every coordinate, only runs once this verdict says `allowed`; a
  // negative verdict leaves index.ts no path at all to querying the
  // moments. Revocation is the case that matters: it hits a link that was
  // still ALLOWED to show the coordinates yesterday.
  const verdict = evaluateToken(validRow({ revoked: true }), REVEALED, NOW);
  assertEquals(verdict.allowed, false);
  // And the rejection stays the one byte-identical value: that the link
  // once worked is not in the response.
  assertEquals(asHttpResponse(verdict), asHttpResponse(LINK_REJECTION));
});

// ===========================================================================
// 3. Paging past the max_rows boundary
// ===========================================================================

function momentRow(id: string, overrides: Partial<MomentRow> = {}): MomentRow {
  return {
    id,
    type: 'photo',
    media_ext: 'jpg',
    storage_key: expectedKeys(TRIP_ID, id, 'photo', 'jpg').storage_key,
    thumb_key: expectedKeys(TRIP_ID, id, 'photo', 'jpg').thumb_key,
    captured_at: '2026-05-08T08:00:00Z',
    captured_tz: 'Europe/Lisbon',
    place_name: 'Lissabon',
    // No place is the default, not the exception: ortBestimmen()
    // deliberately returns null when location services are not allowed, no
    // fix is obtained indoors, or the deadline runs out. Whoever needs
    // coordinates sets them explicitly in their test case.
    lat: null,
    lng: null,
    caption: null,
    duration_s: null,
    author_name: 'Mira',
    // No picture is the default, not the exception: most profiles in this
    // file's existing tests never set one. Whoever needs the case with a
    // picture overrides it explicitly (see section 4b below).
    author_avatar_key: null,
    ...overrides,
  };
}

// A server that caps at an upper bound like PostgREST, with no error, no
// hint. Exactly the property a single select silently fails against.
function cappingServer(count: number, pageSize: number) {
  const all = Array.from({ length: count }, (_, i) => momentRow(`post-${String(i).padStart(4, '0')}`));
  let fetches = 0;
  return {
    all,
    get fetches() {
      return fetches;
    },
    fetchPage(from: number, withCount: boolean): Promise<PageResult> {
      fetches += 1;
      return Promise.resolve({
        rows: all.slice(from, from + pageSize),
        count: withCount ? count : null,
        error: null,
      });
    },
  };
}

Deno.test('collectMoments: pages past the page boundary and loses no moment', async () => {
  const server = cappingServer(1001, 1000);
  const { rows, lost, error } = await collectMoments(server.fetchPage);
  assertEquals(error, null);
  // Without paging this would read 1000, the silent loss this is about.
  assertEquals(rows.length, 1001);
  assertEquals(rows.map((r) => r.id), server.all.map((r) => r.id));
  assertEquals(lost, 0);
});

Deno.test('collectMoments: a single full page costs no second fetch', async () => {
  const server = cappingServer(1000, 1000);
  const { rows } = await collectMoments(server.fetchPage);
  assertEquals(rows.length, 1000);
  // The first pass's count saves the otherwise needed empty fetch.
  assertEquals(server.fetches, 1);
});

Deno.test('collectMoments: a duplicate at the page boundary appears only once', async () => {
  // What happens when, between two fetches, a `confirm` sets a moment with
  // an earlier captured_at to 'uploaded': everything after it shifts back
  // one position, the last row of the first page comes back ONCE MORE in
  // the second. The cross-check against the count only catches the loss
  // direction, not this one.
  const pages: MomentRow[][] = [
    [momentRow('a'), momentRow('b'), momentRow('c')],
    [momentRow('c'), momentRow('d')],
    [],
  ];
  let i = 0;
  const { rows, lost } = await collectMoments((_from, withCount) =>
    Promise.resolve({ rows: pages[i++] ?? [], count: withCount ? 5 : null, error: null })
  );
  assertEquals(rows.map((r) => r.id), ['a', 'b', 'c', 'd']);
  // Five counted, four distinct collected: the gap is made visible, instead
  // of claiming a complete recap.
  assertEquals(lost, 1);
});

Deno.test('collectMoments: a page made entirely of duplicates does not lead to an infinite loop', async () => {
  // The offset grows against what was DELIVERED, not what was KEPT. Measured
  // against the kept rows, it would stand still here forever.
  let fetches = 0;
  const { rows } = await collectMoments((_from, withCount) => {
    fetches += 1;
    if (fetches > 5) return Promise.resolve({ rows: [], count: null, error: null });
    return Promise.resolve({
      rows: [momentRow('a'), momentRow('a')],
      count: withCount ? 99 : null,
      error: null,
    });
  });
  assertEquals(rows.map((r) => r.id), ['a']);
  assert(fetches <= 6, `sammleMomente hat ${fetches} Abrufe gebraucht`);
});

Deno.test('collectMoments: an error aborts and is passed through', async () => {
  const { error, rows } = await collectMoments(() =>
    Promise.resolve({ rows: [], count: null, error: { message: 'kaputt' } })
  );
  assertEquals(error, { message: 'kaputt' });
  assertEquals(rows.length, 0);
});

Deno.test('collectMoments: an empty trip ends the loop immediately', async () => {
  const { rows, lost } = await collectMoments((_from, withCount) =>
    Promise.resolve({ rows: [], count: withCount ? 0 : null, error: null })
  );
  assertEquals(rows, []);
  assertEquals(lost, 0);
});

// ===========================================================================
// 4. Keys are derived, not taken as given
// ===========================================================================

// A signer that, instead of a real signature, only records WHICH path was
// supposed to be signed. Not a mock replacing the checked mechanism: the
// derivation still happens inside buildMedia, only its result is made
// visible here.
function recordingSigner() {
  const signed: string[] = [];
  return {
    signed,
    fn: (key: string) => {
      signed.push(key);
      return Promise.resolve(`https://s3.example/${key}?X-Amz-Expires=3600`);
    },
  };
}

Deno.test('buildMedia: signs the DERIVED path, not the stored thumb_key', async () => {
  const FOREIGN_TRIP = '00000000-0000-4000-8000-00000000dead';
  const row = momentRow('cccccccc-0000-4000-8000-000000000001', {
    // storage_key is correct, thumb_key points into a foreign trip. So the
    // entry stays in the response, and this is exactly what proves the
    // thumb path is derived too. A thumbnail is the content of a moment in
    // miniature; security-wise the same is at stake here as with the
    // medium.
    thumb_key: `trips/${FOREIGN_TRIP}/beliebig_t.jpg`,
  });
  const signer = recordingSigner();
  const { media, skipped } = await buildMedia(TRIP_ID, [row], signer.fn);

  assertEquals(skipped, 0);
  assertEquals(media.length, 1);
  const expected = expectedKeys(TRIP_ID, row.id, 'photo', 'jpg');
  assertEquals(signer.signed, [expected.storage_key, expected.thumb_key]);
  for (const key of signer.signed) {
    assertFalse(key.includes(FOREIGN_TRIP), `ein fremder Pfad wurde signiert: ${key}`);
  }
});

Deno.test('buildMedia: a row whose storage_key points elsewhere is dropped and counted', async () => {
  const good = momentRow('cccccccc-0000-4000-8000-000000000001');
  const bad = momentRow('cccccccc-0000-4000-8000-000000000002', {
    storage_key: 'trips/00000000-0000-4000-8000-00000000dead/beliebig.jpg',
  });
  const signer = recordingSigner();
  const { media, skipped } = await buildMedia(TRIP_ID, [good, bad], signer.fn);

  assertEquals(media.map((m) => m.post_id), [good.id]);
  assertEquals(skipped, 1);
  for (const key of signer.signed) {
    assertFalse(key.includes('dead'), `für eine ausgelassene Zeile wurde signiert: ${key}`);
  }
});

Deno.test('buildMedia: no thumb_key produces thumb_url = null instead of a signature for ".../null"', async () => {
  const row = momentRow('cccccccc-0000-4000-8000-000000000003', { thumb_key: null });
  const signer = recordingSigner();
  const { media } = await buildMedia(TRIP_ID, [row], signer.fn);
  assertEquals(media[0].thumb_url, null);
  assertEquals(signer.signed.length, 1);
  assertFalse(signer.signed[0].includes('null'));
});

Deno.test('buildMedia: the order of the rows is preserved', async () => {
  const ids = ['post-1', 'post-2', 'post-3'];
  const signer = recordingSigner();
  const { media } = await buildMedia(TRIP_ID, ids.map((id) => momentRow(id)), signer.fn);
  assertEquals(media.map((m) => m.post_id), ids);
});

Deno.test('buildMedia: the extension comes from the row media_ext (iOS .mov, Android .mp4)', async () => {
  const row = momentRow('cccccccc-0000-4000-8000-000000000004', {
    type: 'video',
    media_ext: 'mov',
    duration_s: 12,
    storage_key: expectedKeys(TRIP_ID, 'cccccccc-0000-4000-8000-000000000004', 'video', 'mov').storage_key,
    thumb_key: null,
  });
  const signer = recordingSigner();
  const { media, skipped } = await buildMedia(TRIP_ID, [row], signer.fn);
  assertEquals(skipped, 0);
  assert(signer.signed[0].endsWith('.mov'), signer.signed[0]);
  assertEquals(media[0].duration_s, 12);
});

Deno.test('buildMedia: lat and lng pass through unchanged', async () => {
  // Since Phase 7 the shared recap shows the same map as the app (Spec R4).
  // The value is checked, not just the field's presence: a swapped or
  // rounded coordinate drops a pin at the wrong place, and a negative
  // longitude (Lisbon sits west of Greenwich) is the case a sign error
  // would show up in.
  const row = momentRow('cccccccc-0000-4000-8000-000000000005', { lat: 38.7139, lng: -9.1301 });
  const signer = recordingSigner();
  const { media, skipped } = await buildMedia(TRIP_ID, [row], signer.fn);
  assertEquals(skipped, 0);
  assertEquals(media[0].lat, 38.7139);
  assertEquals(media[0].lng, -9.1301);
});

Deno.test('buildMedia: a moment with no place keeps null instead of disappearing', async () => {
  // The normal case, not the special case: ortBestimmen() deliberately
  // returns null when location services are not allowed. The moment still
  // gets submitted, and therefore has to appear in the shared recap too. A
  // `filter` on set coordinates would be silent data loss; the map leaves
  // out the pin, not the film roll the moment.
  const row = momentRow('cccccccc-0000-4000-8000-000000000006', { lat: null, lng: null });
  const signer = recordingSigner();
  const { media, skipped } = await buildMedia(TRIP_ID, [row], signer.fn);
  assertEquals(skipped, 0);
  assertEquals(media.length, 1);
  assertEquals(media[0].lat, null);
  assertEquals(media[0].lng, null);
});

// ===========================================================================
// 4b. The avatar key passes through, never a finished URL (Task 10)
// ===========================================================================
// Its own, lean row factory instead of `momentRow()` from above: the two
// tests here check ONLY the pass-through of author_avatar_key, every other
// field is irrelevant to the point being made. `storage_key`/`thumb_key`
// still have to match the derivation from keys.ts (`trips/<trip>/<post>.<ext>`),
// otherwise buildMedia sorts the moment out and `media` would be empty, a
// test that then proves nothing anymore.
const row = (avatarKey: string | null): MomentRow => ({
  id: 'p1',
  type: 'photo',
  media_ext: 'jpg',
  storage_key: 'trips/t1/p1.jpg',
  thumb_key: 'trips/t1/p1_t.jpg',
  captured_at: '2026-08-01T10:00:00Z',
  captured_tz: 'Europe/Zurich',
  place_name: null,
  lat: null,
  lng: null,
  caption: null,
  duration_s: null,
  author_name: 'Lea',
  author_avatar_key: avatarKey,
});

Deno.test('buildMedia passes the avatar key through', async () => {
  const { media } = await buildMedia('t1', [row('profiles/u1/a.jpg')], async (k) => `https://sig/${k}`);
  assertEquals(media[0].author_avatar_key, 'profiles/u1/a.jpg');
});

// Like author_name: a missing value becomes null, never undefined. A field
// that is sometimes missing gets overlooked while building the web player.
Deno.test('with no picture, the contract carries null, not undefined', async () => {
  const { media } = await buildMedia('t1', [row(null)], async (k) => `https://sig/${k}`);
  assertEquals(media[0].author_avatar_key, null);
});

// ===========================================================================
// 5. The response shape, the evidence for what does NOT leave
// ===========================================================================

// The forbidden list from Spec §5.1 and the task brief, plus the fields a
// trip row otherwise carries.
const FORBIDDEN_FIELDS = [
  'reaktionen',
  'reactions',
  'kommentare',
  'comments',
  'mitglieder',
  'members',
  'trip_members',
  'invite_code',
  'author_id',
  'owner_id',
  'reporter_id',
  'status',
  'revealed_at',
  'plan',
  'storage_key',
  'thumb_key',
  'upload_status',
];

Deno.test('shapeTrip: returns EXACTLY name, start_date and end_date', () => {
  // The row deliberately arrives here with everything public.trips carries.
  // invite_code alone would let anyone with the public link join the trip,
  // "allowed to look" would turn into "able to take part".
  const fullRow = {
    id: TRIP_ID,
    name: 'Lissabon Städtetrip',
    cover_key: 'trips/x/cover.jpg',
    start_date: '2026-05-08',
    end_date: '2026-05-12',
    status: 'revealed',
    revealed_at: '2026-05-13T17:00:00Z',
    invite_code: 'a1b2c3d4e5f6',
    owner_id: '33333333-3333-4333-8333-333333333333',
    plan: 'free',
    created_at: '2026-05-01T10:00:00Z',
  };

  const trip = shapeTrip(fullRow);
  assertEquals(Object.keys(trip).sort(), ['end_date', 'name', 'start_date']);
  assertEquals(trip, { name: 'Lissabon Städtetrip', start_date: '2026-05-08', end_date: '2026-05-12' });
});

Deno.test('the response from resolve carries exactly the fields of the contract', async () => {
  const fullRow = {
    id: TRIP_ID,
    name: 'Lissabon Städtetrip',
    start_date: '2026-05-08',
    end_date: '2026-05-12',
    status: 'revealed',
    invite_code: 'a1b2c3d4e5f6',
    owner_id: '33333333-3333-4333-8333-333333333333',
  };
  const signer = recordingSigner();
  const { media, skipped } = await buildMedia(
    TRIP_ID,
    [momentRow('cccccccc-0000-4000-8000-000000000001', { caption: 'Fähre legt ab' })],
    signer.fn,
  );
  const response = buildResolveResponse(fullRow, media, '2026-08-08T13:00:00.000Z', skipped);

  assertEquals(Object.keys(response).sort(), ['media', 'skipped', 'trip', 'valid_until']);
  assertEquals(Object.keys(response.trip).sort(), ['end_date', 'name', 'start_date']);
  // Thirteen fields since Task 10 (twelve before): author_avatar_key was
  // added (before that ten, until Phase 7 brought lat and lng). This list is
  // the place where an unintentionally added column shows up, even one
  // that looks harmless.
  assertEquals(Object.keys(response.media[0]).sort(), [
    'author_avatar_key',
    'author_name',
    'caption',
    'captured_at',
    'captured_tz',
    'duration_s',
    'lat',
    'lng',
    'medium_url',
    'place_name',
    'post_id',
    'thumb_url',
    'type',
  ]);

  // The author's name belongs in it, it already sits on every moment in the
  // recap anyway. There is still no FIELD author_id; the UUID itself does
  // travel along in `author_avatar_key` since the profile picture feature
  // once the author has a picture (here: null, see momentRow()).
  assertEquals(response.media[0].author_name, 'Mira');

  // And finally the coarse but effective grip: the whole response as text.
  // That also catches a field someone later smuggles in through a nested
  // object or a ...spread, instead of writing it into the key list above.
  const asText = JSON.stringify(response);
  for (const field of FORBIDDEN_FIELDS) {
    assertFalse(asText.includes(field), `die Antwort enthält "${field}": ${asText}`);
  }
  assertFalse(asText.includes(fullRow.owner_id));
  assertFalse(asText.includes(fullRow.invite_code));
});
