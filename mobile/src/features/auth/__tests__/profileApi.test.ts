const mockInsert = jest.fn();
// `update(...).eq(...)` is a chain: `update` returns the object with `eq`,
// only `eq` resolves the promise with `{ error }`, the way PostgREST does it.
const mockUpdateEq = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockUpdateEq }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ insert: mockInsert, update: mockUpdate, select: jest.fn() }) },
}));

import { validateUsername, validateDisplayName, createProfile, updateProfile } from '../profileApi';

test.each([
  ['lea', null],
  ['lea_2026', null],
  ['ab', 'Mindestens 3 Zeichen: Kleinbuchstaben, Zahlen und _.'],
  ['Lea', 'Mindestens 3 Zeichen: Kleinbuchstaben, Zahlen und _.'],
  ['a'.repeat(21), 'Mindestens 3 Zeichen: Kleinbuchstaben, Zahlen und _.'],
])('validateUsername(%s) → %s', (input, expected) => {
  expect(validateUsername(input)).toBe(expected);
});

test.each([
  ['Lea', null],
  ['', 'Sag uns, wie du heissen willst (1–40 Zeichen).'],
  ['x'.repeat(41), 'Sag uns, wie du heissen willst (1–40 Zeichen).'],
])('validateDisplayName(%s) → %s', (input, expected) => {
  expect(validateDisplayName(input)).toBe(expected);
});

test('createProfile maps a unique violation to an inline error', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
  const { error } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBe('Dieser Username ist vergeben, probier einen anderen.');
});

test('createProfile: success → error null', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  const { error } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBeNull();
  // Scaffolding adjustment (Task 7): `createProfile` now ALWAYS writes a
  // fourth field `avatar_key` along (default `null`, see the signature
  // below). This pre-existing assertion previously checked the insert
  // without this field, with the extended signature the function now
  // actually calls `insert` with `avatar_key: null`, the old expectation
  // would be wrong.
  expect(mockInsert).toHaveBeenCalledWith({
    id: 'uid-1', username: 'lea', display_name: 'Lea', avatar_key: null,
  });
});

// Task 7: onboarding uploads a chosen image before `createProfile` and
// passes the finished key through, so the row is created with `avatar_key`
// in a single write (no follow-up update).
test('createProfile writes avatar_key along', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await createProfile('u1', 'lea', 'Lea', 'profiles/u1/a.jpg');
  expect(mockInsert).toHaveBeenCalledWith({
    id: 'u1',
    username: 'lea',
    display_name: 'Lea',
    avatar_key: 'profiles/u1/a.jpg',
  });
});

// Without a chosen image it stays at the default `null`, never an empty
// string (empty strings have already been a problem in this schema before,
// see 20260808150000_leerstrings_und_profil_grants.sql, and RLS rejects ''
// with 42501, see Task 1).
test('createProfile without an image writes null', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await createProfile('u1', 'lea', 'Lea');
  expect(mockInsert).toHaveBeenCalledWith({
    id: 'u1',
    username: 'lea',
    display_name: 'Lea',
    avatar_key: null,
  });
});

// `field` tells the screen WHERE the message belongs. Previously there was
// only one error string, and it landed under the username field across the
// board, even "the profile could not be saved" (DESIGN-LANGUAGE §4:
// field-precise assignment).
test('createProfile assigns a taken username to the username field', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
  await expect(createProfile('uid-1', 'lea', 'Lea')).resolves.toEqual({
    error: 'Dieser Username ist vergeben, probier einen anderen.',
    field: 'username',
  });
});

test('createProfile assigns a general error to no field', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } });
  const { error, field } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBe('Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.');
  expect(field).toBeNull();
});

// "Change display name" in the profile tab. The username is deliberately not
// part of this (decision 2026-08-13): it may later become a login
// identifier, and a freed-up old name would then be a confusion risk.
// Without a server-side brake (cooldown, lock period) it stays fixed, this
// assertion is therefore also that ONLY display_name sits in the update.
test('updateProfile writes only the trimmed display name, never the username', async () => {
  mockUpdateEq.mockResolvedValueOnce({ error: null });
  const { error } = await updateProfile('uid-1', ' Lea Neu ');
  expect(error).toBeNull();
  expect(mockUpdate).toHaveBeenCalledWith({ display_name: 'Lea Neu' });
  expect(mockUpdateEq).toHaveBeenCalledWith('id', 'uid-1');
});

test('updateProfile reports an error with cause and fix', async () => {
  mockUpdateEq.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } });
  const { error } = await updateProfile('uid-1', 'Lea');
  expect(error).toBe('Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.');
});
