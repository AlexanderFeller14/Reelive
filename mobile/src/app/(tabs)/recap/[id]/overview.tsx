import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, ScrollView, Text, View, StyleSheet, useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { ChevronLeft, Download, Share2 } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { SealPeel } from '@/components/SealPeel';
import { useTheme } from '@/theme/ThemeProvider';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchTrip } from '@/features/trips/tripsApi';
import type { Trip } from '@/features/trips/types';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { saveAllToGallery, type AllResult, type AllProgress } from '@/features/recap/exportApi';
import { groupByDays } from '@/features/recap/days';
import type { RecapMoment, RecapDay } from '@/features/recap/types';
import {
  getPool,
  retryHelps,
  type MediaUrl,
  type Pool,
} from '@/features/recap/urlPool';
import { ShareSheetContent } from '@/features/sharing/ShareSheetContent';

const MONTHS_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function formatDayDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONTHS_LONG[m - 1]}`;
}

// Deliberately reads ONLY `day.date` and `day.number`, never the
// `captured_at`/`captured_tz` of a single moment of that day: on a trip
// heading east across the date line, `day.date` can differ from the local
// date of INDIVIDUAL moments that the monotone day assignment pulled into
// this day (see the comment header of days.ts). `day.date` is still the only
// honest statement about THE DAY as a whole; a heading showing the date of
// any one of its moments instead would lie about exactly those moments.
function dayHeading(day: RecapDay): string {
  const parts = [`Tag ${day.number}`];
  if (day.place) parts.push(day.place);
  parts.push(formatDayDate(day.date));
  return parts.join(' · ');
}

function inTransitText(count: number): string {
  return `${count} ${count === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

function skippedText(count: number): string {
  return `${count} ${count === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

function summaryText(outcome: Extract<AllResult, { status: 'finished' }>): string {
  if (outcome.cancelled) {
    const parts = [`Abgebrochen bei ${outcome.saved} von ${outcome.total} Momenten.`];
    if (outcome.failed > 0) {
      parts.push(`${outcome.failed} ${outcome.failed === 1 ? 'ist' : 'sind'} dabei fehlgeschlagen.`);
    }
    return parts.join(' ');
  }
  if (outcome.failed === 0) {
    return `${outcome.saved} von ${outcome.total} Momenten gesichert.`;
  }
  return `${outcome.saved} von ${outcome.total} Momenten gesichert. ${outcome.failed} ${outcome.failed === 1 ? 'ist' : 'sind'} fehlgeschlagen.`;
}

// Quiet bg-1 surface with an opacity pulse (DESIGN-LANGUAGE §4: "Skeleton:
// bg-1-Blöcke, Opacity-Puls 0.6 ↔ 1.0, kein Gradient-Shimmer"). Pure
// presentation, hence local instead of its own component file.
function SkeletonBlock({ style }: { style: object }) {
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
  }, [reducedMotion, opacity]);

  return <Animated.View style={[style, { backgroundColor: colors['bg-1'], opacity }]} />;
}

function SkeletonScreen() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xl);
  return (
    <View testID="recap-skeleton" style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <View style={[styles.content, { paddingTop: topInset }]}>
        <SkeletonBlock style={{ width: 160, height: 30, borderRadius: radius.control }} />
        <View style={[styles.tileGrid, { marginTop: spacing.xl }]}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonBlock key={i} style={styles.tile} />
          ))}
        </View>
      </View>
    </View>
  );
}

function DaySection({
  day, urls, indexById, onTap,
}: {
  day: RecapDay;
  urls: Map<string, MediaUrl>;
  indexById: Map<string, number>;
  onTap: (index: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.m }}>
      <Text style={[type.h2, { color: colors['text-1'] }]}>{dayHeading(day)}</Text>
      <View style={styles.tileGrid}>
        {day.moments.map((m) => {
          const url = urls.get(m.id);
          const index = indexById.get(m.id);
          // Unreachable by construction, and therefore invisible to any
          // test: `day` comes from groupByDays(withImage, …), `indexById`
          // is built from that same `withImage`.
          if (!url || index === undefined) return null;
          return (
            <PressScale
              key={m.id}
              scaleTo={0.96}
              accessibilityRole="button"
              accessibilityLabel={`Moment ${index + 1} öffnen`}
              testID={`recap-tile-${m.id}`}
              onPress={() => onTap(index)}
            >
              <View style={[styles.tile, { backgroundColor: colors['bg-1'] }]}>
                <Image
                  testID={`recap-image-${m.id}`}
                  source={{ uri: url.thumb_url ?? url.medium_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                />
              </View>
            </PressScale>
          );
        })}
      </View>
    </View>
  );
}

// Light variant, not cinema: overview.tsx is a light screen (DESIGN-LANGUAGE
// §1, only camera/preview/sealing/player are cinema).
function ExportSheetContent({
  state, outcome, onCancel, onDone,
}: {
  state: AllProgress;
  outcome: AllResult | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();

  if (outcome === null) {
    return (
      <View style={{ gap: spacing.base }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
          <ActivityIndicator testID="export-loading" color={colors['text-1']} />
          <Text style={[type.body, { color: colors['text-1'] }]}>
            {state.done} von {state.total} gesichert
          </Text>
        </View>
        <Button variant="secondary" label="Abbrechen" onPress={onCancel} />
      </View>
    );
  }

  if (outcome.status === 'no_permission') {
    return (
      <View style={{ gap: spacing.base }}>
        <Text style={[type.body, { color: colors['text-1'] }]}>{outcome.text}</Text>
        <Button variant="primary" label="Einstellungen öffnen" onPress={() => void Linking.openSettings()} />
        <Button variant="text" label="Schliessen" onPress={onDone} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.base }}>
      <Text testID="export-outcome" style={[type.body, { color: colors['text-1'] }]}>
        {summaryText(outcome)}
      </Text>
      <Button variant="primary" label="Fertig" onPress={onDone} />
    </View>
  );
}

export default function RecapOverview() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xl);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [moments, setMoments] = useState<RecapMoment[]>([]);
  const [pool, setPool] = useState<Pool | null>(null);
  // The UI only hides the entry point; share-link/index.ts (action
  // 'erstellen') checks owner and status server-side again (CLAUDE.md
  // cornerstone: sealing is enforced on the server).
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportState, setExportState] = useState<AllProgress>({ done: 0, total: 0 });
  const [exportOutcome, setExportOutcome] = useState<AllResult | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryHelpful, setRetryHelpful] = useState(true);
  const [loading, setLoading] = useState(false);
  const active = useRef(true);
  // Session-only, no persistent marker: the seal stands again on EVERY fresh
  // open of the recap (breaking it open is the moment, not a one-time
  // unlock). `unsealedRef` holds the peel for the lifetime of THIS screen, so
  // coming back from the player (the screen stays mounted, but useFocusEffect
  // reloads) does not put a seal up again; only really leaving and reopening
  // brings it back.
  const [unsealed, setUnsealed] = useState(false);
  const unsealedRef = useRef(false);
  // Initial value 1 so the content stands there without a fade after a reload
  // out of the player (`unsealed` is already true then).
  const [fadeIn] = useState(() => new Animated.Value(1));
  const reducedMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();

  const load = useCallback(async () => {
    const [
      { data: t, error: tError },
      { data: m, error: mError },
      { pool: p, error: pError, reason: pReason },
    ] = await Promise.all([fetchTrip(id), fetchRecapMoments(id), getPool(id)]);
    if (!active.current) return;
    setTrip(t);
    setMoments(m);
    setPool(p);
    setUnsealed(unsealedRef.current);
    setError(tError ?? pError ?? mError ?? null);
    setRetryHelpful(tError === null && pError !== null ? retryHelps(pReason) : true);
    setLoaded(true);
  }, [id]);

  const retry = useCallback(async () => {
    setLoading(true);
    await load();
    setLoading(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void load();
      return () => {
        active.current = false;
      };
    }, [load])
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/recap');
  };

  const toMap = () => {
    router.push({ pathname: '/recap/[id]/map', params: { id } });
  };

  const toPlayer = (index: number) => {
    router.push({ pathname: '/recap/[id]/player', params: { id, start: String(index) } });
  };

  // Order matters: opacity to 0 FIRST, `unsealed` second, otherwise the
  // content would stand there fully visible for one frame before the fade
  // begins.
  const unseal = () => {
    unsealedRef.current = true;
    fadeIn.setValue(0);
    setUnsealed(true);
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: reducedMotion ? motion.duration.base : motion.duration.gentle,
      // Spelled out, not the RN default (inOut): see the MemorySubmission
      // animation, the default makes a fade run out sluggishly.
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    }).start();
  };

  if (!loaded) return <SkeletonScreen />;

  const urls = pool?.urls ?? new Map<string, MediaUrl>();
  const uploaded = moments.filter((m) => m.upload_status === 'uploaded');
  const withImage = uploaded.filter((m) => urls.has(m.id));
  const indexById = new Map(withImage.map((m, i) => [m.id, i] as const));

  const saveAll = () => {
    const entries = withImage.map((m) => ({ moment: m, url: urls.get(m.id)! }));
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportOutcome(null);
    setExportState({ done: 0, total: entries.length });
    setExportOpen(true);
    void saveAllToGallery(entries, (state) => setExportState(state), controller.signal).then((outcome) => {
      if (!active.current) return;
      setExportOutcome(outcome);
    });
  };

  const cancelExport = () => {
    exportAbortRef.current?.abort();
  };

  const closeExport = () => {
    if (exportOutcome === null) exportAbortRef.current?.abort();
    setExportOpen(false);
  };

  const canShare = !!trip && trip.owner_id === userId && trip.status === 'revealed';
  const canExport = !!trip && withImage.length > 0;
  // Written as a positive list, not as `!== 'active'`: both are the same
  // today, because `TripStatus` knows exactly these three values. Should a
  // fourth ever arrive, the spelling decides what it inherits when it is
  // overlooked, with `!==` the map, here its absence. For sealing, "closed
  // when in doubt" is the only defensible default, and this line mirrors the
  // condition of the server policy verbatim.
  const canMap = !!trip && (trip.status === 'revealed' || trip.status === 'archived');

  const header = (
    <View style={styles.header}>
      <PressScale accessibilityRole="button" accessibilityLabel="Zurück" onPress={goBack}>
        <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
      </PressScale>
      <View style={styles.headerActions}>
        {canExport && (
          <PressScale
            testID="overview-save-all-open"
            accessibilityRole="button"
            accessibilityLabel="Alle sichern"
            onPress={saveAll}
          >
            <Download size={22} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
        )}
        {canShare && (
          <PressScale
            testID="overview-share-open"
            accessibilityRole="button"
            accessibilityLabel="Recap teilen"
            onPress={() => setShareOpen(true)}
          >
            <Share2 size={22} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
        )}
      </View>
    </View>
  );

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
        <View style={[styles.content, { paddingTop: topInset }]}>
          {header}
          <Text style={[type.body, { color: colors.danger }]}>{error ?? 'Diese Reise gibt es nicht mehr.'}</Text>
          {error && retryHelpful && (
            <Button
              variant="secondary"
              label="Nochmal versuchen"
              onPress={() => void retry()}
              loading={loading}
            />
          )}
        </View>
      </View>
    );
  }

  const days = groupByDays(withImage, trip.start_date);
  const pendingCount = moments.length - uploaded.length;
  const skippedCount = pool?.skipped ?? 0;
  const completelyEmpty = days.length === 0 && pendingCount === 0 && skippedCount === 0;
  const sealed = days.length > 0 && !unsealed;
  const stage = Math.min(windowWidth - 2 * spacing.screen, SEAL_STAGE_MAX);

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      {/* `flexGrow: 1` only while the seal stands: then the content fills the
          height and the stage can centre itself in what is left below the
          title. Normal afterwards, a short recap may be short. */}
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset }, sealed && styles.contentStretched]}>
        {header}
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>

        {/* The two readings of this recap (Spec §5.1) as a segment row of two
            pills (radius 999), explicitly NOT as a second tab bar: the bottom
            one stays at four entries (DESIGN-LANGUAGE §4), and the map is a
            view onto THIS recap, not an area of its own.

            It sits below the H1, not between header row and H1: the row
            switches what stands BELOW it, and separated from the title it
            would read as part of the header chrome instead of as a choice
            about the content. The spacing comes from the `gap` of
            `styles.content` (12), 4-grid, without a second value beside it.

            Light, not translucent: the `Pill` component is made for a foreign
            surface (DESIGN-LANGUAGE §1, "auf Fotos"), here plain white lies
            underneath. */}
        {canMap && !sealed && (
          <View style={styles.segmentRow}>
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel="Nach Tagen, aktuelle Ansicht"
              testID="overview-segment-days"
              style={[styles.segmentPill, { backgroundColor: colors['bg-1'] }]}
            >
              <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Nach Tagen</Text>
            </View>
            <PressScale
              accessibilityRole="button"
              testID="overview-segment-map"
              onPress={toMap}
            >
              <View
                style={[
                  styles.segmentPill,
                  { backgroundColor: colors['bg-0'], borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
                ]}
              >
                <Text style={[type.bodyMedium, { color: colors['text-2'] }]}>Auf der Karte</Text>
              </View>
            </PressScale>
          </View>
        )}

        {error ? (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{error}</Text>
            {retryHelpful && (
              <Button
                variant="secondary"
                label="Nochmal versuchen"
                onPress={() => void retry()}
                loading={loading}
              />
            )}
          </View>
        ) : completelyEmpty ? (
          <Text style={[type.h2, { color: colors['text-1'], marginTop: spacing.xl }]}>
            Diese Reise ist leer geblieben.
          </Text>
        ) : sealed ? (
          // The staged moment before the recap (§7: only staged moments are
          // centred): the seal in the middle, a line below it saying what to
          // do. No frame, no shadow from us, the seal brings its own.
          <View style={styles.sealStage}>
            <SealPeel testID="recap-seal" size={stage} onPeeled={unseal} />
            <Text style={[type.body, { color: colors['text-2'], textAlign: 'center' }]}>
              Dein Recap ist versiegelt. Tipp aufs Siegel, um ihn zu öffnen.
            </Text>
          </View>
        ) : (
          <Animated.View style={{ gap: spacing.xl, marginTop: spacing.xl, opacity: fadeIn }}>
            {/* Cut out on `bg-0`, hence without frame and shadow. */}
            <View>
              <Image
                testID="recap-popcorn"
                source={require('@/assets/images/popcornbecher.png')}
                style={styles.popcorn}
                contentFit="contain"
                accessible={false}
              />
              <Text style={[type.bodyMedium, { color: colors['text-1'], marginTop: spacing.m }]}>
                {"Dein Recap wartet. Popcorn holen, Licht aus, los geht's."}
              </Text>
            </View>
            {days.map((day) => (
              <DaySection key={day.number} day={day} urls={urls} indexById={indexById} onTap={toPlayer} />
            ))}
          </Animated.View>
        )}

        {!error && !sealed && (pendingCount > 0 || skippedCount > 0) && (
          <View style={{ gap: spacing.xs, marginTop: spacing.xl }}>
            {pendingCount > 0 && (
              <Text style={[type.secondary, { color: colors['text-2'] }]}>{inTransitText(pendingCount)}</Text>
            )}
            {skippedCount > 0 && (
              <Text style={[type.secondary, { color: colors['text-2'] }]}>{skippedText(skippedCount)}</Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Sibling of the ScrollView, not its child (same pattern as the
          comment sheet in player.tsx), it has to lie above everything. */}
      {canShare && (
        <Sheet visible={shareOpen} title="Recap teilen" onClose={() => setShareOpen(false)} cinemaMode>
          <ShareSheetContent tripId={id} />
        </Sheet>
      )}
      {canExport && (
        <Sheet visible={exportOpen} title="Momente sichern" onClose={closeExport}>
          <ExportSheetContent
            state={exportState}
            outcome={exportOutcome}
            onCancel={cancelExport}
            onDone={() => setExportOpen(false)}
          />
        </Sheet>
      )}
    </View>
  );
}

// Upper bound of the seal stage, the same sharpness limit as FILM_REEL_MAX in
// recap/index.tsx: the seal takes up 500/720 of the stage, at 416 that is
// 289 pt, times three 867 px, below the 1254 px of the source. On every
// iPhone the width stays below this anyway, the limit only bites on an iPad.
const SEAL_STAGE_MAX = 416;

const styles = StyleSheet.create({
  content: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.m },
  contentStretched: { flexGrow: 1 },
  // Fills the height below the title and centres the seal in it, with the
  // hint underneath (spacing from the 4-grid).
  sealStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.l },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  // Two pills side by side, left aligned (DESIGN-LANGUAGE §7), not a bar
  // stretched over the full width: stretched it would look like a second tab
  // bar, and that is exactly what it must not be (Spec §5.1).
  segmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  // Radius 999 (DESIGN-LANGUAGE §3, the pill value). Height 44 like the pills
  // on the map itself; that value is a size, not a spacing, and the 4-grid
  // applies to spacings (§3), otherwise neither Button 52 nor Input 56 would
  // hold.
  segmentPill: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  // Three columns. The gap explicitly via `columnGap`/`rowGap`, NOT via
  // `justifyContent: 'space-between'` (review Task 10, minor): that let the
  // gap emerge from the remaining space, differently sized per device width
  // and never exactly from the 4-grid.
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', columnGap: spacing.xs, rowGap: spacing.xs },
  tile: { width: '31.5%', aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
  // Smaller than the images of the empty states (160): there the image
  // carries a screen with nothing else on it, here it accompanies a recap
  // that starts right below it.
  popcorn: { width: 120, height: 120, alignSelf: 'center' },
});
