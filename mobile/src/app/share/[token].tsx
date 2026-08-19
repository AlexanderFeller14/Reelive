import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { ProgressBar } from '@/components/ProgressBar';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { resolveToken, DEAD_LINK_TEXT, type SharedMoment } from '@/features/sharing/shareApi';
import { sortMoments } from '@/features/recap/days';
import {
  blocksAutoAdvance,
  durationFor,
  withReason,
  withoutReason,
  dayChanges,
  advance,
  goBack,
  type PauseReason,
  type PlayerState,
} from '@/features/recap/playerLogic';
import { groupByDays } from '@/features/recap/days';
import type { RecapMoment, RecapDay } from '@/features/recap/types';
import { timeInZone } from '@/features/recap/timeOfDay';
import { viewportFor } from '@/features/map/viewport';
import { MapSurface } from '@/features/map/MapSurface';
import { cluster } from '@/features/map/clustering';
import { zoomExhausted, zoomTarget, type ZoomAttempt } from '@/features/map/clusterTap';
import { toMapPoints } from '@/features/map/mapPoints';
import {
  ClusterSheetContent,
  MomentSheetContent,
  pinImageUrl,
  sheetImageUrl,
  type SheetForm,
} from '@/features/map/MomentSheet';
import type {
  Viewport,
  Cluster,
  MapSurfaceHandle,
  MapPoint,
} from '@/features/map/types';

// Public, read-only web player (Task-5 brief, spec §5.2): shows the same
// story as mobile/src/app/(tabs)/recap/[id]/player.tsx, cinema palette,
// progress bar, day separators, author, time, place, caption. WITHOUT the
// emoji bar, WITHOUT comments, WITHOUT reporting, WITHOUT login. Built as
// its OWN, smaller screen instead of copying the 1532 line player or bending
// it with a `viewOnly` switch, see the report for the reasoning. Reused are
// the finished, reviewed building blocks: ProgressBar, playerLogic
// (durationFor, advance, goBack, dayChanges, PauseReason/withReason/
// withoutReason/blocksAutoAdvance) and days.ts (groupByDays, sortMoments),
// UNCHANGED, no import from recapApi.ts/socialApi.ts/AuthProvider (W4:
// none of that may even APPEAR in this screen's module graph, not merely
// stay unused, see share/__tests__/moduleGraph.test.ts).
//
// Deliberate simplifications compared to the native player (each justified
// in the report):
// - No close button, no swipe down: there is no "previous" route to return
//   to, the page IS the whole web experience (isWebLocked in guard.ts locks
//   out everything else).
// - No cinema fade when entering: that one pictures "the lights go out" on
//   the way from a BRIGHT screen, and there is no preceding bright screen
//   within this session, the browser tab loads straight into the cinema.
// - A failed photo/video shows the hint pill IMMEDIATELY (no invisible
//   retry, no V10 URL renewal like in the native player): the pool here
//   comes from ONE call without a session, and a second, silently
//   re-signing background call would be extra complexity for a use case (a
//   story usually played through within minutes) the task brief does not
//   ask for.
//
// Since Task 15 the same screen carries the SECOND reading of the recap: the
// map (spec §5.10). It replaces the player instead of getting a route of its
// own, a shared link is ONE URL, and a second route would be one nobody can
// share and that would be opened without any history. The map surface itself
// is the one the app uses (features/map/MapSurface.tsx natively, .web.tsx in
// the browser); this screen hands it pins, line and camera and decides what
// a tap sets off.
const PRELOAD_COUNT = 3;
const INTERSTITIAL_DURATION_MS = 1500;
const TAP_THRESHOLD_MS = 250;

// The two readings (spec §5.10), the segment row word for word as in the
// app's overview, where it reads «Nach Tagen · Auf der Karte».
const VIEW_LABEL = 'Ansehen';
const MAP_LABEL = 'Auf der Karte';
// What sets this page's sheets apart from those of the app map
// (features/map/MomentSheet.tsx), and nothing else: the button is named
// differently here, because there is no recap player to jump into, only the
// shared player on THIS screen (spec §5.10).
const SHEET_FORM: SheetForm = { buttonLabel: 'Ab hier ansehen', prefix: 'teilen-' };
// Height of the segment row (36 + 2 × 4 padding), the same 44 points as
// every other pill in this project. A constant, because the player's header
// slides underneath as soon as the row exists.
const SEGMENT_HEIGHT = 44;

type LoadPhase = 'loading' | 'error' | 'empty' | 'ready' | 'end';
type MediaLink = { medium_url: string; thumb_url: string | null };

// Maps the shareApi response onto the RecapMoment shape so that
// durationFor/groupByDays/dayChanges/sortMoments/toMapPoints stay reusable
// UNCHANGED (they are typed on RecapMoment[]). The fields filled in here
// (trip_id, author_id, upload_status) are read by NONE of the reused
// functions, id serves as the stable key (from post_id), the rest are pure
// placeholders to satisfy the shape.
//
// lat/lng are PASSED THROUGH since Task 15 instead of being set to null:
// they are the basis of the map on this page (spec §5.10). shareApi.ts
// checks them for a finite number while reading, so what arrives here is
// either a usable coordinate or `null`.
//
// The avatar key is likewise PASSED THROUGH since Task 10 (fixed null
// before, SharedMoment carried no image key back then): the KEY, never a
// finished URL, `<Avatar>` builds the URL itself via avatarUrl()
// (features/auth/avatar.ts).
function toRecapMoment(m: SharedMoment): RecapMoment {
  return {
    id: m.post_id,
    trip_id: '',
    author_id: '',
    type: m.type,
    duration_s: m.duration_s,
    caption: m.caption,
    captured_at: m.captured_at,
    captured_tz: m.captured_tz,
    place_name: m.place_name,
    lat: m.lat,
    lng: m.lng,
    upload_status: 'uploaded',
    authorName: m.authorName,
    authorAvatarKey: m.authorAvatarKey,
  };
}

// The day's date on the interstitial, formatted like in the native player
// (player.tsx), as a small copy of its own: player.tsx does not export the
// helper, and this screen does not go and rebuild it over there.
//
// The time of day sat here as a copy too until Task 15. It now comes from
// features/recap/timeOfDay.ts, which is the place the comment over there
// points at ("switching the two screens over is mechanical follow-up work"),
// and that file has been in this screen's module graph since the map anyway
// (features/map/pin.ts builds its label from it).
const MONTHS_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
function formatDayDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONTHS_LONG[m - 1]}`;
}
function dayHeading(day: RecapDay): string {
  const parts = [`Tag ${day.number}`];
  if (day.place) parts.push(day.place);
  parts.push(formatDayDate(day.date));
  return parts.join(' · ');
}

function CinemaButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <View style={styles.cinemaButton}>
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

function LoadingHintPill({ text }: { text: string }) {
  return (
    <Pill style={styles.loadingHintPill}>
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{text}</Text>
    </Pill>
  );
}

// Discreet footer (brief: "the Reelive wordmark and «Hol dir die App»
// discreetly at the bottom", concept §5.9), purely informative, NO button:
// there is no store link yet (Task 11 of this phase only follows later), and
// a link into nothing would be worse than none at all.
function FooterBar() {
  return (
    <View testID="teilen-fussleiste" style={styles.footerBar} pointerEvents="none">
      <Text style={[type.label, { color: cinema['text-1'] }]}>Reelive</Text>
      <Text style={[type.secondary, { color: cinema['text-2'] }]}>Hol dir die App</Text>
    </View>
  );
}

function PhotoMoment({ url, onError }: { url: string; onError: () => void }) {
  return (
    <Image
      testID="teilen-foto"
      source={{ uri: url }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={150}
      onError={onError}
    />
  );
}

function VideoMoment({
  url, paused, onEnd, onError,
}: {
  url: string;
  paused: boolean;
  onEnd: () => void;
  onError: () => void;
}) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    const endSub = player.addListener('playToEnd', onEnd);
    const statusSub = player.addListener('statusChange', (payload: { status: string }) => {
      if (payload.status === 'error') onError();
    });
    return () => {
      endSub.remove();
      statusSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

  return (
    <VideoView
      testID="teilen-video"
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

function MomentView({
  moment, url, failed, paused, onVideoEnd, onError,
}: {
  moment: RecapMoment;
  url: MediaLink | undefined;
  failed: boolean;
  paused: boolean;
  onVideoEnd: () => void;
  onError: () => void;
}) {
  if (!failed && url) {
    return moment.type === 'video' ? (
      <VideoMoment url={url.medium_url} paused={paused} onEnd={onVideoEnd} onError={onError} />
    ) : (
      <PhotoMoment url={url.medium_url} onError={onError} />
    );
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      {url?.thumb_url && (
        <Image source={{ uri: url.thumb_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      <View style={styles.loadingHintWrap}>
        <LoadingHintPill
          text={
            moment.type === 'video'
              ? 'Dieses Video lässt sich gerade nicht laden.'
              : 'Dieses Foto lässt sich gerade nicht laden.'
          }
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The map (spec §5.10)
// ---------------------------------------------------------------------------

// Moments this page never received at all: the function could hand out no URL
// for them (`ausgelassen`, share-link/aufloesung.ts). Worded exactly as in
// overview.tsx and recap/[id]/map.tsx: the same situation says the same thing
// everywhere.
function skippedText(count: number): string {
  return `${count} ${count === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

function withoutPlaceText(count: number): string {
  const word = count === 1 ? 'Moment' : 'Momente';
  const secondSentence = count === 1 ? 'Er läuft' : 'Sie laufen';
  return `${count} ${word} ohne Ort. ${secondSentence} im Recap mit.`;
}

// One half of the segment row.
//
// The ACTIVE half is deliberately NOT a button: it shows where you are, a tap
// on it would do nothing, and press feedback would be a promise nobody keeps
// (the same decision as in overview.tsx). `accessible` bundles surface and
// text into one element so VoiceOver reads the state as one piece of
// information instead of loose text next to a button.
//
// Colours differ from the app's overview, for a reason that is not taste:
// there the row lies on white, here on a FOREIGN SURFACE (photo or map
// tiles). DESIGN-LANGUAGE §1 allows only the translucent pill on top of
// that, so the pill carries the track, and the active half inside it is the
// bright surface of the CinemaButton. The passive text uses `cinema.text-1`
// and not `text-2` (§4, tab bar): §4 describes the tab bar on `bg-0`; here
// the ground is semi-transparent over a bright map, and the weaker tone
// would no longer be reliably readable there. The difference is carried by
// the fill, not by the text colour.
function SegmentHalf({
  label, active, testID, onPress,
}: {
  label: string;
  active: boolean;
  testID: string;
  onPress: () => void;
}) {
  if (active) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${label}, aktuelle Ansicht`}
        testID={testID}
        style={styles.segmentActive}
      >
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    );
  }
  return (
    <PressScale accessibilityRole="button" testID={testID} onPress={onPress}>
      <View style={styles.segmentPassive}>
        <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

// The way into the map and the way back, ONE element for both, in ONE place,
// in both views. It sits at the very top on purpose and not in the player's
// header: the header belongs to the player (progress, author, place/time),
// this row belongs to the screen. And it must not jump while switching, or
// the way back would have to be searched for instead of found where it was
// just tapped.
// `onSwitch` takes no argument although there are two halves: the ACTIVE one
// is not a button (see above), so only the other one can ever be pressed, the
// switch has no target to choose. An `onSwitch(true|false)` would only look
// like the closer fit and would be an ignored argument at both call sites.
function SegmentRow({
  onMap, onSwitch, top,
}: {
  onMap: boolean;
  onSwitch: () => void;
  /** Distance to the top edge, from `useTopInset`, see there. */
  top: number;
}) {
  return (
    // `box-none`: the frame spans the full width and must not swallow a tap
    // left or right of the pill, in the player the tap zone lies underneath,
    // on the map the map itself.
    <View style={[styles.segmentRow, { top }]} pointerEvents="box-none">
      <Pill style={styles.segmentTrack}>
        <SegmentHalf
          label={VIEW_LABEL}
          active={!onMap}
          testID="teilen-segment-ansehen"
          onPress={onSwitch}
        />
        <SegmentHalf
          label={MAP_LABEL}
          active={onMap}
          testID="teilen-segment-karte"
          onPress={onSwitch}
        />
      </Pill>
    </View>
  );
}

export default function SharedRecapScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [tripName, setTripName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [skipped, setSkipped] = useState(0);
  // Reference-stable from the moment load() sets it once, dayChanges memoises
  // over the ARRAY REFERENCE, not over content or length (the same contract
  // as in the native player, playerLogic.ts).
  const [playlist, setPlaylist] = useState<RecapMoment[]>([]);
  const [urls, setUrls] = useState<Map<string, MediaLink>>(new Map());
  const [state, setState] = useState<PlayerState>({ index: 0, paused: new Set(), progress: 0 });
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'player' | 'map'>('player');
  // The last REPORTED map viewport, or `null` for "the map has not reported
  // anything yet". It is the basis of the clustering (which counts in screen
  // points and needs the current zoom), and at the same time the viewport the
  // map opens with the next time, see below.
  const [viewport, setViewport] = useState<Viewport | null>(null);
  // What the moment sheet currently shows, or `null` for "none open". ONE
  // state for both cases, because they answer the same question ("which
  // moments sit behind this pin") and rule each other out: one point is the
  // single moment (spec §5.7), several are the list of a cluster that cannot
  // be zoomed apart.
  const [sheet, setSheet] = useState<MapPoint[] | null>(null);

  const active = useRef(true);
  const segmentStartRef = useRef(0);
  const touchStartRef = useRef(0);
  const activeIdRef = useRef<string | undefined>(undefined);
  const pausedRef = useRef<ReadonlySet<PauseReason>>(new Set());
  // The segment row is the topmost element of this screen and therefore the
  // first to meet the Dynamic Island. `spacing.xl` was the player header's
  // previous fixed distance; `useTopInset` leaves it standing where it is
  // enough and only gives way where the device takes more.
  const top = useTopInset(spacing.xl);
  const map = useRef<MapSurfaceHandle>(null);
  // The last zoom attempt on a cluster, the basis for whether another one
  // still achieves anything (features/map/clusterTap.ts). A ref and not
  // state: the value changes nothing on screen, it only answers the next
  // question.
  const lastZoom = useRef<ZoomAttempt | null>(null);

  const reducedMotion = useReducedMotion();
  // The surface the clustering happens on: the map lies as an absoluteFill
  // over the whole screen, so the window is its measure (the same reasoning
  // as in recap/[id]/map.tsx).
  const { width, height } = useWindowDimensions();

  const load = useCallback(async () => {
    setPhase('loading');
    setErrorText(null);
    // Everything belonging to the PREVIOUS resolution goes away here. The
    // screen stays mounted when the token changes (same route, different
    // parameter), and a sheet left standing would afterwards carry a moment
    // of the previous trip, its button setting the player to an index that
    // points at a completely different moment in the new trip.
    setView('player');
    setSheet(null);
    setViewport(null);
    setSkipped(0);
    lastZoom.current = null;
    const { data, error } = await resolveToken(token);
    if (!active.current) return;

    if (error || !data) {
      setErrorText(error ?? DEAD_LINK_TEXT);
      setPhase('error');
      return;
    }

    const list = sortMoments(data.medien.map(toRecapMoment));
    const urlMap = new Map<string, MediaLink>(
      data.medien.map((m) => [m.post_id, { medium_url: m.medium_url, thumb_url: m.thumb_url }])
    );
    setTripName(data.reise.name);
    setStartDate(data.reise.start_date);
    setSkipped(data.ausgelassen);
    setUrls(urlMap);
    setPlaylist(list);
    setFailed(new Set());

    if (list.length === 0) {
      setPhase('empty');
      return;
    }
    setState({ index: 0, paused: new Set(), progress: 0 });
    setPhase('ready');
  }, [token]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, [load]);

  // No useFocusEffect needed: there is no sibling route this screen could be
  // returned to (see the file header).
  useEffect(() => {
    setStatusBarStyle(view === 'map' ? 'dark' : 'light');
  }, [view]);

  const activeMoment = playlist[state.index];
  activeIdRef.current = activeMoment?.id;
  const interstitial = state.paused.has('zwischenkarte');
  const paused = state.paused.size > 0;
  pausedRef.current = state.paused;

  const days = useMemo(() => groupByDays(playlist, startDate), [playlist, startDate]);
  const currentDay = useMemo(() => {
    if (!activeMoment) return null;
    return days.find((d) => d.moments.some((m) => m.id === activeMoment.id)) ?? null;
  }, [days, activeMoment]);

  // -------------------------------------------------------------------------
  // The map (spec §5.10)
  // -------------------------------------------------------------------------

  const { points, withoutPlace } = useMemo(() => toMapPoints(playlist), [playlist]);

  const startViewport = useMemo(() => viewportFor(points), [points]);

  // What the map opens with AND what the clustering runs on.
  //
  // The surface is TORN DOWN when switching to the player and mounted anew
  // when switching back, not merely hidden. Two reasons:
  //
  // - `initialViewport` only takes effect on mount (types.ts). A permanently
  //   mounted surface would have to have its camera dragged along via
  //   `flyTo`; this way "when the map becomes visible" and "when the viewport
  //   applies" fall together by themselves, and there is no second path along
  //   which the camera gets set.
  // - In the browser Leaflet builds the map into a DOM node and derives the
  //   zoom from its SIZE (`fitBounds` to `getBoundsZoom`, MapSurface.web.tsx).
  //   A hidden surface has the size 0 × 0, and the wrapper calls
  //   `invalidateSize()` nowhere, so "mounted but invisible" is not even a
  //   possibility over there but a map that opens on a meaningless zoom level.
  //
  // So that the map still does not jump back to its starting position when
  // switching back, it opens with the last reported viewport. The first time
  // there is none, then it shows everything.
  const visibleViewport = viewport ?? startViewport;

  const line = useMemo(
    () => points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [points]
  );

  const clusters = useMemo(
    () => (visibleViewport ? cluster(points, visibleViewport, width, height) : []),
    [points, visibleViewport, width, height]
  );

  // A pin's image, as a lookup function instead of a finished list: the
  // surface asks for the anchor of each cluster, and which clusters there are
  // it knows better than this screen does.
  const thumbFor = useCallback((postId: string) => pinImageUrl(urls, postId), [urls]);

  const rememberViewport = useCallback((visible: Viewport) => setViewport(visible), []);

  // The camera is moved by THE SURFACE, not by this screen. The reduced
  // motion switch sits there too, it belongs to the technique of the
  // respective map (animateToRegion/setRegion natively, flyTo/setView in the
  // browser).
  const show = useCallback((target: Viewport) => map.current?.flyTo(target), []);

  // What a tap on a cluster additionally needs to know, in a ref instead of
  // in the dependencies of `onCluster`. If the function hung on the viewport,
  // every pin would get a new `onPress` on EVERY map movement, and the `memo`
  // on the marker (components/MapPin.tsx) would have no effect.
  //
  // `useLayoutEffect`, not `useEffect`: a passive effect only runs AFTER the
  // commit, and in that window a tap would still read the old state, the map
  // coming out of a flight and the tap on the pin that just appeared counting
  // with the zoom from before.
  const mapState = useRef<Viewport | null>(visibleViewport);
  useLayoutEffect(() => {
    mapState.current = visibleViewport;
  }, [visibleViewport]);

  const onCluster = useCallback(
    (tappedCluster: Cluster) => {
      const visible = mapState.current;

      // Unreachable, but needed for the type: `clusters` is only calculated
      // when the viewport stands, without it there would be no pin at all.
      if (!visible) return;

      // The decision "zoom or sheet" lives in features/map/clusterTap.ts,
      // shared with the app's map screen, together with the reasoning there
      // for why bit-identical coordinates are not enough for it: the map has
      // a last zoom level, and three to eight metres of GPS offset no longer
      // separate them there.
      if (zoomExhausted(tappedCluster, visible, lastZoom.current)) {
        setSheet(tappedCluster.points);
        return;
      }

      const target = zoomTarget(tappedCluster, visible);
      // Unreachable (a cluster has at least one point), but the type of
      // `zoomTarget` (it passes `viewportFor`'s `null` through) demands the
      // handling.
      if (!target) return;

      lastZoom.current = { anchorId: tappedCluster.anchor.moment.id, before: visible };

      // DESIGN-LANGUAGE §5 names selection haptics for "zoom". `.catch`,
      // because a rejected promise from a native module would otherwise count
      // as an unhandled rejection; in the browser there is no haptics, the
      // call is a no-op there.
      void Haptics.selectionAsync().catch(() => {});

      show(target);
    },
    [show]
  );

  // What a tap on this cluster WILL do, for the label VoiceOver reads out.
  // The same question and the same answer as above, only without the
  // consequences; worded exactly as in recap/[id]/map.tsx, together with the
  // reasoning there for why the surface cannot calculate this itself and why
  // the viewport here does NOT come from `mapState`: this question is asked
  // while rendering, the ref only catches up in the layout effect afterwards.
  const opensSheet = useCallback(
    (tappedCluster: Cluster) => {
      if (!visibleViewport) return false;
      return zoomExhausted(tappedCluster, visibleViewport, lastZoom.current);
    },
    [visibleViewport]
  );

  // "Ab hier ansehen" (spec §5.10). The sheet closes on the way, unlike in
  // the app: there the player pushes itself over it as its own route and the
  // open sheet stays for the way back. Here it would lie on top of the player
  // it has just started.
  const viewFromHere = useCallback((entry: MapPoint) => {
    setState({ index: entry.index, paused: new Set(), progress: 0 });
    setPhase('ready');
    setSheet(null);
    setView('player');
  }, []);

  const switchView = useCallback((target: 'player' | 'map') => {
    setSheet(null);
    setView(target);
  }, []);

  // Whether this page has a map at all (spec K9). Unlike in the app it needs
  // no explanatory empty screen for that, the entrance simply does not come
  // into being, and the player stands there undisturbed.
  const hasMap = visibleViewport !== null;

  const advanceAutomatically = useCallback(() => {
    const result = advance(state, playlist.length);
    if (result === 'ende') {
      setPhase('end');
      return;
    }
    // A real index change: 'halten' belongs to the moment being LEFT and must
    // not block the new one (the same contract as in the native player).
    // 'zwischenkarte' stays untouched, the effect below (deps include
    // state.index) manages it itself.
    setState({ ...result, paused: withoutReason(result.paused, 'halten') });
  }, [state, playlist.length]);
  const advanceAutomaticallyRef = useRef(advanceAutomatically);
  advanceAutomaticallyRef.current = advanceAutomatically;

  const onVideoEnded = useCallback((postId: string) => {
    if (activeIdRef.current !== postId) return;
    if (blocksAutoAdvance(pausedRef.current)) return;
    advanceAutomaticallyRef.current();
  }, []);

  // ONE timer for photos AND videos (durationFor delivers a sensible duration
  // for both), for a video at the same time the fallback in case it never
  // loads.
  useEffect(() => {
    if (phase !== 'ready' || view !== 'player' || state.paused.size > 0) return;
    const moment = playlist[state.index];
    if (!moment) return;
    const duration = durationFor(moment);
    const rest = Math.max(0, duration - state.progress);
    segmentStartRef.current = Date.now() - state.progress;
    const timer = setTimeout(() => advanceAutomaticallyRef.current(), rest);
    return () => clearTimeout(timer);
  }, [phase, view, state.paused, state.index, state.progress, playlist]);

  // `view` sits in the dependencies although the effect reads it nowhere, and
  // that is not sloppiness but the assurance itself: the day announcement is
  // an announcement of the PLAYER. So the effect runs anew on every change of
  // view and begins the one and a half seconds from the start.
  //
  // An additional `view !== 'player'` in the body stood here briefly and flew
  // out again: it was demonstrably not observable (the effect rebuilds the
  // state on the way back anyway), exactly the kind of condition nobody can
  // check later.
  useEffect(() => {
    if (phase !== 'ready') return;
    if (!dayChanges(playlist, startDate, state.index)) {
      setState((s) => (s.paused.has('zwischenkarte') ? { ...s, paused: withoutReason(s.paused, 'zwischenkarte') } : s));
      return;
    }
    setState((s) => ({ ...s, paused: withReason(s.paused, 'zwischenkarte') }));
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, paused: withoutReason(s.paused, 'zwischenkarte') }));
    }, INTERSTITIAL_DURATION_MS);
    return () => clearTimeout(timer);
  }, [phase, view, playlist, startDate, state.index]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const upcomingUrls = playlist
      .slice(state.index + 1, state.index + 1 + PRELOAD_COUNT)
      .filter((m) => m.type === 'photo')
      .map((m) => urls.get(m.id)?.medium_url)
      .filter((u): u is string => !!u);
    if (upcomingUrls.length > 0) void Image.prefetch(upcomingUrls);
  }, [phase, state.index, playlist, urls]);

  const skipInterstitial = () => {
    setState((s) => ({ ...s, paused: withoutReason(s.paused, 'zwischenkarte') }));
  };

  const onLoadError = useCallback((postId: string) => {
    if (activeIdRef.current !== postId) return;
    setFailed((s) => new Set(s).add(postId));
  }, []);

  const onPressIn = () => {
    touchStartRef.current = Date.now();
    const moment = playlist[state.index];
    if (!moment) return;
    const duration = durationFor(moment);
    const elapsed = Math.min(duration, Math.max(0, Date.now() - segmentStartRef.current));
    setState((s) => ({ ...s, paused: withReason(s.paused, 'halten'), progress: elapsed }));
  };

  const endTouch = (side: 'left' | 'right') => {
    const held = Date.now() - touchStartRef.current;
    if (held < TAP_THRESHOLD_MS) {
      if (side === 'right') {
        const result = advance(state, playlist.length);
        if (result === 'ende') {
          setPhase('end');
          return;
        }
        setState({ ...result, paused: withoutReason(result.paused, 'halten') });
        return;
      }
      const backResult = goBack(state);
      setState({ ...backResult, paused: withoutReason(backResult.paused, 'halten') });
      return;
    }
    setState((s) => ({ ...s, paused: withoutReason(s.paused, 'halten') }));
  };

  const watchAgain = () => {
    setState({ index: 0, paused: new Set(), progress: 0 });
    setPhase('ready');
  };

  if (phase === 'loading') {
    return (
      <View testID="teilen-laedt" style={styles.screen}>
        <ActivityIndicator color={cinema['text-1']} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View testID="teilen-fehler" style={[styles.screen, styles.center]}>
        <Text style={[type.h2, styles.centeredText]}>{errorText}</Text>
        <View style={{ marginTop: spacing.xl }}>
          <CinemaButton label="Nochmal versuchen" onPress={() => void load()} />
        </View>
        <FooterBar />
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View testID="teilen-leer" style={[styles.screen, styles.center]}>
        <Text style={[type.h2, styles.centeredText]}>
          {tripName ? `${tripName} ist leer geblieben.` : 'Dieser Recap ist leer geblieben.'}
        </Text>
        <FooterBar />
      </View>
    );
  }

  if (view === 'map' && visibleViewport) {
    return (
      // NO cinema surface underneath: the map is a bright tool for finding,
      // as in the app, not a media full screen (spec §5.3). The tiles bring
      // their own colours, they are content like a photo, not interface
      // (decision R2); what lies ON TOP of them stays binding.
      <View testID="teilen-karte" style={styles.surface}>
        <MapSurface
          ref={map}
          initialViewport={visibleViewport}
          clusters={clusters}
          line={line}
          thumbFor={thumbFor}
          onCluster={onCluster}
          opensSheet={opensSheet}
          onViewportChange={rememberViewport}
          reducedMotion={reducedMotion}
        />

        {/* The moments that cannot carry a pin (spec K6). Unlike in the app a
            pure PIECE OF INFORMATION without a sheet: there the map is a
            screen of its own, and without the tile list those moments could
            not be reached from it at all. Here the way to them lies one pill
            width away, "Ansehen" plays the whole trip, those moments
            included. Hence `pointerEvents: none`: the row says something, it
            promises nothing. */}
        {(withoutPlace.length > 0 || skipped > 0) && (
          <View style={styles.bar} pointerEvents="none">
            {skipped > 0 && (
              <Pill testID="teilen-ausgelassen" style={styles.barPill}>
                <Text style={[type.secondary, { color: cinema['text-1'] }]}>
                  {skippedText(skipped)}
                </Text>
              </Pill>
            )}
            {withoutPlace.length > 0 && (
              <Pill style={styles.barPill}>
                <Text style={[type.secondary, { color: cinema['text-1'] }]}>
                  {withoutPlaceText(withoutPlace.length)}
                </Text>
              </Pill>
            )}
          </View>
        )}

        {/* Only mounted once there is something to show: `Sheet` brings its
            entry animation along in an effect (spring-ui, DESIGN-LANGUAGE
            §4), so a freshly mounted one opens from below every time. */}
        {sheet !== null && (
          <Sheet
            visible
            // The list gets a heading, the single moment does not: there the
            // image is the header (spec §5.7).
            title={sheet.length > 1 ? `${sheet.length} Momente an diesem Ort` : undefined}
            onClose={() => setSheet(null)}
          >
            {sheet.length === 1 ? (
              <MomentSheetContent
                point={sheet[0]}
                imageUrl={sheetImageUrl(urls, sheet[0].moment.id)}
                form={SHEET_FORM}
                onView={viewFromHere}
              />
            ) : (
              <ClusterSheetContent
                points={sheet}
                urls={urls}
                form={SHEET_FORM}
                onView={viewFromHere}
              />
            )}
          </Sheet>
        )}

        {/* Last in the tree and with the highest zIndex: the way back into the
            player must not be covered by anything. */}
        <SegmentRow onMap onSwitch={() => switchView('player')} top={top} />
      </View>
    );
  }

  if (phase === 'end') {
    return (
      <View testID="teilen-ende" style={[styles.screen, styles.center]}>
        <Text style={[type.h2, styles.centeredText]}>
          {tripName ? `Das war der Recap von „${tripName}".` : 'Das war der Recap.'}
        </Text>
        {skipped > 0 && (
          <Text style={[type.secondary, styles.centeredHint]}>{skippedText(skipped)}</Text>
        )}
        <View style={{ marginTop: spacing.xl }}>
          <CinemaButton label="Nochmal ansehen" onPress={watchAgain} />
        </View>
        <FooterBar />
        {hasMap && (
          <SegmentRow onMap={false} onSwitch={() => switchView('map')} top={top} />
        )}
      </View>
    );
  }

  // phase === 'ready', activeMoment is thus guaranteed to be set (the list is
  // never empty at this point, see load()).
  if (!activeMoment) return null;
  const url = urls.get(activeMoment.id);
  const placeTimeText = activeMoment.place_name
    ? `${activeMoment.place_name} · ${timeInZone(activeMoment.captured_at, activeMoment.captured_tz)}`
    : timeInZone(activeMoment.captured_at, activeMoment.captured_tz);

  return (
    <View testID="teilen-bereit" style={styles.screen}>
      <MomentView
        key={activeMoment.id}
        moment={activeMoment}
        url={url}
        failed={failed.has(activeMoment.id)}
        paused={paused}
        onVideoEnd={() => onVideoEnded(activeMoment.id)}
        onError={() => onLoadError(activeMoment.id)}
      />

      {/* The PLAYER's header slides underneath the segment row as soon as the
          row exists: the row belongs to the screen and therefore stands at
          the top, the progress and the information about the moment belong to
          the player and stand below it. Without a map everything stays where
          it was. */}
      <View
        style={[
          styles.headerArea,
          { top: hasMap ? top + SEGMENT_HEIGHT + spacing.base : top },
        ]}
        pointerEvents="none"
      >
        <ProgressBar
          count={playlist.length}
          activeIndex={state.index}
          durationMs={durationFor(activeMoment)}
          elapsedMs={state.progress}
          paused={paused}
        />
        <View style={styles.headerRow}>
          <Pill style={styles.namePill}>
            {/* 32 instead of the Avatar default 36: lower end of the
                DESIGN-LANGUAGE §4 range (32 to 44 px), fitting the compact
                header pill, the same size as in the native player
                (player.tsx), the same size the deleted local AvatarInitiale
                copy carried here. */}
            <Avatar name={activeMoment.authorName} avatarKey={activeMoment.authorAvatarKey} cinemaMode size={32} />
            <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{activeMoment.authorName}</Text>
          </Pill>
          <Pill style={styles.infoPill}>
            <Text style={[type.secondary, { color: cinema['text-1'] }]}>{placeTimeText}</Text>
          </Pill>
        </View>
      </View>

      {activeMoment.caption && (
        <Pill testID="teilen-caption" style={styles.captionPill} pointerEvents="none">
          <Text style={[type.body, { color: cinema['text-1'] }]}>{activeMoment.caption}</Text>
        </Pill>
      )}

      <Pressable
        testID="teilen-links"
        accessibilityRole="button"
        accessibilityLabel="Zurück zum vorherigen Moment"
        style={styles.tapZoneLeft}
        onPressIn={onPressIn}
        onPressOut={() => endTouch('left')}
      />
      <Pressable
        testID="teilen-rechts"
        accessibilityRole="button"
        accessibilityLabel="Weiter zum nächsten Moment"
        style={styles.tapZoneRight}
        onPressIn={onPressIn}
        onPressOut={() => endTouch('right')}
      />

      {interstitial && (
        <Pressable testID="teilen-zwischenkarte" style={styles.interstitial} onPress={skipInterstitial}>
          <Text style={[type.h1, styles.centeredText]}>
            {currentDay ? dayHeading(currentDay) : 'Ein neuer Tag beginnt.'}
          </Text>
        </Pressable>
      )}

      <FooterBar />

      {/* Last in the tree and with the highest zIndex, above the day
          interstitial too: switching to the map must not depend on whether a
          day happens to be breaking right now. */}
      {hasMap && (
        <SegmentRow onMap={false} onSwitch={() => switchView('map')} top={top} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  // The map view, without a cinema background: the tiles lie underneath, and
  // in the short span until they are there no black cinema hall should flash
  // up (spec §5.3: the map is bright).
  surface: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen },
  centeredText: { color: cinema['text-1'], textAlign: 'center' },
  centeredHint: { color: cinema['text-2'], textAlign: 'center', marginTop: spacing.m },
  cinemaButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: cinema['text-1'],
  },
  // `top` comes from the JSX: the player's header slides underneath the
  // segment row as soon as this trip has a map.
  headerArea: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    gap: spacing.base,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s },
  namePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  infoPill: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  captionPill: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    // xxl instead of xl (task review): leaves room for the footer (Reelive
    // wordmark plus "Hol dir die App"), which sits further down fixed at
    // bottom:xs. The pill grows UPWARDS from its `bottom` anchor and so
    // collides with no footer height, as long as the footer's total height
    // stays below the difference (xxl minus xs).
    bottom: spacing.xxl,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.control,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  tapZoneLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', zIndex: 1 },
  tapZoneRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', zIndex: 1 },
  loadingHintWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: spacing.xxl },
  loadingHintPill: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
  interstitial: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: cinema['bg-0'],
    zIndex: 2,
  },
  footerBar: {
    position: 'absolute',
    bottom: spacing.xs,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 2,
  },

  // --- The map (spec §5.10) ------------------------------------------------

  // zIndex 3: above the tap zones (1) AND above the day interstitial (2). The
  // segment row is the only way between the two readings, it must not be
  // covered by anything the player happens to be showing.
  // `top` comes from the JSX (useTopInset).
  segmentRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 3 },
  // The track carries the padding, the halves inside carry their own height:
  // 36 + 2 × 4 makes the 44 points that the back, filter and name pills have
  // as well.
  segmentTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.pill,
  },
  segmentActive: {
    height: 36,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cinema['text-1'],
  },
  segmentPassive: {
    height: 36,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The information about the moments without a place, centred at the bottom,
  // the same spot as the bar of the app map. The distance to the bottom is
  // the screen margin (DESIGN-LANGUAGE §3); in the browser the tiles'
  // attribution sits below it on the right (K14) and does not get in the way
  // of a centred pill.
  bar: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.screen,
    alignItems: 'center',
    gap: spacing.s,
  },
  // Radius 12 instead of a pill: whole sentences stand here that may wrap
  // onto two lines, and a 999 rounding around two lines of text looks like a
  // mistake.
  barPill: {
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.control,
  },
});
