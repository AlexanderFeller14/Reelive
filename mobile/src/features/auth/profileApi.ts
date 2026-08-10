import { supabase } from '@/lib/supabase';

export type Profile = { id: string; username: string; display_name: string };

export function validateUsername(username: string): string | null {
  return /^[a-z0-9_]{3,20}$/.test(username)
    ? null
    : 'Mindestens 3 Zeichen: Kleinbuchstaben, Zahlen und _.';
}

export function validateDisplayName(displayName: string): string | null {
  const len = displayName.trim().length;
  return len >= 1 && len <= 40 ? null : 'Sag uns, wie du heissen willst (1–40 Zeichen).';
}

// `feld` sagt dem Screen, WO die Meldung hingehoert. Vorher gab es nur einen
// Fehlerstring, und der landete pauschal unter dem Username-Feld, auch «Das
// Profil konnte nicht gespeichert werden», was mit dem Username nichts zu tun
// hat. DESIGN-LANGUAGE §4 verlangt feldgenaue Zuordnung, und die kann nur
// treffen, wer weiss, welches Feld gemeint ist.
export async function createProfile(
  userId: string,
  username: string,
  displayName: string
): Promise<{ error: string | null; feld: 'username' | null }> {
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, username, display_name: displayName.trim() });
  if (!error) return { error: null, feld: null };
  if (error.code === '23505') {
    return { error: 'Dieser Username ist vergeben, probier einen anderen.', feld: 'username' };
  }
  return { error: 'Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.', feld: null };
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', userId)
    .maybeSingle();
  return data;
}
