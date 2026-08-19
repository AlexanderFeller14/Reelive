import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/networkError';
import { deregistrierePushToken } from '@/features/push/pushApi';

export async function requestOtp(phone: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (!error) return { error: null };
  if (istOffline(error)) return { error: OFFLINE_HINT };
  if (error.status === 429) return { error: 'Zu viele Versuche. Warte kurz und fordere dann einen neuen Code an.' };
  return { error: 'Der Code konnte nicht gesendet werden. Prüf die Nummer und probier es nochmal.' };
}

export async function verifyOtp(phone: string, code: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
  if (!error) return { error: null };
  if (istOffline(error)) return { error: OFFLINE_HINT };
  return { error: 'Der Code stimmt nicht oder ist abgelaufen. Fordere einen neuen an.' };
}

export async function signOut(): Promise<void> {
  // BEFORE supabase.auth.signOut(), not after, and strictly sequential, not
  // just out of caution: the deletion runs through the RLS policy
  // push_tokens_delete_own (user_id = auth.uid()). After signing out there
  // is no auth.uid() anymore, the deletion attempt would then hit no row at
  // all (RLS hides it, no error, but no effect), the session therefore
  // still has to be valid at delete time.
  // deregistrierePushToken() itself never throws (see pushApi.ts), but it
  // does delay the sign-out if it hangs: getExpoPushTokenAsync() internally
  // does a fetch() with no discernible timeout. We deliberately accept
  // that; cleaning up in parallel with supabase.auth.signOut() would fail
  // on exactly the RLS gap above.
  await deregistrierePushToken();
  await supabase.auth.signOut();
}

export type OAuthProvider = 'apple' | 'google';

// Prepared abstraction (Spec §4): only gets activated with a dev build +
// credentials. The EXPO_PUBLIC_AUTH_* flags keep the buttons invisible until
// then, this fallback only kicks in if a flag is accidentally on.
export async function signInWith(provider: OAuthProvider): Promise<{ error: string | null }> {
  return {
    error: `Anmeldung mit ${provider === 'apple' ? 'Apple' : 'Google'} ist noch nicht verfügbar. Nutze deine Handynummer.`,
  };
}
