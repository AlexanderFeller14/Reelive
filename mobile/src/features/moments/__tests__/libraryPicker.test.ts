const mockLaunch = jest.fn();
// The representation mode is a string enum at runtime; the module reads it
// from the package, so the mock has to carry it.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (options: unknown) => mockLaunch(options),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockAssetInfo = jest.fn();
jest.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  getAssetInfoAsync: (id: string) => mockAssetInfo(id),
}));

import { pickFromLibrary, SELECTION_LIMIT } from '../libraryPicker';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
  mockLaunch.mockResolvedValue({ canceled: true, assets: null });
});

test('opens a multi-select picker for photos and videos with EXIF and compatible representations', async () => {
  await pickFromLibrary();
  expect(mockLaunch).toHaveBeenCalledWith(
    expect.objectContaining({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: SELECTION_LIMIT,
      orderedSelection: true,
      exif: true,
      quality: 1,
      preferredAssetRepresentationMode: 'compatible',
    })
  );
  // The avatar bug of 2026-08-13: allowsEditing swaps in the legacy picker.
  expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty('allowsEditing');
});

test('a cancel comes back as canceled', async () => {
  await expect(pickFromLibrary()).resolves.toEqual({ canceled: true });
  expect(mockAssetInfo).not.toHaveBeenCalled();
});

test('normalizes photos and videos and enriches them from the library', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///a.jpg',
        type: 'image',
        assetId: 'A',
        exif: { DateTimeOriginal: '2026:08:05 14:32:11' },
        duration: null,
      },
      { uri: 'file:///b.mov', type: 'video', assetId: 'B', duration: 12_400 },
    ],
  });
  mockAssetInfo.mockImplementation(async (id: string) =>
    id === 'A'
      ? { creationTime: 1_000, location: { latitude: 47.05, longitude: 8.31 } }
      : { creationTime: 2_000, location: undefined }
  );

  await expect(pickFromLibrary()).resolves.toEqual({
    canceled: false,
    media: [
      {
        uri: 'file:///a.jpg',
        kind: 'photo',
        durationMs: null,
        exif: { DateTimeOriginal: '2026:08:05 14:32:11' },
        creationTime: 1_000,
        location: { latitude: 47.05, longitude: 8.31 },
      },
      {
        uri: 'file:///b.mov',
        kind: 'video',
        durationMs: 12_400,
        exif: null,
        creationTime: 2_000,
        location: null,
      },
    ],
  });
});

test('a live photo counts as a photo', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///live.jpg', type: 'livePhoto', assetId: null }],
  });
  await expect(pickFromLibrary()).resolves.toMatchObject({ media: [{ kind: 'photo' }] });
});

test('without an asset id or with a failing lookup the element keeps null for time and place', async () => {
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///a.jpg', type: 'image', assetId: null },
      { uri: 'file:///b.jpg', type: 'image', assetId: 'B' },
    ],
  });
  mockAssetInfo.mockRejectedValue(new Error('no access'));

  await expect(pickFromLibrary()).resolves.toMatchObject({
    canceled: false,
    media: [
      { uri: 'file:///a.jpg', creationTime: null, location: null },
      { uri: 'file:///b.jpg', creationTime: null, location: null },
    ],
  });
  expect(mockAssetInfo).toHaveBeenCalledTimes(1);
  expect(mockAssetInfo).toHaveBeenCalledWith('B');
});

test('asks for read access before the picker, and a refusal does not stop the picker', async () => {
  mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
  mockRequestPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
  await pickFromLibrary();
  expect(mockGetPermissions).toHaveBeenCalledWith(false);
  expect(mockRequestPermissions).toHaveBeenCalledWith(false);
  expect(mockLaunch).toHaveBeenCalledTimes(1);
});

test('does not ask again when access is granted or can no longer be asked for', async () => {
  await pickFromLibrary();
  expect(mockRequestPermissions).not.toHaveBeenCalled();

  mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
  await pickFromLibrary();
  expect(mockRequestPermissions).not.toHaveBeenCalled();
  expect(mockLaunch).toHaveBeenCalledTimes(2);
});

test('a failing permission check still opens the picker', async () => {
  mockGetPermissions.mockRejectedValue(new Error('kaputt'));
  await expect(pickFromLibrary()).resolves.toEqual({ canceled: true });
  expect(mockLaunch).toHaveBeenCalledTimes(1);
});

test('a picker failure propagates to the caller', async () => {
  mockLaunch.mockRejectedValue(new Error('picker broke'));
  await expect(pickFromLibrary()).rejects.toThrow('picker broke');
});
