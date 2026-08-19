import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

// 1920 instead of 1080 (request 2026-08-18): photos shouldn't look noticeably
// softer than the 1080×1920 videos next to them. Costs roughly three times
// the photo storage per moment.
const PHOTO_MAX_EDGE = 1920;
const THUMB_MAX_EDGE = 320;
const JPEG_QUALITY = 0.8;

// Below the documents directory, one folder per moment.
const MOMENTS_FOLDER = 'momente';

// File extension from a local path or storage key, lowercased and without
// the dot. Empty if none is recognizable.
export function extensionFrom(uri: string): string {
  const withoutSuffix = uri.split(/[?#]/)[0];
  const name = withoutSuffix.slice(withoutSuffix.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// Which extensions are even allowed per capture type, and what applies when
// nothing usable can be read from the capture.
//
// Final-Review, Important 5: expo-camera produces a QuickTime file (.mov) on
// iOS, .mp4 on Android. The earlier version uploaded the iOS bytes under
// ….mp4 with Content-Type video/mp4 anyway, the bucket accepted it because it
// checks the DECLARED type. The result was permanently mislabeled objects,
// and since the key is immutable per moment, not fixable afterwards. Photos
// always go out unchanged as JPEG: they get re-encoded as JPEG by
// preparePhoto regardless of what the camera delivered.
const ALLOWED_EXTENSIONS: Record<'photo' | 'video', readonly string[]> = {
  photo: ['jpg'],
  video: ['mp4', 'mov'],
};
const DEFAULT_EXTENSION: Record<'photo' | 'video', string> = { photo: 'jpg', video: 'mp4' };

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

// The capture's actual extension, constrained to the allowed list. Anything
// unknown falls back to the default instead of leaking into the key and
// therefore into the signed path.
export function mediaExtension(type: 'photo' | 'video', uri: string): string {
  const candidate = extensionFrom(uri);
  return ALLOWED_EXTENSIONS[type].includes(candidate) ? candidate : DEFAULT_EXTENSION[type];
}

// Key logic deliberately exists twice: here and in the Edge Function
// supabase/functions/media-urls/keys.ts (erwarteteSchluessel). The client
// needs the keys before the insert already; the Function doesn't trust the
// client and re-derives them server-side from the posts row (Spec §6),
// including the extension, which is written for that purpose as
// posts.media_ext.
export function storageKey(tripId: string, momentId: string, extension: string): string {
  return `trips/${tripId}/${momentId}.${extension}`;
}

export function thumbKey(tripId: string, momentId: string): string {
  return `trips/${tripId}/${momentId}_t.jpg`;
}

// The extension already sits in the storage key, so it doesn't need to be
// stored a second time in the queue job, nor can it drift apart from it.
// Used by the worker for the PUT's content type and by momentsApi for
// posts.media_ext.
export function contentTypeForKey(key: string): string {
  return CONTENT_TYPES[extensionFrom(key)] ?? 'application/octet-stream';
}

export function newMomentId(): string {
  return Crypto.randomUUID();
}

type Dimensions = { width: number; height: number };
type ResizeTarget = { width?: number; height?: number };

// Loads the image once unchanged (no resize()), just to learn the actual
// source dimensions; the context-based API only knows width/height after
// renderAsync(). Context and result are released again immediately.
async function sourceDimensions(uri: string): Promise<Dimensions> {
  const context = ImageManipulator.manipulate(uri);
  try {
    const original = await context.renderAsync();
    try {
      return { width: original.width, height: original.height };
    } finally {
      original.release();
    }
  } finally {
    context.release();
  }
}

// Scales the LONG edge to `longEdge`: width for landscape/square, height for
// portrait (only set one dimension, the native implementation carries the
// other along preserving the aspect ratio). If the image is already
// smaller, it isn't scaled up, an empty target means "skip resize".
function scaleLongEdge(source: Dimensions, longEdge: number): ResizeTarget {
  const longestSide = Math.max(source.width, source.height);
  if (longestSide <= longEdge) return {};
  return source.width >= source.height ? { width: longEdge } : { height: longEdge };
}

// Scales `uri` to `target` and saves it as JPEG with a fixed quality.
// expo-image-manipulator has used this context-based, chainable API since
// SDK 54 (manipulate → resize → renderAsync → saveAsync); the old
// manipulateAsync is now only a @deprecated wrapper around it. The wrapper
// releases its SharedObjects after use ("these shared objects will not be
// used anymore"), same pattern here, via try/finally including on failure.
async function saveAsJpeg(uri: string, target: ResizeTarget): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  try {
    if (target.width !== undefined || target.height !== undefined) {
      context.resize(target);
    }
    const rendered = await context.renderAsync();
    try {
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
      return result.uri;
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

export async function preparePhoto(uri: string): Promise<{ medium: string; thumb: string }> {
  const sourceSize = await sourceDimensions(uri);
  const medium = await saveAsJpeg(uri, scaleLongEdge(sourceSize, PHOTO_MAX_EDGE));
  const thumb = await saveAsJpeg(uri, scaleLongEdge(sourceSize, THUMB_MAX_EDGE));
  return { medium, thumb };
}

// Videos aren't post-processed, the resolution already comes from the
// camera's capture quality (Task-Brief). Only a still frame is pulled for
// the thumbnail; the caller (Preview) catches errors and shows a message.
export async function prepareVideo(uri: string): Promise<{ medium: string; thumb: string }> {
  const stillFrame = await getThumbnailAsync(uri, { time: 0 });
  return { medium: uri, thumb: stillFrame.uri };
}

// === Durable storage (Final-Review, Critical 2) ===
//
// takePictureAsync, recordAsync, ImageManipulator.saveAsync, and
// getThumbnailAsync all write to Library/Caches, a directory that iOS is
// allowed to clear under memory pressure and that isn't backed up. The queue
// is supposed to hold moments for days though; it used to hold only pointers
// into a directory that can vanish at any time. That's why the medium and
// thumbnail move into their own folder per moment below the documents
// directory when enqueuing, and the job remembers THESE paths.
export function momentFolder(momentId: string): Directory {
  return new Directory(Paths.document, MOMENTS_FOLDER, momentId);
}

// COPIES medium and thumbnail into the moment folder and returns the new
// paths. The sources stay untouched in the process, they only get released
// once the job actually owns them (see discardIntermediates and
// preview.tsx).
//
// Re-Review: this used to say `move`. That was harmless for photos
// (preparePhoto creates new files anyway), but fatal for videos:
// prepareVideo returns the raw capture ITSELF as the medium. If it got moved
// and something then failed afterwards, the thumb, but above all
// enqueueJob, the error path cleared out the moment folder and took the only
// copy with it. A second tap on "submit" then already failed at the still
// frame, and the capture was irretrievably gone. Of all places, in the error
// path of the fix that was supposed to prevent data loss.
//
// The price is briefly doubled space requirements (at 30 s in 1080p up to
// ~50 MB, the bucket limit). That's the right side to err on: if the copy
// fails for lack of space, the capture is still there and a second attempt
// is possible; with the move, it was gone.
export async function persistDurably(
  momentId: string,
  files: { medium: string; thumb: string }
): Promise<{ medium: string; thumb: string }> {
  const folder = momentFolder(momentId);
  folder.create({ intermediates: true, idempotent: true });

  const extension = extensionFrom(files.medium) || 'jpg';
  // overwrite: a restart after an aborted submission would otherwise hit a
  // half-finished file from the previous attempt and fail on it.
  const targetMedium = new File(folder, `medium.${extension}`);
  await new File(files.medium).copy(targetMedium, { overwrite: true });

  const targetThumb = new File(folder, 'thumb.jpg');
  await new File(files.thumb).copy(targetThumb, { overwrite: true });

  return { medium: targetMedium.uri, thumb: targetThumb.uri };
}

// Called wherever a job leaves the queue, on the success path AND on
// permanent rejection (see uploadWorker). Without this, the medium and
// thumbnail of every uploaded moment would stay behind forever, for video
// the full 30 seconds in 1080p.
//
// Never throws: a failed cleanup costs storage space, a worker run that
// fails on it would repeat the job forever.
export function removeMomentFiles(momentId: string): void {
  try {
    const folder = momentFolder(momentId);
    if (folder.exists) folder.delete();
  } catch (error) {
    console.error('[medien] Moment-Ordner konnte nicht entfernt werden', momentId, error);
  }
}

// Deletes a single local file, if it (still) exists. Never throws, a file
// left behind must not hold up either submitting or discarding.
//
// Re-Review: used to be called `rohaufnahmeVerwerfen`. The name became
// misleading the moment intermediates were also released through it, and
// exactly this fuzziness ("which file is actually the only copy?") was
// behind the video data loss. Whoever cleans up now names explicitly WHAT.
export function discardFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.error('[medien] Datei konnte nicht entfernt werden', uri, error);
  }
}

// Releases what was DERIVED from the raw capture: the compressed medium and
// the thumbnail in the cache. The raw capture itself is guaranteed to stay,
// for a video it IS the medium (prepareVideo returns `uri` unchanged), and
// it's then the only copy. Exactly this distinction was missing and cost the
// capture in the error path.
export function discardIntermediates(
  rawCapture: string,
  prepared: { medium: string; thumb: string }
): void {
  for (const path of new Set([prepared.medium, prepared.thumb])) {
    if (path !== rawCapture) discardFile(path);
  }
}
