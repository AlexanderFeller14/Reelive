import { removeAvatar, setAvatar } from '../avatarApi';

const UID = '11111111-2222-3333-4444-555555555555';
const OLD = `profiles/${UID}/alt.jpg`;

// The "mock" prefix here isn't a matter of taste: babel-plugin-jest-hoist
// hoists jest.mock() calls above all other statements (even above
// `const X = jest.fn()`), so the modules are already mocked before they get
// imported. If a factory references a variable from outside, the plugin
// checks whether it survives this hoisting, and only what starts with
// "mock" (case-insensitive) does, so it gets hoisted along with it. Without
// the prefix the test run already breaks with "not allowed to reference any
// out-of-scope variables", see media.test.ts for the same trap with type
// aliases.
const mockUploaded = jest.fn();
const mockRemoved = jest.fn();
const mockUpdated = jest.fn();
const mockCrop = jest.fn();
const mockResize = jest.fn();

// The HTTP status the mocked upload returns, controllable per test.
//
// Previously this was fixed at `{ status: 200 }`, and that meant the status
// branch in avatarApi's upload() was unreachable by ANY test: the check
// could have been deleted without a trace, the suite would have stayed
// green. But this exact check carries the assurance from Spec §5.4:
// `File.upload()` does NOT throw on 4xx/5xx, it returns the response
// instead. Without it, a rejected upload (413 over the 2 MiB bucket limit,
// 403 on a violated folder policy) would set `avatar_key` to a key with no
// bytes behind it: a broken tile for every fellow traveller and in the
// shared recap.
//
// "mock" prefix for the same hoisting reason as above; the variable is only
// read at upload()'s call time, not while the factory gets hoisted.
let mockUploadStatus = 200;

// avatarApi calls newAvatarKey (avatar.ts), which uses real expo-crypto. In
// the Jest environment, jest-expo automatically replaces every native
// module with the generated no-op mock from expo-crypto/mocks/ExpoCrypto.ts,
// whose randomUUID() returns `undefined` there, the same reason avatar.test.ts
// already needs this same mock. Without it, `Crypto.randomUUID().replace(...)`
// throws on the very first call, before the actual assertion even gets a
// chance to run.
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    const c = mockUuidCounter;
    mockUuidCounter += 1;
    const hex = c.toString(16).padStart(8, '0');
    return `${hex}-0000-4000-8000-000000000000`;
  },
}));

// The source dimensions are adjustable, because cropping has happened in
// avatarApi since the 2026-08-13 bug, not in the system editor anymore: only
// with a NON-square original can it be checked that cropping happens
// centered on the shorter edge instead of squashing.
let mockSourceWidth = 4000;
let mockSourceHeight = 3000;

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      crop: (...a: unknown[]) => mockCrop(...a),
      resize: (...a: unknown[]) => mockResize(...a),
      renderAsync: async () => ({
        // renderAsync returns the dimensions, that's exactly where avatarApi reads them from.
        get width() { return mockSourceWidth; },
        get height() { return mockSourceHeight; },
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
      mockUploaded(...args);
      return Promise.resolve({ status: mockUploadStatus });
    };
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({
      update: (values: unknown) => ({
        eq: async (_s: string, _v: string) => {
          mockUpdated(values);
          return { error: null };
        },
      }),
    }),
    storage: { from: () => ({ remove: async (keys: string[]) => { mockRemoved(keys); return { error: null }; } }) },
  },
}));

// mockReset, not mockClear: several tests below set their own implementation
// (throw, log order). mockClear only clears the call list and would let it
// carry over into the next test, a test that would then pass or fail for
// the wrong reason.
beforeEach(() => {
  mockUploaded.mockReset();
  mockRemoved.mockReset();
  mockUpdated.mockReset();
  mockCrop.mockReset();
  mockResize.mockReset();
  mockUploadStatus = 200;
  mockSourceWidth = 4000;
  mockSourceHeight = 3000;
});

// Cropping has been the app's own job since 2026-08-13: `allowsEditing` had
// to go from the image picker, because on iOS it forces the old
// UIImagePickerController, which gets torn down by the system on large
// originals (the app then only sees an indistinguishable `canceled`). So the
// assurance «no squeezed face in the round frame» moves here.
test('a landscape format gets cropped centered on the shorter edge, not squashed', async () => {
  mockSourceWidth = 4000;
  mockSourceHeight = 3000;
  await setAvatar(UID, 'file:///quer.jpg', null);
  // The shorter edge is the height: a 3000 square, centered horizontally.
  expect(mockCrop).toHaveBeenCalledWith({
    originX: 500, originY: 0, width: 3000, height: 3000,
  });
  expect(mockResize).toHaveBeenCalledWith({ width: 512, height: 512 });
});

test('a portrait format gets cropped centered vertically', async () => {
  mockSourceWidth = 1000;
  mockSourceHeight = 2500;
  await setAvatar(UID, 'file:///hoch.jpg', null);
  expect(mockCrop).toHaveBeenCalledWith({
    originX: 0, originY: 750, width: 1000, height: 1000,
  });
});

// The order isn't arbitrary: crop first, then scale. If it scaled to
// 512x512 first, the crop would afterward sit on the wrong image and miss
// its mark entirely.
test('cropping happens before scaling', async () => {
  const order: string[] = [];
  mockCrop.mockImplementation(() => order.push('crop'));
  mockResize.mockImplementation(() => order.push('resize'));
  await setAvatar(UID, 'file:///quer.jpg', null);
  expect(order).toEqual(['crop', 'resize']);
});

test('setAvatar uploads, sets the column and cleans up the old object', async () => {
  const { avatarKey, error } = await setAvatar(UID, 'file:///gewaehlt.jpg', OLD);
  expect(error).toBeNull();
  expect(avatarKey).toMatch(new RegExp(`^profiles/${UID}/[0-9a-f]{32}\\.jpg$`));
  expect(mockUpdated).toHaveBeenCalledWith({ avatar_key: avatarKey });
  expect(mockRemoved).toHaveBeenCalledWith([OLD]);
});

// The order is the actual assurance: the object first, then the column. The
// other way around, the row would point at something not there yet, and
// every fellow traveller would see a broken tile.
test('the column gets set only after the upload', async () => {
  const order: string[] = [];
  mockUploaded.mockImplementation(() => order.push('upload'));
  mockUpdated.mockImplementation(() => order.push('update'));
  await setAvatar(UID, 'file:///gewaehlt.jpg', null);
  expect(order).toEqual(['upload', 'update']);
});

// A leftover old object costs ~50 KB. A failure here must not roll back the
// new, already-set image.
test('a failed cleanup leaves the new image standing', async () => {
  mockRemoved.mockImplementation(() => { throw new Error('gone is gone'); });
  const { avatarKey, error } = await setAvatar(UID, 'file:///gewaehlt.jpg', OLD);
  expect(error).toBeNull();
  expect(avatarKey).not.toBeNull();
});

test('a failed upload does not set the column', async () => {
  mockUploaded.mockImplementation(() => { throw new Error('no network'); });
  const { avatarKey, error } = await setAvatar(UID, 'file:///gewaehlt.jpg', null);
  expect(avatarKey).toBeNull();
  expect(error).toBe('Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.');
  expect(mockUpdated).not.toHaveBeenCalled();
});

// The case that was unprovable without a controllable status (see
// mockUploadStatus above): the upload technically goes THROUGH,
// `File.upload()` doesn't throw, but the server rejects it. 413 is the
// realistic case, the `avatare` bucket caps at 2 MiB (migration
// 20260812130000), 403 would be the second one (folder policy). The column
// must afterward know nothing about a key with no bytes behind it.
test('an upload rejected with 4xx does not set the column', async () => {
  mockUploadStatus = 413;
  const { avatarKey, error } = await setAvatar(UID, 'file:///zu-gross.jpg', null);
  // The attempt actually happened, otherwise this test would only check
  // that nothing happened at all, and would also be green with a broken
  // mock.
  expect(mockUploaded).toHaveBeenCalledTimes(1);
  expect(avatarKey).toBeNull();
  expect(error).toBe('Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.');
  expect(mockUpdated).not.toHaveBeenCalled();
});

// The reverse order on removal: the column first, then the object.
// Otherwise the row would point at something already gone.
test('removeAvatar clears the column before the object', async () => {
  const order: string[] = [];
  mockUpdated.mockImplementation(() => order.push('update'));
  mockRemoved.mockImplementation(() => order.push('remove'));
  const { error } = await removeAvatar(UID, OLD);
  expect(error).toBeNull();
  expect(order).toEqual(['update', 'remove']);
  expect(mockUpdated).toHaveBeenCalledWith({ avatar_key: null });
});
