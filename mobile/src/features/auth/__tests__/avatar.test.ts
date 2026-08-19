// expo-crypto is used in the real environment, the mock here returns a
// different UUID on every call (so the test can rely on distinct keys). The
// format has to be a real UUID so that replace(/-/g, '') leaves exactly 32
// hex characters.
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    const c = mockUuidCounter;
    mockUuidCounter += 1;
    const hex = c.toString(16).padStart(8, '0');
    return `${hex}-0000-4000-8000-000000000000`;
  }),
}));

import { avatarUrl, newAvatarKey } from '../avatar';

const UID = '11111111-2222-3333-4444-555555555555';

// The prefix is not a matter of taste: konto-loeschen/index.ts allows
// exactly `profiles/<user_id>/` as its allowed prefix, and whatever does not
// match that stays in storage forever on account deletion.
test('the key lives in its own profiles folder', () => {
  expect(newAvatarKey(UID)).toMatch(
    new RegExp(`^profiles/${UID}/[0-9a-f]{32}\\.jpg$`)
  );
});

test('two keys of the same person differ', () => {
  expect(newAvatarKey(UID)).not.toBe(newAvatarKey(UID));
});

test('avatarUrl appends the key to the public path', () => {
  expect(avatarUrl(`profiles/${UID}/abc.jpg`)).toBe(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatare/profiles/${UID}/abc.jpg`
  );
});

// Without an image there is no URL, and the caller shows the initial. `null`
// instead of a URL to an object that does not exist: a broken tile would be
// worse than an honest gap.
test('without a key there is no URL', () => {
  expect(avatarUrl(null)).toBeNull();
  expect(avatarUrl(undefined)).toBeNull();
  expect(avatarUrl('')).toBeNull();
});
