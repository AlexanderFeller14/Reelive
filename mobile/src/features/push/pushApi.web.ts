export type PushRegistrationResult = 'ok' | 'keine-berechtigung' | 'nicht-unterstuetzt' | 'fehler';

// Web version of pushApi.ts (Task-4-brief, phase 6).
//
// No import of expo-notifications or expo-device: both pull in native
// modules that Metro can't bundle for web, and whose push functions don't
// exist in the browser anyway. The native version would return
// 'nicht-unterstuetzt' immediately for Platform.OS === 'web', before it
// actually uses either library, this web shim just makes that shortcut
// explicit while avoiding the import itself.
//
// Never throws, as required in the brief for the native version too
// (every failure here is even more so a normal case, not an error): the
// root layout calls registerPushToken() on every signedIn change without
// error handling.
export async function registerPushToken(_userId: string): Promise<PushRegistrationResult> {
  return 'nicht-unterstuetzt';
}

export async function deregisterPushToken(): Promise<void> {}
