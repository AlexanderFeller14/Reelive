// Web-Fassung von pushApi: kein expo-notifications/expo-device im Spiel, also
// auch kein Mock dafür nötig, genau das ist der Punkt dieser Datei.
import { registrierePushToken, deregistrierePushToken } from '../pushApi.web';

test("registrierePushToken() liefert immer 'nicht-unterstuetzt' und wirft nie", async () => {
  await expect(registrierePushToken('user-1')).resolves.toBe('nicht-unterstuetzt');
  await expect(registrierePushToken('')).resolves.toBe('nicht-unterstuetzt');
});

test('deregistrierePushToken() wirft nie und liefert nichts', async () => {
  await expect(deregistrierePushToken()).resolves.toBeUndefined();
});
