import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { reportError } from '@/lib/errorReporter';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { groupByDays, sortMoments } from '@/features/recap/days';
import type { RecapMoment, RecapDay } from '@/features/recap/types';
import { getPool, retryHelps, type MediaUrl } from '@/features/recap/urlPool';
import { fetchTrip } from '@/features/trips/tripsApi';
import { viewportFor } from '@/features/map/viewport';
import { MapSurface } from '@/features/map/MapSurface';
import { cluster } from '@/features/map/clustering';
import { zoomExhausted, zoomTarget, type ZoomAttempt } from '@/features/map/clusterTap';
import { toMapPoints } from '@/features/map/mapPoints';
import { useTripBound } from '@/features/trips/useTripBound';
import { momentLabel } from '@/features/map/pin';
import {
  FadeIn,
  ClusterSheetContent,
  MomentSheetContent,
  SheetScroll,
  pinImageUrl,
  sheetImageUrl,
  rowStyles,
  type SheetForm,
} from '@/features/map/MomentSheet';
import type {
  Viewport,
  Cluster,
  MapSurfaceHandle,
  MapPoint,
} from '@/features/map/types';

// One fixed empty map instead of `new Map()` on every reset: the value feeds
// the pins as a dependency, and a map that is new every time would make them
// recompute for no reason.
const NO_URLS: ReadonlyMap<string, MediaUrl> = new Map();

// DESIGN-LANGUAGE §5: "lists = 40 ms stagger", the rows of the cluster list
// appear one after another, not as one block.
const STAGGER_MS = 40;
// §5: "prefers-reduced-motion: everything becomes a 200 ms fade". The same
// value as in Sheet.tsx (module private there).
const REDUCED_DURATION_MS = 200;

// If one of the two queries throws instead of returning its error as a value,
// there is no text from the server. Then this one has to step in, cause and
// fix, without an apology (DESIGN-LANGUAGE §6), following the same pattern as
// the generic load error in recapApi.ts.
const THROW_TEXT = 'Die Karte konnte nicht geladen werden. Probier es gleich nochmal.';

// Spec §5.9, verbatim. No empty map viewport over the Atlantic, but the
// answer why there is nothing here.
const EMPTY_TITLE = 'Diese Reise hat keine Orte';
const EMPTY_EXPLANATION =
  'Momente bekommen ihren Ort beim Einsenden, aber nur, wenn die Ortungsdienste erlaubt sind. Für diese Reise war das nie der Fall.';

// And the other empty case: there are no moments at all. Word for word the
// same as overview.tsx and player.tsx, the same trip should say the same
// thing on all three screens.
const EMPTY_WITHOUT_MOMENTS = 'Diese Reise ist leer geblieben.';

// The one line that explains the gap in the day numbers. `selectableDays`
// leaves out days where no moment has a place, the overview shows them
// anyway, so the filter jumps from day 1 to day 3. Without this sentence that
// looks like a bug instead of a rule.
const GAP_HINT = 'Tage, an denen kein Moment einen Ort hat, stehen nicht zur Wahl.';

// What separates the sheets of this screen from those of the shared recap
// (features/map/MomentSheet.tsx): the label of the button, and nothing else.
// The empty testID prefix is deliberate, see `SheetForm` there.
const SHEET_FORM: SheetForm = { buttonLabel: 'Im Recap ansehen', prefix: '' };

// The bar at the bottom AND the title of its sheet (Spec §5.8), one source
// for both. Singular and plural as everywhere in the project: the number
// stays even in the singular.
function withoutPlaceText(count: number): string {
  return `${count} ${count === 1 ? 'Moment' : 'Momente'} ohne Ort`;
}

// What this map does NOT show, in words. Word for word the same as
// overview.tsx (module private there): the same trip should say the same two
// sentences for the same two situations on both screens. Singular and plural
// as everywhere in the project, the number stays even in the singular.
//
// They are explicitly NOT the same as the bar about moments without a place:
// that one is about moments which cannot get a pin on this map but are fully
// present in overview and recap. This one is about moments the trip does not
// give out at all right now, one group is still coming, the other could not
// be loaded.
function inTransitText(count: number): string {
  return `${count} ${count === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

function withoutImageText(count: number): string {
  return `${count} ${count === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

// A moment no pin can carry, with its place in the playlist. Exactly this
// value goes to the player as `start`, just like `MapPoint.index` (types.ts):
// never the position within this list here, never the one in the raw moment
// list.
type WithoutPlace = { moment: RecapMoment; index: number };

// How far the load path of the moments has come.
//
// Without this distinction THREE different situations would look identical,
// because all three end in `points = []` and `viewport = null`: "still
// loading", "could not load" (deep link into a foreign trip, sealed trip, no
// network) and "loaded, but not a single moment has a place". Until task 10
// that was the same white surface with a back pill.
type Phase = 'loading' | 'error' | 'loaded';

// The result of ONE load, with the trip it belongs to. The reasoning for the
// stamp stands at the state declaration.
type LoadState = {
  tripId: string;
  phase: Phase;
  points: MapPoint[];
  withoutPlace: WithoutPlace[];
  // Moments this map does not show at all, neither as a pin nor in the bar
  // about moments without a place. They drop out of the playlist in the load
  // path below, and without these two numbers they would do so without a
  // trace: a trip with 15 moments showed 11 pins, named 3 moments without a
  // place, and the missing rest could not be explained from the outside.
  //
  // Kept apart because these are two different situations with two different
  // outlooks, exactly as in overview.tsx: `inTransit` is still coming,
  // `withoutImage` could not be loaded right now.
  inTransit: number;
  withoutImage: number;
  errorText: string | null;
  // Whether a second attempt achieves anything. Inside the load state and not
  // beside it: the answer belongs to exactly this error text and is set
  // together with it, kept apart the two could drift and the button would
  // promise something the text already rules out.
  //
  // `false` only on a factual rejection of the pool (sealed, no access,
  // features/recap/urlPool.ts). Without an error the value is meaningless and
  // stands on `true`.
  canRetry: boolean;
};

// Fixed empty lists instead of `[]` on every derivation, same reason as
// NO_URLS above: the values feed `visiblePoints`, `line` and `clusters` as
// dependencies, and an array that is new on every render would make them
// recompute for no reason.
const NO_POINTS: MapPoint[] = [];
const NONE_WITHOUT_PLACE: WithoutPlace[] = [];
const NO_MOMENTS: RecapMoment[] = [];

// The day filter, and on the FINISHED map points, never on the moments before
// them.
//
// This is the one place where this filter could go silently wrong:
// `point.index` counts into the unfiltered playlist and goes to the player as
// `start` (see types.ts and `toPlayer` below). If the moment list were
// narrowed down to one day first and `toMapPoints` were called on the rest,
// the index would suddenly count INSIDE the day instead of into the trip. The
// pins would still sit on their coordinates, everything would look right, and
// the jump would land on the wrong moment.
function pointsOnDay(points: MapPoint[], day: RecapDay | null): MapPoint[] {
  if (!day) return points;
  const ids = new Set(day.moments.map((m) => m.id));
  return points.filter((p) => ids.has(p.moment.id));
}

// The days this map can choose between at all.
//
// Grouping runs over the WHOLE playlist, not only over the moments with a
// place: `groupByDays` carries the highest day number given out so far
// forward monotonically (days.ts, Important 1), so a moment left out can
// shift the numbers behind it. overview.tsx and player.tsx work with exactly
// this list, and the same trip showing different day numbers in two places
// would be a bug nobody could explain from the outside.
//
// Offered from it is only what actually changes something on the map: a day
// whose moments are all without a place would lead onto an empty map without
// any explanation, a dead end in the filter that only the way back to all
// days gets out of. What falls away tears a gap into the numbers (day 1, day
// 3), and GAP_HINT explains that gap in the sheet instead of leaving it
// silent.
function selectableDays(allDays: RecapDay[], points: MapPoint[]): RecapDay[] {
  const withPlace = new Set(points.map((p) => p.moment.id));
  return allDays.filter((day) => day.moments.some((m) => withPlace.has(m.id)));
}

// The moments without a place, with their position in the playlist.
//
// The order comes from `sortMoments`, THE SAME function `toMapPoints` gives
// out its indices with (mapPoints.ts). It is a total order (captured_at, id
// as the second criterion, days.ts), so applying it twice to the same list
// necessarily yields the same order: the tile of a moment without a place and
// the pin of a moment with one therefore provably count into the same list.
//
// Not over the incoming order: `fetchRecapMoments` sorts by itself today
// (recapApi.ts), which is exactly why it would show nowhere if the incoming
// list were counted here, until one day somebody moves that sorting. WHO has
// no place is still decided by `toMapPoints` alone; here it is only looked up
// at which position they stand.
function withoutPlaceWithIndex(playlist: RecapMoment[], withoutPlace: RecapMoment[]): WithoutPlace[] {
  const ids = new Set(withoutPlace.map((m) => m.id));
  return sortMoments(playlist)
    .map((moment, index) => ({ moment, index }))
    .filter((entry) => ids.has(entry.moment.id));
}

// One row of the day list (task 9 brief): all days, or a single trip day. No
// primary button, DESIGN-LANGUAGE §4 allows exactly one per screen, and the
// moment sheet carries it.
//
// The check marks the state the pill at the top shows: in a list longer than
// the sheet it is the only place where scrolling still shows what currently
// applies. `accessibilityState.selected` tells VoiceOver the same thing the
// check shows.
function DayEntry({
  label, place, active, position, testID, onSelect,
}: {
  label: string;
  place?: string | null;
  active: boolean;
  position: number;
  testID: string;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  return (
    <FadeIn position={position}>
      <PressScale
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        testID={testID}
        onPress={onSelect}
      >
        <View style={rowStyles.row}>
          <View style={rowStyles.text}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{label}</Text>
            {/* The place of the day only stands there when there is one
                (days.placeOfTheDay returns null otherwise), no invented
                placeholder. On a MAP it is the actually useful piece of
                information: a day number says little, a city name a lot. */}
            {place ? (
              <Text numberOfLines={1} style={[type.secondary, { color: colors['text-2'] }]}>
                {place}
              </Text>
            ) : null}
          </View>
          {active && <Check size={20} color={colors.accent} strokeWidth={1.75} />}
        </View>
      </PressScale>
    </FadeIn>
  );
}

// One tile of the moments without a place, the same tile list as in the
// overview (Spec §5.8): square, radius 12 (the thumbnail value from
// DESIGN-LANGUAGE §3), three per row. No primary button on the tile and none
// in the sheet around it: there is exactly one per screen (§4), and the
// moment sheet carries it.
function WithoutPlaceTile({
  entry, thumbUrl, position, onView,
}: {
  entry: WithoutPlace;
  thumbUrl: string | null;
  position: number;
  onView: (entry: WithoutPlace) => void;
}) {
  const { colors } = useTheme();
  const { moment } = entry;
  return (
    <FadeIn position={position}>
      <PressScale
        scaleTo={0.96}
        accessibilityRole="button"
        accessibilityLabel={momentLabel(moment)}
        testID={`ohne-ort-kachel-${moment.id}`}
        onPress={() => onView(entry)}
      >
        <View style={[styles.tile, { backgroundColor: colors['bg-1'] }]}>
          {/* Without a usable URL the calm bg-1 surface stays, no pulse:
              nothing more is coming (the same distinction as in the pin
              skeleton and in the moment sheet). */}
          {thumbUrl !== null && (
            <Image
              testID={`ohne-ort-bild-${moment.id}`}
              source={{ uri: thumbUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={motion.duration.fast}
            />
          )}
        </View>
      </PressScale>
    </FadeIn>
  );
}

// DESIGN-LANGUAGE §4: "skeleton: bg-1 blocks, opacity pulse 0.6 to 1.0 (no
// gradient shimmer)". On this screen the block is the WHOLE surface, the map
// fills it later just the same (Spec §5.3), there is nothing beside it a
// smaller block could hint at.
//
// WITH a way back, unlike the skeleton screen in overview.tsx: the overview
// is a tab root, the map a screen reached by `push`. Neither `urlPool.ts` nor
// `recapApi.ts` knows a timeout or an AbortController, so if one of the two
// queries hangs, a pulsing grey block would otherwise stay here for good,
// with only the tab bar leading out of it (fix round 1, Important 2).
function MapSkeleton({ topInset, onBack }: { topInset: number; onBack: () => void }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.gentle, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: motion.duration.gentle, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity, reducedMotion]);

  return (
    <View style={[styles.surface, { backgroundColor: colors['bg-0'] }]}>
      <Animated.View
        testID="karte-skelett"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors['bg-1'], opacity }]}
      />
      {/* The same arrow as in the error branch, at the same spot as the back
          pill of the finished map, and not the pill itself: below it lies no
          photo and no map, but a light bg-1 surface (DESIGN-LANGUAGE §1). */}
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="Zurück"
        onPress={onBack}
        style={[styles.backLight, { top: topInset }]}
      >
        <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
      </PressScale>
    </View>
  );
}

// The map as the second reading of the same recap (Spec §5.2): the same level
// as overview.tsx and player.tsx, so that `[id]` stays shared.
//
// The screen is LIGHT, not cinema (Spec §5.3): it shows no media full screen,
// it is a tool for finding. Only the jump into the player switches into the
// cinema. The map tiles bring their own colours, they are content like a
// photo, not interface (decision R2); binding stays what lies ON them.
export default function RecapMap() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Screen margin 24 (DESIGN-LANGUAGE §3) as the base, so the back pill keeps
  // the same distance at the top as on the left; on devices with a Dynamic
  // Island useTopInset pushes it below that anyway.
  const topInset = useTopInset(spacing.screen);
  const reducedMotion = useReducedMotion();
  const map = useRef<MapSurfaceHandle>(null);
  // The last zoom attempt onto a cluster, the basis for whether another one
  // still achieves something (features/map/clusterTap.ts). A ref and not
  // state: the value changes nothing about the picture, it only answers the
  // next question.
  const lastZoom = useRef<ZoomAttempt | null>(null);
  // The surface clustering happens on. The map lies as absoluteFill over the
  // whole screen, so the window is its measure. The tab bar is missing from
  // the height; that shifts the 40 point threshold by a few percent and only
  // decides about pins that sit right on the border anyway. Measuring would
  // be more precise, but it would bring a first pass with 0 by 0 along, and
  // that projected EVERY moment onto the same spot.
  const { width, height } = useWindowDimensions();

  // Everything that comes from ONE load of the moments, in ONE state and with
  // the trip it belongs to (fix round 1, Important 1).
  //
  // Together, because it comes into being together and becomes invalid
  // together: a phase without the matching points (or the other way round)
  // never exists.
  //
  // With a stamp, because the screen stays mounted when the trip id changes,
  // and without it the load state of t1 stood over t2, not for one frame but
  // for the full load time of the new trip: the placeless explanation over a
  // trip full of places, t1's error text plus its retry button over t2, t1's
  // bar with t1's moments. And t1's pins: a tap on one opened a sheet that
  // already carries `tripId: t2`, the guard below then no longer catches, and
  // the button into the player sent it into t2 with t1's index.
  const [loadState, setLoadState] = useState<LoadState>(() => ({
    tripId: id,
    phase: 'loading',
    points: NO_POINTS,
    withoutPlace: NONE_WITHOUT_PLACE,
    inTransit: 0,
    withoutImage: 0,
    errorText: null,
    canRetry: true,
  }));
  // Only for the button in the error branch. A second attempt deliberately
  // does NOT reset the phase to 'loading': the error text should stay while
  // the new attempt runs, otherwise a skeleton flashes between two failures
  // and nobody can read what was actually going on. Same pattern as `loading`
  // in overview.tsx.
  const [retryRunning, setRetryRunning] = useState(false);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  // The image URLs stay around, because every pin carries its own thumbnail
  // (Spec §5.4), not only to filter with.
  const [urls, setUrls] = useState<ReadonlyMap<string, MediaUrl>>(NO_URLS);
  // What the sheet currently shows, or `null` for none open. ONE state for
  // both cases, because they answer the same question (which moments are
  // behind this pin) and exclude one another: one point is the single moment
  // (Spec §5.7), several are the list of a cluster that cannot be zoomed
  // apart (task 8 brief, step 2b).
  //
  // With the trip it was opened from: the screen stays mounted when the id
  // changes (the same reason the load path below clears its states), and a
  // sheet left standing would afterwards show a moment of the PREVIOUS trip,
  // its button sent the player into the new trip with the previous trip's
  // index, where the same number points at a completely different moment.
  //
  // `useTripBound` holds the stamp and throws the value away on a change
  // (features/trips/useTripBound.ts, including the full reasoning why that
  // has to happen while RENDERING and not in an effect). Four states of this
  // screen need exactly that, and four times the same hand written comparison
  // was the pattern this phase lost three rounds to.
  const [sheetPoints, setSheetPoints] = useTripBound<MapPoint[] | null>(id, null);
  // The two halves the day numbers come out of, each with the trip it stems
  // from. They come from TWO separate queries (see the load paths below), and
  // a mixture of two trips would give numbers that exist in neither: the
  // start date of one, the moments of the other.
  //
  // The playlist lies here in addition to `points`, because it carries the
  // moments WITHOUT a place along; `selectableDays` needs it for the
  // numbering (reasoning there).
  const [playlist, setPlaylist] = useState<{ tripId: string; moments: RecapMoment[] } | null>(null);
  const [tripStart, setTripStart] = useState<{ tripId: string; startDate: string } | null>(null);
  const [dayChoice, setDayChoice] = useTripBound<number | null>(id, null);
  const [daysOpen, setDaysOpen] = useTripBound(id, false);
  const [withoutPlaceOpen, setWithoutPlaceOpen] = useTripBound(id, false);


  // The load state is DERIVED instead of reset while rendering, unlike the
  // four sheets and filters above, and for a reason that only holds for
  // loaded data: with t1 to t2 to t1, t1's state is the right one again. A
  // reset would throw it away and show a skeleton over a map that has long
  // been correct, for the length of another load. With a sheet it is the
  // other way round, there one would open by itself that nobody tapped
  // (reasoning above).
  //
  // If the state belongs to another trip, this one is simply not loaded yet:
  // 'loading'. Exactly what the screen shows when it is opened for the first
  // time.
  //
  // ONE condition for all four values, not four separate ones. Four would not
  // be checkable as of three: the phase alone already sends the screen into
  // the skeleton and returns before every other branch, so an additional
  // check on `points` or `withoutPlace` could be deleted without any
  // assertion falling, exactly the kind of condition nobody can check later
  // on. Split like this a half state cannot exist at all: either the whole
  // load state applies, or the one of a screen that has not loaded anything
  // yet.
  const visibleState: LoadState =
    loadState.tripId === id
      ? loadState
      : {
          tripId: id,
          phase: 'loading',
          points: NO_POINTS,
          withoutPlace: NONE_WITHOUT_PLACE,
          inTransit: 0,
          withoutImage: 0,
          errorText: null,
          canRetry: true,
        };
  const { phase, points, withoutPlace, inTransit, withoutImage, errorText, canRetry } =
    visibleState;
  // Derived for the same reason as above, and needed here additionally for
  // the difference between no moment having a place and there being no
  // moments at all (see the two empty branches below).
  const playlistNow =
    playlist !== null && playlist.tripId === id ? playlist.moments : NO_MOMENTS;

  // The load attempt whose answer still counts.
  //
  // An object of its own per attempt and no longer the earlier active flag:
  // since the retry button the load path can also be started by hand, so TWO
  // attempts can be open at the same time. A shared flag could only say
  // cancel all, not only the newest counts, and the slower of the two answers
  // would otherwise overwrite the newer one.
  const attempt = useRef({ valid: true });

  // The three unstamped side states of a load, they belong cleared after a
  // failure. `points` and `withoutPlace` deliberately do NOT stand here:
  // those are carried by the `LoadState`, which is set together with the
  // error in the same move.
  const clearMap = useCallback(() => {
    setUrls(NO_URLS);
    setViewport(null);
    setPlaylist(null);
  }, []);

  const load = useCallback(async () => {
    // Synchronous, before the first wait: the previous attempt stops counting
    // from here on, and the effect below can pick up its own one straight
    // afterwards from the ref.
    attempt.current.valid = false;
    const mine = { valid: true };
    attempt.current = mine;
    // The remembered zoom attempt belongs to the pins that are about to be
    // replaced. A post id does not appear in a second trip, so the comparison
    // would go nowhere anyway, but it should not be left standing either.
    lastZoom.current = null;
    try {
      const [moments, poolResult] = await Promise.all([fetchRecapMoments(id), getPool(id)]);
      if (!mine.valid) return;

      // Both queries return their error as a VALUE, and both texts are
      // already German copy in Du form (recapApi.ts, urlPool.ts), including
      // the two factual 403s about a sealed trip and about missing access,
      // which `getPool` additionally makes machine readable as `reason`.
      //
      // Pool before moments, as in overview.tsx and player.tsx: without image
      // URLs the playlist is empty anyway (it filters on `urls.has`), so the
      // pool error names the cause that lies further up.
      const error = poolResult.error ?? moments.error;
      if (error !== null) {
        clearMap();
        setLoadState({
          tripId: id,
          phase: 'error',
          points: NO_POINTS,
          withoutPlace: NONE_WITHOUT_PLACE,
          inTransit: 0,
          withoutImage: 0,
          errorText: error,
          // Only the pool knows a `reason`, and it only counts when ITS error
          // is the one shown (see the order above). The moment error is
          // always a snapshot, there a second attempt is the right move.
          canRetry:
            poolResult.error !== null ? retryHelps(poolResult.reason) : true,
        });
        return;
      }

      // THE place where a bug would stay silent: the map has to count the
      // same list as the player. `point.index` goes to it later as `start`,
      // and `parseStartIndex` counts there into exactly this filtered list
      // (player.tsx); overview.tsx builds its `indexById` out of the same
      // filtering. If this screen handed in the raw moment list, every still
      // uploading moment would shift everything behind it, the pins would
      // still sit right, but the jump would land on the wrong moment, and
      // nobody notices unless they count.
      //
      // BOTH conditions are needed, neither is covered by the other: that
      // `media-urls` signs server side only for uploaded moments (and
      // `urls.has` therefore sorts out the same thing today) is a property of
      // ANOTHER file, one this screen does not know and must not rely on.
      const poolUrls = poolResult.pool?.urls ?? NO_URLS;
      const uploaded = moments.data.filter((m) => m.upload_status === 'uploaded');
      const withImage = uploaded.filter((m) => poolUrls.has(m.id));
      const { points: p, withoutPlace: o } = toMapPoints(withImage);
      setUrls(poolUrls);
      setViewport(viewportFor(p));
      setPlaylist({ tripId: id, moments: withImage });
      setLoadState({
        tripId: id,
        phase: 'loaded',
        points: p,
        withoutPlace: withoutPlaceWithIndex(withImage, o),
        // The filtering above stays as it is, `point.index` has to match the
        // playlist, otherwise the player starts on the wrong moment. What was
        // missing is the information about WHAT falls out along the way.
        inTransit: moments.data.length - uploaded.length,
        withoutImage: uploaded.length - withImage.length,
        errorText: null,
        canRetry: true,
      });
    } catch (thrown: unknown) {
      // fetchRecapMoments and getPool return errors as a VALUE instead of
      // throwing, but "normally does not throw" is no assurance this chain
      // can carry. If one of the two does throw, the rejection would be
      // unhandled without this `catch` (fix round 1). There is no text from
      // the server then, so THROW_TEXT steps in, and the error additionally
      // goes to the error reporter (a no-op without a DSN, see
      // lib/errorReporter.ts), because only it knows the technical cause.
      if (!mine.valid) return;
      reportError(thrown, { screen: 'recap/map', tripId: id, loadPath: 'moments' });
      clearMap();
      setLoadState({
        tripId: id,
        phase: 'error',
        points: NO_POINTS,
        withoutPlace: NONE_WITHOUT_PLACE,
        inTransit: 0,
        withoutImage: 0,
        errorText: THROW_TEXT,
        canRetry: true,
      });
    }
  }, [id, clearMap]);

  useEffect(() => {
    // `load` sets its state only AFTER the first `await` (the lines before
    // touch only a ref), so the cascading renders the rule warns about do not
    // exist here. The load path has to be a `useCallback` so that the retry
    // button can reuse it instead of maintaining a second copy of the same
    // path. Same place and same reason in player.tsx and overview.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Hold on to the attempt just started HERE, not only in the cleanup:
    // `load` hooks it in synchronously before it waits for the first time
    // (see there), so the value is fixed in this line. Read in the cleanup,
    // `attempt.current` would long be a different one when the trip id
    // changes, and react-hooks/exhaustive-deps warns about exactly that,
    // rightly.
    const mine = attempt.current;
    // Without this a late answer of the PREVIOUS trip would write its pins
    // into the new one.
    return () => {
      mine.valid = false;
    };
  }, [load]);

  const retry = useCallback(async () => {
    setRetryRunning(true);
    await load();
    setRetryRunning(false);
  }, [load]);

  // The trip is loaded SEPARATELY, not in the `Promise.all` above.
  //
  // Needed from it is `start_date` alone: the day numbers count from the
  // start date OF THE TRIP (days.ts), not from the first moment, overview.tsx
  // and player.tsx read it in the same place. Without this query this screen
  // would have to guess the days out of the moments and would show different
  // numbers for the same trip than the overview.
  //
  // But: the filter is an extra, the pins ARE the screen, and in a shared
  // `Promise.all` that would only be true for the error path, not for the
  // time path. Until the viewport stands, the map is not even mounted; the
  // pins would hang on a query that contributes nothing to them. And
  // `fetchTrip` is not one query but two: internally it waits for the rpc
  // `my_post_counts` as well (tripsApi.ts), so a hanging moment counter would
  // leave an empty surface standing on an otherwise intact network, although
  // moments and URLs are long there.
  useEffect(() => {
    let active = true;
    void fetchTrip(id)
      .then(({ data: trip, error }) => {
        if (!active) return;
        // No `start_date` (load error, or the trip does not exist any more):
        // then the filter is missing, and nothing else.
        //
        // The error deliberately does NOT become visible. The pins, the line
        // and the jump into the player stand complete, an error message over
        // an intact map would claim something here is broken, and it would
        // additionally fight the bar below for the same spot. What is missing
        // is a pill that only exists at all with more than one selectable
        // day.
        //
        // It must not vanish without a trace though: until task 10 this was
        // the only load path of this screen without any report. The error
        // reporter is the only place where a missing filter caused by a
        // failed trip query can be told apart from a trip that has only one
        // day with pins, from the outside both look the same.
        if (error !== null) {
          reportError(new Error(error), { screen: 'recap/map', tripId: id, loadPath: 'trip' });
        }
        setTripStart(trip ? { tripId: id, startDate: trip.start_date } : null);
      })
      // Same reason as for the load path above: `fetchTrip` returns errors as
      // a VALUE, but "normally does not throw" carries no chain.
      .catch((error: unknown) => {
        if (!active) return;
        // With `loadPath` like the value path above: without it a throwing
        // `fetchTrip` would not be distinguishable from a throwing
        // `fetchRecapMoments` in the error reporter.
        reportError(error, { screen: 'recap/map', tripId: id, loadPath: 'trip' });
        setTripStart(null);
      });
    return () => {
      active = false;
    };
  }, [id]);

  // The visible viewport moves into state on every map movement: task 7
  // clusters pins by their distance in SCREEN points and needs the current
  // zoom for that, not the initial one.
  const rememberViewport = useCallback((visible: Viewport) => setViewport(visible), []);

  // The selectable days, only once BOTH halves belong to the trip currently
  // shown. The load paths run independently, so there is a window in which
  // the start date of the new trip is already there and the moments are still
  // those of the previous one; the numbers out of that would exist in neither
  // trip.
  //
  // `useMemo` and not a state in the load path: the calculation hangs on
  // exactly these three loaded values, and they change once per load, while
  // this screen re-renders on every map movement.
  const allDays = useMemo(() => {
    if (playlistNow.length === 0) return [];
    if (tripStart === null || tripStart.tripId !== id) return [];
    return groupByDays(playlistNow, tripStart.startDate);
  }, [playlistNow, tripStart, id]);

  const days = useMemo(() => selectableDays(allDays, points), [allDays, points]);

  // Whether the offered day numbers have a gap, exactly when `selectableDays`
  // left something out. Not read off the numbers themselves: the overview
  // shows the same numbers, and what is missing here is missing FOR THIS
  // reason, not for just any.
  const daysGap = allDays.length > days.length;

  // The selected day as an object instead of a bare number, and looked up out
  // of `days` instead of believed out of `dayChoice`: after a reload the
  // selected day can have vanished (a moment was added and shifted the
  // numbering, or the last moment of that day lost its place). If it is not
  // found any more, all days apply again; pill, pins, line and viewport ALL
  // derive from this one value and therefore cannot drift apart.
  const selectedDay = useMemo(
    () => days.find((t) => t.number === dayChoice) ?? null,
    [days, dayChoice]
  );

  // What the map shows. Filtered on the FINISHED points, see `pointsOnDay`:
  // the index in them still points into the whole trip.
  const visiblePoints = useMemo(() => pointsOnDay(points, selectedDay), [points, selectedDay]);

  // The line of the trip (Spec K3/§5.6). `points` comes out of toMapPoints
  // already sorted by `captured_at`, here it is deliberately NOT sorted
  // again: the line shows in which order things were captured, never in which
  // they were uploaded.
  //
  // `useMemo` is not polish here: `rememberViewport` makes the screen
  // re-render on every map movement, and a coordinate array that is new on
  // every render would send the polyline over the bridge every time. Over
  // `visiblePoints`, not over `points`: a line that kept drawing on to the
  // next day while a day is selected would claim a movement that did not
  // happen on that day. That changes nothing about the sorting, `pointsOnDay`
  // only filters, it does not reorder.
  const line = useMemo(
    () => visiblePoints.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [visiblePoints]
  );

  // Pins that would otherwise cover each other share one (Spec §5.5).
  // Clustering goes by the distance on THE CURRENTLY VISIBLE viewport, which
  // is why `viewport` stands in the dependencies and not merely the initial
  // value: zooming in makes a cluster fall apart by itself.
  //
  // `useMemo` binds the calculation to exactly the four values that determine
  // its result. `cluster` compares every point with every cluster so far, and
  // the screen re-renders on every map movement, plus on every state that has
  // nothing to do with the map (the incoming image URLs today, the moment
  // sheet in task 8). Without the binding it would run along on every one of
  // those renders. What is saved is the CALCULATION, not a rebuild of the
  // pins: those hang on their key and their props and would stay in place
  // without the memo too.
  const clusters = useMemo(
    () => (viewport ? cluster(visiblePoints, viewport, width, height) : []),
    [visiblePoints, viewport, width, height]
  );

  // The image of a pin, as a lookup function instead of a finished list: the
  // surface asks for the anchor of every cluster, and which clusters exist it
  // knows better than this screen. `useCallback` binds it to the pool, not to
  // every render: the screen re-renders on every map movement, the URLs
  // change once per load.
  const thumbFor = useCallback((postId: string) => pinImageUrl(urls, postId), [urls]);

  // The camera is moved by THE SURFACE, not by this screen: `show` is since
  // task 14 the imperative handle of `MapSurface` (features/map/types.ts).
  // The reduced motion switch sits there too, it belongs to the technique of
  // the respective map (animateToRegion/setRegion natively, flyTo/setView in
  // the browser), not to the screen. For this screen it stays THE one place
  // every camera movement goes through (Spec K12): the cluster zoom and the
  // day filter both call in here.
  //
  // The first start deliberately does NOT go through here: the map is only
  // mounted once the viewport stands, and it opens right there. There is
  // nothing to drive away from.
  const show = useCallback((target: Viewport) => map.current?.flyTo(target), []);

  // What a tap on a cluster additionally has to know, in a ref instead of in
  // the dependencies of `onCluster`. If the function hung on `viewport`,
  // every pin would get a new `onPress` on EVERY map movement (the surface
  // passes `onCluster` down to all pins); the `memo` on the marker
  // (MapPin.tsx) would have no effect, and every pin would send its
  // coordinate over the bridge again although nothing about it changed.
  //
  // `useLayoutEffect`, not `useEffect`: a passive effect runs only AFTER the
  // commit, and in the window in between a tap still reads the old state. The
  // same reasoning stands in MapSurface.tsx on the ref that holds the
  // CLUSTERS, where map.test.tsx nails it down (a tap right after a cluster
  // falls apart is not swallowed).
  const state = useRef<{ viewport: Viewport | null }>({ viewport });
  useLayoutEffect(() => {
    state.current = { viewport };
  }, [viewport]);

  // What the tap on this cluster WILL do, for the label VoiceOver reads out.
  // Same question, same answer, same `zoomExhausted` as in the tap below,
  // only without the consequences.
  //
  // It stands here and not in the surface, although the surface draws the
  // pins: it hangs on the history (which cluster was driven at in vain last),
  // and that lies in `lastZoom`. Up to here the surface knew only half the
  // rule, bit identical coordinates, and kept announcing a zoom on a stuck
  // cluster although the tap had long been opening the sheet.
  //
  // The viewport comes from STATE here, not from `state.current` like in the
  // tap below, and that is not an oversight: this question is asked while
  // RENDERING, and the layout effect that follows the ref up runs only
  // afterwards. With the ref the first pin of every trip carried the label
  // for no viewport known, so always the zoom announcement, even on one spot.
  // Found by the screen test, not derived. With the tap it is the other way
  // round: it comes out of a closure that would see the state of back then,
  // which is why it reads the ref.
  const opensSheet = useCallback(
    (cluster: Cluster) => {
      // Without a viewport there are no pins that could be labelled (see
      // `clusters` above). Needed for the type anyway.
      if (!viewport) return false;
      return zoomExhausted(cluster, viewport, lastZoom.current);
    },
    [viewport]
  );


  // A tap on a cluster drives into it as long as that achieves something
  // (Spec §5.5): whoever searches on the map wants to use the map. Only where
  // zooming brings nothing more does the sheet open, see below.
  //
  // WHICH cluster was tapped the surface has already answered: the marker
  // reports the anchor to it, and it looks the cluster up in its own state
  // (MapSurface.tsx). Here only what follows from that stands.
  const onCluster = useCallback(
    (cluster: Cluster) => {
      const { viewport: visible } = state.current;

      // Unreachable, but needed for the type: `clusters` is only calculated
      // when `viewport` stands (see useMemo above). Without a viewport there
      // would be no pin at all that could be tapped.
      if (!visible) return;

      // ONE question leads into the sheet: does zooming still achieve anything
      // here? It covers all the cases where the answer is no,
      //
      // - the frequent one: a single pin. One point trivially lies on one
      //   spot, and there the moment itself stands (Spec §5.7). The map does
      //   NOT move while doing so: the moment should not slide away under the
      //   sheet while it is being read.
      // - the rare one: a cluster whose moments all lie on the same
      //   coordinate. It falls apart at no zoom level.
      // - and the one that was missing until the merge fix round: a cluster
      //   that does have different coordinates, but so close together that the
      //   last zoom level of the map no longer separates them. At three to
      //   eight metres of GPS offset that is the normal case, not the
      //   exception.
      //
      // It is answered in features/map/clusterTap.ts, together with the shared
      // recap (share/[token].tsx), including the full reasoning.
      //
      // Deliberately no additional `points.length === 1` in front: that check
      // would be covered by the rest and could be deleted without any
      // assertion falling, exactly the kind of condition nobody can check
      // later on.
      if (zoomExhausted(cluster, visible, lastZoom.current)) {
        // As in `openDayFilter`: at most ONE sheet is open at a time
        // (reasoning there), and that is why BOTH others are cleared, not
        // only the one of the moments without a place. Until the §9
        // walkthrough (task 12) `setDaysOpen(false)` was missing here, and
        // the assurance held in one direction only: the day filter closed the
        // moment sheet, the tap on a pin left the day sheet standing.
        //
        // Two open sheets are not merely untidy: each brings a backdrop of
        // its own (`backdrop`, tokens.ts, rgba(0,0,0,0.4)), two of them on
        // top of each other dim to roughly 0.64. That value comes from no
        // token any more (DESIGN-LANGUAGE §9), and on top of that two
        // `shadow-3` panels would lie on each other, of which a swipe closes
        // only the upper one. That the backdrop of the day sheet catches this
        // tap on the device anyway is exactly the argument `openDayFilter`
        // explicitly does NOT let count for the other direction: the state
        // should be unambiguous instead of hanging on hit order.
        setDaysOpen(false);
        setWithoutPlaceOpen(false);
        setSheetPoints(cluster.points);
        return;
      }

      const target = zoomTarget(cluster, visible);
      // Unreachable (a cluster has at least one point), but the type of
      // `viewportFor` demands the handling.
      if (!target) return;

      // What this drive ATTEMPTED, the basis of the answer on the next tap
      // onto the same cluster. If the visible viewport stays the same
      // afterwards, the map has reached its last zoom level.
      lastZoom.current = { anchorId: cluster.anchor.moment.id, before: visible };

      // DESIGN-LANGUAGE §5 names selection haptics for zoom, the same
      // feedback as on a tab change. It belongs on the zoom itself, not in
      // `show`: the day filter (task 9) drives for a different reason and
      // brings its own rule. `.catch`, because a rejected promise out of a
      // native module would otherwise count as an unhandled rejection, same
      // pattern as player.tsx.
      void Haptics.selectionAsync().catch(() => {});

      show(target);
    },
    [show, id]
  );

  // The way into the player (Spec §5.7), the same one for ALL three sheets of
  // this screen. The union instead of a bare `{ index: number }`: otherwise
  // EVERY number called `index` would fit here, including a position within
  // `withoutPlace` or within a cluster. At this one place the type is the
  // last hint at compile time about where the value may come from. `index`
  // counts over the PLAYLIST the load path above filters, the same one the
  // player builds, and `parseStartIndex` counts there into exactly it
  // (player.tsx). Never the index within `points` (that one skips the moments
  // without a place), never the one within the cluster and never the one
  // within `withoutPlace`: all three would seem to sit right and would start
  // the player on the wrong moment.
  //
  // The sheet deliberately stays open while doing so: closing it would mean
  // letting it flash away during the transition into the player, and whoever
  // comes back finds the place they were at again.
  const toPlayer = useCallback(
    (entry: MapPoint | WithoutPlace) => {
      router.push({ pathname: '/recap/[id]/player', params: { id, start: String(entry.index) } });
    },
    [router, id]
  );

  // The sentences about what this map does not give at all. As a list,
  // because both situations can occur at the same time, and without useMemo:
  // comparing two numbers costs less than the comparison that would cache the
  // result.
  const fullyMissing: string[] = [];
  if (inTransit > 0) fullyMissing.push(inTransitText(inTransit));
  if (withoutImage > 0) fullyMissing.push(withoutImageText(withoutImage));

  // What the pill shows and what VoiceOver announces, one source for both.
  const filterState = selectedDay ? `Tag ${selectedDay.number}` : 'Alle Tage';

  const openDayFilter = () => {
    // NO stacked sheets: `Sheet` brings a backdrop of its own over the whole
    // screen (Sheet.tsx), two on top of each other would give a doubly dimmed
    // map, and a swipe down would close only the upper one and leave a panel
    // behind that nobody expects any more.
    //
    // (Not the reason: the number of primary buttons. The day list has none
    // by construction, so two open sheets would still have exactly one,
    // DESIGN-LANGUAGE §4 is not violated here and does not carry this
    // decision.)
    //
    // On the device the backdrop of the open moment sheet catches this tap
    // anyway; that the state is made unambiguous here regardless costs
    // nothing and makes the assurance checkable instead of leaving it to hit
    // order.
    setSheetPoints(null);
    setWithoutPlaceOpen(false);
    setDaysOpen(true);
  };

  // For the same reason and along the same way.
  const openWithoutPlace = () => {
    setSheetPoints(null);
    setDaysOpen(false);
    setWithoutPlaceOpen(true);
  };

  const selectDay = (day: RecapDay | null) => {
    setDaysOpen(false);
    setDayChoice(day?.number ?? null);

    // The selected day changes pins AND line AND viewport: a day whose
    // moments lie outside the visible viewport would otherwise be an empty
    // map, and the choice would look like a bug.
    //
    // `pointsOnDay` with the NEW day instead of with `visiblePoints`: the
    // state still stands on the old value in this line, React only re-renders
    // afterwards.
    const target = viewportFor(pointsOnDay(points, day));
    // Unreachable as long as the list is right: `selectableDays` only offers
    // days that have at least one pin, and all days only exists when there
    // are pins at all. Without a target the camera stays put, a jump to
    // `null` would be a jump into the Atlantic.
    if (!target) return;

    // DESIGN-LANGUAGE §5 names selection haptics for tabs and zoom. Choosing
    // a day is both at once: a selection that moves the camera. It stands
    // here and not in `show`, because the cluster zoom already brings its own
    // feedback (see `onCluster`).
    void Haptics.selectionAsync().catch(() => {});

    show(target);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    // Without a way back (deep link straight onto the map) the way leads to
    // the overview OF THIS trip, not to the recap list: the map is one
    // reading of this recap, not an area of its own (Spec §5.1).
    else router.replace({ pathname: '/recap/[id]/overview', params: { id } });
  };

  // ---------------------------------------------------------------------
  // The three states without a map. Until task 10 they all looked the same,
  // a white surface with a back pill, because all three end in `points = []`
  // and `viewport = null`.
  // ---------------------------------------------------------------------

  if (phase === 'loading') return <MapSkeleton topInset={topInset} onBack={goBack} />;

  if (phase === 'error') {
    return (
      <View style={[styles.surface, { backgroundColor: colors['bg-0'] }]}>
        <View style={[styles.textScreen, { paddingTop: topInset }]}>
          {/* The way back on a screen WITHOUT a map. The translucent pill is no
              good for that: it is made for a foreign surface (DESIGN-LANGUAGE
              §1), without a map it would lie on pure white and would be the
              only cinema spot of a light screen. So the same header as in
              overview.tsx, with the same label as the pill. */}
          <PressScale accessibilityRole="button" accessibilityLabel="Zurück" onPress={goBack}>
            <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
          {/* The text comes from the load path and already names cause and
              fix in Du form (recapApi.ts, urlPool.ts), nothing is invented. */}
          <Text style={[type.body, { color: colors.danger }]}>{errorText}</Text>
          {/* The only primary button of this state (DESIGN-LANGUAGE §4): the
              way back above is an icon, not a button. And it only stands where
              a second attempt can achieve something
              (features/recap/urlPool.ts): under the sealed trip message it
              would be a promise without cover, and the state then has no
              primary button at all, which §4 explicitly allows. */}
          {canRetry && (
            <Button
              variant="primary"
              label="Nochmal versuchen"
              onPress={() => void retry()}
              loading={retryRunning}
            />
          )}
        </View>
      </View>
    );
  }

  // There being no moments at all is NOT the same as no moment having a place
  // (fix round 1, Important 3). A trip where nobody submitted anything, or
  // where all uploads are still on their way, would otherwise get the
  // sentence about location services to read: a claim about something that
  // never took place.
  //
  // Word for word the same as overview.tsx and player.tsx (the empty phase),
  // so that the same trip says the same thing on all three screens. Without a
  // second line: whether the moments are still coming or never came, this
  // screen does not know, and a guess would be a claim again.
  if (playlistNow.length === 0) {
    return (
      <View style={[styles.surface, { backgroundColor: colors['bg-0'] }]}>
        <View style={[styles.textScreen, { paddingTop: topInset }]}>
          <Text style={[type.h1, { color: colors['text-1'] }]}>{EMPTY_WITHOUT_MOMENTS}</Text>
          <Button variant="primary" label="Zurück zur Übersicht" onPress={goBack} />
        </View>
      </View>
    );
  }

  // No empty map viewport over the Atlantic (Spec K9): `viewportFor` returns
  // `null` when not a single moment has a place, so instead of an invented
  // region the explanation from Spec §5.9 stands here.
  //
  // No header and no second way out: the one button IS the way back, an arrow
  // beside it would do the same thing twice. It calls `goBack` and not a
  // `replace` of its own, both branches of it land on the overview of this
  // trip (there is no other way onto the map), and `back()` keeps the stack
  // instead of overwriting it.
  //
  // Also no bar about moments without a place, although HERE every moment has
  // one: it is a pill for the map surface, and what it says the explanation
  // above already says for the whole trip. The moments stay reachable through
  // the overview, which shows them all.
  if (points.length === 0) {
    return (
      <View style={[styles.surface, { backgroundColor: colors['bg-0'] }]}>
        <View style={[styles.textScreen, { paddingTop: topInset }]}>
          <View style={styles.textBlock}>
            <Text style={[type.h1, { color: colors['text-1'] }]}>{EMPTY_TITLE}</Text>
            <Text style={[type.body, { color: colors['text-2'] }]}>{EMPTY_EXPLANATION}</Text>
          </View>
          <Button variant="primary" label="Zurück zur Übersicht" onPress={goBack} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.surface, { backgroundColor: colors['bg-0'] }]}>
      {/* `viewport` always stands here, it is calculated from the same `points`
          whose count caught the empty state above. The check stays anyway,
          because the type demands it. */}
      {viewport && (
        <MapSurface
          ref={map}
          initialViewport={viewport}
          clusters={clusters}
          line={line}
          thumbFor={thumbFor}
          onCluster={onCluster}
          opensSheet={opensSheet}
          onViewportChange={rememberViewport}
          reducedMotion={reducedMotion}
        />
      )}

      {/* The map has no header of its own, it should be big (Spec §5.3), the
          only way back is this translucent pill over the map surface
          (DESIGN-LANGUAGE §1: UI on a foreign surface lies exclusively as a
          pill with blur). It stands outside the MapView so that it stays
          reachable in the placeless case too. */}
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="Zurück"
        onPress={goBack}
        style={[styles.back, { top: topInset }]}
      >
        <Pill style={styles.backPill}>
          <ChevronLeft size={24} color={cinema['text-1']} strokeWidth={1.75} />
        </Pill>
      </PressScale>

      {/* The day filter, opposite the way back (task 9 brief: top right). As
          there a translucent pill with blur, it lies on the map surface
          (DESIGN-LANGUAGE §1).

          Only from two selectable days on: with only one, all days and day 1
          showed the same pins, and a pill that distinguishes nothing is no
          filter but a claim. With zero days (no pins, or the trip query failed)
          there is nothing to choose anyway. */}
      {days.length > 1 && (
        <PressScale
          testID="karte-tagesfilter"
          accessibilityRole="button"
          accessibilityLabel={`Reisetag wählen, aktuell ${filterState}`}
          onPress={openDayFilter}
          style={[styles.dayFilter, { top: topInset }]}
        >
          <Pill style={styles.dayFilterPill}>
            <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{filterState}</Text>
            <ChevronDown size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </Pill>
        </PressScale>
      )}

      {/* The moments that cannot carry a pin (Spec §5.8). Every real trip has
          them, without permission, indoors or on a timeout `determinePlace`
          deliberately returns three `null` (features/moments/placeAndTime.ts),
          and they must not simply be missing from the map without anyone
          noticing.

          No primary button but a translucent pill like the two above: it lies
          on the map surface (DESIGN-LANGUAGE §1), and the one primary button of
          this screen is carried by the moment sheet (§4).

          The number holds for the WHOLE trip, even with a day selected: a
          moment without a place lies on no day OF THE MAP, and a day whose
          moments are all without a place is not offered for selection at all
          (see `selectableDays`). A bar filtered along would leave exactly these
          moments reachable on no way at all. */}
      {(withoutPlace.length > 0 || fullyMissing.length > 0) && (
        // The centring is carried by a frame of its own, not by the
        // PressScale itself: that one would stretch over the full width and
        // would catch every tap left and right of the pill, which on a map
        // would be a 44 point high band that cannot be panned in any more.
        // `box-none` lets taps through the frame, only the pill itself takes
        // them.
        <View style={styles.bar} pointerEvents="box-none">
          {/* The moments this map does not give at all (fix round after the
              final review). Purely informative and therefore `pointerEvents:
              none`: there is no way to them from here, they stand in no
              playlist, so no index leads to them either. Without this line
              the arithmetic on the screen no longer added up: the pins plus
              the bar would come to less than the trip has, and nobody would
              see why. */}
          {fullyMissing.length > 0 && (
            <Pill testID="karte-fehlen-ganz" style={styles.missingPill} pointerEvents="none">
              {fullyMissing.map((sentence) => (
                <Text key={sentence} style={[type.secondary, { color: cinema['text-1'] }]}>
                  {sentence}
                </Text>
              ))}
            </Pill>
          )}
          {withoutPlace.length > 0 && (
            <PressScale
              testID="karte-ohne-ort"
              accessibilityRole="button"
              // The pill shows the number, the label additionally says what a
              // tap does, word for word like the pin of an indivisible
              // cluster.
              accessibilityLabel={`${withoutPlaceText(withoutPlace.length)} ansehen`}
              onPress={openWithoutPlace}
            >
              <Pill style={styles.withoutPlacePill}>
                <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>
                  {withoutPlaceText(withoutPlace.length)}
                </Text>
              </Pill>
            </PressScale>
          )}
        </View>
      )}

      {/* Mounted only when it should be open, as with the moment sheet: `Sheet`
          brings its entry animation along in an effect. */}
      {daysOpen && (
        <Sheet visible title="Reisetage" onClose={() => setDaysOpen(false)}>
          {/* Scrolls and is capped, for the same reason as the cluster list: a
              long trip has many days, and `Sheet` would cut the overhang off
              hard (85 % window height, `overflow: hidden`), so the last days
              would be selectable on no way at all. */}
          <SheetScroll testID="tage-liste">
            <DayEntry
              testID="tag-eintrag-alle"
              label="Alle Tage"
              active={selectedDay === null}
              position={0}
              onSelect={() => selectDay(null)}
            />
            {days.map((day, position) => (
              <DayEntry
                key={day.number}
                testID={`tag-eintrag-${day.number}`}
                label={`Tag ${day.number}`}
                place={day.place}
                active={selectedDay?.number === day.number}
                // Offset by one: the all days row comes first.
                position={position + 1}
                onSelect={() => selectDay(day)}
              />
            ))}
          </SheetScroll>
          {/* OUTSIDE the scroll surface: the sentence explains the list, and an
              explanation you have to scroll all the way down to find explains
              nothing. Only on a real gap, a gapless list does not raise the
              question at all. */}
          {daysGap && (
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{GAP_HINT}</Text>
          )}
        </Sheet>
      )}

      {withoutPlaceOpen && (
        <Sheet visible title={withoutPlaceText(withoutPlace.length)} onClose={() => setWithoutPlaceOpen(false)}>
          {/* Scrolls and is capped, for the same reason as the cluster and day
              lists: `Sheet` would cut the overhang off hard (85 % window
              height, `overflow: hidden`), and the cut off moments would be
              reachable from the map on no other way, a pin is exactly what they
              do not have. */}
          <SheetScroll testID="ohne-ort-liste">
            <View style={styles.tileGrid}>
              {withoutPlace.map((entry, position) => (
                <WithoutPlaceTile
                  key={entry.moment.id}
                  entry={entry}
                  thumbUrl={pinImageUrl(urls, entry.moment.id)}
                  position={position}
                  onView={toPlayer}
                />
              ))}
            </View>
          </SheetScroll>
        </Sheet>
      )}

      {/* Mounted only when there is something to show: `Sheet` brings its entry
          animation along in an effect (spring-ui, DESIGN-LANGUAGE §4), so a
          freshly mounted sheet opens from the bottom every time. The children
          are built by the parent anyway, so a permanently mounted sheet would
          still have to guard them against `null`. */}
      {sheetPoints !== null && (
        <Sheet
          visible
          // The list gets a heading, the single moment does not: there the
          // image is the head (Spec §5.7). More than one point always means
          // all on the same coordinate here, so the wording about this one
          // place is literally true, unlike with a cluster formed by screen
          // points.
          title={sheetPoints.length > 1 ? `${sheetPoints.length} Momente an diesem Ort` : undefined}
          onClose={() => setSheetPoints(null)}
        >
          {sheetPoints.length === 1 ? (
            <MomentSheetContent
              point={sheetPoints[0]}
              imageUrl={sheetImageUrl(urls, sheetPoints[0].moment.id)}
              form={SHEET_FORM}
              onView={toPlayer}
            />
          ) : (
            <ClusterSheetContent
              points={sheetPoints}
              urls={urls}
              form={SHEET_FORM}
              onView={toPlayer}
            />
          )}
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1 },
  back: { position: 'absolute', left: spacing.screen },
  backPill: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The way back on a light surface (skeleton): the same spot as the back
  // pill of the finished map, only without a pill underneath.
  backLight: { position: 'absolute', left: spacing.screen },
  dayFilter: { position: 'absolute', right: spacing.screen },
  // The same height as the back pill opposite, so both sit on one line.
  // Spacings from the 4 point grid (DESIGN-LANGUAGE §3).
  dayFilterPill: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  // The bar of the moments without a place, centred at the bottom.
  // Horizontally centred instead of at one edge: top left and top right
  // already carry the way back and the day filter, and a third pill in the
  // same corner would look as if it belonged to one of them. The distance to
  // the bottom is the screen margin (DESIGN-LANGUAGE §3); the tab bar below
  // does not belong to this surface, the screen ends above it.
  bar: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.screen,
    alignItems: 'center',
    gap: spacing.s,
  },
  // Multi line and without a fixed height, unlike the pills beside it: whole
  // sentences stand here, not a label.
  missingPill: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.control,
    gap: spacing.xs,
  },
  // The same height and the same inner measure as the filter pill opposite.
  withoutPlacePill: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  // Three columns, word for word like the overview (Spec §5.8: the same tile
  // list), including the reasoning there why the gap comes from
  // `columnGap`/`rowGap` and not from `justifyContent: 'space-between'`.
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    columnGap: spacing.xs,
    rowGap: spacing.xs,
  },
  tile: { width: '31.5%', aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
  // The states without a map (loading / error / no places): a light screen
  // read from top to bottom. Margin 24 (DESIGN-LANGUAGE §3), overwritten at
  // the top by `useTopInset`.
  textScreen: { padding: spacing.screen, gap: spacing.xl },
  textBlock: { gap: spacing.m },
});
