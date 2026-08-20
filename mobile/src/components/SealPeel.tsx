import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BlurMask,
  Canvas,
  FilterMode,
  Group,
  ImageShader,
  MipmapMode,
  Oval,
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
  PEELED_AT_MS,
  STAGE,
  DURATION_MS,
  GRID_RESOLUTION,
  triangleIndices,
  nodePositions,
  shadowParameters,
  textureCoordinates,
} from '@/features/recap/sealPeel';

const REDUCED_DURATION_MS = 200;

// Color of the floor shadow from the prototype (warm dark brown, not a
// neutral black: the shadow sits under red wax on a light background).
const SHADOW_COLOR = '#36150D';
// Tilt of the shadow ellipse (radians), also from the prototype.
const SHADOW_ROTATION = [{ rotate: -0.18 }];

type Props = {
  // Edge length of the square stage in points. The seal itself takes up
  // 500/720 of it (sealPeel.SEAL), the rest is air it rolls itself into
  // while peeling off.
  size: number;
  // Reported as soon as the stage is empty (sealPeel.PEELED_AT_MS), not
  // only at the end of the shadow fade-out; with reduced motion, after the
  // 200 ms fade.
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

export function SealPeel({ size, onPeeled, testID }: Props) {
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
    return () => {
      clearTimeout(timer);
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

  const nodes = useDerivedValue(() => nodePositions(progress.value, GRID_RESOLUTION));
  const shadowRect = useDerivedValue(() => {
    const s = shadowParameters(progress.value);
    return { x: s.x - s.rx, y: s.y - s.ry, width: 2 * s.rx, height: 2 * s.ry };
  });
  const shadowCenter = useDerivedValue(() => {
    const s = shadowParameters(progress.value);
    return { x: s.x, y: s.y };
  });
  const shadowOpacity = useDerivedValue(() => shadowParameters(progress.value).opacity);
  const shadowSoftness = useDerivedValue(() => shadowParameters(progress.value).softness);

  // Everything is computed in stage units (720) and scaled onto the point
  // size as a whole; the shadow's softness scales along with it (BlurMask
  // respectCTM, the default), so every number stays the prototype's number.
  const scale = size / STAGE;

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
      <Canvas testID="seal-stage" style={{ width: size, height: size }}>
        {image && textures && (
          <Group transform={[{ scale }]} opacity={opacity}>
            <Oval
              rect={shadowRect}
              color={SHADOW_COLOR}
              opacity={shadowOpacity}
              origin={shadowCenter}
              transform={SHADOW_ROTATION}
            >
              <BlurMask blur={shadowSoftness} style="normal" />
            </Oval>
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
          </Group>
        )}
      </Canvas>
    </PressScale>
  );
}
