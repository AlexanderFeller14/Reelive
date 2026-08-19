import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Lock } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { PressScale } from '@/components/PressScale';
import { cinema, palette, radius } from '@/theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Snapchat pattern (product concept): tap = photo, hold = video. The
// threshold decides when a press turns into a video, short enough not to
// feel like a delay, long enough that a normal tap isn't mistaken for a
// hold.
const HOLD_THRESHOLD_MS = 500;

const SIZE = 76; // outer diameter of the shutter (radius 999, DESIGN-LANGUAGE §4)
const STROKE = 4;
const RING_RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Lock (spec 2026-08-12): the thumb swipes right to the lock and is then
// free, the video keeps running. Without it, every recording costs up to
// thirty seconds of sustained pressure, and every movement of the hand goes
// straight through the finger that's supposed to hold the shot steady.
const LOCK_SIZE = 44; // same as "switch camera" and "flash" in the viewfinder header
const LOCK_GAP = 96; // center to center, to the right of the shutter
// Half the distance: short enough that the lock engages without effort,
// long enough that a slip doesn't trigger it.
const LOCK_THRESHOLD = LOCK_GAP / 2;
// The stage carries both the shutter AND the lock and is deliberately
// symmetric: it's centered from the outside, a one-sided overhang would push
// the shutter off the image center. 236 also fits an iPhone SE.
const STAGE_WIDTH = 2 * (LOCK_GAP + LOCK_SIZE / 2);

// While the thumb holds, it may travel across the whole screen: right to the
// lock, up and down for the drag-zoom. Pressable gives up the press as soon
// as the touch leaves the hold area, then onPressOut fires and the
// recording ends mid-zoom (device finding 2026-08-13: at 40 pt it broke off
// as soon as the finger left the shutter; the lock gesture was only covered
// to the right). 1000 covers every iPhone dimension (Pro Max: 956 pt logical
// height). Stopping on RELEASE is unaffected: lifting the finger fires
// onPressOut everywhere.
const PRESS_HOLD_AREA = 1000;

// How much clearly vertical movement it takes for the drag-zoom to take
// over. On the way to the lock (right) the thumb inevitably drifts a bit
// vertically too, without a dead zone the recording zoomed along (device
// finding 2026-08-14). 16 from the 4-pt grid (§3); additionally the vertical
// distance must exceed the horizontal one, otherwise it's a swipe to the
// lock. Once taken over, the zoom follows the finger freely, mid-zoom the
// hand shouldn't suddenly grab at nothing.
const DRAG_DEAD_ZONE = 16;

// DESIGN-LANGUAGE §5, a deliberate and narrowly scoped exception (confirmed
// as defensible in the 2026-08-07 review, see the fix-round-1 appendix in
// task-7-report.md): the progress ring animates `strokeDashoffset`, neither
// `transform` nor `opacity`, and runs JS-driven (`useNativeDriver: false`),
// not on the UI thread.
//
// Clarification of an originally wrong justification: the "linear is
// forbidden, except for progress that reflects real time" exception in §5
// covers ONLY the easing curve (linear vs. ease-smooth), not the animated
// property. It does not automatically cover this case; that was a mistaken
// inference on the first pass.
//
// Standalone justification for the exception: a filling ring can only be
// rebuilt with pure `transform`/`opacity` via two independently rotating
// half-circle masks (the standard pattern behind e.g.
// react-native-circular-progress). That geometry can't be visually verified
// in this sandbox environment without a simulator/screenshot, and an
// unnoticed rotation/pivot bug would show up at exactly the one spot in the
// app the product concept calls its "centerpiece". The SVG stroke technique,
// by contrast, is the industry standard for circular progress, stays
// confined to this one component (no other place in the app animates a
// non-transform property), and runs through `Animated.timing` (instead of a
// raw `setInterval`) so it at least fits the project's Animated conventions.
const RING_DURATION_EASING = Easing.linear; // §5: linear is the allowed exception here for real-time progress.

type Props = {
  onPhoto: () => void;
  onVideoStart: () => void;
  onVideoStop: () => void;
  /** Maximum duration of a video in seconds, the ring stops itself here. */
  maxSeconds: number;
  /**
   * Reports whether the running recording is locked, i.e. whether the hand
   * is free. Only then can anything else be operated alongside it: React
   * Native knows exactly one responder, a second finger on another element
   * would take the touch away from the holding press and end the recording.
   */
  onLockChange?: (locked: boolean) => void;
  /**
   * Reports the vertical finger movement since touch-down, starting at
   * recording start (positive upward, pt). The screen turns this into the
   * drag-zoom; whatever happens before the hold threshold is a tap and
   * reports nothing.
   */
  onZoomDrag?: (dragAmount: number) => void;
};

type Phase = 'idle' | 'holding' | 'video' | 'locked';

function lightFeedback() {
  // .catch(): haptics is pure garnish (§5), a missing/denied haptics
  // feature must never disturb the recording itself.
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// The shutter is the only spot in the camera screen with real logic:
// telling a tap from a hold apart and stopping the recording at maxSeconds
// by itself. Two timers cover that (threshold + max duration) and are
// cleaned up both on release and on unmount, a dangling timer would keep
// firing onVideoStart/-Stop after leaving the screen.
export function ShutterButton({ onPhoto, onVideoStart, onVideoStop, maxSeconds, onLockChange, onZoomDrag }: Props) {
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [overThreshold, setOverThreshold] = useState(false);
  // Ref instead of state: the timer callbacks need the current phase value
  // synchronously and without stale-closure risk (setState is async/batched).
  const phase = useRef<Phase>('idle');
  const thresholdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `useState` instead of `useRef`, because the value is read during render
  // (`interpolate` further down) and a ref has no business there. Lazy
  // initialization creates the value exactly once, so the reference is as
  // stable as a ref, just without touching it during render. Same pattern as
  // the floating ticket in aufnehmen/index.tsx.
  const [progress] = useState(() => new Animated.Value(0));
  // Where the thumb touched down. What's measured is the displacement, not
  // the screen position: the shutter sits centered, but a thumb rarely
  // lands dead center.
  const startX = useRef(0);
  // Where the thumb touched down, vertically: this becomes the drag-zoom
  // amount, same as startX for the lock gesture.
  const startY = useRef(0);
  // The same knowledge as `overThreshold`, only synchronously readable.
  // onPressOut decides between locking and stopping with this, and a state
  // value there might still be the old one.
  const beyond = useRef(false);
  // Which finger started the press. Because the press keeps the responder
  // (cancelable, see below), events from ALL fingers land here, onTouchMove
  // only follows this one, otherwise a second tap elsewhere on screen would
  // shift the lock threshold or tear the drag-zoom around. The type comes
  // from RN's event declaration (string there, actually a number on device),
  // only compared for equality, never computed with.
  const startFinger = useRef<GestureResponderEvent['nativeEvent']['identifier'] | undefined>(undefined);
  // Whether the drag-zoom has taken over for this press (see DRAG_DEAD_ZONE above).
  const dragActive = useRef(false);

  useEffect(() => {
    // Unmount cleanup: without this, a timer still pending at the moment of
    // leaving would keep running in the background and call onVideoStart/-Stop
    // on a component that no longer exists.
    return () => {
      if (thresholdTimer.current) clearTimeout(thresholdTimer.current);
      if (maxDurationTimer.current) clearTimeout(maxDurationTimer.current);
      progress.stopAnimation();
    };
  }, [progress]);

  const stopVideo = () => {
    if (maxDurationTimer.current) {
      clearTimeout(maxDurationTimer.current);
      maxDurationTimer.current = null;
    }
    progress.stopAnimation();
    progress.setValue(0);
    phase.current = 'idle';
    beyond.current = false;
    setRecording(false);
    setLocked(false);
    setOverThreshold(false);
    onLockChange?.(false);
    onVideoStop();
  };

  // Does the event come from a different finger than the one that started
  // the press? Because the press keeps the responder (cancelable below), it
  // receives events from ALL fingers, and React Native fires onPressOut as
  // soon as ANY finger ends, not just the holding one (device finding
  // 2026-08-14: exactly that stopped filming on any random tap). Without an
  // identifier (older events, tests), the finger counts as the own one.
  const isOtherFinger = (e?: GestureResponderEvent) =>
    e?.nativeEvent?.identifier !== undefined &&
    startFinger.current !== undefined &&
    e.nativeEvent.identifier !== startFinger.current;

  // The running recording locks itself: the hand is free, the shutter
  // becomes a stop button. Called from two paths, the swipe past the lock
  // (pressEnd) and the touchCancel of the holding finger (below).
  const lockCapture = () => {
    phase.current = 'locked';
    beyond.current = false;
    setLocked(true);
    setOverThreshold(false);
    onLockChange?.(true);
  };

  const onPressIn = (e?: GestureResponderEvent) => {
    // Locked, the shutter is a stop button: the press ends instead of
    // starting a new recording. The following onPressOut then finds 'idle'
    // and triggers nothing more.
    if (phase.current === 'locked') {
      stopVideo();
      return;
    }
    // Even WHILE recording, a press is a stop: this keeps it endable in
    // every state, even if the holding finger got cancelled and its
    // release never arrives (device finding 2026-08-14). A pressIn here can
    // only be a deliberate new tap, Pressability only re-arms once the
    // previous press is over.
    if (phase.current === 'video') {
      stopVideo();
      return;
    }
    // 'holding': the photo window (500 ms). A second tap here is a foreign
    // finger, nothing to reset, the first tap is running.
    if (phase.current !== 'idle') return;
    startX.current = e?.nativeEvent?.pageX ?? 0;
    startY.current = e?.nativeEvent?.pageY ?? 0;
    startFinger.current = e?.nativeEvent?.identifier;
    dragActive.current = false;
    phase.current = 'holding';
    thresholdTimer.current = setTimeout(() => {
      phase.current = 'video';
      thresholdTimer.current = null;
      setRecording(true);
      lightFeedback();
      onVideoStart();
      // Real elapsed time up to maxSeconds, DESIGN-LANGUAGE §5 explicitly
      // allows `linear` as the exception for the easing curve on progress
      // that reflects real time (for the animated property itself see the
      // explanation at RING_DURATION_EASING above).
      Animated.timing(progress, {
        toValue: 1,
        duration: maxSeconds * 1000,
        easing: RING_DURATION_EASING,
        useNativeDriver: false, // strokeDashoffset isn't transform/opacity, can't run natively.
      }).start();
      maxDurationTimer.current = setTimeout(stopVideo, maxSeconds * 1000);
    }, HOLD_THRESHOLD_MS);
  };

  // Tracks the thumb on its way to the lock. Only evaluated from 'video'
  // onward: before that there's no recording to lock, and a swipe during
  // that window stays a tap, i.e. a photo.
  const onTouchMove = (e?: GestureResponderEvent) => {
    if (phase.current !== 'video') return;
    // Foreign fingers say nothing here (see startFinger above).
    if (e?.nativeEvent?.identifier !== startFinger.current) return;
    const sideways = (e?.nativeEvent?.pageX ?? 0) - startX.current;
    const dragAmount = startY.current - (e?.nativeEvent?.pageY ?? 0);
    // The drag-zoom only takes over on clearly vertical movement and then
    // follows freely (see DRAG_DEAD_ZONE above).
    if (!dragActive.current && Math.abs(dragAmount) >= DRAG_DEAD_ZONE && Math.abs(dragAmount) > Math.abs(sideways)) {
      dragActive.current = true;
    }
    if (dragActive.current) onZoomDrag?.(dragAmount);
    const crossedNow = (e?.nativeEvent?.pageX ?? 0) - startX.current >= LOCK_THRESHOLD;
    if (crossedNow === beyond.current) return;
    beyond.current = crossedNow;
    setOverThreshold(crossedNow);
    // Only on reaching it, not on returning: the signal confirms the lock is
    // engaging, and a back-and-forth shouldn't buzz in the hand.
    if (crossedNow) lightFeedback();
  };

  // The end of the HOLDING press, called from onPressOut (own finger) and
  // from the raw touchEnd of the holding finger. Both can arrive for the
  // same finger; the phase machine turns the second call into a no-op (each
  // branch leaves its phase).
  const pressEnd = () => {
    if (phase.current === 'holding') {
      // Threshold never reached: a normal tap -> photo.
      if (thresholdTimer.current) {
        clearTimeout(thresholdTimer.current);
        thresholdTimer.current = null;
      }
      phase.current = 'idle';
      lightFeedback();
      onPhoto();
      return;
    }
    if (phase.current === 'video') {
      // Released past the lock: the recording keeps running, only the thumb
      // is free. Both timers stay untouched, the max duration still applies
      // unchanged.
      if (beyond.current) {
        lockCapture();
        return;
      }
      stopVideo();
    }
    // phase === 'idle': the video already stopped itself (max duration
    // reached), a late release triggers nothing more.
    // phase === 'locked': locking already consumed this press.
  };

  const onPressOut = (e?: GestureResponderEvent) => {
    // A FOREIGN finger's release doesn't end the press, React Native
    // reports it as pressOut anyway (see isOtherFinger above).
    if (isOtherFinger(e)) return;
    pressEnd();
  };

  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [CIRCUMFERENCE, 0] });

  return (
    // box-none: the stage is just a frame for layout, touches belong to the
    // shutter and the lock, not the empty space between them.
    <View style={styles.stage} pointerEvents="box-none">
      {recording && !locked && (
        <Pill
          testID="ausloeser-schloss"
          accessibilityLabel="Aufnahme sperren"
          style={styles.lock}
          // The gesture's target, not its own tap target: it's reached via
          // the thumb, which is already on the shutter anyway.
          pointerEvents="none"
        >
          <Lock
            size={22}
            color={overThreshold ? palette.accent : cinema['text-2']}
            strokeWidth={1.75}
          />
        </Pill>
      )}
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={locked ? 'Aufnahme beenden' : 'Auslöser'}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onTouchMove={onTouchMove}
        // Without this, `Pressable` would give up the press as soon as the
        // thumb leaves the shutter, and stop the video on the way to the
        // lock or mid drag-zoom (see PRESS_HOLD_AREA above).
        pressRetentionOffset={{
          top: PRESS_HOLD_AREA,
          bottom: PRESS_HOLD_AREA,
          left: PRESS_HOLD_AREA,
          right: PRESS_HOLD_AREA,
        }}
        // And without THIS it would give it up as soon as a second finger
        // taps any other touchable (a tab bar button is enough): Pressable
        // answers the responder request with yes by default
        // (`cancelable ?? true`, Pressability.js), giving it up fires
        // onPressOut, which stops the video (device finding 2026-08-13).
        // `false` declines, the press survives, the foreign touchable
        // doesn't fire at all.
        cancelable={false}
        onTouchEnd={(e) => {
          // The real end of the holding finger. Needed because Pressability
          // may have already ended the press prematurely (foreign finger,
          // see onPressOut), its own release then delivers no more
          // pressOut, but this raw touchEnd always arrives: it goes to the
          // view the touch BEGAN on.
          if (e?.nativeEvent?.identifier === startFinger.current) pressEnd();
        }}
        onTouchCancel={(e) => {
          // iOS killed the holding finger's touch (observed after a foreign
          // finger ends; system gestures and interruptions can do this too).
          // This finger NEVER delivers another event, its release never
          // arrives. Stopping would be the old regression, ignoring it would
          // leave the recording unstoppable: instead it locks itself and
          // keeps running hands-free, the shutter becomes the stop button
          // from here on.
          if (e?.nativeEvent?.identifier === startFinger.current && phase.current === 'video') {
            lockCapture();
          }
        }}
      >
        <View style={styles.wrap}>
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RING_RADIUS}
            stroke={cinema['overlay-pill']}
            strokeWidth={STROKE}
            fill="none"
          />
          {recording && (
            <AnimatedCircle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RING_RADIUS}
              stroke={palette.accent}
              strokeWidth={STROKE}
              strokeDasharray={`${CIRCUMFERENCE}, ${CIRCUMFERENCE}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              fill="none"
              rotation={-90}
              origin={`${SIZE / 2}, ${SIZE / 2}`}
            />
          )}
        </Svg>
          <View
            testID="ausloeser-kern"
            style={[styles.core, recording && styles.coreActive, locked && styles.coreLocked]}
          />
        </View>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: STAGE_WIDTH,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sits at the right edge of the stage, which is exactly wide enough that
  // the pill's center is LOCK_GAP away from the shutter.
  lock: {
    position: 'absolute',
    right: 0,
    width: LOCK_SIZE,
    height: LOCK_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: SIZE - STROKE * 4,
    height: SIZE - STROKE * 4,
    borderRadius: radius.pill,
    backgroundColor: cinema['text-1'],
  },
  // While recording the core contracts, a pure transform change
  // (DESIGN-LANGUAGE §5), no opacity dimming.
  coreActive: {
    transform: [{ scale: 0.72 }],
    backgroundColor: palette.accent,
  },
  // Round means "recording", square means "ends the recording": the
  // familiar stop sign. It's the only feedback that carries the locked
  // state, since the lock pill is gone by then. Radius 12 from §3, no
  // in-between value.
  coreLocked: {
    transform: [{ scale: 0.56 }],
    borderRadius: radius.control,
  },
});
