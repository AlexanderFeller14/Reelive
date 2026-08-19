import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Marker } from 'react-native-maps';
import { Play } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { useTheme } from '@/theme/ThemeProvider';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { cinema, motion, radius, shadow, spacing, type } from '@/theme/tokens';
import type { RecapMoment } from '@/features/recap/types';
import { pinAppearance, pinLabel } from '@/features/map/pin';
import type { MapPoint } from '@/features/map/types';

// The pin on the recap map (Spec §5.4): not a map pin shape, but the round
// thumbnail of the moment, the same visual language as the avatars
// (DESIGN-LANGUAGE §4: round, 2 px white ring). It answers "what happened
// here?" without a single tap.
//
// Two components in one file, because they share one rule: `MapPin` is the
// appearance, `MapPinMarker` puts it on the map and decides when it's
// allowed to stop redrawing itself. That decision hinges on WHAT the pin is
// currently showing, splitting them would mean answering the same question
// in two places.
//
// `pinAppearance` and `pinLabel` have lived platform-free in
// features/map/pin.ts since Task 14: the browser version of the map surface
// builds its pins from DOM instead of Marker views, but needs the same two
// rules, and can't import this file, because it drags in react-native-maps.

// 44 px including the ring, like the largest avatar (§4). The ring sits as
// `borderWidth` INSIDE, exactly like in Avatar.tsx.
const SIZE = 44;
const RING = 2;
// The play icon sits in a translucent pill (§1), 20 px is the smallest area
// in which a 12 px icon doesn't feel cramped.
const VIDEO_PILL = 20;
const COUNTER_SIZE = 20;

type MapPinProps = {
  moment: RecapMoment;
  /** Image URL from the cache; `null` when there is no usable one. */
  thumbUrl: string | null;
  /** Moments in the group. 1 (the normal case) shows no number. */
  count?: number;
  /**
   * Reports that the pin looks finished and nothing about it will change on
   * its own anymore. `MapPinMarker` then switches `tracksViewChanges` off.
   * Also reported again when the appearance has changed and the new state
   * is in place, see `pinAppearance`.
   */
  onReady?: () => void;
};

// The circle under the image. `pulse` distinguishes the two reasons it's
// visible:
//
// - `true`: an image is on its way (§4 skeleton, opacity pulse 0.6 <-> 1.0,
//   NEVER a gradient shimmer). The pulse is the promise "something's coming".
// - `false`: nothing more is coming. Then nothing pulses here either, a
//   quiet `bg-1` surface, like an avatar without an image.
//
// Deliberately the same mechanism as `SkelettBlock` in uebersicht.tsx (private
// there), here as a circle instead of a block.
function SkeletonCircle({ pulse }: { pulse: boolean }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    if (reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.gentle, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: motion.duration.gentle, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion, opacity]);

  return (
    <Animated.View
      testID="nadel-skelett"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors['bg-1'], opacity }]}
    />
  );
}

export function MapPin({ moment, thumbUrl, count = 1, onReady }: MapPinProps) {
  const { colors } = useTheme();

  // Not "is loaded", but "WHICH URL is loaded": on a source change (the cache
  // renews its signatures before they expire) the old loaded state is
  // worthless, and the skeleton has to come back. As a plain boolean this
  // would need an effect that resets it, and that would get in the way of
  // the ready-report in effect ordering.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const imageReady = thumbUrl !== null && loadedUrl === thumbUrl;

  // Without an image source, the pin waits on nothing: its appearance is
  // settled immediately. If it never reported here, the marker would redraw
  // it forever on every frame (fix round 1, item 3).
  const ready = thumbUrl === null || imageReady;
  const appearance = pinAppearance(moment, thumbUrl, count);

  const onImageLoaded = useCallback(() => setLoadedUrl(thumbUrl), [thumbUrl]);

  // `appearance` belongs in the dependencies, not just `ready`: if the
  // counter pill or the play icon changes while the image has long since
  // settled, nothing would fire otherwise, and the marker would never draw
  // the new state.
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, appearance, onReady]);

  return (
    // The padding isn't whitespace, it's room: the counter pill juts out past
    // the circle, and Android clips a marker view at its own edges. Because
    // it's the same on every side, the circle stays at the center of the
    // view, and thus on its coordinate.
    <View style={styles.outer}>
      <View style={[styles.frame, { borderColor: colors['bg-0'], backgroundColor: colors['bg-1'] }]}>
        {/* The clip sits one level DEEPER than the shadow: `overflow:
            hidden` and `shadow.s2` on the same view also cut away the
            shadow on iOS (masksToBounds). */}
        <View style={styles.clip}>
          {/* The circle sits UNDER the image, not above it, and both are
              mounted at the same time. That's no accident: react-native-maps
              draws the pin one last time when `tracksViewChanges` switches
              off, and that happens in the same commit in which the circle
              disappears. If it sat on top, the order of two native
              operations would decide whether the frozen image still carries
              the circle. Underneath, the question doesn't arise: the loaded
              photo covers it completely either way. */}
          {!imageReady && <SkeletonCircle pulse={thumbUrl !== null} />}

          {thumbUrl !== null && (
            // Deliberately WITHOUT `transition` (unlike the tiles in
            // uebersicht.tsx): a running fade-in would freeze half
            // transparent on the last draw.
            <Image
              testID="nadel-bild"
              source={{ uri: thumbUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              onLoad={onImageLoaded}
              onError={onImageLoaded}
            />
          )}

          {moment.type === 'video' && (
            <View style={[StyleSheet.absoluteFill, styles.videoCenter]} pointerEvents="none">
              <Pill testID="nadel-video" style={styles.videoPill}>
                <Play size={12} color={cinema['text-1']} strokeWidth={1.75} />
              </Pill>
            </View>
          )}
        </View>
      </View>

      {/* The group's counter pill (Spec §5.5). A group of one isn't a group,
          it doesn't carry a "1". */}
      {count > 1 && (
        <View style={[styles.counter, { backgroundColor: colors.accent }]}>
          <Text style={[type.label, styles.counterText, { color: colors['on-accent'] }]}>{String(count)}</Text>
        </View>
      )}
    </View>
  );
}

type MarkerProps = {
  point: MapPoint;
  thumbUrl: string | null;
  count?: number;
  /**
   * Does a tap on this group open its list, instead of flying into it?
   * Only changes the label; what the tap triggers is decided by the screen
   * (karte.tsx) using the same information.
   */
  opensSheet?: boolean;
  /**
   * Tap on the pin. Gets back the point it represents (a group's anchor,
   * for a group), instead of taking a ready-made action. Only this way can
   * the screen give ONE unchanging function to all pins; a
   * `() => doSomething(group)` would be a new one on every render and would
   * make the `memo` below pointless.
   */
  onPress?: (point: MapPoint) => void;
};

// The pin on the map. `tracksViewChanges` is the spot where this screen
// technically tips over, the value tells react-native-maps whether it should
// keep redrawing the pin:
//
// - permanently `true`: every pin gets re-rendered on every frame; from a
//   handful of pins on, the map visibly stutters.
// - permanently `false`: the pin freezes in the state it had at the first
//   draw. But the image only arrives from the network after that, so the
//   empty circle would remain, forever.
//
// The reported ready state is therefore not held as yes/no, but as the
// appearance IT APPLIES TO. If any visible property changes, new image
// source, different group size, different moment type, the reported state
// no longer matches the current one, and the pin redraws itself again on its
// own. A yes/no with an effect that resets it does the same only as long as
// nobody turns the order of effects against it.
//
// `memo` for the same reason the line on the screen is memoized: the screen
// re-renders on EVERY map movement (`onRegionChangeComplete`), and without
// this every pin would recompute every time. It also keeps the coordinate
// literal below harmless, it only gets rebuilt once a property has actually
// changed.
export const MapPinMarker = memo(function MapPinMarker({
  point, thumbUrl, count = 1, opensSheet = false, onPress,
}: MarkerProps) {
  const { moment } = point;
  const appearance = pinAppearance(moment, thumbUrl, count);
  const [renderedAppearance, setRenderedAppearance] = useState<string | null>(null);
  const handleReady = useCallback(() => setRenderedAppearance(appearance), [appearance]);

  // The marker hands back to the screen WHICH pin was tapped. The closure is
  // created in here instead of in the screen, so it only gets rebuilt when
  // this pin re-renders anyway.
  const handlePress = useCallback(() => onPress?.(point), [onPress, point]);

  return (
    <Marker
      testID={`karte-nadel-${moment.id}`}
      accessibilityLabel={pinLabel(moment, count, opensSheet)}
      coordinate={{ latitude: point.lat, longitude: point.lng }}
      tracksViewChanges={renderedAppearance !== appearance}
      onPress={handlePress}
    >
      <MapPin moment={moment} thumbUrl={thumbUrl} count={count} onReady={handleReady} />
    </Marker>
  );
});

const styles = StyleSheet.create({
  outer: { padding: spacing.s, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    borderWidth: RING,
    ...shadow.s2,
  },
  clip: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  videoCenter: { alignItems: 'center', justifyContent: 'center' },
  videoPill: {
    width: VIDEO_PILL,
    height: VIDEO_PILL,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: COUNTER_SIZE,
    height: COUNTER_SIZE,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §2: numbers always tabular-nums, an "11" shouldn't be narrower than a
  // "44", otherwise the pill would wobble between two zoom levels.
  counterText: { fontVariant: ['tabular-nums'] },
});
