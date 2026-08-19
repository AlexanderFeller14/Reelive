// The package's official in-memory mock: the same API, no native module.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationsActive, setNotificationsActive } from '../settings';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

// Unlike "WLAN only" (default off), the default here is ON: registration
// has run automatically on every signedIn since Task 4, and the new
// switch must not silence existing installations.
test('without an entry: notifications on', async () => {
  await expect(notificationsActive()).resolves.toBe(true);
});

test('off gets saved and read back', async () => {
  await setNotificationsActive(false);
  await expect(notificationsActive()).resolves.toBe(false);
});

test('on again gets saved and read back', async () => {
  await setNotificationsActive(false);
  await setNotificationsActive(true);
  await expect(notificationsActive()).resolves.toBe(true);
});

// Broken storage must not silence anyone: when in doubt, on.
test('a read error falls back to ON', async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(notificationsActive()).resolves.toBe(true);
});

// A write error must not crash the settings screen (same behavior as
// moments/settings).
test('a write error does not throw', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('kaputt'));
  await expect(setNotificationsActive(false)).resolves.toBeUndefined();
});
