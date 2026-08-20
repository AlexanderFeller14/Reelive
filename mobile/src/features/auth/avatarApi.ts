import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { supabaseBaseUrl } from '@/lib/supabaseUrl';
import { AVATAR_BUCKET, newAvatarKey } from './avatar';
import type { Crop } from './crop';

// The largest display spot is the 44 px circle, 512 carries that with
// headroom even on a 3x display. At quality 0.8 that's about 50 KB.
const EDGE = 512;
const JPEG_QUALITY = 0.8;

// The image no longer arrives square: the system crop (`allowsEditing`) is
// gone, because on iOS it forces the old UIImagePickerController and gets
// torn down by the system on large originals, the app then gets a
// "cancelled" that is indistinguishable from a real cancel (debugged
// 2026-08-13, measured: canceled=true without any exception). So the app
// crops itself, and the crop belongs here, where the image runs through
// anyway.
//
// Centered on the SHORTER edge, then scaled. Not simply setting both edges
// to 512: that squashes a portrait or landscape format into a square, and
// in the round frame that shows immediately as squeezed faces.
//
// Same context-based pattern as features/moments/media.ts, including
// release() in finally: the SharedObjects are freed in the error case too.
async function asSquareJpeg(uri: string, chosen?: Crop): Promise<string> {
  let area: Crop;
  if (chosen) {
    // The person chose the crop themselves (AvatarCropper). Then measuring
    // is skipped: the crop screen already knows the dimensions, and a second
    // renderAsync() on a large original would be pure waste.
    area = chosen;
  } else {
    // No chosen crop (camera selfie): centered on the shorter edge. The
    // context-based API only knows the dimensions after renderAsync(), so
    // load it once unchanged, same approach as sourceDimensions() in
    // media.ts.
    const measureContext = ImageManipulator.manipulate(uri);
    let width: number;
    let height: number;
    try {
      const original = await measureContext.renderAsync();
      try {
        width = original.width;
        height = original.height;
      } finally {
        original.release();
      }
    } finally {
      measureContext.release();
    }
    const side = Math.min(width, height);
    area = {
      originX: Math.round((width - side) / 2),
      originY: Math.round((height - side) / 2),
      width: side,
      height: side,
    };
  }

  const { originX, originY } = area;
  const side = area.width;

  const context = ImageManipulator.manipulate(uri);
  try {
    // Crop first, then scale: the other way around would scale the full,
    // uncropped image and the crop would no longer fit afterwards.
    context.crop({ originX, originY, width: side, height: side });
    context.resize({ width: EDGE, height: EDGE });
    const rendered = await context.renderAsync();
    try {
      const result = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: JPEG_QUALITY,
      });
      return result.uri;
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

// NOT supabase.storage.from().upload(): the storage client expects a Blob,
// and `fetch(uri).blob()` is unreliable under React Native. Instead the same
// File.upload() pattern as features/moments/uploadWorker.ts, proven in this
// project.
async function upload(key: string, uri: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Nicht angemeldet.');
  const base = supabaseBaseUrl;
  if (!base) throw new Error('Supabase-URL fehlt.');

  const response = await new File(uri).upload(
    `${base}/storage/v1/object/${AVATAR_BUCKET}/${key}`,
    {
      httpMethod: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    }
  );
  // upload() does NOT throw on 4xx/5xx, it returns the response (the same
  // pitfall as in uploadWorker.ts). Without this check a rejected upload
  // would pass as done, and the column would point at nothing.
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Upload abgelehnt (${response.status}).`);
  }
}

// Cleans up an old object. Deliberately WITHOUT returning an error: a
// leftover object costs ~50 KB, a reverted image costs the person their
// just-made choice. The less harmful failure direction wins.
async function cleanupOld(oldKey: string | null): Promise<void> {
  if (!oldKey) return;
  try {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([oldKey]);
    if (error) console.error('[avatarApi] old image left behind', error);
  } catch (error) {
    console.error('[avatarApi] old image left behind', error);
  }
}

// Order (Spec §5.3): upload -> set column -> delete old object. This way
// the row never points at something that isn't there yet or no longer is.
export async function setAvatar(
  userId: string,
  localUri: string,
  oldKey: string | null,
  // Optional, because not every path has a chosen crop: one comes from the
  // gallery (AvatarCropper), a camera selfie is already capture-ready and
  // gets cropped centered.
  crop?: Crop,
): Promise<{ avatarKey: string | null; error: string | null }> {
  const key = newAvatarKey(userId);

  try {
    const preparedUri = await asSquareJpeg(localUri, crop);
    await upload(key, preparedUri);
  } catch (error) {
    console.error('[avatarApi] upload failed', error);
    return {
      avatarKey: null,
      error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.',
    };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_key: key })
    .eq('id', userId);
  if (error) {
    console.error('[avatarApi] avatar_key set failed', error);
    // The fresh object already sits in storage, but the column doesn't know
    // about it. Clean it up, otherwise it stays forever, with nobody left
    // who still knows its path (same reasoning as in delete-account/process.ts).
    await cleanupOld(key);
    return {
      avatarKey: null,
      error: 'Das Bild konnte nicht gespeichert werden. Probier es gleich nochmal.',
    };
  }

  await cleanupOld(oldKey);
  return { avatarKey: key, error: null };
}

// Reverse order: clear the column first, then the object. The other way
// around, the row would point at something that no longer exists.
export async function removeAvatar(
  userId: string,
  oldKey: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_key: null })
    .eq('id', userId);
  if (error) {
    console.error('[avatarApi] avatar_key clear failed', error);
    return { error: 'Das Bild konnte nicht entfernt werden. Probier es gleich nochmal.' };
  }
  await cleanupOld(oldKey);
  return { error: null };
}
