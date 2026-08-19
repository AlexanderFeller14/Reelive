// Export to the gallery (Task-7 brief, Spec §6, promise W9): save one
// moment, save all of them, via the same signed read URLs the player
// already has (urlPool.ts). What gets saved is ALWAYS `medium_url` (full
// resolution), never `thumb_url`.
//
// === The intermediate step, and why it cleans up this time (Phase-4 lesson) ===
//
// expo-media-library only saves from a LOCAL file
// (MediaLibrary.createAssetAsync(filePath)), but the media sits behind a
// signed HTTPS URL. So it needs a download via expo-file-system before
// anything can reach the gallery at all.
//
// In Phase 4, exactly this pattern (raw capture → prepared file → queue)
// produced a bug: derived intermediate files stayed behind after use and
// created the very storage pressure that destroyed their own queue (see
// media.ts, "Durable storage" section). Three decisions that avoid that
// from the start here:
//
// 1. **Cache, not Documents.** media.ts deliberately copies TO Documents,
//    because the queue has to hold moments for days before the upload
//    consumes them. Here it's the reverse: the downloaded file lives only
//    for the duration of ONE single `Asset.create()` call, seconds, not
//    days. `Paths.cache` (deletable by the system under storage pressure)
//    is the right place for that, not the wrong one: nothing needs to
//    survive beyond this one call.
// 2. **`finally`, not "afterwards".** Every downloaded file gets deleted in
//    a `finally` block that runs on EVERY path, success, a regular failure
//    (network, 4xx/5xx), AND an abort via `AbortSignal`. Cleaning up
//    "afterwards" only on the success path was exactly the gap Phase 4
//    left open: an aborted or failed download left a file behind there
//    too, just unwatched.
// 3. **Clean up BEFORE the first download, not only afterwards.** If the
//    app crashes mid-download (no JS `finally` can catch that), an orphaned
//    file would be left behind until the next export without this step.
//    `resetExportFolder()` deletes the ENTIRE export folder before a new
//    run starts, so an orphaned remnant from a crashed previous run never
//    survives longer than until the next export attempt.
// Deliberately the LEGACY entry point ('expo-media-library/legacy'), not the
// more modern class-based API (Asset.create(), from the main export), even
// though the SDK-57 changelog recommends the latter for new code. Reason:
// `expo-media-library`'s main entry point (`index.ts`) declares
// `class Asset extends ExpoMediaLibraryNext.Asset {}`, evaluated AT MODULE
// LOAD time, `ExpoMediaLibraryNext` itself is `requireNativeModule(...)`
// WITHOUT its own web version. This phase's web export bundles the ENTIRE
// app as an SPA per Task 4/5, including this screen; with the modern entry
// point, `npx expo export --platform web` therefore already breaks while
// bundling with "Class extends value undefined is not a constructor or
// null" (verified and reproduced myself, see the report). The LEGACY entry
// point instead imports `ExpoMediaLibrary` (without "Next"), for which a
// real `ExpoMediaLibrary.web.ts` exists, which answers
// `getPermissionsAsync`/`requestPermissionsAsync` with `granted:false`
// instead of throwing on import. On web (locked out via `istWebGesperrt()`
// anyway, Task 4/5), the effect stays the same as intended: no permission,
// so never an actual `createAssetAsync` call, only the bundling itself no
// longer breaks.
import * as MediaLibrary from 'expo-media-library/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import { mediaExtension } from '@/features/moments/media';
import type { RecapMoment } from './types';
import type { MediaUrl } from './urlPool';

const EXPORT_FOLDER = 'export';

function exportFolder(): Directory {
  return new Directory(Paths.cache, EXPORT_FOLDER);
}

// Best effort, never throws (same principle as media.ts,
// removeMomentFiles/discardFile): a failed cleanup must block neither the
// export itself nor a later attempt.
function resetExportFolder(): void {
  const folder = exportFolder();
  try {
    if (folder.exists) folder.delete();
  } catch (error) {
    console.error('[exportApi] Export-Ordner konnte nicht geräumt werden', error);
  }
  folder.create({ intermediates: true, idempotent: true });
}

export const NO_ACCESS_TEXT =
  'Reelive braucht Zugriff auf deine Fotobibliothek, um Momente dort zu sichern. Erlaube das in den Systemeinstellungen.';
const PERMISSION_CHECK_ERROR =
  'Der Zugriff auf die Fotobibliothek konnte nicht geprüft werden. Probier es gleich nochmal.';

export type PermissionResult = { erlaubt: true } | { erlaubt: false; text: string };

export async function ensurePermission(): Promise<PermissionResult> {
  try {
    const current = await MediaLibrary.getPermissionsAsync(true);
    if (current.granted) return { erlaubt: true };
    if (!current.canAskAgain) return { erlaubt: false, text: NO_ACCESS_TEXT };
    const requested = await MediaLibrary.requestPermissionsAsync(true);
    if (requested.granted) return { erlaubt: true };
    return { erlaubt: false, text: NO_ACCESS_TEXT };
  } catch {
    return { erlaubt: false, text: PERMISSION_CHECK_ERROR };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function downloadAndSaveOne(url: string, filename: string, signal?: AbortSignal): Promise<void> {
  const target = new File(exportFolder(), filename);
  try {
    const file = await File.downloadFileAsync(url, target, { idempotent: true, signal });
    await MediaLibrary.createAssetAsync(file.uri);
  } finally {
    if (target.exists) {
      try {
        target.delete();
      } catch (error) {
        // A failed cleanup must not override the success/failure of the
        // save itself (same principle as media.ts), only logged, never
        // thrown.
        console.error('[exportApi] Zwischendatei konnte nicht gelöscht werden', filename, error);
      }
    }
  }
}

const SINGLE_ERROR = 'Dieser Moment konnte nicht gesichert werden. Probier es gleich nochmal.';

export type SingleResult = { ok: true } | { ok: false; grund: 'keine_berechtigung' | 'fehler'; text: string };

export async function saveMomentToGallery(moment: RecapMoment, url: MediaUrl): Promise<SingleResult> {
  const permission = await ensurePermission();
  if (!permission.erlaubt) return { ok: false, grund: 'keine_berechtigung', text: permission.text };

  resetExportFolder();
  const extension = mediaExtension(moment.type, url.medium_url);
  try {
    await downloadAndSaveOne(url.medium_url, `${moment.id}.${extension}`);
    return { ok: true };
  } catch {
    return { ok: false, grund: 'fehler', text: SINGLE_ERROR };
  }
}

export type AllProgress = { erledigt: number; gesamt: number };

// Deliberately discriminates between "never got started" (no permission,
// before the first download) and "is done" (a tally, even if incomplete),
// a shared shape would have forced a caller to distinguish `gesichert:0,
// gesamt:0` from a genuine zero-length run, without the shape itself
// providing a way to do so.
export type AllResult =
  | { status: 'keine_berechtigung'; text: string }
  | { status: 'fertig'; gesichert: number; gesamt: number; fehlgeschlagen: number; abgebrochen: boolean };

// No `Promise.all`: sequential, on purpose, a progress of "7 of 23" assumes
// there's a well-defined "done so far" at every point in time; parallel
// downloads would only complicate that, without the brief calling for any
// parallelism.
export async function saveAllToGallery(
  entries: { moment: RecapMoment; url: MediaUrl }[],
  onProgress: (progress: AllProgress) => void,
  signal?: AbortSignal
): Promise<AllResult> {
  const permission = await ensurePermission();
  if (!permission.erlaubt) return { status: 'keine_berechtigung', text: permission.text };

  resetExportFolder();

  const gesamt = entries.length;
  let gesichert = 0;
  let fehlgeschlagen = 0;

  for (let i = 0; i < gesamt; i++) {
    if (signal?.aborted) {
      return { status: 'fertig', gesichert, gesamt, fehlgeschlagen, abgebrochen: true };
    }
    const { moment, url } = entries[i];
    const extension = mediaExtension(moment.type, url.medium_url);
    try {
      await downloadAndSaveOne(url.medium_url, `${moment.id}.${extension}`, signal);
      gesichert += 1;
    } catch (error) {
      if (isAbortError(error)) {
        return { status: 'fertig', gesichert, gesamt, fehlgeschlagen, abgebrochen: true };
      }
      fehlgeschlagen += 1;
    }
    onProgress({ erledigt: i + 1, gesamt });
  }

  return { status: 'fertig', gesichert, gesamt, fehlgeschlagen, abgebrochen: false };
}
