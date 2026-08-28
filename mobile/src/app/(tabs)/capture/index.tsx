import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  useWindowDimensions,
  Easing,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { BlurView } from 'expo-blur';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type PictureRef,
} from 'expo-camera';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { ChevronDown, Images, SwitchCamera, Vibrate, VibrateOff, Zap, ZapOff } from 'lucide-react-native';
import { ShutterButton } from '@/components/ShutterButton';
import { MomentSubmissionAnimation } from '@/components/MomentSubmissionAnimation';
import { ImportIntroSheet } from '@/components/ImportIntroSheet';
import { ImportConfirmSheet } from '@/components/ImportConfirmSheet';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { PressScale } from '@/components/PressScale';
import { ZoomSelector } from '@/components/ZoomSelector';
import * as nativeCapture from '@/features/camera/nativeCapture';
import * as nativeZoom from '@/features/camera/nativeZoom';
import * as multiCamera from '@/features/camera/multiCamera';
import { TripPickerScreen } from '@/features/camera/TripPickerScreen';
import {
  clamp,
  fingerDistance,
  multiCamTarget,
  nativeFactor,
  zoomDevice,
  dragFactor,
  type Lens,
} from '@/features/camera/zoom';
import { cinema, motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchTrips } from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';
import type { CachedTrip } from '@/features/trips/tripsCache';
import { formatDay, groupTrips, todaysCalendarDay } from '@/features/trips/tripDay';
import { ownMomentCount } from '@/features/moments/counter';
import {
  assess,
  refusalSummary,
  type AcceptedMedia,
  type PickedMedia,
  type RefusalReason,
} from '@/features/moments/libraryImport';
import { pickFromLibrary, SELECTION_LIMIT, type PickResult } from '@/features/moments/libraryPicker';
import {
  discardRefused,
  submitImports,
  type ImportOutcome,
} from '@/features/moments/libraryImportSubmit';
import { useAuth } from '@/features/auth/AuthProvider';
import * as handoff from '@/features/camera/handoff';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';
import * as warmup from '@/features/camera/warmup';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Maximum duration of a video, the same number goes to the shutter AND to
// CameraView.recordAsync. Originally 30 (product concept: Snapchat pattern),
// since 2026-08-14 at 90 by user decision: the story measure was too tight in
// everyday travel. The ring on the shutter still fills over the full duration
// and then stops the capture by itself.
const MAX_VIDEO_SECONDS = 90;

// How long the video stop waits for the pre-warmed preview player at most
// before it navigates anyway. A local video is usually ready to play after
// ~100-250 ms; the deadline only catches the outlier, so that a sluggish load
// never holds up the navigation.
const PLAYER_LEAD_MS = 400;

// How long the stop waits for the poster (frame 0 of the video) at most. It is
// created in parallel with the player lead time and, in the preview, bridges
// the ~0.8 s the VideoView needs on device to draw for the first time
// (measured 2026-08-14). Without a poster it navigates anyway: the surface
// then stays dark briefly, the old state as a fallback.
const POSTER_DEADLINE_MS = 300;

// Frame 0 of the capture as a poster, or null on failure or dawdling.
// getThumbnailAsync occasionally returns an object without a uri for
// immediately stopped mini videos (known finding), hence the check instead of
// trust.
function createPoster(uri: string): Promise<string | null> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(null), POSTER_DEADLINE_MS);
    getThumbnailAsync(uri, { time: 0 })
      .then((image) => image?.uri ?? null)
      .catch(() => null)
      .then((poster) => {
        clearTimeout(deadline);
        resolve(poster);
      });
  });
}

function playerReady(player: VideoPlayer): Promise<void> {
  return new Promise((resolve) => {
    if (player.status === 'readyToPlay' || player.status === 'error') {
      resolve();
      return;
    }
    let subscription: { remove(): void } | null = null;
    const done = () => {
      clearTimeout(deadline);
      subscription?.remove();
      resolve();
    };
    const deadline = setTimeout(done, PLAYER_LEAD_MS);
    subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' || status === 'error') done();
    });
  });
}

// How long the message stays after a failed capture. Long enough to read,
// short enough not to become wallpaper that covers the viewfinder. Outside the
// motion scale (§5), because that one measures transitions, not reading
// times.
const ERROR_MS = 4000;

// A single capture error is one short sentence; ERROR_MS alone covers that.
// The pill also carries the library import's batch-failure summary: the
// pre-submission refusals are already explained in the confirmation sheet,
// so what lands here only lists what failed while sending, one reason
// repeated, hence short in practice. 50 ms per character is a comfortable
// reading pace regardless, and the ceiling keeps even a long text from
// parking the pill over the viewfinder indefinitely, should either text
// ever grow past a single short sentence.
const ERROR_MS_PER_CHARACTER = 50;
const ERROR_MAX_MS = 12_000;

// On the simulator every video capture fails (there is no camera there), on
// device a call can come in or the storage can be full. Without this message
// you tap stop and face a screen that says nothing (DESIGN-LANGUAGE §6: errors
// explain cause and remedy).
const ERROR_TEXT = 'Das Video hat nicht geklappt. Versuch es nochmal.';

// The photo counterpart: if takePictureAsync fails (always on the simulator,
// on device with full storage or a revoked permission), you stay in the
// viewfinder and the pill says so (DESIGN-LANGUAGE §6).
const PHOTO_ERROR_TEXT = 'Das Foto hat nicht geklappt. Versuch es nochmal.';

// The library picker itself failed (not a refusal by our rules): iOS could
// not present it, or the copy of a selected asset broke off.
const IMPORT_PICKER_ERROR_TEXT = 'Deine Fotos liessen sich nicht öffnen. Probier es nochmal.';
// Same wording as the preview's WITHOUT_SESSION_MESSAGE: the job carries
// the author id, and without a session there is none to carry.
const IMPORT_WITHOUT_SESSION_TEXT = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';

// How often the start of a video capture is retried, and how long is waited in
// between.
//
// Since the camera runs permanently in video mode (spec 2026-08-13 §3), the
// session has long been built by the time the hold is pressed, and the first
// attempt hits. The loop remains as a safety net: a tab switch or an
// interruption (a call) can keep the session busy exactly when the start
// attempt hits it, and there is no "session ready" event (onCameraReady fires
// exactly once at session start, not afterwards).
const VIDEO_START_ATTEMPTS = 10;
const VIDEO_START_WAIT_MS = 100;

// Safety deadline of the switch fade: if the device event fails to appear
// (simulator without a second camera), it clears itself away again instead of
// standing over the viewfinder forever. Generous over the measured ~350-650 ms
// rebuild durations.
const SWITCH_FADE_DEADLINE_MS = 1500;

// 300 ms is iOS' own measure for a double tap. Outside the motion scale (§5),
// and rightly so: that one measures transitions, not the patience of a
// gesture.
const DOUBLE_TAP_MS = 300;

// How far a finger may travel before a tap turns into a swipe, and how far
// apart the two taps may lie. 24 from the 4-pt grid (§3).
const TAP_RADIUS = 24;

// The distances of the drag zoom (spec 2026-08-13 §7). Upwards, a fixed share
// of the window height covers the way from the start factor to the maximum: a
// share instead of points, so that an iPhone SE and a Pro Max feel the same.
// Downwards only a short remaining distance to the edge is left from the
// shutter (which sits almost at the bottom), and it leads back to the minimum.
// Both are fine-tuning candidates for the device test.
const DRAG_DISTANCE_UP_RATIO = 0.4;
const DRAG_DISTANCE_DOWN = 96;

// Diameter of the shutter (components/ShutterButton.tsx). Everything lying on
// top of it computes from this number.
const SHUTTER_SIZE = 76;

// How far above the bottom edge the shutter sits, and with it the whole lower
// set of controls: the zoom row and the error message stack above it. Dropped
// from 48 to 16 in two steps, both times after a look at the device: the
// controls stood too far into the image. Below it the tab bar begins (49 + 8 +
// device inset), so it cannot go much lower.
const SHUTTER_BOTTOM = spacing.base;

// How tightly the zoom row sits above the shutter.
const ZOOM_DISTANCE = spacing.s;

// Height of the zoom row: 24 for the step plus twice 4 of the pill's inner
// spacing (components/ZoomSelector.tsx).
const ZOOM_ROW_HEIGHT = 24 + 2 * spacing.xs;

// Where the error message stands: above the shutter, and above the zoom row if
// the device has one. Without this shift the two would lie on top of each
// other, because the message appears right after a capture, i.e. exactly when
// the row is back in the image.
function errorBottom(withZoomRow: boolean): number {
  const aboveShutter = SHUTTER_BOTTOM + SHUTTER_SIZE + spacing.l;
  return withZoomRow ? aboveShutter + ZOOM_ROW_HEIGHT + spacing.m : aboveShutter;
}

function momentsText(count: number): string {
  return `${count} ${count === 1 ? 'Moment' : 'Momente'}`;
}

// Name and counter in the head pill, stacked; shared by the switcher (with
// chevron) and the plain label (without).
function HeaderTripTexts({ name, count }: { name: string; count: number }) {
  return (
    <View style={styles.headerTexts}>
      {/* numberOfLines: a single long word (trip names are free text) would
          otherwise overflow the shrunken pill instead of being truncated. */}
      <Text numberOfLines={1} style={[type.bodyMedium, { color: cinema['text-1'] }]}>
        {name}
      </Text>
      <Text style={[type.secondary, { color: cinema['text-2'] }]}>{momentsText(count)}</Text>
    </View>
  );
}

// Whether there is an ultra-wide among these lenses: as a lens of its own or
// as a component of a virtual device. multiCamTarget decides on that whether
// 0.5x is a lens of its own or merely clamps at 1x. A free function, because
// the camera switch needs it for the NEW facing before React has replaced the
// derived values of the old one.
function hasUltraWideIn(lenses: Lens[]): boolean {
  return lenses.some((l) => l.type === 'ultraWide' || l.components.includes('ultraWide'));
}

// Cinema applies in this tab ONLY to the viewfinder (DESIGN-LANGUAGE v2 §1:
// the fixed cinema palette belongs to the media screens, and where no image
// stands there is no medium). Every state that shows only text instead of the
// camera is an ordinary everyday screen and lies on a light ground, like the
// trip, recap and profile tabs. Until now all four lay in the dark hall
// although a photo never appeared in them.
//
// The waiting state is light too: in the majority of cases it leads straight
// into the viewfinder, and that very transition is meant to be staged per the
// guiding idea ("the lights go out"), not to vanish because it was already
// dark beforehand.
function EmptyScreen() {
  return <View style={styles.light} />;
}

// Spec §4 demands both verbatim: "switch camera and flash as translucent
// pills". §10 excludes only the trip switcher, and "flash" appeared nowhere in
// the plan (final review, important 7). For a shared travel diary, no front
// camera means no group pictures.
// The stabilization pill joined later (spec 2026-08-20), MultiCam branch
// only.
//
// Translucent pill per DESIGN-LANGUAGE §1/§4: `overlay-pill` + blur (task 10,
// phase 6, see components/Pill.tsx), radius 999. Icons: Lucide, outline,
// stroke 1.75 (§4).
function PillButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Pill style={styles.controlPill}>{children}</Pill>
    </PressScale>
  );
}

function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <View style={[styles.light, styles.center]}>
      <Text style={[type.h2, styles.title]}>Das hat nicht geklappt</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>{error}</Text>
      <View style={{ marginTop: spacing.xl }}>
        <Button variant="primary" label="Nochmal versuchen" onPress={onRetry} />
      </View>
    </View>
  );
}

// Size of the focus ring: between a control button (44) and the shutter (76),
// on the 4-pt grid (§3). Big enough to stand out as an answer, small enough
// not to obstruct the subject.
const FOCUS_RING_SIZE = 72;

// How long the ring stands after appearing. Outside the motion scale (§5),
// which measures transitions: this is a standing time, the way ERROR_MS is a
// reading time.
const FOCUS_RING_HOLD_MS = 600;

// The visible answer to the focus tap (camera-app pattern): the ring appears
// slightly too big at the point, settles onto its size, stands briefly and
// goes by itself. Only transform and opacity are animated (§5), both through
// useNativeDriver; `fast` for appearing and going: this is micro feedback, not
// a transition.
function FocusRing({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const reducedMotion = useReducedMotion();
  // Both via useState instead of useRef: read during render (interpolate),
  // same pattern as FloatingFlightTicket below.
  const [entrance] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const duration = reducedMotion ? 0 : motion.duration.fast;
    const easing = Easing.bezier(...motion.easeSmooth);
    const run = Animated.sequence([
      Animated.parallel([
        Animated.timing(entrance, { toValue: 1, duration, easing, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration, easing, useNativeDriver: true }),
      ]),
      Animated.delay(FOCUS_RING_HOLD_MS),
      Animated.timing(opacity, { toValue: 0, duration, easing, useNativeDriver: true }),
    ]);
    // Only a COMPLETED run cleans up: an interruption means a new ring (new
    // key) has taken over, and its run then cleans up for both.
    run.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => run.stop();
  }, [entrance, opacity, onDone, reducedMotion]);

  const scale = entrance.interpolate({ inputRange: [0, 1], outputRange: [1.4, 1] });
  return (
    <Animated.View
      testID="focus-ring"
      pointerEvents="none"
      accessible={false}
      style={[
        styles.focusRing,
        {
          left: x - FOCUS_RING_SIZE / 2,
          top: y - FOCUS_RING_SIZE / 2,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

// Lies over the inevitably frozen viewfinder during the camera-switch rebuild
// (FaceTime pattern): the blur turns the still frame into a deliberate fade
// instead of a hang (user finding 2026-08-18). It only fades IN (opacity, §5);
// its end is the first live frame of the new camera, which replaces it without
// a successor, and fading out would veil exactly that frame again.
function SwitchFade() {
  const reducedMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const run = Animated.timing(opacity, {
      toValue: 1,
      duration: reducedMotion ? 0 : motion.duration.fast,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [opacity, reducedMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[StyleSheet.absoluteFill, { opacity }]}
    >
      <BlurView testID="switch-blur" intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

// Travel of the float. 12 from the 4-pt grid (§3), big enough for the movement
// to carry, small enough not to nudge the text below it.
const FLOAT_LIFT = 12;

// Width of the image, at the same time its upper bound (see styles.ticketSurface).
const TICKET_WIDTH = 288;

// A duration outside the token scale, and deliberately so: the scale (§5)
// measures TRANSITIONS, i.e. how long something takes to become something
// else. `gentle` (400) is enough for the skeleton pulse, a float at that pace
// would be fidgeting, and `feature` (800) is reserved for stagings per §5.
// 2400 ms per direction is barely five seconds per round: movement you notice
// when you look, and that leaves you alone otherwise.
const FLOAT_MS = 2400;

// Cut out and floating (wish): the ticket rises and sinks.
//
// Without a shadow, deliberately so for now. Three attempts failed at the same
// point: the ticket lies tilted in the PNG (4 degrees, measured at its bottom
// edge) and ends at 84 % of the image height, so every drawn shape below it
// has to hit both by hand. Whoever adds one starts here.
//
// Only `transform` and `opacity` are animated (§5), so both run through
// `useNativeDriver`.
function FloatingFlightTicket() {
  const reducedMotion = useReducedMotion();
  // 0 = down (rest position), 1 = up. `useState` instead of `useRef`, because
  // the value is read during render (interpolate) and a ref has no business
  // there.
  const [hover] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      hover.setValue(0);
      return;
    }
    // A symmetric ease-in-out instead of `easeSmooth`: that one is an ease-OUT
    // and shoots off at every turning point, which shows as a jolt in a back
    // and forth. Floating is a sine movement, equally slow at both ends.
    // `linear` stays forbidden in any case (§7).
    const easing = Easing.inOut(Easing.ease);
    const cycle = Animated.loop(
      Animated.sequence([
        Animated.timing(hover, { toValue: 1, duration: FLOAT_MS, easing, useNativeDriver: true }),
        Animated.timing(hover, { toValue: 0, duration: FLOAT_MS, easing, useNativeDriver: true }),
      ])
    );
    cycle.start();
    return () => cycle.stop();
  }, [reducedMotion, hover]);

  const lift = hover.interpolate({ inputRange: [0, 1], outputRange: [0, -FLOAT_LIFT] });

  return (
    <View style={styles.ticketStage}>
      <Animated.View style={[styles.ticketSurface, { transform: [{ translateY: lift }] }]}>
        <Image
          testID="empty-state-flight-ticket"
          source={require('@/assets/images/flugticket-transparent.png')}
          style={styles.flightTicket}
          contentFit="contain"
          // Says nothing the text below it does not already say.
          accessible={false}
        />
      </Animated.View>
    </View>
  );
}

// `nextTrip`: the soonest planned trip, if any. A planned trip is `active`
// but not running (groupTrips), so the camera stays shut; the text then
// names the day it opens instead of asking for a first trip.
function NoTripScreen({ nextTrip, onCreate }: { nextTrip: CachedTrip | null; onCreate: () => void }) {
  return (
    <View style={[styles.light, styles.center]}>
      {/* The third empty state with an image of its own, after the camper
          (trip tab) and the film reel (recap tab): the image only stands where
          nothing else does. */}
      <FloatingFlightTicket />
      <Text style={[type.h2, styles.title]}>Keine laufende Reise</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>
        {nextTrip
          ? `«${nextTrip.name}» beginnt am ${formatDay(nextTrip.start_date)}. Sobald sie läuft, fängt hier deine Kamera an.`
          : 'Leg deine erste Reise an oder tritt einer per Einladungslink bei. Sobald sie läuft, fängt hier deine Kamera an.'}
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        <Button variant="primary" label="Neue Reise anlegen" onPress={onCreate} />
      </View>
    </View>
  );
}

function PermissionScreen() {
  return (
    <View style={[styles.light, styles.center]}>
      <Text style={[type.h2, styles.title]}>Kamera-Zugriff fehlt</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>
        Reelive braucht Zugriff auf Kamera und Mikrofon, um Momente aufzunehmen. Erlaube das in
        den Systemeinstellungen.
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        <Button
          variant="primary"
          label="Einstellungen öffnen"
          onPress={() => void Linking.openSettings()}
        />
      </View>
    </View>
  );
}

export default function CaptureScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [trips, setTrips] = useState<CachedTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  // The trip switcher from the product concept ("discreet at the top: active
  // trip name, switchable when several trips are running"). Without this state
  // the picker screen was a one-way street: chosen once, there was no way
  // back, and with exactly one running trip it was never reachable, because
  // the trip was hard-wired.
  const [pickerOpen, setPickerOpen] = useState(false);
  // The camera runs PERMANENTLY in video mode (spec 2026-08-13 §3): switching
  // the mode prop rebuilt the native session (preset + outputs, setCameraMode
  // on the sessionQueue) and cost the video start up to ~1 s. Photos are taken
  // by the photo output of the same session: it stays attached in video mode,
  // then delivers 16:9 at 1920x1080, and the pipeline scales to a 1080 px long
  // edge anyway (media.ts). `capturing` replaces the earlier question
  // `mode === 'video'`: is a capture running right now?
  const [capturing, setCapturing] = useState(false);
  // Whether this tab currently has focus: `mute` hangs off it. The microphone
  // belongs permanently to the running video session (otherwise the beginning
  // of the video had no sound), but ONLY while the viewfinder is visible: the
  // tab screens stay mounted, and the orange microphone dot must not glow
  // app-wide while you are reading in the trip tab.
  const [focused, setFocused] = useState(true);
  // Whether OUR OWN MultiCam session carries the viewfinder (spec §8/§9). A
  // state, not a derived question: if the session setup fails on device, the
  // screen falls back to expo-camera for the REST of the session, and that
  // fallback has to trigger a render. The initial value comes from the module
  // itself (no module, Android, simulator -> false right away, the CameraView
  // takes over without anything ever having started).
  const [multiCam, setMultiCam] = useState(() => multiCamera.available());
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [stabilization, setStabilization] = useState<'on' | 'off'>('on');
  // Counter catch-up from task 9 (task 10 brief): server state PLUS waiting
  // moments of the same trip (ownMomentCount), instead of freezing at the bare
  // trip.my_post_count, otherwise the pill does not move after an offline
  // capture (spec §7, "must never work backwards"). Stays `null` until the
  // first answer is in; until then the pill shows the last known server state
  // instead of briefly flashing "0 Momente" (see the fallback in the render
  // below).
  const [counter, setCounter] = useState<number | null>(null);
  // The text of the message, or null: since the instant photo there are two
  // sources (photo and video), and the pill shows whatever went wrong last.
  const [captureError, setCaptureError] = useState<string | null>(null);
  // The running library import, or null: how many of the accepted elements
  // have been enqueued so far. While it runs, shutter and header are removed
  // (like during a capture) and the progress pill stands in for them.
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  // A finished import waiting for its success animation: the batch size and
  // the counter value from before the batch, which the animation rolls up
  // from. Back to null once the animation has played.
  const [importDone, setImportDone] = useState<{
    added: number;
    counterBefore: number | null;
  } | null>(null);
  // The refusal summary of the last import, held back until the success
  // animation has played so the two do not stack on top of each other.
  const heldSummary = useRef<string | null>(null);
  // Where the library import stands between the two sheets: the intro
  // (rules, "Fotos auswählen") and the confirmation (what would go in,
  // what stays out). null: no sheet open. The picker itself and the batch
  // live in importRunning/importing, not here.
  const [importStage, setImportStage] = useState<
    | { kind: 'intro' }
    | { kind: 'confirm'; tripId: string; total: number; accepted: AcceptedMedia[]; reasons: RefusalReason[] }
    | null
  >(null);
  // Re-entry guard for pickAndAssess and confirmImport (same pattern as
  // photoRunning above): the ref fences the two native round trips (the
  // picker, the batch) so they can't overlap with themselves or each
  // other, while the sheets themselves (importStage) stay plain state and
  // remain tappable in between. A ref, because the value has to be read
  // synchronously within the same tick, before any state update from the
  // first press has landed.
  const importRunning = useRef(false);
  // The DISPLAYED factor (0.5 / 1 / 4 ...), not the device's. Between the two
  // lies the base, see zoom.ts.
  const [factor, setFactor] = useState(1);
  // Whether the running capture is locked, i.e. the hand is free.
  const [captureLocked, setCaptureLocked] = useState(false);
  // Where the last focus tap sat, or null. `state` counts up and is the ring's
  // key: a new tap replaces the standing ring with a fresh one instead of
  // showing its expiring animation on.
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; state: number } | null>(null);
  // Counted up on every focus, and the counter effect below hangs off it (see
  // there and useFocusEffect).
  const [focusState, setFocusState] = useState(0);
  const cameraRef = useRef<CameraView>(null);
  // Whether a photo cycle is running right now (tap until navigation commit).
  // The shutter stays operable between tap and navigation; a second cycle
  // would overwrite the handoff holder and orphan the first capture (including
  // its background file). A ref, because the value has to be read
  // synchronously within the same tick.
  const photoRunning = useRef(false);
  const videoStartTime = useRef(0);
  const videoPromise = useRef<Promise<{ uri: string } | undefined> | null>(null);
  // The start of the NATIVE pipeline (task 2), remembered as a PROMISE instead
  // of a mere boolean: a lightning-fast stop right after the start must be
  // able to wait for exactly this result, otherwise handleVideoStop still
  // reads the old state and accidentally takes the fallback path while the
  // native capture is actually running (or the other way round). `null` means:
  // no start attempt under way.
  const nativeStart = useRef<Promise<boolean> | null>(null);
  // Whether the NATIVE pipeline carries the running capture (the resolved
  // result of nativeStart, as a ref for the synchronous look of the gestures).
  // The double-tap switch DURING the capture hangs off it: on a facing switch
  // expo-camera swaps only the device input of the same running session, our
  // own pipeline hangs off its outputs and simply keeps recording, whereas a
  // running recordAsync (fallback) would be aborted by that rebuild.
  const nativeRunning = useRef(false);
  // Whether the shutter has been released since this capture started. A ref,
  // because the start loop has to read the value synchronously between two
  // rounds; a state value would still be the old one there.
  const videoStopped = useRef(false);
  // Shields setState after blur/unmount (same pattern as trip/index.tsx).
  const active = useRef(true);
  // Whether the CAPTURE PREVIEW currently lies over the tab (goToPreview sets
  // it, the next focus takes it back). The difference from a real tab switch
  // counts twice (user finding 2026-08-18, "brief still image when
  // discarding"): under the preview the microphone stays attached
  // (re-attaching it on the way back was a session rebuild that froze the
  // viewfinder exactly at the moment of return), and the viewfinder frozen for
  // the photo starts running again UNDER the preview already, so the instant
  // way back shows a live image right away. A state, not a ref: the mute prop
  // hangs off it (refs in the render are taboo), and the blur effect further
  // below gets the current value through its dependency.
  const [inPreview, setInPreview] = useState(false);
  // Whether the camera-switch rebuild is running (switchCamera sets it, the
  // arrival of the new camera takes it back): while it is, a blur fade lies
  // over the inevitably frozen viewfinder (FaceTime pattern). The hardware
  // rebuild takes ~350-650 ms, and a bare still frame felt like a hang (user
  // finding 2026-08-18).
  const [switching, setSwitching] = useState(false);
  // The same value as `factor`, only readable synchronously: the re-applying
  // and the pinch gesture need it outside the render, where a state value
  // would still be the old one.
  const factorRef = useRef(1);
  // The display factor last chosen PER FACING (user finding 2026-08-19):
  // whoever films at 0.5x, switches to the front briefly and comes back wants
  // to see their 0.5x again, not 1x. Written and read only on a camera switch
  // (applyFacing), in between factorRef leads.
  const factorPerFacing = useRef<{ back: number; front: number }>({ back: 1, front: 1 });
  // Running number of the camera switches: every native answer carries the
  // number of its trigger, and only the YOUNGEST may reconcile or pull along.
  // Without it, the late answer of an overtaken switch rolled into a state
  // that had long belonged to the next one (re-review 2026-08-19, minor 2).
  const switchSeq = useRef(0);
  // The same values as `capturing` and `inPreview`, likewise only readable
  // synchronously: the blur cleanup of the MultiCam lifecycle (see below) has
  // to know their state at the moment of the blur, but must not HANG on them:
  // as dependencies, every single capture stopped and restarted the session.
  const capturingRef = useRef(false);
  const inPreviewRef = useRef(false);
  // What held when the two fingers landed. Everything further is relative to
  // it, which is why it is cleared again on release.
  const pinchStart = useRef<{
    distance: number;
    factor: number;
    limits: { min: number; max: number };
  } | null>(null);
  // What held at the start of the capture: the drag zoom computes relative to
  // it, as the pinch does relative to its landing. `pull` is the travel the
  // shutter had already reported when the anchor was set: the drag counts from
  // there on, not from the touch-down. Without it a camera switch in the middle
  // of the drag pushed the OLD travel onto the new anchor, and the fresh
  // direction stood zoomed in although nobody had pulled for it (user finding
  // 2026-08-21).
  const dragStart = useRef<{
    factor: number;
    limits: { min: number; max: number };
    pull: number;
  } | null>(null);
  // The travel the shutter last reported. The switch needs it to re-anchor
  // mid-drag; it is not state, nothing renders from it.
  const dragPull = useRef(0);
  // Where the finger landed, and when the last tap was: the double tap comes
  // out of those two (see zoomGesture below).
  const tapStart = useRef<{ pageX: number; pageY: number } | null>(null);
  const lastTap = useRef<{ time: number; pageX: number; pageY: number } | null>(null);
  // The RAW tap during a held capture (see onTouchStart of the zoom surface):
  // identifier and landing point of the second finger.
  const rawTap = useRef<{ id: number | string; pageX: number; pageY: number } | null>(null);

  // Computed before the early returns (rules of hooks: the effect below needs
  // `trip?.id` as a dependency, and hooks must not sit behind a conditional
  // return). `trips` can still be `null` here (not loaded yet), then
  // `running` stays empty and `trip` `null`, which the effect below and the
  // later returns already catch.
  //
  // Only RUNNING trips (spec 2026-08-27 "Reisewahl"): `active` is the
  // lifecycle status and also covers trips that have not started yet
  // (groupTrips, the trip tab's split). A planned trip is no place for a
  // moment, and it must not push the picker in front of the camera every
  // time one is created.
  const today = todaysCalendarDay();
  const { running, planned } = groupTrips(trips ?? [], today);
  // With one running trip the choice is made; with several it is the
  // remembered one, or nobody's yet.
  const currentTripId =
    running.length === 1 ? running[0].id : (running.find((t) => t.id === selectedTripId)?.id ?? null);
  // `pickerOpen` beats everything: whoever taps the trip name wants to see the
  // picker; the current trip then only tells it which row to mark.
  const trip = pickerOpen ? null : (running.find((t) => t.id === currentTripId) ?? null);

  // The core of this phase's offline promise (final review, critical 1):
  // "capturing works fully offline", but the viewfinder only appears once a
  // running trip is known. Without a local stock, fetchTrips() returned
  // `{ data: [], error: OFFLINE_HINT }` in airplane mode, and instead of
  // viewfinder and shutter an error page stood here: queue, compression,
  // worker and sealing all correct, and all unreachable.
  //
  // Hence: every successful fetch writes the stock forward, a failed one falls
  // back on it. The error page remains only for the case that there is nothing
  // cached either (`null`, i.e. never loaded successfully). A cached EMPTY
  // stock is a statement instead, "you last had no trip", and deliberately
  // leads to NoTripScreen rather than to the error page.
  //
  // Puts the last known counter in for every trip. The source for that is the
  // cached stock itself, it carries the counter anyway, and unlike the
  // separate counter store (which only ownMomentCount maintains, i.e. only for
  // the CHOSEN trip) it also covers the picking step, where no trip is chosen
  // yet. Where there is no remembered state, the delivered value stays: a 0
  // that can then really only mean "nothing submitted yet".
  const withRememberedCounts = useCallback(
    async (list: CachedTrip[]): Promise<CachedTrip[]> => {
      const remembered = await tripsCache.rememberedTrips(userId);
      if (remembered === null) return list;
      const state = new Map(remembered.map((t) => [t.id, t.my_post_count]));
      return list.map((t) => ({ ...t, my_post_count: state.get(t.id) ?? t.my_post_count }));
    },
    [userId]
  );

  const load = useCallback(async () => {
    const { data, error: fetchError, countsError } = await fetchTrips();
    if (!fetchError) {
      // Re-review, minor 2: if the trips succeed and only the counter rpc
      // fails, every trip carries `my_post_count: 0`. The header pill catches
      // that via ownMomentCount, but the picker screen with several running
      // trips does not, and the zeros went into the cached stock as well. So:
      // a failed counter fetch falls back on the last known state, exactly as
      // in counter.ts. The same class as important 6, one level further.
      const list = countsError ? await withRememberedCounts(data) : data;
      // The cache is written before the active guard: the stock should be
      // brought up to date even if the screen has been left in the meantime.
      await tripsCache.rememberTrips(userId, list);
      if (!active.current) return;
      setTrips(list);
      setError(null);
      return;
    }
    const remembered = await tripsCache.rememberedTrips(userId);
    if (!active.current) return;
    if (remembered !== null) {
      setTrips(remembered);
      setError(null);
      return;
    }
    setTrips([]);
    setError(fetchError);
  }, [userId, withRememberedCounts]);

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      setFocused(true);
      // The capture flow is over (back from the preview), or there never was
      // one (a normal focus).
      setInPreview(false);
      // Return from the preview: the viewfinder was frozen for the photo or
      // the video stop (pausePreview) and now runs on. On the very first focus
      // the camera is not mounted yet, so optional chaining makes the call a
      // no-op then. (These days the normal case is that the blur cleanup below
      // has already started it under the preview, and then this is a no-op
      // too.)
      void cameraRef.current?.resumePreview();
      // Counts every focus up. The counter effect below hangs off this
      // (important 3): until the fix wave it only worked correctly because
      // preview.tsx created a new camera screen on EVERY capture via replace,
      // so its effect necessarily ran anew. Take that stack bug away without
      // hanging the fetch on focusing, and the counter freezes for the whole
      // session: exactly the regression task 10 existed for. The two belong
      // together.
      setFocusState((n) => n + 1);
      void load();
      return () => {
        active.current = false;
        setFocused(false);
        // Safety net: if the screen leaves the stage while the lock is set
        // (deep link, unmount, since by tab it is no longer possible), the tab
        // bar must not stay dead app-wide. The regular exits release it
        // themselves (handlePhoto/handleVideoStop); this catches the rest.
        captureLock.lock(false);
      };
    }, [load])
  );

  // Media screens switch the StatusBar locally (DESIGN-LANGUAGE v2 §1). A
  // mounted <StatusBar style="light" /> would not be enough, because tab
  // screens stay mounted; hence switch depending on focus and reset to 'dark'
  // on leaving (the global default in _layout.tsx).
  //
  // Since only the viewfinder is dark, the style hangs off the state instead
  // of the tab: light icons on a white ground would simply be invisible.
  // `showsViewfinder` deliberately sits up here with the hooks, and its
  // condition mirrors exactly the chain of early returns below: no state
  // before it reaches the camera.
  const showsViewfinder =
    trips !== null &&
    !error &&
    trip !== null &&
    cameraPermission?.granted === true &&
    micPermission?.granted === true;
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(showsViewfinder ? 'light' : 'dark');
      // The same condition reports the cinema stage to the tab navigator: over
      // the viewfinder the bar lies translucently ON the image, so that
      // viewfinder and preview show the same surface (cinemaStage.ts, device
      // finding 2026-08-18 "more cropped than before I shoot").
      cinemaStage.set(showsViewfinder);
      // On blur the flag deliberately STAYS: blur also fires when only the
      // preview covers the tab, and taking it back here would drop the bar
      // invisibly into its light shape and make it jump visibly in the first
      // frame of the instant way back (user finding 2026-08-18). On OTHER tabs
      // the normal bar applies anyway; _layout.tsx decides that from the tab
      // choice (route.name), not from the flag.
      return () => setStatusBarStyle('dark');
    }, [showsViewfinder])
  );

  // Safety net: if the screen leaves the stage entirely (unmount, deep link),
  // the viewfinder flag must not stay set.
  useEffect(() => () => cinemaStage.set(false), []);

  // If the preview covers the tab, let the viewfinder frozen for the photo
  // start running again right NOW (invisibly, it lies underneath): the instant
  // way back then shows a live image immediately instead of the still from the
  // moment of release (user finding 2026-08-18). An effect of its own with
  // inPreview as its dependency: that way the cleanup sees the CURRENT value
  // on blur; in the big focus effect above (dependency only load) it would be
  // a stale closure.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (inPreview) void cameraRef.current?.resumePreview();
      };
    }, [inPreview])
  );

  // Keeps the two mirror refs up to date (see there). An effect of its own
  // instead of an assignment during render: writing refs during render is not
  // reliable under concurrent rendering.
  useEffect(() => {
    capturingRef.current = capturing;
    inPreviewRef.current = inPreview;
  }, [capturing, inPreview]);

  // The lifecycle of the MultiCam session (spec §8/§9). Two things hang off
  // it:
  //
  // The session is built up as soon as the screen is WANTED. That is more
  // than focus ever since the tabs can be swiped: the pager reports how far
  // the finger has dragged, and the warm-up flag goes up in the first tenth
  // of the way (features/camera/warmup.ts). Building up on focus alone would
  // drag a black surface through the whole gesture, since the session needs a
  // moment to come up. `multiCamera.start` is latched against being asked
  // twice, so warm-up and focus may both want it without the second call
  // counting as a failed build-up.
  //
  // If it reports `false` (no module, old build, simulator, or a setup that
  // failed twice in a row), the screen falls back to expo-camera for the REST
  // of the session: `multiCam` then stays false, this effect runs into
  // nothing and the CameraView takes over. The active ref shields the answer
  // that only arrives after leaving the screen (same pattern as in load
  // above).
  //
  // It is stopped ONLY if nothing rests on the session any more, following
  // exactly the conditions of the mute prop in the other branch: under the
  // CAPTURE PREVIEW it keeps running (a rebuild would be the most expensive
  // moment of all on the instant way back), and nobody reaches into a running
  // capture anyway.
  //
  // ONE derived boolean, deliberately not two dependencies: while a swipe
  // finishes, `warm` and `focused` hand over to each other, and depending on
  // both would tear the session down and build it right back up in exactly
  // that moment.
  const warm = useSyncExternalStore(warmup.subscribe, warmup.get);
  const sessionWanted = focused || warm;
  useEffect(() => {
    if (!multiCam || !sessionWanted) return;
    void multiCamera.start().then((ok) => {
      if (!ok && active.current) setMultiCam(false);
    });
    return () => {
      if (!capturingRef.current && !inPreviewRef.current) multiCamera.stop();
    };
  }, [multiCam, sessionWanted]);

  // The torch in the MultiCam branch. In the other branch a prop does this
  // (`enableTorch={flash === 'on' && capturing}` on the CameraView); our own
  // session knows no props, it gets the same switch as a call.
  //
  // `facing` hangs in the dependencies although the expression does not read
  // it: the LED sits on the back, so a switch to the front during a capture
  // has to extinguish it (and the way back light it again). The cleanup
  // switches off, because an unmount or a fallback to expo-camera would
  // otherwise leave a burning lamp behind, but only if it was burning at all,
  // otherwise every change would be a short flicker.
  useEffect(() => {
    if (!multiCam) return;
    const on = flash === 'on' && capturing;
    multiCamera.setFlash(on);
    return () => {
      if (on) multiCamera.setFlash(false);
    };
  }, [multiCam, flash, capturing, facing]);

  // Unlike the torch, the stabilization wish holds for the whole stream
  // (the photo grab inherits the stabilized frame), not only while
  // recording. The native default is on; this effect carries the toggle
  // and repeats the current wish on mount, which is idempotent.
  useEffect(() => {
    if (!multiCam) return;
    multiCamera.setStabilization(stabilization === 'on');
  }, [multiCam, stabilization]);

  // Once the bar lies over the image, it no longer takes room away from the
  // screen, so the bottom-anchored controls (shutter, zoom row, error pill)
  // lift by its height, otherwise they would sit behind it. The same formula
  // as in _layout.tsx (cinemaStage.barHeight), so the two sides cannot drift
  // apart.
  const insets = useSafeAreaInsets();
  const barHeight = cinemaStage.barHeight(insets.bottom);

  // The picture's own frame (cinemaStage.pictureHeight): it hangs at the top
  // edge of the bar and stands as tall as the capture is, so the viewfinder
  // shows the WHOLE recording instead of a filled, 18 % narrower cut-out.
  // What is left over gathers above the picture, where it merges with the
  // status bar.
  const window = useWindowDimensions();
  const pictureHeight = cinemaStage.pictureHeight(window.width, window.height, insets.bottom);
  const stageTop = window.height - barHeight - pictureHeight;

  // Sits with the hooks, because the early returns below lie in between. What
  // lies on top of the viewfinder respects the same top edge as every other
  // screen: edge-to-edge is the camera image, not the pill on top of it.
  // ...and never above the picture's top edge: up there is the black stage,
  // and the pill used to stick to its lower edge (user finding 2026-08-21).
  const viewfinderTopInset = Math.max(useTopInset(spacing.xl), stageTop + spacing.m);

  // --- Zoom (spec 2026-08-12-kamera-zoom-design.md) ---
  //
  // The steps come from the device, not from a hand-maintained table: a
  // virtual multi-lens camera knows the factors at which iOS switches lenses,
  // and those are exactly the steps of the camera app (see zoom.ts). Every
  // facing has its own lenses, and the front camera usually only one. Derived
  // instead of stored in an effect: listing the cameras is a query without
  // side effects, and a state beside it would be a second truth. The factor is
  // reset where the facing changes (see "switch camera"), not here.
  const lenses = useMemo(() => nativeZoom.lenses(facing), [facing]);
  const zoom = useMemo(() => zoomDevice(lenses), [lenses]);

  // Whether this facing has an ultra-wide. The MultiCam session decides on
  // that whether 0.5x is a lens of its own or only a crop (see multiCamTarget
  // in zoom.ts). The source is the same ENUMERATED lenses the steps come from:
  // enumerating the virtual device is still allowed, it just must not run in
  // the session.
  const hasUltraWide = useMemo(() => hasUltraWideIn(lenses), [lenses]);

  // The base of the active facing: 0.5 on an ultra-wide device, otherwise 1;
  // also for the single-lens front, whose display and device factor are the
  // same (it has no virtual multi-lens device, `zoom` is null).
  const zoomBase = zoom?.base ?? 1;

  const applyZoom = useCallback(
    (next: number, smooth: boolean) => {
      // Only the SETTING path differs: steps, limits, pinch and drag compute
      // the same display value in both branches. The MultiCam session,
      // however, knows no virtual multi-lens camera, it carries the lenses
      // individually, so the display factor is translated into a lens plus its
      // own factor. It does not need a step device for that: the single-lens
      // front zooms digitally (user finding 2026-08-19), multiCamTarget clamps
      // below 1x itself, and the module clamps at the device limits.
      if (multiCam) {
        factorRef.current = next;
        setFactor(next);
        multiCamera.setZoom(multiCamTarget(next, facing, hasUltraWide), smooth);
        return;
      }
      if (!zoom) return;
      factorRef.current = next;
      setFactor(next);
      nativeZoom.setZoom(zoom.name, nativeFactor(next, zoom.base), smooth);
    },
    [zoom, multiCam, facing, hasUltraWide]
  );

  // The emergency exit of the MultiCam session (spec §9): two lenses heating
  // at once, and the operating system reports pressure before it steps in
  // itself. The expensive part is the second sensor below 1x, so from 'ernst'
  // on the zoom goes back to 1x, where one lens alone is enough. At 'nominal'
  // nothing happens: whoever wants back to 0.5x taps it themselves.
  useFocusEffect(
    useCallback(() => {
      if (!multiCam) return;
      return multiCamera.onPressureChange((level) => {
        if (level === 'nominal') return;
        if (factorRef.current < 1) applyZoom(1, false);
      });
    }, [multiCam, applyZoom])
  );

  // On entering the screen a ZOOMED-IN state (> 1x) jumps back to 1x (wish
  // 2026-08-17): a pinch or drag zoom left standing must not reach unnoticed
  // into the next capture. The wide angle (<= 1x) stays (clarification
  // 2026-08-18): whoever deliberately set 0.5x wants to carry on right there
  // after discarding. Through applyZoom, so that the device goes back too, not
  // just the pill.
  //
  // applyZoom comes in through a ref instead of as a dependency: its identity
  // changes with the facing, and an effect hanging off it would run on EVERY
  // camera switch and throw away the factor just restored from the per-facing
  // memory. In the middle of a held capture the drag zoom jumped back to 1x on
  // every switch back that way (re-review 2026-08-19, important 1). The memory
  // is clamped along on entry: the facing that is NOT visible right now must
  // not carry an old zoom-in into the next capture either.
  const applyZoomRef = useRef(applyZoom);
  useEffect(() => {
    applyZoomRef.current = applyZoom;
  }, [applyZoom]);
  useFocusEffect(
    useCallback(() => {
      factorPerFacing.current.back = Math.min(factorPerFacing.current.back, 1);
      factorPerFacing.current.front = Math.min(factorPerFacing.current.front, 1);
      if (factorRef.current > 1) applyZoomRef.current(1, false);
    }, [])
  );

  // The pitfall of this function: on the virtual device the native factor 1.0
  // IS the widest lens, i.e. 0.5x. And expo-camera sets exactly that 1.0 on
  // every device switch itself (addDevice -> updateZoom with our zoom prop 0,
  // CameraSessionManager.swift:354). Without re-applying, the viewfinder would
  // begin at 0.5x and jump back there after every camera switch.
  const reapplyZoom = useCallback(() => {
    // In the MultiCam branch there is nothing to re-apply: the virtual device
    // does not run in that session at all, and nobody resets its zoom to 1.0
    // behind our back.
    if (!zoom || multiCam) return;
    nativeZoom.setZoom(zoom.name, nativeFactor(factorRef.current, zoom.base), false);
  }, [zoom, multiCam]);

  // The zoom limits of a facing, in the device's own counting, with the same
  // fallback that only the pinch used to know: if the module knows no limits,
  // the topmost step serves as the maximum. Used by BOTH the pinch and the
  // drag zoom. Parameterized by facing instead of bound to the current state:
  // the camera switch needs the limits of the NEW facing before React has
  // replaced the derived values of the old one. That is exactly what killed
  // the drag zoom after a switch in the middle of a capture (user finding
  // 2026-08-19: front to back lost the anchor entirely, back to front kept the
  // wrong limits).
  //
  // A facing without a virtual multi-lens device (every front) has no limits
  // in the expo-camera branch and therefore no zoom; there the path leads only
  // over the virtual device. The MultiCam session zooms it digitally instead,
  // and its limits come from the lens itself: the real wide lens, not blindly
  // the first of the list (the discovery order is no contract).
  const zoomLimitsFor = (position: 'back' | 'front') => {
    const facingLenses = nativeZoom.lenses(position);
    const device = zoomDevice(facingLenses);
    if (device) {
      return (
        nativeZoom.zoomLimits(device.name) ?? {
          min: 1,
          max: nativeFactor(device.steps[device.steps.length - 1], device.base),
        }
      );
    }
    if (!multiCam) return null;
    const lens = facingLenses.find((l) => l.type === 'wide') ?? facingLenses[0];
    if (!lens) return null;
    return nativeZoom.zoomLimits(lens.name) ?? { min: 1, max: 8 };
  };

  // Runs as soon as the multi-lens camera is known. A switch of the DEVICE
  // reports itself instead, see onAvailableLensesChanged on the CameraView.
  useEffect(() => {
    reapplyZoom();
  }, [reapplyZoom]);

  // A clean tap on the viewfinder: focus and exposure at this point
  // (camera-app pattern, see onResponderRelease of the zoom surface below).
  // The ring is the visible answer to it.
  const focusAt = (point: { pageX: number; pageY: number }) => {
    // Two sessions, two ways to the same device: what gets focused is always
    // the camera that is REALLY running. The ring above it is the same.
    if (multiCam) multiCamera.focus(point.pageX, point.pageY);
    else nativeZoom.focus(point.pageX, point.pageY);
    setFocusPoint((previous) => ({ x: point.pageX, y: point.pageY, state: (previous?.state ?? 0) + 1 }));
  };
  // Stable through useCallback: the ring hangs its animation effect off this,
  // and a new identity on every render would restart the run.
  const focusRingDone = useCallback(() => setFocusPoint(null), []);

  // Clears the message away after a hold time that scales with its length
  // (Final-Review, Important 5): ERROR_MS covers one short sentence, the
  // library import's batch-failure summary or a longer capture error earns
  // extra time up to ERROR_MAX_MS if it ever runs past that. The timer
  // hangs off the state itself, not off the trigger: that way a second
  // failure sets it anew instead of the first clock wiping the second
  // message away.
  useEffect(() => {
    if (!captureError) return;
    const hold = Math.min(ERROR_MAX_MS, Math.max(ERROR_MS, captureError.length * ERROR_MS_PER_CHARACTER));
    const timer = setTimeout(() => setCaptureError(null), hold);
    return () => clearTimeout(timer);
  }, [captureError]);

  // Safety net of the switch fade (see SWITCH_FADE_DEADLINE_MS): in the normal
  // case onAvailableLensesChanged clears it away far earlier.
  useEffect(() => {
    if (!switching) return;
    const deadline = setTimeout(() => setSwitching(false), SWITCH_FADE_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [switching]);


  // Ask for the permissions proactively as soon as the current state is known:
  // camera-first (product concept) means the user should not have to hunt for
  // a button just to be asked at all. Only once a request has actually been
  // denied does PermissionScreen show the way into the system settings.
  useEffect(() => {
    if (cameraPermission?.status === 'undetermined') void requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);
  useEffect(() => {
    if (micPermission?.status === 'undetermined') void requestMicPermission();
  }, [micPermission, requestMicPermission]);

  // Pulls the counter along on every trip switch AND on every focus
  // (`focusState`, important 3); without `trip` there is nothing to count.
  // This is exactly where the return from the preview lands: the moment is
  // then freshly in the queue, and the pill has to count it. ownMomentCount
  // can reject (broken local queue, see queueDb.ts), and without .catch() that
  // would stay an unhandled rejection; the fallback to trip.my_post_count in
  // the render below then simply carries on (fix round 1).
  useEffect(() => {
    if (!trip) return;
    void ownMomentCount(trip.id)
      .then((n) => {
        if (active.current) setCounter(n);
      })
      .catch(() => {});
  }, [trip?.id, focusState]);

  // A confirmation sheet belongs to the trip its elements were assessed
  // against. If the trip changes underneath it (the tab stays swipeable
  // while a sheet is open: the trip can end or be revealed meanwhile and
  // another one takes its place), the sheet must not survive: its copies
  // leave tmp and the stage clears, instead of submitting into a trip the
  // person never confirmed.
  useEffect(() => {
    if (importStage?.kind !== 'confirm' || importStage.tripId === trip?.id) return;
    discardRefused(importStage.accepted.map((item) => item.media));
    // Deliberately synchronous, not deferred to a callback: the trip has
    // already changed by the time this effect runs, so the stale sheet
    // must not survive even one extra frame over the wrong trip (same
    // precedent as the load effect in recap/[id]/map.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImportStage(null);
  }, [trip?.id, importStage]);

  if (trips === null) return <EmptyScreen />;
  if (error) {
    return (
      <ErrorScreen
        error={error}
        onRetry={() => {
          setTrips(null);
          void load();
        }}
      />
    );
  }

  if (running.length === 0) {
    return <NoTripScreen nextTrip={planned[0] ?? null} onCreate={() => router.push('/trip/new')} />;
  }

  if (!trip) {
    return (
      <TripPickerScreen
        trips={running}
        today={today}
        // Opened from the viewfinder the picker marks the trip it shows and
        // offers the way back; opened automatically there is nothing to
        // return to, so neither.
        selectedId={pickerOpen ? currentTripId : null}
        onSelect={(id) => {
          setSelectedTripId(id);
          setPickerOpen(false);
        }}
        onClose={pickerOpen ? () => setPickerOpen(false) : undefined}
        onCreate={() => router.push('/trip/new')}
      />
    );
  }

  // Videos leave this screen as a file path, photos through the handoff in
  // memory (a deliberate boundary, see the brief); `tripId` comes along
  // because the preview builds the storage key and the queue job from it, and
  // an id is nothing library-specific, so it does not break the boundary.
  //
  // The cast through `unknown` (instead of `any`, see the precedent in
  // joinFlow.ts) is a leftover from the time before the route existed:
  // `/preview` is in the generated route list today, and tsc accepts the push
  // without the cast as well (checked 2026-08-19).
  const goToPreview = (params: {
    type: 'photo' | 'video';
    duration: string;
    tripId: string;
    uri?: string;
  }) => {
    // Set BEFORE the navigation: the blur effect and the mute prop treat the
    // preview differently from a tab switch (see inPreview above).
    setInPreview(true);
    router.push({ pathname: '/preview', params } as unknown as Href);
  };

  // The library import (spec 2026-08-27, confirmation 2026-08-27), in four
  // moves: the intro sheet (openImport), picker plus assessment ending in
  // the confirmation sheet (pickAndAssess), the batch (confirmImport), and
  // the way out (cancelImport). `trip` is a const narrowed above, so the
  // closures keep it non-null across the awaits.
  const openImport = () => {
    if (importing || capturing || importRunning.current) return;
    setCaptureError(null);
    setImportStage({ kind: 'intro' });
  };

  // Abbrechen, the backdrop, or a swipe on either sheet. In the
  // confirmation stage the accepted copies never entered the queue, so
  // they leave tmp like the refused ones did.
  const cancelImport = () => {
    if (importStage?.kind === 'confirm') {
      discardRefused(importStage.accepted.map((item) => item.media));
    }
    setImportStage(null);
  };

  const pickAndAssess = async () => {
    // Re-entry guard (same pattern as photoRunning above): pickFromLibrary
    // awaits a permission check (requestReadAccess in libraryPicker.ts)
    // before it even presents, so the screen stays fully interactive for
    // that whole native round trip; the header button is back the moment
    // the intro sheet closes.
    if (importRunning.current) return;
    importRunning.current = true;
    setImportStage(null);
    try {
      let picked: PickResult;
      try {
        picked = await pickFromLibrary();
      } catch (error) {
        console.error('[capture] library picker failed', error);
        if (active.current) setCaptureError(IMPORT_PICKER_ERROR_TEXT);
        return;
      }
      if (picked.canceled || picked.media.length === 0) return;
      if (!active.current) {
        // A blur while the picker was open (deep link, back navigation): the
        // picked copies still sit in tmp and have to leave, same as any
        // other refusal path.
        discardRefused(picked.media);
        return;
      }
      if (!userId) {
        discardRefused(picked.media);
        setCaptureError(IMPORT_WITHOUT_SESSION_TEXT);
        return;
      }

      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const assessed = picked.media.map((item) => assess(item, trip, MAX_VIDEO_SECONDS, deviceTz));
      const accepted = assessed.filter((item): item is AcceptedMedia => item.accepted);
      const reasons: RefusalReason[] = [];
      const refused: PickedMedia[] = [];
      for (const item of assessed) {
        if (!item.accepted) {
          reasons.push(item.reason);
          refused.push(item.media);
        }
      }
      // Refused copies leave tmp right away; the accepted ones wait for the
      // confirmation (submitImports releases them, or cancelImport does).
      discardRefused(refused);
      setImportStage({ kind: 'confirm', tripId: trip.id, total: picked.media.length, accepted, reasons });
    } finally {
      importRunning.current = false;
    }
  };

  const confirmImport = async () => {
    if (importStage?.kind !== 'confirm' || importRunning.current) return;
    const { accepted } = importStage;
    // Defensive twin of the trip-change effect above, for the render that
    // can land between the trip actually swapping and that effect running.
    if (importStage.tripId !== trip.id) {
      discardRefused(accepted.map((item) => item.media));
      setImportStage(null);
      return;
    }
    if (!userId) {
      discardRefused(accepted.map((item) => item.media));
      setImportStage(null);
      setCaptureError(IMPORT_WITHOUT_SESSION_TEXT);
      return;
    }
    importRunning.current = true;
    setImportStage(null);
    try {
      // No tab switch in the middle of the batch (captureLock.ts), for the
      // same reason as during a capture: the focus cleanup must not
      // interrupt it.
      captureLock.lock(true);
      const counterBefore = counter;
      setImporting({ done: 0, total: accepted.length });
      let outcome: ImportOutcome;
      try {
        outcome = await submitImports(
          accepted,
          { tripId: trip.id, authorId: userId },
          (done, count) => {
            if (active.current) setImporting({ done, total: count });
          }
        );
      } catch (error) {
        // submitImports catches per element; this is the queue itself
        // failing to initialize. Every accepted element then counts as
        // failed.
        console.error('[capture] library import failed', error);
        outcome = { submitted: 0, failed: accepted.length };
      }
      // Cleared unconditionally: a blur during the batch (deep link, router
      // push) sets active.current false but never re-enters this handler,
      // and `importing` is the only thing keeping shutter and header gone.
      setImporting(null);
      if (!active.current) {
        // Nobody is left to watch the cover, so nothing holds the lock open
        // for it either.
        captureLock.lock(false);
        return;
      }
      // The refusals were explained in the confirmation sheet; the pill
      // afterwards only reports what failed inside the batch, measured
      // against what was confirmed.
      const failures: RefusalReason[] = [];
      for (let i = 0; i < outcome.failed; i += 1) failures.push('failed');
      const summary = refusalSummary(failures, accepted.length, trip, MAX_VIDEO_SECONDS);
      if (outcome.submitted === 0) {
        // Nothing was submitted, so there is no cover to hold the lock for
        // either: the summary is the whole story, right away.
        captureLock.lock(false);
        setCaptureError(summary);
        return;
      }
      // The lock stays SET here: the cinema tab bar sits over this screen,
      // and a tab tap during the 3.6 s cover must not slip past a lock that
      // was already released. finishImport below releases it once the
      // cover is gone.
      heldSummary.current = summary;
      setImportDone({ added: outcome.submitted, counterBefore });
    } finally {
      importRunning.current = false;
    }
  };

  // The success animation has played: the counter effect above re-runs on
  // the focus tick and picks up the fresh queue jobs, and a held summary of
  // the refusals gets its turn in the pill.
  const finishImport = () => {
    // Only now, with the cover gone, can a tab tap safely act again
    // (Final-Review, Important 4): confirmImport above deliberately kept
    // the lock through the whole celebration.
    captureLock.lock(false);
    setImportDone(null);
    setFocusState((n) => n + 1);
    if (heldSummary.current) {
      setCaptureError(heldSummary.current);
      heldSummary.current = null;
    }
  };

  // During a HELD capture the finger lies on the shutter. React Native knows
  // exactly one responder: a second finger on the row would take the touch
  // away from the press, the release would arrive, and the capture would end
  // mid-zoom. If it is locked, though, the hand is free, and then the zoom
  // stays operable, as in the camera app.
  const zoomUsable = !capturing || captureLocked;
  // Being able to zoom and showing steps are two questions: the single-lens
  // front has no row but zooms digitally in the MultiCam branch, so the pinch
  // has to work there although no steps stand in the image.
  const zoomPossible = multiCam || zoom !== null;
  const zoomVisible = zoom !== null && zoomUsable;

  // The pinch, by hand instead of through a gesture recognizer: what is needed
  // is the distance between two fingers, nothing more.
  // `onStartShouldSetResponder: false` lets every single touch through: it
  // belongs to the shutter and the rest of the controls. Only the movement
  // with two fingers takes over.
  // The double tap switches the camera even DURING a capture (wish
  // 2026-08-17, Snapchat pattern), but only on the native path: on a facing
  // switch expo-camera swaps only the device input of the same running session
  // (CameraSessionManager.addDevice), our own pipeline hangs off its outputs
  // and simply keeps recording. A running recordAsync (fallback) would be
  // aborted by that rebuild, so there the double tap stays silent, locked or
  // not. A function instead of a value, because the gestures have to read the
  // nativeRunning ref at the moment of the tap.
  //
  // The MultiCam branch does not know this question any more: there both
  // cameras run in THE SAME session, and the switch only swaps which of them
  // feeds the viewfinder. Nothing there could abort, so the gate belongs to
  // the expo-camera path alone.
  const switchAllowed = () => multiCam || !capturing || nativeRunning.current;

  // Switches the screen to a facing: remembers the factor of the old facing,
  // restores the remembered one of the new facing and re-anchors a running
  // drag zoom: factor from memory, limits of the new camera (before, the
  // anchor either stayed on the old limits or fell away entirely when
  // switching to the device-less front, and the drag was dead for the rest of
  // the capture). In the expo-camera branch it stays at the reset to 1x: expo
  // resets the zoom on a device switch itself, and the fallback mechanics
  // taken from it (reapplyZoom via onAvailableLensesChanged) compute from
  // exactly that state.
  const applyFacing = (from: 'back' | 'front', to: 'back' | 'front') => {
    factorPerFacing.current[from] = factorRef.current;
    const restored = multiCam ? factorPerFacing.current[to] : 1;
    setFacing(to);
    factorRef.current = restored;
    setFactor(restored);
    if (dragStart.current) {
      const limits = zoomLimitsFor(to);
      // The finger keeps lying where it lies, and from here on that spot means
      // the restored factor: the travel so far belongs to the direction just
      // left behind.
      dragStart.current = limits ? { factor: restored, limits, pull: dragPull.current } : null;
    }
  };

  const switchCamera = () => {
    const previous = facing;
    const next = previous === 'back' ? 'front' : 'back';
    if (multiCam) {
      // No hardware rebuild, no waiting, and therefore no fade either: the
      // session keeps running, the module only puts the other connection onto
      // the viewfinder. The screen does not wait for the answer, it switches
      // the facing right away so that steps, limits and zoom target match the
      // new camera in the same frame.
      applyFacing(previous, next);
      // As soon as the answer is in, the NATIVE zoom is pulled along. Without
      // that, display and session drifted apart: the module remembers per
      // facing its last chosen camera along with its standing zoom factor, the
      // screen remembers its display factor; only pulling along brings both to
      // the same remembered state (in the expo-camera branch reapplyZoom does
      // that via onAvailableLensesChanged). If the module answers with null
      // (no module, setup window, switch declined), nothing switched natively:
      // the optimistic change rolls back, otherwise the screen would stand
      // permanently the wrong way round to the session and every further
      // double tap would keep the swap alive (final review 2026-08-19,
      // important 1).
      const seq = ++switchSeq.current;
      void multiCamera.switchCamera().then((response) => {
        // Overtaken: a younger switch has long been applied and its answer
        // reconciles the state. This one has nothing left to say.
        if (seq !== switchSeq.current) return;
        const actual = response ?? previous;
        if (actual !== next) applyFacing(next, actual);
        if (!response) return;
        multiCamera.setZoom(
          multiCamTarget(factorRef.current, response, hasUltraWideIn(nativeZoom.lenses(response))),
          false
        );
      });
      return;
    }
    setSwitching(true);
    applyFacing(previous, next);
  };

  // The drag zoom (spec 2026-08-13 §7): pulling up from the start of the
  // capture zooms in, back down zooms out again. Set hard like the pinch: the
  // zoom follows the finger, it does not trail behind.
  const zoomDrag = (dragAmount: number) => {
    // Noted before the exit below: a facing without zoom reports no factor, but
    // the travel still has to be current when a switch re-anchors.
    dragPull.current = dragAmount;
    // The anchor exists only where there were limits (zoomLimitsFor); the
    // question "does this facing have zoom at all?" is thereby already
    // answered, including for the device-less front in the MultiCam branch.
    const start = dragStart.current;
    if (!start) return;
    applyZoom(
      dragFactor(dragAmount - start.pull, start.factor, start.limits, zoomBase, {
        up: Dimensions.get('window').height * DRAG_DISTANCE_UP_RATIO,
        down: DRAG_DISTANCE_DOWN,
      }),
      false
    );
  };

  // Two clean taps in quick succession at the same spot. Manages the count
  // itself: reports true exactly on the second tap and starts over afterwards.
  // Used by BOTH tap paths (the responder path in the idle state and with a
  // locked capture, the raw touch path with a held one); the states exclude
  // each other, so the shared counter cannot blur between them.
  const isDoubleTap = (end: { pageX: number; pageY: number }) => {
    const previous = lastTap.current;
    const now = Date.now();
    const double =
      previous !== null &&
      now - previous.time <= DOUBLE_TAP_MS &&
      (fingerDistance([previous, end]) ?? 0) <= TAP_RADIUS;
    lastTap.current = double ? null : { time: now, ...end };
    return double;
  };

  // Touches on the camera image: two fingers zoom, two taps switch the camera
  // (Snapchat pattern).
  //
  // The event is touched optionally everywhere (`e?.`), the same pattern as in
  // the shutter: whoever only wants to know WHETHER this element accepts
  // touches calls the predicate without an event.
  const zoomGesture = {
    // The surface takes single touches when a tap may come of them: in the
    // idle state (focus and double-tap switch) and during a LOCKED capture
    // (focus only, the hand is free). During a HELD capture it has to let them
    // through: React Native knows exactly one responder, and that one belongs
    // to the shutter then; if the surface grabbed it, the capture would end.
    onStartShouldSetResponder: () => !capturing || captureLocked,
    onMoveShouldSetResponder: (e?: GestureResponderEvent) =>
      zoomPossible && zoomUsable && (e?.nativeEvent?.touches?.length ?? 0) >= 2,
    onResponderGrant: (e?: GestureResponderEvent) => {
      tapStart.current = {
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
      const distance = fingerDistance(e?.nativeEvent?.touches ?? []);
      if (distance === null) return;
      // Ask for the limits only now: they hang off the active camera format
      // and thus off whether a photo or a video is up next. Without limits
      // (front in the expo branch) there is no anchor and no pinch.
      const limits = zoomLimitsFor(facing);
      if (!limits) return;
      pinchStart.current = { distance, factor: factorRef.current, limits };
    },
    onResponderMove: (e?: GestureResponderEvent) => {
      const distance = fingerDistance(e?.nativeEvent?.touches ?? []);
      if (distance === null) return;
      // On device two fingers almost never land in the same event: the first
      // grabs the surface alone (onResponderGrant sees ONE touch, no anchor),
      // the second follows an event later. The anchor is therefore set HERE as
      // soon as two fingers are present for the first time; before that nobody
      // computed in that case, and the pinch only caught when both fingers
      // happened to land simultaneously (device finding 2026-08-14, "picks up
      // the zoom only partly").
      if (pinchStart.current === null) {
        const limits = zoomLimitsFor(facing);
        if (!limits) return;
        pinchStart.current = { distance, factor: factorRef.current, limits };
        return;
      }
      const start = pinchStart.current;
      if (start.distance === 0) return;
      // Set hard, not smoothly: the zoom should follow the finger, not trail
      // behind it.
      applyZoom(clamp((start.factor * distance) / start.distance, start.limits, zoomBase), false);
    },
    onResponderRelease: (e?: GestureResponderEvent) => {
      const wasPinch = pinchStart.current !== null;
      const start = tapStart.current;
      pinchStart.current = null;
      tapStart.current = null;
      // Whoever zoomed meant neither a switch nor a focus.
      if (wasPinch || !start) return;

      const end = {
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
      // Travelled means swiped, not tapped. A swipe resets the count,
      // otherwise it would become the first half of a double tap.
      if ((fingerDistance([start, end]) ?? 0) > TAP_RADIUS) {
        lastTap.current = null;
        return;
      }

      // The double tap switches the camera: in the idle state always, during a
      // capture only on the native path (see switchAllowed).
      if (isDoubleTap(end) && switchAllowed()) {
        switchCamera();
        return;
      }
      // Every other clean tap focuses at its point, including the first of a
      // double tap (the camera app does the same; the switch afterwards simply
      // makes the focus moot).
      focusAt(end);
    },
    onResponderTerminate: () => {
      pinchStart.current = null;
      tapStart.current = null;
    },
    // The focus tap DURING a held capture: the responder belongs to the
    // shutter then, so responder events do not reach the surface. The raw
    // touch events do arrive though: they follow the touch TARGET, not the
    // responder (device finding 2026-08-14). Tab bar and shutter never hit the
    // surface: their taps target their own views, so a ring over the controls
    // is ruled out. In every other state this path stays silent, there
    // onResponderRelease above focuses, otherwise the tap would fire twice.
    onTouchStart: (e?: GestureResponderEvent) => {
      if (!capturing || captureLocked) return;
      const id = e?.nativeEvent?.identifier;
      if (id === undefined) return;
      rawTap.current = {
        id,
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
    },
    onTouchEnd: (e?: GestureResponderEvent) => {
      const start = rawTap.current;
      if (!start || e?.nativeEvent?.identifier !== start.id) return;
      rawTap.current = null;
      if (!capturing || captureLocked) return;
      const end = {
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
      // Travelled means swiped, the same yardstick as for the tap above.
      if ((fingerDistance([start, end]) ?? 0) > TAP_RADIUS) {
        lastTap.current = null;
        return;
      }
      // The second finger's double tap switches the camera in the middle of
      // filming (Snapchat pattern), only on the native path, the fallback
      // would abort (see switchAllowed).
      if (isDoubleTap(end) && switchAllowed()) {
        switchCamera();
        return;
      }
      focusAt(end);
    },
  };

  const handlePhoto = async () => {
    // Re-entry guard: between `pressOut` and the navigation commit the shutter
    // stays operable, and without this lock a second tap in that window would
    // kick off a second cycle (see photoRunning above).
    if (photoRunning.current) return;
    photoRunning.current = true;
    // While the cycle runs, no tab switches (captureLock.ts): with flash that
    // window is 1-2 s wide, and a switch in the middle of the capture would
    // orphan the handoff and start the preview from a foreign tab.
    captureLock.lock(true);
    try {
      // The MultiCam branch grabs into the running stream (spec §6): the
      // module takes the next frame of the active camera and puts it into tmp
      // as a JPEG, no takePictureAsync, no second photo output. The flash
      // travels along as an argument, because only the module knows when it
      // may grab after firing. NO pausePreview: our own session knows no
      // preview pause, the viewfinder keeps running under the preview, and the
      // way back therefore meets a live image.
      if (multiCam) {
        const photo = await multiCamera.takePhoto(flash === 'on');
        if (!photo) throw new Error('kein Frame');
        // The same handoff as below, only with a FINISHED file instead of a
        // ref plus a background save: the grab has already written the JPEG,
        // so `file` is resolved immediately. For display the holder carries an
        // expo-camera PictureRef; expo-image accepts a source of the shape
        // `{ uri }` just as well (the preview has long been passing it through
        // that way in the deep-link case), the holder type just does not know
        // this second shape yet. The reinterpretation therefore sits here in
        // exactly ONE place, instead of changing the type and dragging the
        // preview along. Nobody needs breite/hoehe on this path: they are in
        // the JPEG.
        const source = { uri: photo.uri } as unknown as PictureRef;
        handoff.setPhoto({ ref: source, file: Promise.resolve({ uri: photo.uri }) });
        goToPreview({ type: 'photo', duration: '0', tripId: trip.id });
        return;
      }
      // Kick off the capture first, THEN freeze the preview: the SDK docs
      // advise against takePictureAsync while the preview is paused, and the
      // order makes no visible difference, both run in the same tick. The
      // frozen image is the perceived shutter.
      //
      // That holds only WITHOUT flash, where the image is there within a few
      // dozen ms (spec 2026-08-13 §4). WITH flash iOS first runs the metering
      // sequence (pre-flash, exposure convergence, main flash), 1-2 s: an
      // immediately frozen viewfinder would stand there as a dark freeze the
      // whole time (device test 2026-08-13). So it stays live, you SEE the
      // flash fire (camera-app pattern), and freezing happens only once the
      // image is there: as a calm still for the transition, as with the video
      // stop. `mirror: true` affects ONLY the front camera (expo-camera checks
      // the facing itself, CameraPhotoCapture.swift) and saves there what the
      // viewfinder showed; without the flag a selfie flipped mirrored after
      // the capture (device finding 2026-08-18). The video pipeline needs none
      // of this, it takes the mirroring straight from the viewfinder
      // connection (verbindungAngleichen).
      const pending = cameraRef.current?.takePictureAsync({
        pictureRef: true,
        shutterSound: false,
        mirror: true,
      });
      if (flash === 'off') void cameraRef.current?.pausePreview();
      const ref = await pending;
      if (!ref) throw new Error('keine Kamera');
      if (flash === 'on') void cameraRef.current?.pausePreview();
      // The ref is there within milliseconds (no JPEG, no disk I/O); from now
      // on it is saved in the background, and "submit" in the preview awaits
      // exactly this promise (spec 2026-08-13 §4). savedFile instead of
      // savePictureAsync directly: the native return is called `url` on iOS
      // and `uri` on Android (see handoff.ts).
      handoff.setPhoto({ ref, file: handoff.savedFile(ref) });
      goToPreview({ type: 'photo', duration: '0', tripId: trip.id });
    } catch (err) {
      console.error('[capture] photo capture failed', err);
      // Without the thaw the viewfinder would stay frozen: pausePreview has
      // run and nobody navigates away. In the MultiCam branch the call is a
      // no-op (there is no CameraView there, cameraRef stays null), nothing
      // was frozen anyway.
      void cameraRef.current?.resumePreview();
      setCaptureError(PHOTO_ERROR_TEXT);
    } finally {
      // Covers success as well as failure; after success the navigation is
      // committed, so another tap only reaches this screen again after the
      // return from the preview.
      photoRunning.current = false;
      captureLock.lock(false);
    }
  };

  const handleVideoStart = () => {
    videoStartTime.current = Date.now();
    videoStopped.current = false;
    // A new capture clears the old complaint, otherwise it would still be
    // standing there while the next one is already running.
    setCaptureError(null);
    setCapturing(true);
    // No tab switch while capturing: the focus cleanup would otherwise hang in
    // the middle of the running movie-file recording (see the mute comment on
    // the CameraView and captureLock.ts).
    captureLock.lock(true);
    // Anchor of the drag zoom: factor and limits at the start of the capture.
    // Ask for the limits only now, not at render time: they hang off the
    // active format. Without limits (front in the expo branch) there is no
    // drag.
    const limits = zoomLimitsFor(facing);
    dragPull.current = 0;
    dragStart.current = limits ? { factor: factorRef.current, limits, pull: 0 } : null;
    // Start directly instead of via an effect on the mode: the session has
    // long been ready in the permanent video mode, there is nothing to commit.
    // It is retried anyway (see VIDEO_START_ATTEMPTS above), and on the
    // simulator EVERY attempt keeps failing ("SimulatorNotSupported"); in the
    // end it stays at `undefined` and the screen says so.
    const startRecording = async (): Promise<{ uri: string } | undefined> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < VIDEO_START_ATTEMPTS; attempt++) {
        // Whoever already released the shutter no longer wants a video.
        // Without this check the next round would begin a capture nobody stops
        // any more: `stopRecording()` has long run and hit nothing, and the
        // capture would run to `maxDuration`.
        if (videoStopped.current) return undefined;
        try {
          return await cameraRef.current?.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
        } catch (err) {
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, VIDEO_START_WAIT_MS));
        }
      }
      // All rounds used up. Whatever went wrong last belongs in the log:
      // otherwise only ERROR_TEXT stands on the device and the actual cause
      // (simulator, no storage, permission revoked) is swallowed.
      console.error('[capture] video capture failed', lastError);
      return undefined;
    };
    // The switch: try our own native pipeline first (task 2); only if it
    // declines (no module, old build, Android) does the previous recordAsync
    // path begin. `nativeStart` holds the promise, not just the result:
    // handleVideoStop later awaits that same promise instead of a boolean that
    // could still show the old state on a lightning-fast stop.
    //
    // If our own MultiCam session carries the viewfinder, IT produces the
    // capture: the same native capture as otherwise, only fed by the
    // distributor of its session instead of by the tap on the expo-camera
    // session (spec §4). A camera switch in the middle costs no gap there, the
    // timeline is the shared session clock.
    nativeStart.current = multiCam
      ? multiCamera.startCapture(MAX_VIDEO_SECONDS)
      : nativeCapture.startCapture(MAX_VIDEO_SECONDS);
    void nativeStart.current.then((ok) => {
      nativeRunning.current = ok;
      // The recordAsync path belongs to the CameraView; in the MultiCam branch
      // there is none (cameraRef stays null), so a fallback would run into
      // nothing. If the start fails there, the stop says so via the error
      // pill.
      if (!ok && !multiCam) videoPromise.current = startRecording();
    });
  };

  const handleVideoStop = async () => {
    // Set before stopping: the start attempt above reads this flag between two
    // rounds and gives up then, instead of beginning a capture behind the
    // release.
    videoStopped.current = true;
    // The capture ends: from here the double tap is governed by the idle state
    // alone (switchAllowed).
    nativeRunning.current = false;
    cameraRef.current?.stopRecording();

    // The switch: first wait for WHETHER the native capture was running at all
    // (the PROMISE from handleVideoStart, not just a boolean flag). A
    // lightning-fast stop right after the start would otherwise see the old,
    // still undecided state and run into the wrong branch. In the native case
    // the `stopRecording()` above and the fallback path below are harmless: no
    // recordAsync is running anyway.
    const nativeStarted = nativeStart.current ? await nativeStart.current : false;
    nativeStart.current = null;
    if (nativeStarted) {
      // It is stopped where it was started. Everything after that is the same
      // for both pipelines: the file, the discard and the instant preview hang
      // natively off the same running capture, no matter which session fed
      // it.
      const result = await (multiCam
        ? multiCamera.stopCapture()
        : nativeCapture.stopCapture());
      setCapturing(false);
      captureLock.lock(false);
      if (!result) {
        setCaptureError(ERROR_TEXT);
        return;
      }
      handoff.setVideo({ kind: 'native', fileReady: nativeCapture.fileReady() });
      goToPreview({
        uri: result.uri,
        type: 'video',
        duration: String(Math.round(result.durationS)),
        tripId: trip.id,
      });
      return;
    }

    // Here the MultiCam branch ends: the start declined, and there is no
    // second path (recordAsync belongs to the CameraView, which does not even
    // exist in this branch). The pill says so, instead of the path below
    // running silently into nothing.
    if (multiCam) {
      setCapturing(false);
      captureLock.lock(false);
      setCaptureError(ERROR_TEXT);
      return;
    }

    // The viewfinder deliberately stays LIVE during file finalization (~100 to
    // 300 ms, device finding 2026-08-14): the earlier pausePreview came from
    // the days of the hard cut to the preview, and as a still frame it was
    // exactly the perceptible stutter on release. The time jump from
    // viewfinder to video is covered by the fade these days (preview.tsx).
    const result = await videoPromise.current;
    videoPromise.current = null;
    setCapturing(false);
    // Before both exits (error pill as well as navigation): the capture is
    // over, the tabs belong operable again.
    captureLock.lock(false);
    if (!result?.uri) {
      void cameraRef.current?.resumePreview();
      setCaptureError(ERROR_TEXT);
      return;
    }
    const duration = Math.round((Date.now() - videoStartTime.current) / 1000);
    // Warm-up (device finding 2026-08-14, Snapchat yardstick): the player is
    // created HERE and loads while the viewfinder keeps running live;
    // navigation waits until it is ready to play, so the fade goes into an
    // already running video instead of into a dark surface the first frame
    // pops into. Only the DISPLAY travels through the holder; the data (uri)
    // still goes as a param, the documented boundary stays.
    const player = createVideoPlayer(result.uri);
    player.loop = true;
    player.muted = true;
    // Muted it needs no audio session, and only that way does this screen's
    // later microphone rebuild leave it alone (preview.tsx).
    player.audioMixingMode = 'mixWithOthers';
    player.play();
    // Poster and player warm-up run in parallel; the gate is the slower of the
    // two, capped by its respective deadline.
    const [poster] = await Promise.all([createPoster(result.uri), playerReady(player)]);
    if (player.status === 'error') {
      // A broken player shows nothing: release it, the preview then loads via
      // the uri itself, the old path as a fallback.
      player.release();
    } else {
      handoff.setVideo({ kind: 'player', player, poster });
    }
    goToPreview({ uri: result.uri, type: 'video', duration: String(duration), tripId: trip.id });
  };

  // Three states instead of two (fix round 1: the earlier version wrongly
  // treated "not asked yet"/"currently asking" like "denied", because
  // `status: 'undetermined'` also carries `granted: false`):
  //   - null           -> answer still unknown, claim nothing (wait)
  //   - 'undetermined' -> neither asked nor answered (the request may be
  //                       running, the system dialog may be open) -> wait as
  //                       well, NEVER show the settings screen
  //   - 'denied'       -> actually denied -> only here the way into the
  //                       system settings
  if (cameraPermission === null || micPermission === null) return <EmptyScreen />;
  if (cameraPermission.status === 'denied' || micPermission.status === 'denied') {
    return <PermissionScreen />;
  }
  if (!cameraPermission.granted || !micPermission.granted) {
    // 'undetermined': neither asked nor answered, the request may be running,
    // the system dialog may be open. Wait, claim nothing, NEVER show the
    // settings screen.
    return <EmptyScreen />;
  }

  return (
    <View style={styles.screen}>
      {multiCam ? (
        // The viewfinder of our own session. It knows neither `mute` nor
        // `flash`, `enableTorch`, `selectedLens` or
        // `onAvailableLensesChanged`: the microphone hangs off the session
        // itself (not off a prop), the zoom path picks the lens, and the flash
        // comes in a step of its own. Everything above it (zoom surface, focus
        // ring, header, zoom row, shutter) is the same for both branches.
        <multiCamera.MultiCameraViewfinder
          testID="multicam-viewfinder"
          style={[styles.picture, { height: pictureHeight, bottom: barHeight }]}
        />
      ) : (
        <CameraView
          ref={cameraRef}
          style={[styles.picture, { height: pictureHeight, bottom: barHeight }]}
          facing={facing}
          mode="video"
          // Not `!focused` alone: the tab bar stays visible, a LOCKED capture
          // keeps running after the release, and a tap on another tab fires
          // the focus cleanup in the middle of it. `mute` does not flip a
          // plain switch there: expo-camera builds
          // `session.beginConfiguration()` + `removeInput(audio)` for it, and
          // reconfiguring a session IN THE MIDDLE of a running
          // AVCaptureMovieFileOutput recording aborts it. So while `capturing`
          // holds, the microphone stays attached regardless of focus: it is
          // recording right now. And while the CAPTURE PREVIEW covers the tab
          // (inPreview) as well: re-attaching on the instant way back was
          // exactly the session rebuild that froze the viewfinder at the
          // moment of return (user finding 2026-08-18). Only a real tab switch
          // detaches the microphone: the orange dot must not glow app-wide.
          mute={!focused && !capturing && !inPreview}
          // `flash` applies to photos; video needs the torch instead, the
          // same switch under two prop names. Whether the photo flash really
          // fires in the video preset on device is on the device checklist
          // (spec 2026-08-13 §9); the fallback would be the torch.
          flash={flash}
          enableTorch={flash === 'on' && capturing}
          videoQuality="1080p"
          // The multi-lens camera as ONE device: inside it iOS switches
          // between the lenses itself, seamlessly and without rebuilding the
          // session. Only that way does the zoom cross 0.5x without stalling.
          selectedLens={zoom?.name}
          // Fires after every device switch, and specifically AFTER
          // expo-camera's own updateZoom (addDevice, defer block): exactly the
          // moment our factor belongs restored.
          onAvailableLensesChanged={() => {
            // The new camera delivers: the switch fade can go.
            setSwitching(false);
            reapplyZoom();
          }}
        />
      )}
      {/* Catches the movement of two fingers. Lies above the camera image but
          below everything operable: whatever comes after it gets its touches
          first. */}
      <View testID="viewfinder-zoom-area" style={StyleSheet.absoluteFill} {...zoomGesture} />
      {focusPoint && (
        <FocusRing
          key={focusPoint.state}
          x={focusPoint.x}
          y={focusPoint.y}
          onDone={focusRingDone}
        />
      )}
      {switching && <SwitchFade />}
      {/* While a video runs, the header disappears (spec 2026-08-12). The
          reason is not aesthetics: in the locked state the hand is free, so
          these buttons would be reachable, and a camera switch in the middle
          of recordAsync can abort the running recording. Removed rather than
          just hidden, so that VoiceOver offers nothing that cannot be operated
          right now. */}
      {!capturing && !importing && (
        <View testID="viewfinder-header" style={[styles.headerRow, { top: viewfinderTopInset }]}>
          {/* The trip switcher (product concept: "switchable when several
              trips are running"): the trip name IS the button, no extra
              control on the image. The chevron makes that visible without
              asking for more room than an icon. With one running trip there
              is nothing to switch to, so the name is a label: no chevron, no
              press, and nothing for VoiceOver to offer. */}
          {running.length > 1 ? (
            <PressScale
              style={styles.headerPicker}
              accessibilityRole="button"
              accessibilityLabel={`Reise wechseln, ${trip.name}`}
              onPress={() => setPickerOpen(true)}
            >
              <Pill style={styles.headerPill}>
                <HeaderTripTexts name={trip.name} count={counter ?? trip.my_post_count} />
                <ChevronDown size={18} color={cinema['text-2']} strokeWidth={1.75} />
              </Pill>
            </PressScale>
          ) : (
            <Pill style={[styles.headerPicker, styles.headerPill]}>
              <HeaderTripTexts name={trip.name} count={counter ?? trip.my_post_count} />
            </Pill>
          )}
          <View style={styles.controls}>
            <PillButton label="Kamera wechseln" onPress={switchCamera}>
              <SwitchCamera size={22} color={cinema['text-1']} strokeWidth={1.75} />
            </PillButton>
            <PillButton
              label={flash === 'on' ? 'Blitz ausschalten' : 'Blitz einschalten'}
              onPress={() => setFlash((current) => (current === 'on' ? 'off' : 'on'))}
            >
              {flash === 'on' ? (
                <Zap size={22} color={cinema['text-1']} strokeWidth={1.75} />
              ) : (
                <ZapOff size={22} color={cinema['text-2']} strokeWidth={1.75} />
            )}
          </PillButton>
            <PillButton label="Momente aus Fotos einsenden" onPress={openImport}>
              <Images size={22} color={cinema['text-1']} strokeWidth={1.75} />
            </PillButton>
            {multiCam && (
              <PillButton
                label={
                  stabilization === 'on'
                    ? 'Stabilisierung ausschalten'
                    : 'Stabilisierung einschalten'
                }
                onPress={() =>
                  setStabilization((current) => (current === 'on' ? 'off' : 'on'))
                }
              >
                {stabilization === 'on' ? (
                  <Vibrate size={22} color={cinema['text-1']} strokeWidth={1.75} />
                ) : (
                  <VibrateOff size={22} color={cinema['text-2']} strokeWidth={1.75} />
                )}
              </PillButton>
            )}
        </View>
      </View>
      )}
      {captureError && (
        <Pill style={[styles.errorPill, { bottom: errorBottom(zoomVisible) + barHeight }]}>
          <Text style={[type.secondary, styles.errorText]}>{captureError}</Text>
        </Pill>
      )}
      {importing && (
        <Pill
          testID="import-progress"
          style={[styles.errorPill, styles.importPill, { bottom: errorBottom(zoomVisible) + barHeight }]}
        >
          <ActivityIndicator color={cinema['text-1']} />
          <Text style={[type.secondary, styles.errorText]}>
            {`${importing.done} von ${importing.total} Momenten eingesendet`}
          </Text>
        </Pill>
      )}
      {zoomVisible && zoom && (
        <View
          style={[
            styles.zoomWrap,
            { bottom: SHUTTER_BOTTOM + SHUTTER_SIZE + ZOOM_DISTANCE + barHeight },
          ]}
        >
          <ZoomSelector
            steps={zoom.steps}
            factor={factor}
            onSelect={(step) => applyZoom(step, true)}
          />
        </View>
      )}
      {!importing && (
        <View
          testID="shutter-stage"
          style={[styles.shutterWrap, { bottom: SHUTTER_BOTTOM + barHeight }]}
        >
          <ShutterButton
            onPhoto={() => void handlePhoto()}
            onVideoStart={handleVideoStart}
            onVideoStop={() => void handleVideoStop()}
            onZoomDrag={zoomDrag}
            maxSeconds={MAX_VIDEO_SECONDS}
            onLockChange={setCaptureLocked}
          />
        </View>
      )}
      <ImportIntroSheet
        visible={importStage?.kind === 'intro'}
        period={trip}
        maxVideoSeconds={MAX_VIDEO_SECONDS}
        selectionLimit={SELECTION_LIMIT}
        onPick={() => void pickAndAssess()}
        onClose={cancelImport}
        bottomInset={barHeight}
      />
      <ImportConfirmSheet
        visible={importStage?.kind === 'confirm'}
        accepted={importStage?.kind === 'confirm' ? importStage.accepted : []}
        summary={
          importStage?.kind === 'confirm'
            ? refusalSummary(importStage.reasons, importStage.total, trip, MAX_VIDEO_SECONDS, 'preview')
            : null
        }
        onConfirm={() => void confirmImport()}
        onClose={cancelImport}
        bottomInset={barHeight}
      />
      <MomentSubmissionAnimation
        visible={importDone !== null}
        onFinished={finishImport}
        counter={importDone?.counterBefore ?? null}
        added={importDone?.added ?? 1}
      />
    </View>
  );
}

// The light values come straight from `palette` instead of through useTheme():
// this file carries both palettes side by side and so stays with ONE pattern
// (StyleSheet with token values). Light-only (§1) makes both paths identical
// anyway: `theme.colors` IS `palette`.
const styles = StyleSheet.create({
  // The cinema hall: only the viewfinder itself.
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  // The capture's frame, hung at the tab bar's top edge; height and bottom
  // come from the device (cinemaStage.pictureHeight).
  picture: { position: 'absolute', left: 0, right: 0 },
  // Everything else in this tab, see EmptyScreen.
  light: { flex: 1, backgroundColor: palette['bg-0'] },
  center: { justifyContent: 'center', padding: spacing.screen },
  // Bigger than the camper and the film reel (both square at 160): the ticket
  // is 3:2 landscape and carries this screen on its own; at the same size it
  // looked lost next to the large H2. 288 x 192, both on the 4-pt grid (§3).
  //
  // The width is an UPPER BOUND, not a fixed number: 288 plus the two 24-pt
  // screen margins bursts an iPhone SE (320 wide), the image would run past
  // the edge. `width: '100%'` + `aspectRatio` lets it shrink along on narrow
  // devices while keeping 3:2. At a 1536 px source there is over 5x of
  // reserve, sharp up to 3x without @2x/@3x files.
  ticketStage: { alignItems: 'center', marginBottom: spacing.l },
  // The lift moves only the image (transform changes no layout), the shadow
  // stays put: that is exactly what creates the impression of height.
  ticketSurface: { width: '100%', maxWidth: TICKET_WIDTH },
  flightTicket: { width: '100%', aspectRatio: 3 / 2 },
  title: { color: palette['text-1'] },
  text: { color: palette['text-2'] },
  // One row for everything that lies on top of the viewfinder: the header pill
  // on the left, the controls on the right (re-review, minor 1). Before, both
  // were positioned absolutely on their own; as long as nothing was on the
  // right it went unnoticed that the header pill grows without bound, with the
  // controls beside it a long trip name runs underneath. The row bounds the
  // pill (flexShrink) without moving the controls: they still sit at the right
  // screen margin (§3, margins 24).
  // `top` is deliberately missing here: it comes from useTopInset and thus
  // from the device, not from the stylesheet (see viewfinderTopInset).
  headerRow: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.m,
  },
  // The shrinking sits on the press area instead of on the pill: since the
  // name became a button there is a Pressable between row and pill, and a
  // flexShrink further in would leave that one at full width.
  headerPicker: { flexShrink: 1 },
  // Pill on the camera preview (DESIGN-LANGUAGE §1/§4): translucent, radius
  // 999, blur via components/Pill.tsx (no backgroundColor here, the Pill
  // component takes care of that itself).
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
  // Name and counter stay stacked, the chevron sits beside them. The shrink
  // share belongs to the texts, not to the icon.
  headerTexts: { flexShrink: 1 },
  // Switch camera and flash (spec §4): top right, level with the header pill,
  // stacked on the 4-pt grid (§3). flexShrink: 0, the pill should shrink, not
  // the controls.
  controls: {
    flexShrink: 0,
    gap: spacing.m,
  },
  controlPill: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `bottom` is deliberately missing here, as with zoomWrap: since the tab bar
  // lies as an overlay over the image, the device's bar height is added to the
  // bottom spacing (barHeight, see JSX), and only the render knows it.
  shutterWrap: {
    position: 'absolute',
    alignSelf: 'center',
  },
  // Tight above the shutter, as in the camera app: its bottom spacing plus
  // diameter plus the narrow gap between them (values in the JSX).
  zoomWrap: {
    position: 'absolute',
    alignSelf: 'center',
  },
  // Above the shutter, not below it (that is where the tab bar sits) and not
  // at the top, where the next attempt wedged it under the header. `bottom` is
  // deliberately missing here: it depends on whether the zoom row lies in
  // between, and comes from errorBottom().
  errorPill: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.m,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  // Centered, because a single short sentence in a pill is not the wall of
  // text §7 is about but a label.
  errorText: { color: cinema['text-1'], textAlign: 'center' },
  // The progress pill during a library import: spinner and text side by
  // side in the error pill's frame.
  importPill: { flexDirection: 'row', justifyContent: 'center', gap: spacing.s },
  // The focus ring: a fine light line on the camera image, radius 999 (§4).
  // `left`/`top` are deliberately missing, they come from the tap point.
  focusRing: {
    position: 'absolute',
    width: FOCUS_RING_SIZE,
    height: FOCUS_RING_SIZE,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: cinema['text-1'],
  },
});
