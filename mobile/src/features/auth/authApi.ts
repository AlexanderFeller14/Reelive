import { supabase } from '@/lib/supabase';
import { OFFLINE_HINT, istOffline } from '@/lib/netzfehler';
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
  // VOR supabase.auth.signOut(), nicht danach — und zwingend sequenziell,
  // nicht nur aus Vorsicht: die Löschung läuft über die RLS-Policy
  // push_tokens_delete_own (user_id = auth.uid()). Nach dem Abmelden gibt es
  // kein auth.uid() mehr, der Löschversuch träfe dann auf gar keine Zeile
  // mehr (RLS blendet sie aus, kein Fehler, aber wirkungslos) — die Session
  // muss beim Löschen also noch gültig sein.
  // deregistrierePushToken() wirft selbst nie (siehe pushApi.ts), verzögert
  // das Abmelden aber sehr wohl, wenn sie hängt: getExpoPushTokenAsync()
  // macht intern ein fetch() ohne erkennbaren Timeout. Das nehmen wir bewusst
  // in Kauf — parallel zu supabase.auth.signOut() aufzuräumen würde an
  // genau der RLS-Lücke oben scheitern.
  await deregistrierePushToken();
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
