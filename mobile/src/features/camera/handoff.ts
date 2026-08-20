// The captured photo travels as a native storage object (PictureRef) from
// the camera screen to the preview. Router params are strings, a ref
// doesn't fit through, hence this holder, the smallest thing that closes
// the gap (spec 2026-08-13-aufnahme-tempo-design.md §4). It holds exactly
// ONE handoff: more than one capture is never in flight at the same time.
import type { PictureRef } from 'expo-camera';
import type { VideoPlayer } from 'expo-video';

export type PhotoHandoff = {
  /** For display: expo-image takes a SharedRef directly as source. */
  ref: PictureRef;
  /** The ref's savePictureAsync, for submitting, runs in the background from the moment of capture. */
  file: Promise<{ uri: string }>;
};

let pendingPhoto: PhotoHandoff | null = null;

export function setPhoto(handoff: PhotoHandoff): void {
  // Replaces anything left over without comment: the old ref falls to the GC.
  pendingPhoto = handoff;
  // As long as nobody is waiting, a rejection (storage full) must not become
  // an "unhandled rejection". The empty handler hangs off one BRANCH of the
  // promise, not the promise itself: whoever awaits `file` later (the
  // preview on submit) still gets the rejection unchanged.
  void handoff.file.catch(() => {});
}

export function takePhoto(): PhotoHandoff | null {
  const handoff = pendingPhoto;
  pendingPhoto = null;
  return handoff;
}

// The video has also travelled through the holder since the 2026-08-14
// device finding. Two shapes (Task 10, own pipeline for the instant
// preview):
//   - 'native': the own pipeline. The file is produced in the background
//     (fileReady), the preview plays natively (InstantPreview, Task 12);
//     uri and duration travel as router params as before.
//   - 'player': the fallback from commit 918e185, the camera screen warms
//     up an expo-video player before navigating and puts a poster (frame 0
//     of the video) next to it, because the VideoView takes ~0.8 s on
//     device before it draws a fully loaded player (measured 2026-08-14,
//     constant, JS thread free in the meantime); until then the poster
//     stands in, the switch is invisible because the loop starts at frame
//     0. The video's data (for submitting and discarding) still travels as
//     a uri in the router params, that documented boundary stays.
export type VideoHandoff =
  | {
      kind: 'native';
      /** Resolves once the background file has finished writing. */
      fileReady: Promise<void>;
    }
  | {
      kind: 'player';
      /** Pre-warmed, already playing player. */
      player: VideoPlayer;
      /** Frame 0 as an instant bridge until the VideoView draws; null if
       *  producing it failed or dawdled (then the area stays briefly dark,
       *  the old state as a fallback). */
      poster: string | null;
    };

let pendingVideo: VideoHandoff | null = null;

export function setVideo(handoff: VideoHandoff): void {
  // Unlike the photo ref, a leftover player doesn't fall to the GC: it's a
  // native object and needs an explicit release. Only the player shape
  // carries such an object, the native shape doesn't.
  if (pendingVideo?.kind === 'player') pendingVideo.player.release();
  // Same as with the photo: as long as nobody is waiting, an early rejection
  // (e.g. a failed background write) must not become an "unhandled
  // rejection". The empty handler hangs off one BRANCH of the promise, not
  // the promise itself: whoever awaits `fileReady` later still gets the
  // rejection unchanged.
  if (handoff.kind === 'native') void handoff.fileReady.catch(() => {});
  pendingVideo = handoff;
}

export function takeVideo(): VideoHandoff | null {
  const handoff = pendingVideo;
  pendingVideo = null;
  return handoff;
}

// savePictureAsync is inconsistent across platforms (expo-camera SDK 57):
// Android delivers the field `uri` (CameraViewModule.kt, putString("uri",
// …)), iOS delivers `url` (ExpoCameraUtils.saveImage, result["url"]), and
// the TS type PhotoResult promises `uri` uniformly. Anyone who trusts the
// type and only reads `.uri` gets undefined on the iPhone: submitting a
// photo silently failed because of this (device finding 2026-08-14). This
// wrapper straightens out the discrepancy at the source; if both are
// missing, that's a real error and belongs in the submit's catch as a
// rejection, not as a silent undefined in a job.
export function savedFile(ref: PictureRef): Promise<{ uri: string }> {
  return ref.savePictureAsync().then((result) => {
    const { uri, url } = result as { uri?: string; url?: string };
    const path = uri ?? url;
    if (!path) throw new Error('savePictureAsync lieferte weder uri noch url');
    return { uri: path };
  });
}
