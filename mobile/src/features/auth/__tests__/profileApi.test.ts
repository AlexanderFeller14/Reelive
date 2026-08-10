const mockInsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ insert: mockInsert, select: jest.fn() }) },
}));

import { validateUsername, validateDisplayName, createProfile } from '../profileApi';

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

test('createProfile mappt Unique-Verletzung auf Inline-Fehler', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
  const { error } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBe('Dieser Username ist vergeben, probier einen anderen.');
});

test('createProfile: Erfolg → error null', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  const { error } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBeNull();
  expect(mockInsert).toHaveBeenCalledWith({ id: 'uid-1', username: 'lea', display_name: 'Lea' });
});

// `feld` sagt dem Screen, WO die Meldung hingehört. Vorher gab es nur einen
// Fehlerstring, und der landete pauschal unter dem Username-Feld, auch
// «Das Profil konnte nicht gespeichert werden», was mit dem Username nichts
// zu tun hat (DESIGN-LANGUAGE §4: feldgenaue Zuordnung).
test('createProfile weist den vergebenen Username dem Username-Feld zu', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
  await expect(createProfile('uid-1', 'lea', 'Lea')).resolves.toEqual({
    error: 'Dieser Username ist vergeben, probier einen anderen.',
    feld: 'username',
  });
});

test('createProfile ordnet einen allgemeinen Fehler keinem Feld zu', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } });
  const { error, feld } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBe('Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.');
  expect(feld).toBeNull();
});
