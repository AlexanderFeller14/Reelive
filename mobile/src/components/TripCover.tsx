import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { placeholderCover } from '@/features/trips/placeholderCover';

// A trip's cover (DESIGN-LANGUAGE v2 §4): 3:2, 24 px radius, borderless,
// without shadow. Used in two places, on the trip card in the lists and
// at the very top of the trip detail screen, hence here once instead of
// twice.
//
// Real trip covers don't exist yet. Until then a placeholder sits here,
// where an empty `bg-1` surface used to be: `position` is the card's place
// in its list and picks the image (see `placeholderCover`), so that two
// identical covers don't end up stacked. The trip detail passes the same
// position in via its route's `cover` parameter. Without one, it defaults
// to the first image.
//
// `bg-1` stays underneath as a base so the surface doesn't flash white
// while decoding. The images are 16:9 and get cropped to 3:2 (`cover`),
// about 8% falls away on each side, in both cases the subject sits far
// enough inside to survive that. The image says nothing the title below
// it doesn't already say, hence `accessible={false}`.
export function TripCover({
  position = 0, sealed = false, children,
}: {
  position?: number;
  sealed?: boolean;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    // Two layers instead of one: the seal overlaps the cover's corner and
    // must therefore hang outside the clipping container. If it were
    // inside, that container's `overflow: hidden` would clip off exactly
    // the overhanging part.
    <View>
      <View style={[styles.cover, { backgroundColor: colors['bg-1'] }]}>
        <Image
          testID="reise-cover"
          source={placeholderCover(position)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessible={false}
        />
        <View style={styles.overlay}>{children}</View>
      </View>
      {sealed && (
        // The seal shows the wax seal image itself, no longer the pill
        // with the word "Versiegelt". On a photo, the light `bg-1` pill
        // wouldn't have had a reliable background anyway (§1: on photos,
        // UI only sits as a translucent pill), the seal brings its own.
        // For screen readers the word still stands, as the image's label,
        // the seal is not decoration, it carries the trip's state.
        <Image
          testID="wachssiegel"
          source={require('@/assets/images/rotes-brief-wachssiegel-transparent.png')}
          style={styles.seal}
          contentFit="contain"
          accessibilityRole="image"
          accessibilityLabel="Versiegelt"
        />
      )}
    </View>
  );
}

// A good third of the cover height: the seal is the trip's state, not a
// badge at the edge, and only carries its relief at this size.
const SEAL_SIZE = 80;

// How far it sticks out past the corner. A fixed value instead of a
// fraction of the seal size, because it isn't the seal that limits it, but
// what sits next to it: on the left the 24 px screen edge, above it the
// section heading with its 24 px gap. 16 leaves 8 px of breathing room on
// both sides.
const OVERHANG = 16;

const styles = StyleSheet.create({
  // `overflow: hidden` is not cosmetic here: without it, the absolutely
  // filled cover image would stick out past the rounded corners.
  cover: { aspectRatio: 3 / 2, borderRadius: radius.card, overflow: 'hidden' },
  overlay: { flex: 1, padding: spacing.m, alignItems: 'flex-start' },
  seal: {
    position: 'absolute',
    top: -OVERHANG,
    left: -OVERHANG,
    width: SEAL_SIZE,
    height: SEAL_SIZE,
  },
});
