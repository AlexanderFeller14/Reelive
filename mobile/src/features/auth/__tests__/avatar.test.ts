// expo-crypto wird in der echten Umgebung verwendet, der Mock hier liefert
// unterschiedliche UUIDs auf jeden Aufruf (damit der Test auf unterschiedliche
// Schlüssel vertrauen kann). Das Format muss ein echtes UUID sein, damit beim
// replace(/-/g, '') genau 32 Hex-Zeichen übrig bleiben.
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    const c = mockUuidCounter;
    mockUuidCounter += 1;
    const hex = c.toString(16).padStart(8, '0');
    return `${hex}-0000-4000-8000-000000000000`;
  }),
}));

import { avatarUrl, neuerAvatarSchluessel } from '../avatar';

const UID = '11111111-2222-3333-4444-555555555555';

// Das Präfix ist nicht Geschmackssache: konto-loeschen/index.ts führt genau
// `profiles/<user_id>/` als erlaubtes Präfix, und was nicht darauf passt,
// bleibt beim Kontolöschen für immer im Speicher liegen.
test('der Schluessel liegt im eigenen profiles-Ordner', () => {
  expect(neuerAvatarSchluessel(UID)).toMatch(
    new RegExp(`^profiles/${UID}/[0-9a-f]{32}\\.jpg$`)
  );
});

test('zwei Schluessel derselben Person unterscheiden sich', () => {
  expect(neuerAvatarSchluessel(UID)).not.toBe(neuerAvatarSchluessel(UID));
});

test('avatarUrl haengt den Schluessel an den oeffentlichen Pfad', () => {
  expect(avatarUrl(`profiles/${UID}/abc.jpg`)).toBe(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatare/profiles/${UID}/abc.jpg`
  );
});

// Ohne Bild gibt es keine URL, und der Aufrufer zeigt die Initiale. `null`
// statt einer URL auf ein Objekt, das es nicht gibt: eine kaputte Kachel wäre
// schlimmer als eine ehrliche Lücke.
test('ohne Schluessel gibt es keine URL', () => {
  expect(avatarUrl(null)).toBeNull();
  expect(avatarUrl(undefined)).toBeNull();
  expect(avatarUrl('')).toBeNull();
});
