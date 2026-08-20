import { useState } from 'react';
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { PressScale } from '@/components/PressScale';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import {
  cropFor,
  clamp,
  baseFactor,
  type Crop,
  type Framing,
} from '@/features/auth/crop';

// The replacement for the system crop that `allowsEditing` used to provide.
// That option had to go (see AvatarPicker): it forces the old
// UIImagePickerController on iOS, which gets killed by the system for large
// images. Without a replacement, though, the image would have been cropped
// centered without being asked, and a profile picture whose crop you can't
// choose is a step backward.
//
// Cinema palette instead of `useTheme()`: here a photo covers the full
// surface, and DESIGN-LANGUAGE §1 calls for the dark theater for media
// screens. Same approach as in the recap player.
//
// Gestures handled by hand via PanResponder instead of a recognizer: the same
// pattern as Sheet.tsx (swiping) and the camera zoom in the viewfinder. The
// project does have react-native-gesture-handler as a dependency, but doesn't
// use it anywhere itself, a second gesture model just for this screen would
// be the worse choice.

const { width: WINDOW_WIDTH } = Dimensions.get('window');
// The frame is square and takes up the window width minus the screen
// margins.
const FRAME = WINDOW_WIDTH - spacing.screen * 2;

const START: Framing = { zoom: 1, offsetX: 0, offsetY: 0 };

function distance(points: { pageX: number; pageY: number }[]): number {
  const dx = points[0].pageX - points[1].pageX;
  const dy = points[0].pageY - points[1].pageY;
  return Math.hypot(dx, dy);
}

export function AvatarCropper({
  uri, width, height, onCancel, onDone,
}: {
  uri: string;
  width: number;
  height: number;
  onCancel: () => void;
  onDone: (crop: Crop) => void;
}) {
  const source = { width: width, height: height };
  const [framing, setFraming] = useState<Framing>(START);

  // The state at the start of a gesture. As state and not a ref, because the
  // project has kept its Animated/gesture values that way since the lint
  // pass; for the gesture itself, all that matters is that the value sits
  // between two events.
  const [start, setStart] = useState<{ framing: Framing; span: number | null }>({
    framing: START,
    span: null,
  });

  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        setFraming((current) => {
          setStart({
            framing: current,
            span: touches.length >= 2 ? distance(touches) : null,
          });
          return current;
        });
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        setStart((s) => {
          // Two fingers: zoom. The starting span is filled in retroactively
          // if the second finger only joins mid-gesture, otherwise the
          // image would jump the instant it's touched.
          if (touches.length >= 2) {
            const currentSpan = distance(touches);
            if (s.span === null) return { framing: s.framing, span: currentSpan };
            setFraming(
              clamp(
                { ...s.framing, zoom: s.framing.zoom * (currentSpan / s.span) },
                source,
                FRAME,
              ),
            );
            return s;
          }
          setFraming(
            clamp(
              {
                zoom: s.framing.zoom,
                offsetX: s.framing.offsetX + gesture.dx,
                offsetY: s.framing.offsetY + gesture.dy,
              },
              source,
              FRAME,
            ),
          );
          return s;
        });
      },
    }),
  );

  // The rendering mirrors exactly the model from crop.ts: base factor times
  // zoom, then shifted. If this drifts from that, the frame shows something
  // different from what comes out in the end.
  const factor = baseFactor(source, FRAME) * framing.zoom;

  return (
    <View style={styles.surface}>
      <View style={styles.center}>
        <View testID="crop-frame" style={styles.frame} {...pan.panHandlers}>
          <Image
            testID="crop-image"
            source={{ uri }}
            style={{
              width: width * factor,
              height: height * factor,
              transform: [
                { translateX: framing.offsetX },
                { translateY: framing.offsetY },
              ],
            }}
            contentFit="fill"
          />
        </View>
        <Text style={[type.secondary, styles.hint]}>
          Schieben und mit zwei Fingern zoomen
        </Text>
      </View>

      <View style={styles.buttons}>
        <PressScale testID="crop-cancel" accessibilityRole="button" onPress={onCancel}>
          <Text style={[type.bodyMedium, styles.buttonText]}>Abbrechen</Text>
        </PressScale>
        <PressScale
          testID="crop-apply"
          accessibilityRole="button"
          onPress={() => onDone(cropFor(framing, source, FRAME))}
        >
          <Text style={[type.bodyMedium, styles.buttonTextStrong]}>Übernehmen</Text>
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    // `absoluteFill`, not `absoluteFillObject`: the latter no longer exists
    // in this React Native version (0.86), and `absoluteFill` here is a
    // plain, spreadable object, the same spot as in Sheet.tsx.
    ...StyleSheet.absoluteFill,
    backgroundColor: cinema['bg-0'],
    justifyContent: 'space-between',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.l },
  // Round, not square: the frame shows exactly what later sits in the avatar
  // circle. A square frame would let corners be chosen along that are never
  // visible.
  frame: {
    width: FRAME,
    height: FRAME,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: cinema['bg-1'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: cinema['text-2'] },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.l,
  },
  buttonText: { color: cinema['text-2'], paddingVertical: spacing.m },
  buttonTextStrong: { color: cinema['text-1'], paddingVertical: spacing.m },
});
