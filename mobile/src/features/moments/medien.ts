import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

const FOTO_MAX_KANTE = 1080;
const THUMB_MAX_KANTE = 320;
const JPEG_QUALITAET = 0.8;

// Schlüssel-Logik existiert bewusst zweimal: hier und in der Edge Function
// supabase/functions/media-urls/keys.ts (erwarteteSchluessel). Der Client
// braucht die Schlüssel schon vor dem Insert; die Function traut dem Client
// nicht und leitet sie serverseitig aus der posts-Zeile neu ab (Spec §6).
export function storageKey(tripId: string, postId: string, typ: 'photo' | 'video'): string {
  const endung = typ === 'video' ? 'mp4' : 'jpg';
  return `trips/${tripId}/${postId}.${endung}`;
}

export function thumbKey(tripId: string, postId: string): string {
  return `trips/${tripId}/${postId}_t.jpg`;
}

export function neuePostId(): string {
  return Crypto.randomUUID();
}

// Skaliert `uri` auf die angegebene Breite und speichert als JPEG mit fester
// Qualität. expo-image-manipulator setzt seit SDK 54 auf diese kontextbasierte,
// verkettbare API (manipulate → resize → renderAsync → saveAsync); das alte
// manipulateAsync ist nur noch ein @deprecated Wrapper darüber.
async function skalierenAlsJpeg(uri: string, breite: number): Promise<string> {
  const kontext = ImageManipulator.manipulate(uri);
  kontext.resize({ width: breite });
  const gerendert = await kontext.renderAsync();
  const ergebnis = await gerendert.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITAET });
  return ergebnis.uri;
}

export async function fotoAufbereiten(uri: string): Promise<{ medium: string; thumb: string }> {
  const medium = await skalierenAlsJpeg(uri, FOTO_MAX_KANTE);
  const thumb = await skalierenAlsJpeg(uri, THUMB_MAX_KANTE);
  return { medium, thumb };
}

// Videos werden nicht nachbearbeitet — die Auflösung kommt schon aus der
// Aufnahmequalität der Kamera (Task-Brief). Nur ein Standbild fürs Thumbnail
// wird gezogen; der Aufrufer (Preview) fängt Fehler ab und zeigt eine Meldung.
export async function videoAufbereiten(uri: string): Promise<{ medium: string; thumb: string }> {
  const standbild = await getThumbnailAsync(uri, { time: 0 });
  return { medium: uri, thumb: standbild.uri };
}
