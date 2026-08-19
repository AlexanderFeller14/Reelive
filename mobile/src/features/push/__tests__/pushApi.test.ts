// Jest hoisting: jest.mock moves above the imports, the factory runs
// BEFORE the const assignments. The mocks must therefore not be direct
// values in the object literal (they'd be undefined forever there), access
// must only happen at call time. Same principle as in
// mobile/src/features/trips/__tests__/tripsApi.test.ts.
const mockUpsert = jest.fn();
const mockDeleteEq = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

// Device.isDevice is a getter on expo-device, not a function call, the
// getter in the mock calls a jest.fn() so the return value (and a throw
// from it) can be switched per test.
const mockIsDevice = jest.fn();
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice();
  },
}));

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  // Real value doesn't matter (see pushApi.ts: only passed through, never
  // evaluated), the constant only needs to exist so the Android branch
  // doesn't fail on an undefined property.
  AndroidImportance: { DEFAULT: 3 },
}));

import { Platform } from 'react-native';
import { registerPushToken, deregisterPushToken } from '../pushApi';

const GRANTED = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
const DENIED = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
const UNDETERMINED = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDevice.mockReturnValue(true);
  mockGetPermissionsAsync.mockResolvedValue(GRANTED);
  mockGetExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc]' });
  mockUpsert.mockResolvedValue({ data: [{ token: 'ExponentPushToken[abc]' }], error: null });
  mockDeleteEq.mockResolvedValue({ data: null, error: null });
  mockSetNotificationChannelAsync.mockResolvedValue({ id: 'default' });
  mockFrom.mockReturnValue({
    upsert: (...args: unknown[]) => mockUpsert(...args),
    delete: () => ({ eq: (...args: unknown[]) => mockDeleteEq(...args) }),
  });
});

test('no real device (simulator/emulator) → nicht-unterstuetzt, without asking for permission', async () => {
  mockIsDevice.mockReturnValue(false);
  const result = await registerPushToken('u1');
  expect(result).toBe('nicht-unterstuetzt');
  expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('permission missing and declined after asking → keine-berechtigung', async () => {
  mockGetPermissionsAsync.mockResolvedValue(UNDETERMINED);
  mockRequestPermissionsAsync.mockResolvedValue(DENIED);
  const result = await registerPushToken('u1');
  expect(result).toBe('keine-berechtigung');
  expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('permission already granted → not asked again', async () => {
  await registerPushToken('u1');
  expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
});

test('success: writes exactly one row via upsert on token, including an explicit updated_at', async () => {
  const result = await registerPushToken('u1');

  expect(result).toBe('ok');
  expect(mockFrom).toHaveBeenCalledWith('push_tokens');
  expect(mockUpsert).toHaveBeenCalledTimes(1);

  const [payload, options] = mockUpsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
  expect(payload).toMatchObject({
    token: 'ExponentPushToken[abc]',
    user_id: 'u1',
    platform: 'ios',
  });
  // Must be sent explicitly (review from Task 1): PostgREST builds the ON
  // CONFLICT DO UPDATE only over sent columns, a missing updated_at would
  // otherwise stay at the first-insert value forever.
  expect(typeof payload.updated_at).toBe('string');
  expect(options).toEqual({ onConflict: 'token' });
});

// The most important part per the brief: NO error case must throw. Every
// one of these cases is the normal case in everyday use (Expo Go,
// simulator, no EAS project, network error), a test that only checks the
// success path would be worthless here. Every test case calls
// registerPushToken() WITHOUT its own try/catch: an actual throw would
// reject the `await` and fail the test right there, independent of the
// .resolves.toBe() comparison afterward.
describe('never throws, every failure returns a valid value instead of throwing', () => {
  // Deliberately hypothetical, not a real path: the real expo-device
  // exports isDevice as a constant computed once at module import
  // (node_modules/expo-device/build/Device.js: `export const isDevice = …`),
  // not as a getter. A throw there would happen on the very first import
  // of the file, long before registerPushToken() is called, this test can
  // therefore never occur that way. It stays anyway to prove that the
  // outer try/catch would also catch a synchronous throw at this spot,
  // should the export form of expo-device ever change.
  test('Device.isDevice access throws (hypothetical, see comment)', async () => {
    mockIsDevice.mockImplementation(() => {
      throw new Error('kaputt');
    });
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });

  test('getPermissionsAsync rejects (network error or similar)', async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });

  test('requestPermissionsAsync rejects', async () => {
    mockGetPermissionsAsync.mockResolvedValue(UNDETERMINED);
    mockRequestPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });

  test('getExpoPushTokenAsync rejects (promise rejection, e.g. iOS without an EAS project: ERR_NOTIFICATIONS_NO_EXPERIENCE_ID)', async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error('ERR_NOTIFICATIONS_NO_EXPERIENCE_ID'));
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });

  test('getExpoPushTokenAsync throws synchronously (Expo Go on Android, see warnOfExpoGoPushUsage in expo-notifications)', async () => {
    mockGetExpoPushTokenAsync.mockImplementation(() => {
      throw new Error(
        'expo-notifications: Android Push notifications (remote notifications) … removed from Expo Go with the release of SDK 53.'
      );
    });
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });

  test('response without a token value', async () => {
    mockGetExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: '' });
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });

  test('upsert returns an error instead of throwing (standard postgrest behavior)', async () => {
    mockUpsert.mockResolvedValue({ data: null, error: { message: 'network request failed' } });
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });

  test('upsert throws directly (unexpected reject instead of {error})', async () => {
    mockUpsert.mockRejectedValue(new Error('kaputt'));
    await expect(registerPushToken('u1')).resolves.toBe('fehler');
  });
});

// jest-expo resolves 'react-native' by default with Platform.OS === 'ios'
// (see the success test above: platform: 'ios'), the complete
// `if (Platform.OS === 'android')` branch (notification channel before the
// permission request, Android 13 precondition per version-exact SDK-57
// docs) has so far been reached by NO test case. Platform.OS is a normal,
// writable data field on react-native (not a getter,
// node_modules/react-native/Libraries/Utilities/Platform.ios.js), so it
// can be switched directly and restored afterward.
describe('Android: notification channel before the permission request', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  test('success: channel is created, then the normal flow continues to ok', async () => {
    Platform.OS = 'android';

    const result = await registerPushToken('u1');

    expect(result).toBe('ok');
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledTimes(1);
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ name: 'Reelive', importance: 3 })
    );
    // Order: the channel must come BEFORE the permission check (Android
    // 13+ otherwise shows no dialog at all, see comment in pushApi.ts).
    const channelCall = mockSetNotificationChannelAsync.mock.invocationCallOrder[0];
    const permissionCall = mockGetPermissionsAsync.mock.invocationCallOrder[0];
    expect(channelCall).toBeLessThan(permissionCall);
  });

  test('internal error case: channel creation throws → flow still continues to ok', async () => {
    Platform.OS = 'android';
    mockSetNotificationChannelAsync.mockRejectedValue(new Error('kaputt'));

    await expect(registerPushToken('u1')).resolves.toBe('ok');
    expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

// deregisterPushToken() isn't part of the Task-4 interface contract, but
// a follow-up from the Task 1 review (see authApi.signOut): deletes the
// own push_tokens row on sign-out, so the previous person's registration
// doesn't stay on the device. The same principle as above applies to it:
// no error case must throw, sign-out must never depend on it.
describe('deregisterPushToken', () => {
  test('deletes the row for the current token', async () => {
    await deregisterPushToken();
    expect(mockFrom).toHaveBeenCalledWith('push_tokens');
    expect(mockDeleteEq).toHaveBeenCalledWith('token', 'ExponentPushToken[abc]');
  });

  test('no permission granted → does not even ask for the token, deletes nothing', async () => {
    mockGetPermissionsAsync.mockResolvedValue(UNDETERMINED);
    await expect(deregisterPushToken()).resolves.toBeUndefined();
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('getPermissionsAsync throws → does not throw, deletes nothing', async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    await expect(deregisterPushToken()).resolves.toBeUndefined();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('no token available → deletes nothing, does not throw', async () => {
    mockGetExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: '' });
    await expect(deregisterPushToken()).resolves.toBeUndefined();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('getExpoPushTokenAsync throws (Expo Go, simulator, no EAS project) → does not throw, deletes nothing', async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error('ERR_NOTIFICATIONS_NO_EXPERIENCE_ID'));
    await expect(deregisterPushToken()).resolves.toBeUndefined();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('deletion fails → still does not throw', async () => {
    mockDeleteEq.mockRejectedValue(new Error('kaputt'));
    await expect(deregisterPushToken()).resolves.toBeUndefined();
  });
});
