// Web version of pushApi: no expo-notifications/expo-device involved, so
// no mock needed for them either, that's exactly the point of this file.
import { registerPushToken, deregisterPushToken } from '../pushApi.web';

test("registerPushToken() always returns 'unsupported' and never throws", async () => {
  await expect(registerPushToken('user-1')).resolves.toBe('unsupported');
  await expect(registerPushToken('')).resolves.toBe('unsupported');
});

test('deregisterPushToken() never throws and returns nothing', async () => {
  await expect(deregisterPushToken()).resolves.toBeUndefined();
});
