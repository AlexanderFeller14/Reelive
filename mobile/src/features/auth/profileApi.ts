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

// «Anzeigename ändern» im Profil-Tab, als UPDATE auf die eigene Zeile
// (profiles_update_own bindet es an die eigene id). Der USERNAME ist bewusst
// nicht dabei (Entscheid 2026-08-13): er soll später möglicherweise ein
// Login-Identifikator werden, und ein freigewordener alter Name wäre dann
// ein Verwechslungs-Risiko. Änderbar wird er erst wieder mit einer
// SERVERSEITIGEN Bremse (Cooldown, Sperrfrist für alte Namen) — eine reine
// UI-Sperre wie diese hält einen gebastelten API-Aufruf nicht auf, die
// Spalten-Grants (20260808150000) erlauben das Update technisch weiterhin.
// avatar_key gehört ebenfalls nicht hierher, das Bild läuft über avatarApi
// (Upload und Aufräumen hängen dort dran).
export async function updateProfile(
  userId: string,
  displayName: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName.trim() })
    .eq('id', userId);
  if (!error) return { error: null };
  return { error: 'Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.' };
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_key')
    .eq('id', userId)
    .maybeSingle();
  return data;
}
