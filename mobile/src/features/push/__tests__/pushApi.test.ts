// Jest-Hoisting: jest.mock wandert über die Importe, die Factory läuft also
// VOR den const-Zuweisungen. Die Mocks dürfen deshalb nicht als direkte Werte
// im Objektliteral stehen (sie wären dort für immer undefined) — der Zugriff
// muss erst zur Aufrufzeit passieren. Gleiches Prinzip wie in
// mobile/src/features/trips/__tests__/tripsApi.test.ts.
const mockUpsert = jest.fn();
const mockDeleteEq = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

// Device.isDevice ist bei expo-device ein Getter, kein Funktionsaufruf — der
// Getter im Mock ruft eine jest.fn() auf, damit der Rückgabewert (und ein
// Wurf daraus) sich pro Test umschalten lässt.
const mockIsDevice = jest.fn();
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice();
  },
}));

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
}));

import { registrierePushToken, deregistrierePushToken } from '../pushApi';

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
  mockFrom.mockReturnValue({
    upsert: (...args: unknown[]) => mockUpsert(...args),
    delete: () => ({ eq: (...args: unknown[]) => mockDeleteEq(...args) }),
  });
});

test('kein echtes Gerät (Simulator/Emulator) → nicht-unterstuetzt, ohne Berechtigung zu erfragen', async () => {
  mockIsDevice.mockReturnValue(false);
  const ergebnis = await registrierePushToken('u1');
  expect(ergebnis).toBe('nicht-unterstuetzt');
  expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('Berechtigung fehlt und wird nach Erfragen abgelehnt → keine-berechtigung', async () => {
  mockGetPermissionsAsync.mockResolvedValue(UNDETERMINED);
  mockRequestPermissionsAsync.mockResolvedValue(DENIED);
  const ergebnis = await registrierePushToken('u1');
  expect(ergebnis).toBe('keine-berechtigung');
  expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('Berechtigung bereits erteilt → wird nicht erneut erfragt', async () => {
  await registrierePushToken('u1');
  expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
});

test('Erfolg: schreibt genau eine Zeile per upsert auf token, inkl. explizitem updated_at', async () => {
  const ergebnis = await registrierePushToken('u1');

  expect(ergebnis).toBe('ok');
  expect(mockFrom).toHaveBeenCalledWith('push_tokens');
  expect(mockUpsert).toHaveBeenCalledTimes(1);

  const [payload, optionen] = mockUpsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
  expect(payload).toMatchObject({
    token: 'ExponentPushToken[abc]',
    user_id: 'u1',
    platform: 'ios',
  });
  // Muss ausdrücklich gesendet werden (Review aus Task 1): PostgREST baut das
  // ON CONFLICT DO UPDATE nur über gesendete Spalten, ein fehlendes
  // updated_at bliebe sonst für immer auf dem Erst-Insert-Wert stehen.
  expect(typeof payload.updated_at).toBe('string');
  expect(optionen).toEqual({ onConflict: 'token' });
});

// Der wichtigste Teil laut Brief: KEIN Fehlerfall darf werfen. Jeder dieser
// Fälle ist im Alltag der Normalfall (Expo Go, Simulator, kein EAS-Projekt,
// Netzfehler) — ein Test, der nur den Erfolgspfad prüft, wäre hier wertlos.
// Jeder Testfall ruft registrierePushToken() OHNE eigenes try/catch auf: ein
// tatsächlicher Wurf liesse den `await` rejecten und den Test schon daran
// scheitern, unabhängig vom .resolves.toBe()-Vergleich danach.
describe('wirft nie — jeder Fehlschlag liefert einen gültigen Wert statt zu werfen', () => {
  test('Device.isDevice-Zugriff wirft', async () => {
    mockIsDevice.mockImplementation(() => {
      throw new Error('kaputt');
    });
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });

  test('getPermissionsAsync lehnt ab (Netzfehler o.ä.)', async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });

  test('requestPermissionsAsync lehnt ab', async () => {
    mockGetPermissionsAsync.mockResolvedValue(UNDETERMINED);
    mockRequestPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });

  test('getExpoPushTokenAsync lehnt ab (Promise-Rejection, z.B. iOS ohne EAS-Projekt: ERR_NOTIFICATIONS_NO_EXPERIENCE_ID)', async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error('ERR_NOTIFICATIONS_NO_EXPERIENCE_ID'));
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });

  test('getExpoPushTokenAsync wirft synchron (Expo Go auf Android, siehe warnOfExpoGoPushUsage in expo-notifications)', async () => {
    mockGetExpoPushTokenAsync.mockImplementation(() => {
      throw new Error(
        'expo-notifications: Android Push notifications (remote notifications) … removed from Expo Go with the release of SDK 53.'
      );
    });
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });

  test('Antwort ohne Token-Wert', async () => {
    mockGetExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: '' });
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });

  test('upsert liefert einen Fehler statt zu werfen (Standard-postgrest-Verhalten)', async () => {
    mockUpsert.mockResolvedValue({ data: null, error: { message: 'network request failed' } });
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });

  test('upsert wirft direkt (unerwarteter Reject statt {error})', async () => {
    mockUpsert.mockRejectedValue(new Error('kaputt'));
    await expect(registrierePushToken('u1')).resolves.toBe('fehler');
  });
});

// deregistrierePushToken() gehört nicht zum Task-4-Interface-Vertrag, sondern
// zum Review-Nachtrag aus Task 1 (siehe authApi.signOut): löscht beim
// Abmelden die eigene push_tokens-Zeile, damit die Registrierung der vorigen
// Person nicht auf dem Gerät liegen bleibt. Gilt für sie derselbe Grundsatz
// wie oben: kein Fehlerfall darf werfen, Sign-out darf nie daran hängen.
describe('deregistrierePushToken', () => {
  test('löscht die Zeile zum aktuellen Token', async () => {
    await deregistrierePushToken();
    expect(mockFrom).toHaveBeenCalledWith('push_tokens');
    expect(mockDeleteEq).toHaveBeenCalledWith('token', 'ExponentPushToken[abc]');
  });

  test('keine Berechtigung erteilt → fragt gar nicht erst den Token ab, löscht nichts', async () => {
    mockGetPermissionsAsync.mockResolvedValue(UNDETERMINED);
    await expect(deregistrierePushToken()).resolves.toBeUndefined();
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('getPermissionsAsync wirft → wirft nicht, löscht nichts', async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    await expect(deregistrierePushToken()).resolves.toBeUndefined();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('kein Token verfügbar → löscht nichts, wirft nicht', async () => {
    mockGetExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: '' });
    await expect(deregistrierePushToken()).resolves.toBeUndefined();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('getExpoPushTokenAsync wirft (Expo Go, Simulator, kein EAS-Projekt) → wirft nicht, löscht nichts', async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error('ERR_NOTIFICATIONS_NO_EXPERIENCE_ID'));
    await expect(deregistrierePushToken()).resolves.toBeUndefined();
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('Löschen schlägt fehl → wirft trotzdem nicht', async () => {
    mockDeleteEq.mockRejectedValue(new Error('kaputt'));
    await expect(deregistrierePushToken()).resolves.toBeUndefined();
  });
});
