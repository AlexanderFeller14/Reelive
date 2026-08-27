import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Canvas,
  FilterMode,
  Group,
  ImageShader,
  LinearGradient,
  MipmapMode,
  Rect,
  Vertices,
  useImage,
} from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PressScale } from '@/components/PressScale';
import { motion } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import {
  FLIGHT_ROOM,
  LIFT_OFF_MS,
  PEELED_AT_MS,
  STAGE,
  DURATION_MS,
  GRID_RESOLUTION,
  dissolveEdge,
  triangleIndices,
  nodePositions,
  textureCoordinates,
} from '@/features/recap/sealPeel';

const REDUCED_DURATION_MS = 200;

// The canvas the seal needs at a given stage size, and where the stage sits
// inside it. The seal flies far up and to the left out of its stage
// (sealPeel.FLIGHT_ROOM) before it breaks up, so the drawing area has to
// reach out that far too, otherwise the flying seal is sliced off along the
// canvas edge. Exported so a caller can position the STAGE, not the canvas.
export function peelCanvas(size: number) {
  const stageScale = size / STAGE;
  return {
    width: (STAGE + FLIGHT_ROOM.left) * stageScale,
    height: (STAGE + FLIGHT_ROOM.top) * stageScale,
    stageLeft: FLIGHT_ROOM.left * stageScale,
    stageTop: FLIGHT_ROOM.top * stageScale,
  };
}

type Props = {
  // Edge length of the square stage in points. The seal itself takes up
  // 500/720 of it (sealPeel.SEAL), the rest is air it rolls itself into
  // while peeling off.
  size: number;
  // Reported once the seal has come off and begins to break up (LIFT_OFF_MS).
  // With reduced motion there is nothing to watch, so it arrives at once.
  onLiftOff?: () => void;
  // Reported once nothing of the seal is left to see (PEELED_AT_MS); with
  // reduced motion, after the 200 ms fade.
  onPeeled: () => void;
  testID?: string;
};

// The wax seal on the recap overview that the person peels off themselves:
// a tap, then it detaches like a flexible sticker from the bottom right,
// rolls itself up, and flies out of frame to the top left (physics in
// features/recap/sealPeel.ts, ported from docs/design/reelive-sticker-
// peel.html). Drawn with Skia: the seal PNG sits as a texture on a triangle
// mesh whose node positions are recomputed per frame on the UI thread
// (`useDerivedValue` from a single progress value), Skia reads the shared
// values directly, no frame crosses the JS bridge.
//
// Clock: progress runs LINEARLY over DURATION_MS. That is not a violation
// of DESIGN-LANGUAGE §5 ("linear is forbidden"), but the exception named
// there: the value represents real time, the curves (the front's
// smoothstep, the shadow's falloff) live in the physics itself, just as in
// the prototype, where `p` is likewise the raw clock.
//
// `onPeeled` arrives via its own `setTimeout`, not via withTiming's
// completion callback: same pattern as RevealSequence (in tests
// without a native Animated module the callback fires immediately instead
// of after the duration), and the moment (85% of the duration, when no
// node is left on the stage) isn't the end of the animation anyway.
//
// Sequenced as state (`mode`) plus effect rather than directly in the tap
// handler, like RevealSequence (`visible` → effect): the tap only
// decides WHAT runs (peel or, with reduced motion, fade), the effect starts
// the animation and timer and tears both down again in its cleanup, an
// unmount mid-peel leaves neither a timer nor a computation running on the
// UI thread.
type Mode = 'idle' | 'peel' | 'fade';

export function SealPeel({ size, onLiftOff, onPeeled, testID }: Props) {
  const reducedMotion = useReducedMotion();
  const image = useImage(require('@/assets/images/rotes-brief-wachssiegel-transparent.png'));
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const [mode, setMode] = useState<Mode>('idle');
  const running = mode !== 'idle';
  // Always the current callback, so a new identity from outside doesn't
  // restart the running effect (the screen defines it inline).
  const onPeeledRef = useRef(onPeeled);
  useEffect(() => {
    onPeeledRef.current = onPeeled;
  }, [onPeeled]);
  const onLiftOffRef = useRef(onLiftOff);
  useEffect(() => {
    onLiftOffRef.current = onLiftOff;
  }, [onLiftOff]);

  useEffect(() => {
    if (mode === 'idle') return;
    let duration: number;
    if (mode === 'fade') {
      duration = REDUCED_DURATION_MS;
      opacity.value = withTiming(0, {
        duration: REDUCED_DURATION_MS,
        easing: Easing.bezier(...motion.easeSmooth),
      });
    } else {
      duration = PEELED_AT_MS;
      progress.value = withTiming(1, { duration: DURATION_MS, easing: Easing.linear });
    }
    const timer = setTimeout(() => onPeeledRef.current(), duration);
    // Its own timer, on the same clock: with reduced motion nothing is being
    // watched, so the show may start immediately (delay 0).
    const liftOff = setTimeout(
      () => onLiftOffRef.current?.(),
      mode === 'fade' ? 0 : LIFT_OFF_MS
    );
    return () => {
      clearTimeout(timer);
      clearTimeout(liftOff);
      cancelAnimation(progress);
      cancelAnimation(opacity);
    };
  }, [mode, progress, opacity]);

  // Mesh topology and texture coordinates are fixed, only the node
  // positions move. The textures need the image dimensions in pixels (Skia
  // reads them without a `rect` on the ImageShader in the image's pixel
  // space).
  const indices = useMemo(() => triangleIndices(GRID_RESOLUTION), []);
  const textures = useMemo(
    () => (image ? textureCoordinates(GRID_RESOLUTION, image.width(), image.height()) : null),
    [image]
  );

  // The two points of the dissolve edge (sealPeel.dissolveEdge), which walks
  // the diagonal from top left to bottom right and takes the seal apart on
  // the way. Direction and timing live in the physics module, this only
  // hands them to Skia.
  const dissolveStart = useDerivedValue(() => dissolveEdge(progress.value).start);
  const dissolveEnd = useDerivedValue(() => dissolveEdge(progress.value).end);
  const nodes = useDerivedValue(() => nodePositions(progress.value, GRID_RESOLUTION));
  // Everything is computed in stage units (720) and scaled onto the point
  // size as a whole; the shadow's softness scales along with it (BlurMask
  // respectCTM, the default), so every number stays the prototype's number.
  const scale = size / STAGE;
  const canvas = peelCanvas(size);

  const peel = () => {
    if (running) return;
    // DESIGN-LANGUAGE §5: success haptic on reveal. Exactly once, on the
    // tap, not at the end: the person has just broken something open
    // themselves.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Reduced motion is captured HERE, not read inside the effect: if
    // someone toggles the setting mid-peel, what's already started runs to
    // completion instead of restarting.
    setMode(reducedMotion ? 'fade' : 'peel');
  };

  return (
    // Press feedback like a borderless card (§5: scale via spring, here
    // 0.98, never opacity), locked once the peel is running: a second tap
    // must not fire the haptic or the timer a second time.
    <PressScale
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel="Siegel abziehen"
      accessibilityState={{ disabled: running }}
      disabled={running}
      onPress={peel}
      testID={testID}
      style={{ width: size, height: size }}
    >
      {/* Reaches out of the component up and to the left, so the flight has
          room. React Native does not clip it (overflow is visible), and
          because the canvas is NOT the press target, a tap on the card up
          there stays the card's. */}
      <Canvas
        testID="seal-stage"
        style={{
          position: 'absolute',
          left: -canvas.stageLeft,
          top: -canvas.stageTop,
          width: canvas.width,
          height: canvas.height,
        }}
      >
        {image && textures && (
          <Group
            transform={[
              { translateX: canvas.stageLeft },
              { translateY: canvas.stageTop },
              { scale },
            ]}
            opacity={opacity}
          >
            {/* Its own layer, so the dissolve below reaches the seal and
                nothing else. */}
            <Group layer>
              <Vertices
                vertices={nodes}
                textures={textures}
                indices={indices}
                mode="triangles"
              >
                {/* Mipmaps, because the PNG (1254 px) is drawn scaled down on
                    the device; without them the wax relief shimmers while
                    rolling up. Clamp instead of decal: the mesh's edges sit
                    in the PNG's transparent border, there's nothing to tile. */}
                <ImageShader
                  image={image}
                  tx="clamp"
                  ty="clamp"
                  sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}
                />
              </Vertices>
              {/* The dissolve: a gradient drawn over the seal in `dstIn`,
                  which multiplies what is already there by the gradient's
                  alpha. `dstIn` paints no colour of its own, so unlike a mask
                  there is no rectangle that could ever show as an edge. It
                  spans the whole flight room, because dstIn only touches the
                  pixels it actually covers. */}
              <Rect
                x={-FLIGHT_ROOM.left}
                y={-FLIGHT_ROOM.top}
                width={STAGE + FLIGHT_ROOM.left}
                height={STAGE + FLIGHT_ROOM.top}
                blendMode="dstIn"
              >
                <LinearGradient
                  start={dissolveStart}
                  end={dissolveEnd}
                  colors={['#FFFFFF00', '#FFFFFFFF']}
                />
              </Rect>
            </Group>
          </Group>
        )}
      </Canvas>
    </PressScale>
  );
}
