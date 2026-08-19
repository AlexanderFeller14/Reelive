// Web version of pushApi: no expo-notifications/expo-device involved, so
// no mock needed for them either, that's exactly the point of this file.
import { registerPushToken, deregisterPushToken } from '../pushApi.web';

test("registerPushToken() always returns 'nicht-unterstuetzt' and never throws", async () => {
  await expect(registerPushToken('user-1')).resolves.toBe('nicht-unterstuetzt');
  await expect(registerPushToken('')).resolves.toBe('nicht-unterstuetzt');
});

test('deregisterPushToken() never throws and returns nothing', async () => {
  await expect(deregisterPushToken()).resolves.toBeUndefined();
});
