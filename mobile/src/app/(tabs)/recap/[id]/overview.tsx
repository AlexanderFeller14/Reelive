import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, ScrollView, Text, View, StyleSheet,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { ChevronLeft, Download, Play, Share2 } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { RecapHero } from '@/components/RecapHero';
import { Sheet } from '@/components/Sheet';
import { StatusBarCover } from '@/components/StatusBarCover';
import { useTheme } from '@/theme/ThemeProvider';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchTrip } from '@/features/trips/tripsApi';
import type { Trip } from '@/features/trips/types';
import { formatRange } from '@/features/trips/tripDay';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { saveAllToGallery, type AllResult, type AllProgress } from '@/features/recap/exportApi';
import { groupByDays } from '@/features/recap/days';
import { mosaicRows, type MosaicRow, type MosaicTile } from '@/features/recap/mosaic';
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

// Two lines, not one glued string (Task 10): "Tag N" reads as the section's
// H2, the place/date underneath as its secondary line. Split into two
// functions instead of one returning a tuple, so each call site (H2 Text,
// secondary Text) stays a plain string prop.
function dayTitle(day: RecapDay): string {
  return `Tag ${day.number}`;
}

// Deliberately reads ONLY `day.date` and `day.number`, never the
// `captured_at`/`captured_tz` of a single moment of that day: on a trip
// heading east across the date line, `day.date` can differ from the local
// date of INDIVIDUAL moments that the monotone day assignment pulled into
// this day (see the comment header of days.ts). `day.date` is still the only
// honest statement about THE DAY as a whole; a heading showing the date of
// any one of its moments instead would lie about exactly those moments.
function daySubtitle(day: RecapDay): string {
  const parts: string[] = [];
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

// Returns null for a lone traveller, so `heroSubtitle` below can simply drop
// this part instead of stitching it onto an empty phrase.
function fellowTravellersText(memberCount: number): string | null {
  if (memberCount <= 1) return null;
  if (memberCount === 2) return 'zu zweit';
  if (memberCount === 3) return 'zu dritt';
  if (memberCount === 4) return 'zu viert';
  return `mit ${memberCount} Mitreisenden`;
}

// `displayedMomentCount` is a parameter, not `trip.my_post_count`: the tab
// list's card counts what only the owner contributed, the hero counts what
// the recap actually SHOWS, all travellers together. Trip carries no count
// of its own for that, only the loaded pool does.
function heroSubtitle(trip: Trip, displayedMomentCount: number): string {
  const parts = [
    formatRange(trip.start_date, trip.end_date),
    `${displayedMomentCount} ${displayedMomentCount === 1 ? 'Moment' : 'Momente'}`,
  ];
  const companions = fellowTravellersText(trip.member_count);
  if (companions) parts.push(companions);
  return parts.join(' · ');
}

// Quiet bg-1 surface with an opacity pulse (DESIGN-LANGUAGE §4: "Skeleton:
// bg-1-Blöcke, Opacity-Puls 0.6 ↔ 1.0, kein Gradient-Shimmer"). Pure
// presentation, hence local instead of its own component file.
function SkeletonBlock({ style, testID }: { style: object; testID?: string }) {
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

  return <Animated.View testID={testID} style={[style, { backgroundColor: colors['bg-1'], opacity }]} />;
}

// Mirrors the loaded screen's own shape (hero, then a day head, then a
// feature row) instead of the generic 9-square grid the old three-column
// layout used: a skeleton that outlines a DIFFERENT layout than what
// actually loads afterward reads as a glitch the moment the real content
// swaps in.
function SkeletonScreen() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xl);
  return (
    <View testID="recap-skeleton" style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <View style={[styles.content, { paddingTop: topInset }]}>
        <SkeletonBlock testID="recap-skeleton-hero" style={{ aspectRatio: 3 / 2, borderRadius: radius.card }} />
        <View style={{ gap: spacing.xs, marginTop: spacing.xl }}>
          <SkeletonBlock style={{ width: 120, height: 26, borderRadius: radius.control }} />
          <SkeletonBlock style={{ width: 180, height: 18, borderRadius: radius.control }} />
        </View>
        <View testID="recap-skeleton-feature" style={[styles.featureRow, { marginTop: spacing.m }]}>
          <SkeletonBlock style={[styles.leadPress, styles.leadTile]} />
          <View style={styles.featureColumn}>
            <SkeletonBlock style={[styles.featureThirdPress, styles.featureThirdTile]} />
            <SkeletonBlock style={[styles.featureThirdPress, styles.featureThirdTile]} />
          </View>
        </View>
      </View>
    </View>
  );
}

// One tile of the mosaic. Sizing (`pressStyle`) sits on `PressScale` itself,
// not on some node buried inside it: only PressScale is an actual flex
// child of the row/column that lays the tiles out, so a `flex` set any
// deeper would never reach the row's own distribution. `clipStyle`
// (aspectRatio or flex, radius, overflow) sits on the plain View PressScale
// wraps, exactly like every other PressScale user in this codebase (Button,
// RecapHero, TripCard): that View derives its own height from its own
// width, so it never depends on how PressScale's internal Animated.View
// happens to size itself.
function MosaicTileView({
  tile, pressStyle, clipStyle, urls, indexById, onTap,
}: {
  tile: MosaicTile;
  pressStyle: StyleProp<ViewStyle>;
  clipStyle: StyleProp<ViewStyle>;
  urls: Map<string, MediaUrl>;
  indexById: Map<string, number>;
  onTap: (index: number) => void;
}) {
  const { colors } = useTheme();
  const { moment, shape } = tile;
  const url = urls.get(moment.id);
  const index = indexById.get(moment.id);
  // Unreachable by construction, and therefore invisible to any test:
  // `day.moments` (what `mosaicRows` lays out) comes from
  // groupByDays(withImage, …), `indexById` is built from that same
  // `withImage`.
  if (!url || index === undefined) return null;
  return (
    <PressScale
      scaleTo={0.96}
      style={pressStyle}
      accessibilityRole="button"
      accessibilityLabel={`Moment ${index + 1} öffnen`}
      testID={`recap-tile-${shape}-${moment.id}`}
      onPress={() => onTap(index)}
    >
      <View style={[clipStyle, { backgroundColor: colors['bg-1'] }]}>
        <Image
          testID={`recap-image-${moment.id}`}
          source={{ uri: url.thumb_url ?? url.medium_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
        />
        {moment.type === 'video' && (
          // `accessible={false}` on the wrapper, not on `Pill`: the tile's
          // own PressScale already carries the "Moment N öffnen" label, a
          // second accessible node on top of it would just repeat/confuse
          // that for VoiceOver, and `Pill` itself has no `accessible` prop
          // to begin with (it only owns background/blur, per its own
          // contract) - so the plain View around it carries both the flag
          // and this badge's testID.
          <View testID={`recap-tile-video-${moment.id}`} accessible={false} style={styles.videoBadgeWrap}>
            <Pill style={styles.videoBadgeFill}>
              <Play size={12} color={palette['bg-0']} strokeWidth={1.75} />
            </Pill>
          </View>
        )}
      </View>
    </PressScale>
  );
}

// One row of the mosaic. `feature` is the only row shape with two columns
// of DIFFERENT height, so it gets its own branch. `triple` gets its own
// branch too: unlike `single`/`pair` (always exactly as many tiles as the
// row needs), a trailing `triple` row can be short, and its tiles must stay
// true thirds regardless (see the spacer comment below). `single`/`pair`
// are always full, so they share the plain closing branch, only differing
// in which tile shape fills them.
function MosaicRowView({
  row, urls, indexById, onTap,
}: {
  row: MosaicRow;
  urls: Map<string, MediaUrl>;
  indexById: Map<string, number>;
  onTap: (index: number) => void;
}) {
  if (row.kind === 'feature') {
    const [lead, ...rightColumn] = row.tiles;
    return (
      <View style={styles.featureRow}>
        <MosaicTileView
          tile={lead}
          pressStyle={styles.leadPress}
          clipStyle={styles.leadTile}
          urls={urls}
          indexById={indexById}
          onTap={onTap}
        />
        {/* The right column's own height is never set directly: with three
            equal columns of width `w` and two gaps `g` between them, the
            row is `3w + 2g` wide. Lead spans two of those columns plus the
            gap between them (`2w + g` wide) and, to line up with the right
            side, must be exactly that tall too (`2w + g`) - so lead is a
            square, `aspectRatio: 1`, not an arbitrary ratio. Lead's own
            width+aspectRatio is the ONLY self-contained size in this row
            (both right-hand tiles below use `flex: 1` with no aspectRatio
            of their own), so it alone anchors the row's height; the column
            then stretches to match via the default `alignItems: 'stretch'`,
            and its two `flex: 1` children split that stretched height
            evenly. Giving the right-hand tiles their own aspectRatio too,
            "for safety", would make each pick its OWN square independently
            and reintroduce exactly the one-gap mismatch this avoids. */}
        <View style={styles.featureColumn}>
          {rightColumn.map((t) => (
            <MosaicTileView
              key={t.moment.id}
              tile={t}
              pressStyle={styles.featureThirdPress}
              clipStyle={styles.featureThirdTile}
              urls={urls}
              indexById={indexById}
              onTap={onTap}
            />
          ))}
        </View>
      </View>
    );
  }
  if (row.kind === 'triple') {
    // A trailing `triple` row can hold fewer than three moments (mosaic.ts
    // keeps a short last row rather than padding or dropping moments); each
    // real tile still gets `flex: 1` via `thirdPress`. Without something
    // else claiming the missing slots' share, N `flex: 1` siblings would
    // just split the WHOLE row width among however many tiles actually
    // stand there, silently growing a lone trailing tile to full width (or
    // two of them to half each) instead of the one-third every other
    // `third` tile is. These spacers claim exactly that missing share
    // instead (same `flex: 1`, no content, not tappable, not announced),
    // so a partial row's real tiles stay the same width as a full row's,
    // and the empty slots simply show through to the screen's own
    // background on the right. Do not "tidy" them away: that is the one
    // behaviour this whole branch exists for.
    const missingSlots = 3 - row.tiles.length;
    return (
      <View style={styles.tileRow}>
        {row.tiles.map((t) => (
          <MosaicTileView
            key={t.moment.id}
            tile={t}
            pressStyle={styles.thirdPress}
            clipStyle={styles.thirdTile}
            urls={urls}
            indexById={indexById}
            onTap={onTap}
          />
        ))}
        {Array.from({ length: missingSlots }).map((_, i) => (
          <View key={`spacer-${i}`} accessible={false} style={styles.thirdPress} />
        ))}
      </View>
    );
  }
  const [pressStyle, clipStyle] = row.kind === 'single'
    ? [styles.widePress, styles.wideTile]
    : [styles.halfPress, styles.halfTile];
  return (
    <View style={styles.tileRow}>
      {row.tiles.map((t) => (
        <MosaicTileView
          key={t.moment.id}
          tile={t}
          pressStyle={pressStyle}
          clipStyle={clipStyle}
          urls={urls}
          indexById={indexById}
          onTap={onTap}
        />
      ))}
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
  const rows = mosaicRows(day.moments);
  return (
    <View style={{ gap: spacing.m }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={[type.h2, { color: colors['text-1'] }]}>{dayTitle(day)}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>{daySubtitle(day)}</Text>
      </View>
      <View style={{ gap: spacing.xs }}>
        {rows.map((row, rowIndex) => (
          // Index as key is safe here: `mosaicRows` is a pure function of
          // `day.moments`, its rows never reorder or get inserted/removed
          // independently of that same array changing too.
          <MosaicRowView key={rowIndex} row={row} urls={urls} indexById={indexById} onTap={onTap} />
        ))}
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

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
        <View style={[styles.content, { paddingTop: topInset }]}>
          {/* The hero needs a trip to draw at all (title, dates, photo); this
              state has none, so it keeps only the bare way back instead of
              the hero the rest of the screen now opens with. */}
          <PressScale accessibilityRole="button" accessibilityLabel="Zurück" onPress={goBack}>
            <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
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
  // The cover needs no data source of its own: the screen already loads the
  // url pool for the tile grid, the hero just borrows its first
  // thumbnail-bearing entry from the same already-sorted list.
  const coverEntry = withImage.find((m) => urls.get(m.id)?.thumb_url);
  const coverUrl = coverEntry ? (urls.get(coverEntry.id)!.thumb_url ?? null) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset }]}>
        <RecapHero
          title={trip.name}
          subtitle={heroSubtitle(trip, withImage.length)}
          coverUrl={coverUrl}
          onBack={goBack}
          onPlay={() => toPlayer(0)}
        />

        {/* The two readings of this recap (Spec §5.1) as a segment row of two
            pills (radius 999), explicitly NOT as a second tab bar: the bottom
            one stays at four entries (DESIGN-LANGUAGE §4), and the map is a
            view onto THIS recap, not an area of its own.

            Sharing this row with the save/share icons (Task 9: they moved
            here from the header the hero absorbed) instead of two separate
            rows: both belong to the same "what can I do with this recap"
            question, and a screen this light on chrome shouldn't spend two
            lines answering it.

            Light, not translucent: the `Pill` component is made for a
            foreign surface (DESIGN-LANGUAGE §1, "auf Fotos"), here plain
            white lies underneath. */}
        <View style={styles.controlsRow}>
          {canMap ? (
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
          ) : (
            // Empty, not omitted: `justifyContent: 'space-between'` on a
            // SINGLE child aligns it to the start, which would drag the
            // action icons below to the left edge instead of leaving them
            // docked right.
            <View />
          )}
          <View style={styles.actionIcons}>
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
        ) : (
          <View style={{ gap: spacing.xl, marginTop: spacing.xl }}>
            {days.map((day) => (
              <DaySection key={day.number} day={day} urls={urls} indexById={indexById} onTap={toPlayer} />
            ))}
          </View>
        )}

        {!error && (pendingCount > 0 || skippedCount > 0) && (
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
      {/* Before the sheets: their backdrop must keep covering the whole
          screen, including the status bar strip. */}
      <StatusBarCover />

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

const styles = StyleSheet.create({
  content: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.m },
  // Segment pills left, save/share icons right (Task 9: both used to be two
  // separate rows, the header above the H1 and the segment row below it).
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionIcons: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
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
  // Mosaic rows and columns (Task 10, replaces the old three-column grid).
  // The gap is always the explicit `gap` property, never
  // `justifyContent: 'space-between'` (the old grid's review flagged this
  // once already): that lets the gap emerge from the remaining space,
  // differently sized per device width and never exactly from the 4-grid.
  featureRow: { flexDirection: 'row', gap: spacing.xs },
  tileRow: { flexDirection: 'row', gap: spacing.xs },
  featureColumn: { flex: 1, flexDirection: 'column', gap: spacing.xs },
  // `pressStyle` (on PressScale): width/flex participation in the row or
  // column. `clipStyle` (on the plain View PressScale wraps): radius,
  // clipping, and, where the tile is self-contained, its aspectRatio - see
  // the comment on the feature row for why the two right-hand tiles below
  // deliberately have none.
  leadPress: { flex: 2 },
  leadTile: { aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
  widePress: { flex: 1 },
  wideTile: { aspectRatio: 3 / 2, borderRadius: radius.control, overflow: 'hidden' },
  halfPress: { flex: 1 },
  halfTile: { aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
  thirdPress: { flex: 1 },
  thirdTile: { aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
  featureThirdPress: { flex: 1 },
  featureThirdTile: { flex: 1, borderRadius: radius.control, overflow: 'hidden' },
  // Position on the wrapper (see MosaicTileView), size and shape on `Pill`
  // itself: `Pill` owns its background and blur, callers own only shape,
  // size and positioning.
  videoBadgeWrap: { position: 'absolute', bottom: spacing.xs, left: spacing.xs },
  videoBadgeFill: {
    width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
  },
});
