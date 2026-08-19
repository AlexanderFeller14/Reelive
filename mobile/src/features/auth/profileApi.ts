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

// `field` tells the screen WHERE the message belongs. Previously there was
// only one error string, and it landed under the username field across the
// board, even "the profile could not be saved", which has nothing to do
// with the username. DESIGN-LANGUAGE §4 requires field-precise assignment,
// and only someone who knows which field is meant can hit that.
// `avatarKey` is the fourth, optional argument (default `null`): during
// onboarding the row does not exist yet when an image is chosen (see
// profile-setup.tsx), the screen therefore uploads it BEFORE this call and
// passes the finished key along directly, instead of adding it later via a
// separate update, a second write could fail after the row already stands.
// Default `null`, NEVER `''`: the RLS policy on `profiles.avatar_key`
// rejects an empty string with 42501 (Task 1), only `NULL` counts as "no
// image".
export async function createProfile(
  userId: string,
  username: string,
  displayName: string,
  avatarKey: string | null = null
): Promise<{ error: string | null; field: 'username' | null }> {
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, username, display_name: displayName.trim(), avatar_key: avatarKey });
  if (!error) return { error: null, field: null };
  if (error.code === '23505') {
    return { error: 'Dieser Username ist vergeben, probier einen anderen.', field: 'username' };
  }
  return { error: 'Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.', field: null };
}

// "Change display name" in the profile tab, as an UPDATE on the own row
// (profiles_update_own ties it to the own id). The USERNAME is deliberately
// not part of this (decision 2026-08-13): it may later become a login
// identifier, and a freed-up old name would then be a confusion risk.
// Changeable again only once there is a SERVER-SIDE brake (cooldown, lock
// period for old names); a pure UI lock like this one does not stop a
// crafted API call, the column grants (20260808150000) still technically
// allow the update. avatar_key does not belong here either, the image goes
// through avatarApi (upload and cleanup are attached there).
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
