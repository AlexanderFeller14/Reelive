import { useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// The avatar picker consists of TWO parts that have to hang in different
// spots in the tree, that's exactly why it's split this way:
//
//   `AvatarPicker`,       the 44 px circle with the camera badge, a tap
//                          target. It sits wherever the profile picture
//                          belongs (profile card, onboarding row), and
//                          reports the tap upward via `onOpen`.
//   `AvatarSheetContent`, the three entries plus the selection flow. They
//                          sit inside the `Sheet`, and the `Sheet` belongs to
//                          the SCREEN.
//
// Why this can't be one component: `Sheet` is not a `Modal`. Its root is a
// `KeyboardAvoidingView` with `StyleSheet.absoluteFill`, its panel sits
// `position:'absolute'` at `left/right/bottom: 0` (Sheet.tsx). In Yoga, an
// absolutely positioned child resolves against its IMMEDIATE parent, not
// against the screen. If the sheet hung, as it did until the merge fix
// round, inside the circle's wrapper, it ended up exactly as big as that
// wrapper: in the profile tab a 44 px wide strip that scrolled along at the
// avatar's position, with a 44 × 44 "full screen" background and negative
// remaining width for "Foto auswählen" (the panel has 2 × 24 px of inner
// padding); in onboarding a short band in the middle of the form.
//
// Every other sheet in this app is a sibling of its screen's ScrollView
// (trip/[id]/index.tsx, recap/[id]/map|player|overview.tsx), and
// profil.tsx even writes the rule above its own delete sheet.
//
// No test had caught this, and none could: Jest runs no Yoga layout, RNTL
// finds text in the element tree regardless of any geometry. What CAN be
// checked instead is the tree position itself, and that's exactly what the
// screen tests do now (profilTab.test.tsx, profile-setup.test.tsx:
// `sheet-root` is NOT inside the ScrollView, respectively not inside the
// image row).
//
// Why the entries don't simply live in both screens: then the whole
// selection flow (permission, crop, cancel, error message) would be
// duplicated. Same pattern as `ShareSheetContent`
// (features/sharing/ShareSheetContent.tsx): the content is its own component,
// the `Sheet` sits wherever it belongs.

// DESIGN-LANGUAGE §4 caps avatars at 32-44 px. 44 is the upper bound and at
// the same time the iOS minimum for a tap target, both together are why
// cards and onboarding use exactly this value.
const SIZE = 44;
const BADGE = 18;
// The hero variant of the profile tab (image swap 2026-08-13): there the
// circle isn't a card avatar per §4, but the tab's header image, the same
// edge as the 160-sized empty-state images (camper, film reel, flight
// ticket). The badge grows with it, 18 px on a 160 circle would read as a
// speck of dust.
const LARGE_SIZE = 160;
const LARGE_BADGE = 32;
// The badge's center sits on the circle's edge at 45°. The distance to the
// box edge follows from that: size − badge/2 − (size/2)·(1 + 1/√2), i.e.
// −2.6 resp. 7.4, the two values here are rounded. Written down as fixed
// numbers rather than computed, so the existing badge position of the 44
// circles stays exact.
const BADGE_OFFSET = -2;
const LARGE_BADGE_OFFSET = 8;

// Both calls use the same options. Per the SDK 57 docs, `aspect` only has an
// effect on Android; on iOS the system editor forces a square anyway once
// allowsEditing is on. Without a crop, a portrait shot would sit distorted
// inside the round circle.
//
// Explicitly typed as `ImagePicker.ImagePickerOptions` and not `as const`:
// there, `aspect` requires a MUTABLE tuple `[number, number]`, `as const`
// would have frozen it to `readonly [1, 1]` and it could then no longer be
// passed to launchImageLibraryAsync/launchCameraAsync (TS2345). The same trap
// as with `fontVariant` in theme/tokens.ts.
// ---------------------------------------------------------------------------
// NO `allowsEditing`. This is the core of a bug from 2026-08-13.
// ---------------------------------------------------------------------------
// With `allowsEditing: true`, expo-image-picker doesn't use the modern photo
// picker on iOS but the old UIImagePickerController, only that one can crop.
// It loads the source image fully into memory, and for a large image the
// system kills it. What arrives in the app is then `canceled: true`: not
// distinguishable from a real cancel, without an exception, without a
// message. Measured exactly that way, a 1320×1320 image got through, a
// bigger one silently returned `canceled`.
//
// The square is therefore now produced in the app: features/auth/avatarApi.ts
// crops centered to the shorter edge. Whoever brings `allowsEditing` back
// here brings the bug back with it.
//
// `quality` stays at 1: it gets downscaled in avatarApi anyway, and a second
// lossy stage before that only costs quality.
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  quality: 1,
};

// Two sources, one meaning: the profile tab only knows an already SAVED key
// (`avatarKey`), onboarding only a local file NOT YET uploaded (`localUri`),
// but both mean the same thing, "there's currently an image that could be
// removed". The badge label and the "remove image" entry used to hang off
// `avatarKey` alone; in onboarding that's structurally ALWAYS null
// (profile-setup.tsx), so a freshly chosen image stayed "not removable"
// there forever, a review finding that uncovered exactly this gap.
//
// As a function rather than written out twice: since the split above, BOTH
// halves need the answer (the circle for its accessibility label, the sheet
// content for the remove entry), and they must give the same one.
function hasProfileImage(avatarKey: string | null, localUri: string | null): boolean {
  return !!avatarKey || !!localUri;
}

export function AvatarPicker({
  name, avatarKey, localUri = null, onOpen, loading = false, large = false,
}: {
  name: string;
  avatarKey: string | null;
  // Only onboarding sets this (profile-setup.tsx): there, the profile row
  // doesn't exist yet when an image is chosen, so there's no `avatarKey` yet
  // to load the image under, only the local file URI from the image picker.
  // When the prop is set, the circle shows this local image directly, without
  // the detour through `Avatar`/`avatarUrl`. The profile tab omits the prop
  // and behaves unchanged.
  localUri?: string | null;
  // The screen opens its own sheet, the same split that profil.tsx already
  // runs for the delete sheet (`loeschSheetSichtbar`).
  onOpen: () => void;
  loading?: boolean;
  // Hero header image of the profile tab (see LARGE_SIZE above). Onboarding
  // and cards omit the prop and stay at the 44 from §4.
  large?: boolean;
}) {
  const { colors } = useTheme();
  const hasImage = hasProfileImage(avatarKey, localUri);
  const size = large ? LARGE_SIZE : SIZE;
  const badge = large ? LARGE_BADGE : BADGE;
  const offset = large ? LARGE_BADGE_OFFSET : BADGE_OFFSET;

  return (
    <PressScale
      testID="avatar-picker"
      accessibilityRole="button"
      accessibilityLabel={hasImage ? 'Profilbild ändern' : 'Profilbild hinzufügen'}
      onPress={onOpen}
    >
      <View>
        {localUri ? (
          <View
            testID="avatar-picker-local"
            style={[styles.localCircle, {
              width: size, height: size,
              borderColor: colors['bg-0'], backgroundColor: colors['bg-1'],
            }]}
          >
            <Image testID="avatar-image" source={{ uri: localUri }} style={styles.localImage} contentFit="cover" />
          </View>
        ) : (
          <Avatar name={name} avatarKey={avatarKey} size={size} />
        )}
        {/* Without this badge the circle reads as a mere display. It says
            "something here can be changed", without a second line of text.
            The icon size follows the badge in the ratio of the 18 version. */}
        <View
          testID="avatar-picker-badge"
          style={[styles.badge, {
            width: badge, height: badge, right: offset, bottom: offset,
            backgroundColor: colors.accent, borderColor: colors['bg-0'],
          }]}
        >
          <Camera size={large ? 16 : 10} color={colors['on-accent']} strokeWidth={1.75} />
        </View>
        {loading && (
          <View style={[styles.spinner, { backgroundColor: colors['bg-0'] }]}>
            <ActivityIndicator testID="avatar-loading" size="small" color={colors['text-1']} />
          </View>
        )}
      </View>
    </PressScale>
  );
}

// Belongs inside a `<Sheet title="Profilbild">` of the screen. Renders only
// the entries; height, handle, background, and swipe-to-close are Sheet's job.
export function AvatarSheetContent({
  avatarKey, localUri = null, onSelected, onRemove, onClose,
}: {
  avatarKey: string | null;
  localUri?: string | null;
  // The dimensions come along because the crop screen needs them and the
  // image picker delivers them anyway. Measuring them again afterward would
  // mean decoding a large original a second time.
  onSelected: (localUri: string, width: number, height: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  // No reset needed on open: `Sheet` returns `null` while it's invisible
  // (Sheet.tsx), this component gets unmounted then and starts fresh on the
  // next open.
  const [error, setError] = useState<string | null>(null);
  const hasImage = hasProfileImage(avatarKey, localUri);

  const choose = async (source: 'gallery' | 'camera') => {
    setError(null);
    const permission = source === 'gallery'
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      // The sheet deliberately stays OPEN: the message sits inside it,
      // between the entries, and would be covered by the sheet's own
      // background on the screen underneath. Spec §5.2 demands "a message in
      // the sheet instead of a silent nothing", until the merge fix round
      // the text sat outside, i.e. under the backdrop, and was exactly that
      // silent nothing.
      setError(
        source === 'gallery'
          ? 'Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.'
          : 'Ohne Zugriff auf die Kamera geht es nicht. Du kannst das in den Einstellungen ändern.'
      );
      return;
    }

    // try/catch, because the caller writes `void choose(…)`: a thrown
    // exception would otherwise be an unhandled promise rejection, and
    // therefore a silent nothing for the person in front of the device.
    // That's exactly why nothing showed up in the bug from 2026-08-13.
    let result: ImagePicker.ImagePickerResult;
    try {
      result = source === 'gallery'
        ? await ImagePicker.launchImageLibraryAsync(OPTIONS)
        : await ImagePicker.launchCameraAsync(OPTIONS);
    } catch (errorObject) {
      console.error('[AvatarPicker] image picker threw', errorObject);
      setError('Das Bild liess sich nicht öffnen. Probier es nochmal oder nimm ein anderes.');
      return;
    }

    onClose();
    // A cancel isn't an error: the sheet closes, nothing else.
    //
    // Watch out, there's a platform limitation here: a FAILED image picker
    // reports itself the EXACT SAME way, `canceled: true`, without an
    // exception. The two cases can't be told apart at this point, which is
    // why there's no error message here either: it would hit every genuine
    // cancel along with it. The way around it is to not provoke the failure
    // in the first place, see the reasoning at OPTIONS for why
    // `allowsEditing` is missing.
    if (result.canceled || !result.assets?.[0]) return;
    const selected = result.assets[0];
    onSelected(selected.uri, selected.width, selected.height);
  };

  return (
    <>
      <PressScale accessibilityRole="button" onPress={() => void choose('gallery')}>
        <Text style={[type.bodyMedium, styles.entry, { color: colors['text-1'] }]}>
          Foto auswählen
        </Text>
      </PressScale>
      <PressScale accessibilityRole="button" onPress={() => void choose('camera')}>
        <Text style={[type.bodyMedium, styles.entry, { color: colors['text-1'] }]}>
          Selfie aufnehmen
        </Text>
      </PressScale>
      {hasImage && (
        <PressScale
          accessibilityRole="button"
          onPress={() => {
            onClose();
            onRemove();
          }}
        >
          <Text style={[type.bodyMedium, styles.entry, { color: colors.danger }]}>
            Bild entfernen
          </Text>
        </PressScale>
      )}
      {error && (
        <Text testID="avatar-picker-error" style={[type.secondary, { color: colors.danger }]}>
          {error}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // Same shape as Avatar/kreis() (2 px ring, round), but local here instead
  // of imported: `Avatar` builds its circle shape internally via
  // avatarUrl(avatarKey), which doesn't fit a local file URI (the function
  // expects a storage key, not a file:// URI). The edge length comes inline
  // from `size`, because since the hero variant it takes on two different
  // values.
  localCircle: {
    borderRadius: radius.pill,
    borderWidth: 2, overflow: 'hidden',
  },
  localImage: { width: '100%', height: '100%' },
  // Dimensions and position come inline (badge/offset), reasoning at the
  // constants above.
  badge: {
    position: 'absolute',
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    // absoluteFillObject no longer exists in this RN version, only
    // `absoluteFill` itself, at runtime an ordinary (frozen in dev builds)
    // object that spreads just the same.
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  entry: { paddingVertical: spacing.m },
});
