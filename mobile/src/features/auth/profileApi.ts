import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
};

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
// `avatarKey` ist das vierte, optionale Argument (Default `null`): im
// Onboarding existiert die Zeile noch nicht, wenn ein Bild gewählt wird
// (siehe profile-setup.tsx), der Screen lädt es deshalb VOR diesem Aufruf
// hoch und reicht den fertigen Schlüssel direkt mit, statt ihn per
// separatem Update nachzutragen — ein zweiter Schreibvorgang könnte
// scheitern, nachdem die Zeile schon steht. Default `null`, NIE `''`: die
// RLS-Policy auf `profiles.avatar_key` lehnt einen Leerstring mit 42501 ab
// (Task 1), nur `NULL` gilt als „kein Bild".
export async function createProfile(
  userId: string,
  username: string,
  displayName: string,
  avatarKey: string | null = null
): Promise<{ error: string | null; feld: 'username' | null }> {
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, username, display_name: displayName.trim(), avatar_key: avatarKey });
  if (!error) return { error: null, feld: null };
  if (error.code === '23505') {
    return { error: 'Dieser Username ist vergeben, probier einen anderen.', feld: 'username' };
  }
  return { error: 'Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.', feld: null };
}

// «Namen bearbeiten» im Profil-Tab: dieselben Regeln und dieselbe
// Fehler-Zuordnung wie createProfile, nur als UPDATE auf die eigene Zeile.
// Serverseitig erlaubt: die Spalten-Grants aus
// 20260808150000_leerstrings_und_profil_grants.sql geben authenticated genau
// username/display_name/avatar_key frei, profiles_update_own bindet das an
// die eigene id. avatar_key gehört NICHT hierher, das Bild läuft über
// avatarApi (Upload und Aufräumen hängen dort dran).
export async function updateProfile(
  userId: string,
  username: string,
  displayName: string,
): Promise<{ error: string | null; feld: 'username' | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ username, display_name: displayName.trim() })
    .eq('id', userId);
  if (!error) return { error: null, feld: null };
  if (error.code === '23505') {
    return { error: 'Dieser Username ist vergeben, probier einen anderen.', feld: 'username' };
  }
  return { error: 'Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.', feld: null };
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_key')
    .eq('id', userId)
    .maybeSingle();
  return data;
}
