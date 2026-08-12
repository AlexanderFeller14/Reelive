import * as Crypto from 'expo-crypto';

// Der Bucket heisst lokal und produktiv gleich (angelegt in
// 20260812130000_avatar_bild.sql, deklariert in supabase/config.toml), deshalb
// eine Konstante und keine Umgebungsvariable: eine Variable mehr ist eine
// Fehlerquelle mehr, und diese hier hätte nie zwei verschiedene Werte.
export const AVATAR_BUCKET = 'avatare';

// ---------------------------------------------------------------------------
// ACHTUNG: Das Präfix ist ABGESPROCHEN, nicht frei wählbar.
// ---------------------------------------------------------------------------
// konto-loeschen/index.ts baut seine erlaubten Präfixe als
// `profiles/${anfragendeId}/` und löscht nur, was darauf passt (der Wächter
// pfadGehoertUns in konto-loeschen/ablauf.ts, mit ausführlicher Begründung
// dort). Ein Schlüssel nach einem anderen Schema bliebe beim Kontolöschen für
// immer im Speicher liegen, ohne dass jemand seinen Pfad noch kennt.
//
// Der Zufallsanteil leistet zweierlei: Die URL ist nicht aus einer bekannten
// user_id ableitbar, und jedes neue Bild bekommt eine neue URL. Damit löst sich
// der Bildcache von selbst auf, ohne Cache-Buster-Parameter.
export function neuerAvatarSchluessel(userId: string): string {
  const zufall = Crypto.randomUUID().replace(/-/g, '');
  return `profiles/${userId}/${zufall}.jpg`;
}

// Die EINZIGE Stelle, die weiss, wie eine Avatar-URL aussieht. Auch die Edge
// Function gibt nur den Schlüssel heraus, nie eine fertige URL.
export function avatarUrl(avatarKey: string | null | undefined): string | null {
  if (!avatarKey) return null;
  const basis = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!basis) return null;
  return `${basis}/storage/v1/object/public/${AVATAR_BUCKET}/${avatarKey}`;
}
