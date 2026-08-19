import { assertEquals } from 'jsr:@std/assert@1';
import { canRemove, type PostRow, type TripRow } from './access.ts';

const AUTHOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const OWNER = 'bbbbbbbb-0000-4000-8000-000000000002';
const STRANGER = 'cccccccc-0000-4000-8000-000000000003';

function post(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'p1',
    trip_id: 't1',
    author_id: AUTHOR,
    type: 'photo',
    media_ext: 'jpg',
    ...overrides,
  };
}

function trip(overrides: Partial<TripRow> = {}): TripRow {
  return { status: 'revealed', owner_id: OWNER, ...overrides };
}

Deno.test('the author may remove her own moment', () => {
  assertEquals(canRemove(post(), trip(), AUTHOR), true);
});

Deno.test('the owner may remove any moment of her trip (moderation)', () => {
  assertEquals(canRemove(post(), trip(), OWNER), true);
});

// The case this function is really about: a third person may remove
// nothing. If that got through, the media would be deleted before any
// database rule ever got a say.
Deno.test('a third person may not, not even in a trip where they are a member', () => {
  assertEquals(canRemove(post(), trip(), STRANGER), false);
});

// Before the reveal nobody sees anyone else's moments, there is nothing to
// moderate, and an open delete path would be a channel through which the
// seal could be probed.
Deno.test('before the reveal nobody may remove, not even the author', () => {
  assertEquals(canRemove(post(), trip({ status: 'active' }), AUTHOR), false);
});

Deno.test('before the reveal the owner may not remove either', () => {
  assertEquals(canRemove(post(), trip({ status: 'active' }), OWNER), false);
});

// The counter-check for the status comparison: it checks for 'revealed',
// not for "not active". A status added later (archived, locked) therefore
// falls on the safe side, instead of silently being allowed.
Deno.test('an unknown status allows nothing', () => {
  assertEquals(canRemove(post(), trip({ status: 'archiviert' }), OWNER), false);
  assertEquals(canRemove(post(), trip({ status: '' }), AUTHOR), false);
});

// And the association: the owner of ONE trip is not the owner of every
// other one. The handler loads the trip via `post.trip_id`, this test
// records that the rule really makes that comparison.
Deno.test('the owner of a FOREIGN trip may not', () => {
  assertEquals(canRemove(post(), trip({ owner_id: STRANGER }), OWNER), false);
});
