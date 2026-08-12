import { entferneAvatar, setzeAvatar } from '../avatarApi';

const UID = '11111111-2222-3333-4444-555555555555';
const ALT = `profiles/${UID}/alt.jpg`;

// "mock"-Präfix ist hier keine Geschmacksfrage: babel-plugin-jest-hoist hebt
// jest.mock()-Aufrufe vor alle anderen Anweisungen (auch vor `const X =
// jest.fn()`), damit die Module schon gemockt sind, bevor sie importiert
// werden. Referenziert eine Factory eine Variable von ausserhalb, prüft das
// Plugin, ob sie diese Hebung übersteht — und das tut nur, was mit „mock“
// beginnt (case-insensitive), das hebt es gleich mit an. Ohne das Präfix
// bricht schon der Testlauf mit "not allowed to reference any out-of-scope
// variables" ab, siehe medien.test.ts für dieselbe Falle bei Typ-Aliassen.
const mockHochgeladen = jest.fn();
const mockEntfernt = jest.fn();
const mockAktualisiert = jest.fn();

// avatarApi ruft neuerAvatarSchluessel (avatar.ts) auf, und die nutzt echtes
// expo-crypto. Im Jest-Environment ersetzt jest-expo jedes native Modul
// automatisch durch den generierten No-op-Mock aus
// expo-crypto/mocks/ExpoCrypto.ts, dessen randomUUID() dort `undefined`
// liefert — derselbe Grund, aus dem avatar.test.ts denselben Mock schon
// braucht. Ohne ihn wirft `Crypto.randomUUID().replace(...)` schon beim
// ersten Aufruf, bevor die eigentliche Assertion überhaupt greift.
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    const c = mockUuidCounter;
    mockUuidCounter += 1;
    const hex = c.toString(16).padStart(8, '0');
    return `${hex}-0000-4000-8000-000000000000`;
  },
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: async () => ({ uri: 'file:///cache/fertig.jpg' }),
        release: jest.fn(),
      }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    upload = (...args: unknown[]) => {
      mockHochgeladen(...args);
      return Promise.resolve({ status: 200 });
    };
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({
      update: (werte: unknown) => ({
        eq: async (_s: string, _v: string) => {
          mockAktualisiert(werte);
          return { error: null };
        },
      }),
    }),
    storage: { from: () => ({ remove: async (keys: string[]) => { mockEntfernt(keys); return { error: null }; } }) },
  },
}));

// mockReset, nicht mockClear: mehrere Tests unten setzen eine eigene
// Implementation (werfen, Reihenfolge protokollieren). mockClear löscht nur die
// Aufrufliste und liesse sie in den nächsten Test überlaufen — ein Test, der
// dann aus dem falschen Grund grün oder rot wird.
beforeEach(() => {
  mockHochgeladen.mockReset();
  mockEntfernt.mockReset();
  mockAktualisiert.mockReset();
});

test('setzeAvatar laedt hoch, setzt die Spalte und raeumt das alte Objekt weg', async () => {
  const { avatarKey, error } = await setzeAvatar(UID, 'file:///gewaehlt.jpg', ALT);
  expect(error).toBeNull();
  expect(avatarKey).toMatch(new RegExp(`^profiles/${UID}/[0-9a-f]{32}\\.jpg$`));
  expect(mockAktualisiert).toHaveBeenCalledWith({ avatar_key: avatarKey });
  expect(mockEntfernt).toHaveBeenCalledWith([ALT]);
});

// Die Reihenfolge ist die eigentliche Zusicherung: erst das Objekt, dann die
// Spalte. Umgekehrt zeigte die Zeile auf etwas, das noch nicht da ist, und
// alle Mitreisenden sähen eine kaputte Kachel.
test('die Spalte wird erst nach dem Hochladen gesetzt', async () => {
  const reihenfolge: string[] = [];
  mockHochgeladen.mockImplementation(() => reihenfolge.push('upload'));
  mockAktualisiert.mockImplementation(() => reihenfolge.push('update'));
  await setzeAvatar(UID, 'file:///gewaehlt.jpg', null);
  expect(reihenfolge).toEqual(['upload', 'update']);
});

// Ein liegengebliebenes altes Objekt kostet ~50 KB. Ein Fehlschlag hier darf
// das neue, bereits gesetzte Bild nicht zurücknehmen.
test('ein gescheitertes Aufraeumen laesst das neue Bild stehen', async () => {
  mockEntfernt.mockImplementation(() => { throw new Error('weg ist weg'); });
  const { avatarKey, error } = await setzeAvatar(UID, 'file:///gewaehlt.jpg', ALT);
  expect(error).toBeNull();
  expect(avatarKey).not.toBeNull();
});

test('ein gescheiterter Upload setzt die Spalte nicht', async () => {
  mockHochgeladen.mockImplementation(() => { throw new Error('kein Netz'); });
  const { avatarKey, error } = await setzeAvatar(UID, 'file:///gewaehlt.jpg', null);
  expect(avatarKey).toBeNull();
  expect(error).toBe('Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.');
  expect(mockAktualisiert).not.toHaveBeenCalled();
});

// Beim Entfernen umgekehrt: erst die Spalte, dann das Objekt. Sonst zeigte die
// Zeile auf etwas, das schon weg ist.
test('entferneAvatar leert die Spalte vor dem Objekt', async () => {
  const reihenfolge: string[] = [];
  mockAktualisiert.mockImplementation(() => reihenfolge.push('update'));
  mockEntfernt.mockImplementation(() => reihenfolge.push('remove'));
  const { error } = await entferneAvatar(UID, ALT);
  expect(error).toBeNull();
  expect(reihenfolge).toEqual(['update', 'remove']);
  expect(mockAktualisiert).toHaveBeenCalledWith({ avatar_key: null });
});
