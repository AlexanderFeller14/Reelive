import * as Crypto from 'expo-crypto';
import { supabaseBaseUrl } from '@/lib/supabaseUrl';

// The bucket is named the same locally and in production (created in
// 20260812130000_avatar_bild.sql, declared in supabase/config.toml), hence a
// constant and not an environment variable: one more variable is one more
// source of error, and this one here should never have had two different
// values.
export const AVATAR_BUCKET = 'avatare';

// ---------------------------------------------------------------------------
// WARNING: the prefix is AGREED UPON, not freely chosen.
// ---------------------------------------------------------------------------
// konto-loeschen/index.ts builds its allowed prefixes as
// `profiles/${anfragendeId}/` and only deletes what matches that (the guard
// pfadGehoertUns in konto-loeschen/ablauf.ts, with a detailed rationale
// there). A key following a different scheme would stay in storage forever
// on account deletion, without anyone still knowing its path.
//
// The random part achieves two things: the URL is not derivable from a known
// user_id, and every new image gets a new URL. That way the image cache
// resolves itself without a cache-buster parameter.
export function newAvatarKey(userId: string): string {
  const random = Crypto.randomUUID().replace(/-/g, '');
  return `profiles/${userId}/${random}.jpg`;
}

// The ONE place that knows what an avatar URL looks like. Even the edge
// function only hands out the key, never a finished URL.
export function avatarUrl(avatarKey: string | null | undefined): string | null {
  if (!avatarKey) return null;
  const base = supabaseBaseUrl;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${avatarKey}`;
}
