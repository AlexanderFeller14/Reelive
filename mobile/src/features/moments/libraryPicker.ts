import * as ImagePicker from 'expo-image-picker';
// The legacy entry point for the same reason as in recap/exportApi.ts: the
// modern class-based API breaks the web bundle at module load.
import * as MediaLibrary from 'expo-media-library/legacy';
import type { PickedMedia } from './libraryImport';

// Upper bound per round: the picker copies (and in 'compatible' mode
// transcodes) every selected asset before it hands the list over, without
// any progress of its own. Twenty keeps that wait in the seconds.
export const SELECTION_LIMIT = 20;

export type PickResult = { canceled: true } | { canceled: false; media: PickedMedia[] };

// Explicitly typed, not `as const` (same trap as in AvatarPicker.tsx). And
// NO `allowsEditing`: that swaps in the legacy UIImagePickerController,
// which loads the source fully into memory and dies silently on large
// images (bug of 2026-08-13).
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images', 'videos'],
  allowsMultipleSelection: true,
  selectionLimit: SELECTION_LIMIT,
  orderedSelection: true,
  exif: true,
  quality: 1,
  // HEIC becomes JPEG on the way out of the picker, so the web player can
  // display what the camera roll delivered.
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  // `preferredAssetRepresentationMode: Compatible` alone does NOT turn HEVC
  // into H.264 (Final-Review, Important 1): the native default is
  // `videoExportPreset: .passthrough` (ImagePickerOptions.swift:32), and
  // MediaHandler.swift's handleVideo (line 404) then takes a passthrough
  // fast path (lines 412-441) that copies the ORIGINAL library bytes via
  // PHAssetResourceManager whenever PHAsset.fetchAssets(withLocalIdentifiers:)
  // finds the asset, i.e. exactly when library read access was granted (see
  // requestReadAccess below). Setting H264_1920x1080 here fails that
  // `== .passthrough` check and forces a real transcode. The TypeScript type
  // marks `videoExportPreset` `@deprecated` (ImagePicker.types.d.ts:437), but
  // the native module still reads and honours it; the deprecation is only a
  // documentation note. The exported file then comes out as .mp4, which
  // mediaExtension already maps.
  videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080,
};

// Read access to the library is what makes the picker hand over asset ids;
// without it creationTime and location stay out of reach. A refusal is not
// an error: the picker itself works without any permission, and a failing
// check must not stand between the person and their photos.
async function requestReadAccess(): Promise<void> {
  try {
    const current = await MediaLibrary.getPermissionsAsync(false);
    if (current.granted || !current.canAskAgain) return;
    await MediaLibrary.requestPermissionsAsync(false);
  } catch (error) {
    console.error('[libraryPicker] permission request failed', error);
  }
}

async function libraryInfo(
  assetId: string | null | undefined
): Promise<Pick<PickedMedia, 'creationTime' | 'location'>> {
  if (!assetId) return { creationTime: null, location: null };
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    return { creationTime: info.creationTime ?? null, location: info.location ?? null };
  } catch (error) {
    console.error('[libraryPicker] asset info failed', assetId, error);
    return { creationTime: null, location: null };
  }
}

export async function pickFromLibrary(): Promise<PickResult> {
  await requestReadAccess();
  const result = await ImagePicker.launchImageLibraryAsync(OPTIONS);
  if (result.canceled) return { canceled: true };
  const media: PickedMedia[] = [];
  for (const asset of result.assets) {
    const info = await libraryInfo(asset.assetId);
    media.push({
      uri: asset.uri,
      kind: asset.type === 'video' ? 'video' : 'photo',
      durationMs: asset.duration ?? null,
      exif: asset.exif ?? null,
      creationTime: info.creationTime,
      location: info.location,
    });
  }
  return { canceled: false, media };
}
