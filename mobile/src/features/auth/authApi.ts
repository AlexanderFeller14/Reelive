import { supabase } from '@/lib/supabase';

const OFFLINE_HINT = 'Du bist offline. Verbinde dich und probier es nochmal.';

export async function requestOtp(phone: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (!error) return { error: null };
  if (error.message.includes('fetch')) return { error: OFFLINE_HINT };
  if (error.status === 429) return { error: 'Zu viele Versuche. Warte kurz und fordere dann einen neuen Code an.' };
  return { error: 'Der Code konnte nicht gesendet werden. Prüf die Nummer und probier es nochmal.' };
}

export async function verifyOtp(phone: string, code: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
  if (!error) return { error: null };
  if (error.message.includes('fetch')) return { error: OFFLINE_HINT };
  return { error: 'Der Code stimmt nicht oder ist abgelaufen. Fordere einen neuen an.' };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export type OAuthProvider = 'apple' | 'google';

// Vorbereitete Abstraktion (Spec §4): wird erst mit Dev-Build + Credentials
// aktiviert. Die Flags EXPO_PUBLIC_AUTH_* halten die Buttons bis dahin
// unsichtbar — dieser Fallback greift nur, falls ein Flag versehentlich an ist.
export async function signInWith(provider: OAuthProvider): Promise<{ error: string | null }> {
  return {
    error: `Anmeldung mit ${provider === 'apple' ? 'Apple' : 'Google'} ist noch nicht verfügbar. Nutze deine Handynummer.`,
  };
}
