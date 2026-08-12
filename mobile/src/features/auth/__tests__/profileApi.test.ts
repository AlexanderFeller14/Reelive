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
  // Scaffolding-Anpassung (Task 7): `createProfile` schreibt jetzt IMMER ein
  // viertes Feld `avatar_key` mit (Default `null`, siehe Signatur unten).
  // Diese bereits vorhandene Zusicherung prüfte vorher das Insert ohne dieses
  // Feld — mit der erweiterten Signatur ruft die Funktion `insert` jetzt
  // tatsächlich mit `avatar_key: null` auf, die alte Erwartung wäre falsch.
  expect(mockInsert).toHaveBeenCalledWith({
    id: 'uid-1', username: 'lea', display_name: 'Lea', avatar_key: null,
  });
});

// Task 7: das Onboarding lädt ein gewähltes Bild vor `createProfile` hoch und
// reicht den fertigen Schlüssel durch, damit die Zeile mit `avatar_key` in
// einem einzigen Schreibvorgang entsteht (kein nachgelagertes Update).
test('createProfile schreibt avatar_key mit', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await createProfile('u1', 'lea', 'Lea', 'profiles/u1/a.jpg');
  expect(mockInsert).toHaveBeenCalledWith({
    id: 'u1',
    username: 'lea',
    display_name: 'Lea',
    avatar_key: 'profiles/u1/a.jpg',
  });
});

// Ohne gewähltes Bild bleibt es beim Default `null`, nie ein Leerstring
// (Leerstrings waren in diesem Schema schon einmal ein Problem, siehe
// 20260808150000_leerstrings_und_profil_grants.sql, und RLS lehnt `''` mit
// 42501 ab, siehe Task 1).
test('createProfile ohne Bild schreibt null', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await createProfile('u1', 'lea', 'Lea');
  expect(mockInsert).toHaveBeenCalledWith({
    id: 'u1',
    username: 'lea',
    display_name: 'Lea',
    avatar_key: null,
  });
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
