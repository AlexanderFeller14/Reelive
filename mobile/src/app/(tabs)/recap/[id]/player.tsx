import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { Download, MessageCircle, X } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { ProgressBar } from '@/components/ProgressBar';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { Input } from '@/components/Input';
import { SealPeel } from '@/components/SealPeel';
import { cinema, motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset, useBottomInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { saveMomentToGallery } from '@/features/recap/exportApi';
import { reportMoment, REPORT_MAX_LENGTH } from '@/features/recap/reportApi';
import { groupByDays } from '@/features/recap/days';
import { playerMode } from '@/features/recap/playerEntry';
import type { Comment, Reaction, RecapMoment, RecapDay } from '@/features/recap/types';
import {
  getPool,
  isSoonExpiring,
  retryHelps,
  type MediaUrl,
} from '@/features/recap/urlPool';
import {
  blocksAutoAdvance,
  durationFor,
  withReason,
  withoutReason,
  withoutReasons,
  dayChanges,
  advance,
  goBack,
  type PauseReason,
  type PlayerState,
} from '@/features/recap/playerLogic';
import {
  removeReaction,
  fetchComments,
  fetchReactions,
  COMMENT_MAX_LENGTH,
  writeComment,
  setReaction,
} from '@/features/recap/socialApi';

// The next three photos are preloaded via expo-image (V8): tapping onward
// must never flash black.
const PRELOAD_COUNT = 3;
const INTERSTITIAL_DURATION_MS = 1500;
// Story convention (Snapchat/Instagram): 250 ms separates a tap from a hold.
const TAP_THRESHOLD_MS = 250;
// Task 8, Phase 6: a long press opens "report this moment". Deliberately
// well above TAP_THRESHOLD_MS (250 ms already counts as a hold, i.e. as a
// pause); 500 ms is the platform-usual long-press value (iOS/Android, and
// RN Pressable's own default for `delayLongPress`).
const LONG_PRESS_MS = 500;
const CLOSE_THRESHOLD_PX = 120;
// DESIGN-LANGUAGE §5: "light to cinema = fade through dark, 350 ms", the
// staged transition when entering the player ("the lights go out").
const CINEMA_FADE_DURATION_MS = 350;
const CINEMA_FADE_REDUCED_MS = 200;
// How long the end card stands in show mode before handing over to the
// overview on its own (Task 4). This is READING time for "Das war der
// Recap.", not a motion duration, so `useReducedMotion()` must NOT shorten
// it the way CINEMA_FADE_REDUCED_MS shortens the fade above.
const END_CARD_MS = 2000;
// Same sharpness-limit rationale as SEAL_STAGE_MAX in recap/[id]/overview.tsx
// (see there): only bites on an iPad, every iPhone stays below it anyway.
const SEAL_STAGE_MAX = 416;

// Reasons that belong to the moment being LEFT and are taken back on every
// ACTUAL index change, never carried over to the NEW moment. 'kommentare'
// and 'zwischenkarte' deliberately do NOT belong here: 'kommentare' hangs on
// the sheet (it is taken back by closeComments), 'zwischenkarte' manages
// itself through its own effect.
const MOMENT_CHANGE_REASONS: PauseReason[] = ['halten', 'neuversuch'];

// Fixed small emoji bar (Task-12 brief: no picker, no new package). `id` is
// the stable key for testID and React key (an emoji glyph can consist of
// several codepoints, e.g. heart plus variation selector, which makes a poor
// testID), `emoji` is the value socialApi actually stores.
const EMOJI_BAR: { id: string; emoji: string; label: string }[] = [
  { id: 'heart', emoji: '❤️', label: 'Herz' },
  { id: 'laugh', emoji: '😂', label: 'Lachen' },
  { id: 'wow', emoji: '😮', label: 'Staunen' },
  { id: 'clap', emoji: '👏', label: 'Applaus' },
  { id: 'cry', emoji: '😢', label: 'Träne' },
];

// Same wording as the sister screen recap/[id]/overview.tsx for latecomers
// and skipped moments, deliberately a small local copy instead of an import:
// overview.tsx does not export these helpers.
function pendingText(count: number): string {
  return `${count} ${count === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}
function skippedText(count: number): string {
  return `${count} ${count === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

// Same copy rationale as above: "12. August" is the exact date format from
// overview.tsx's own formatDayDate (not exported there either).
const MONTHS_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
function formatDayDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONTHS_LONG[m - 1]}`;
}
// Second line of the interstitial card, staged BELOW the day number rather
// than joined onto it (recap-show plan, Task 3): this is the staging the
// overview's own day headings are meant to move to as well, later.
function daySubheading(day: RecapDay): string {
  return day.place ? `${day.place} · ${formatDayDate(day.date)}` : formatDayDate(day.date);
}

// Unlike preview.tsx (where moment time and device time are the same, because
// the shot is taken live) this strictly needs Intl.DateTimeFormat with
// `timeZone`, there is no Intl-free way.
function timeInZone(capturedAt: string, capturedTz: string): string {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: capturedTz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(capturedAt));
  } catch {
    const d = new Date(capturedAt);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

// Contract 2: the start index from the overview refers to the moments with
// upload_status==='uploaded' that ALSO have a URL in the pool, in the order
// fetchRecapMoments returns them, the same list `load()` below builds as
// `playlist`.
function parseStartIndex(raw: string | undefined, length: number): number {
  if (length === 0) return 0;
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n >= length) return 0;
  return n;
}

type LoadPhase = 'loading' | 'error' | 'empty' | 'ready' | 'ended';

// Media screen (DESIGN-LANGUAGE v2 §1): fixed cinema palette, no useTheme(),
// same pattern as capture/index.tsx and preview.tsx.
function CinemaButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <View style={styles.cinemaButton}>
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <Text style={[type.bodyMedium, styles.textLink]}>{label}</Text>
    </PressScale>
  );
}

// One emoji of the fixed bar. Active (own reaction) fills SOLIDLY with
// `cinema['text-1']`, the same tone CinemaButton already uses for "solid
// surface on a cinema background", so no blur either: an opaque surface has
// nothing that could shine through. Inactive stays a translucent pill with
// blur (DESIGN-LANGUAGE §1/§4). 44x44 is the minimum touch target (v2 §8).
function EmojiPill({
  id, emoji, label, active, onPress,
}: {
  id: string;
  emoji: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressScale
      testID={`player-emoji-${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
      {active ? (
        <View style={[styles.emojiPill, styles.emojiPillActive]}>
          <Text style={styles.emojiGlyph}>{emoji}</Text>
        </View>
      ) : (
        <Pill style={styles.emojiPill}>
          <Text style={styles.emojiGlyph}>{emoji}</Text>
        </Pill>
      )}
    </PressScale>
  );
}

function OtherReactionsPill({ emojis }: { emojis: string[] }) {
  if (emojis.length === 0) return null;
  return (
    <Pill
      testID="player-reactions-others"
      style={styles.otherReactionsPill}
      accessibilityLabel={`Weitere Reaktionen: ${emojis.join(', ')}`}
    >
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{emojis.join(' ')}</Text>
    </Pill>
  );
}

function CommentRow({ comment }: { comment: Comment }) {
  return (
    <View testID={`comment-${comment.id}`} style={styles.commentRow}>
      <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{comment.authorName}</Text>
      <Text style={[type.body, { color: cinema['text-1'] }]}>{comment.text}</Text>
    </View>
  );
}

function LoadingHintPill({ text }: { text: string }) {
  return (
    <Pill style={styles.loadingHintPill}>
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{text}</Text>
    </Pill>
  );
}

function PhotoMoment({ url, onError }: { url: string; onError: () => void }) {
  return (
    <Image
      testID="player-photo"
      source={{ uri: url }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={150}
      onError={onError}
    />
  );
}

// Video end is detected through the player's `playToEnd` event, not through
// a timer; the uniform durationFor timer in the parent still runs as a
// fallback and advances even a video that never loads for lack of network.
// `statusChange` with status==='error' reports exactly that load failure to
// the parent (V10: retry once silently before anything becomes visible).
//
// `paused` drives player.pause()/play() directly: "hold = pause" must not
// stop at freezing the progress bar, otherwise picture AND sound of a video
// would keep running while the display stood still.
function VideoMoment({
  url, paused, onEnded, onError,
}: {
  url: string;
  paused: boolean;
  onEnded: () => void;
  onError: () => void;
}) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    const endedSub = player.addListener('playToEnd', onEnded);
    const statusSub = player.addListener('statusChange', (payload: { status: string }) => {
      if (payload.status === 'error') onError();
    });
    return () => {
      endedSub.remove();
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
      testID="player-video"
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

function MomentView({
  moment, url, failed, paused, onVideoEnded, onError,
}: {
  moment: RecapMoment;
  url: MediaUrl | undefined;
  failed: boolean;
  paused: boolean;
  onVideoEnded: () => void;
  onError: () => void;
}) {
  if (!failed && url) {
    return moment.type === 'video' ? (
      <VideoMoment url={url.medium_url} paused={paused} onEnded={onVideoEnded} onError={onError} />
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

export default function RecapPlayer() {
  const router = useRouter();
  const { id: tripId, start: startParam } = useLocalSearchParams<{ id: string; start?: string }>();
  const reducedMotion = useReducedMotion();
  // Computed ONCE here: Task 4 (end card, leaving the player) reads the same
  // `mode`, so this is the single derivation both tasks share, never a second
  // independent one.
  const mode = playerMode(startParam);
  // The player shows no header and lies edge to edge behind the island and the
  // home indicator. Device finding: the designed 32 from the StyleSheet were
  // not enough, the progress segments sat under the Dynamic Island.
  const topInset = useTopInset(spacing.xl);
  const bottomInset = useBottomInset(spacing.xl);
  const { userId } = useAuth();
  const { width: windowWidth } = useWindowDimensions();

  // As a useState INITIALIZER, not an effect: an effect would leave the
  // player visible without its seal for one frame after mount.
  const [sealed, setSealed] = useState(() => mode === 'show');

  const [phase, setPhase] = useState<LoadPhase>('loading');
  // The error and the question whether a second attempt achieves anything in
  // ONE value. They belong together: a text without that answer would mean
  // putting «Nochmal versuchen» under every sentence, including «Diese Reise
  // ist noch versiegelt.». Kept apart they could drift, and the button would
  // promise something it cannot keep again.
  const [error, setError] = useState<{ text: string; canRetry: boolean } | null>(null);
  const [startDate, setStartDate] = useState('');
  // Reference-stable from the moment `load()` sets it once (contract 1:
  // dayChanges memoises over the ARRAY REFERENCE, not over content or length,
  // so this list is NEVER rebuilt inline, only replaced exactly once per
  // successful load through setState).
  const [playlist, setPlaylist] = useState<RecapMoment[]>([]);
  const [urls, setUrls] = useState<Map<string, MediaUrl>>(new Map());
  const [validUntil, setValidUntil] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  const [state, setState] = useState<PlayerState>({ index: 0, paused: new Set(), progress: 0 });
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [reactionError, setReactionError] = useState<string | null>(null);

  // Task 7: «In Galerie sichern» for the CURRENTLY active moment. Its own
  // notice text instead of reusing `reactionError`: a success is not an error,
  // yet both follow the same pattern (a pill under the reaction row that
  // disappears when the moment changes).
  const [exportRunning, setExportRunning] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const [commentMomentId, setCommentMomentId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [commentSendError, setCommentSendError] = useState<string | null>(null);

  // Task 8, Phase 6: «Diesen Moment melden», triggered by a long press (see
  // onLongPress on the tap zones below), same state pattern as the comment
  // sheet directly above. Reporting removes nothing; only the moderation in
  // the trip detail does that.
  const [reportMomentId, setReportMomentId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportSendError, setReportSendError] = useState<string | null>(null);
  const [reportConfirmed, setReportConfirmed] = useState(false);

  const mounted = useRef(true);
  // Wall-clock time at which the current segment would have started (at
  // progress 0). On touch (hold gesture) that allows computing exactly how
  // much of this moment has already been "seen", without keeping a second,
  // separately ticking counter (the same separation of optics and timer as
  // SealAnimation.tsx: the animation runs on its own, the actual point in time
  // comes from Date.now()).
  const segmentStartRef = useRef(0);
  const touchStartRef = useRef(0);
  const refreshRunningRef = useRef(false);
  const retriedRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | undefined>(undefined);
  // Phase-5 final review, point 1: ONE ref on the current `state.paused` is
  // enough, `blocksAutoAdvance` (playerLogic.ts) knows the difference between
  // the reasons itself. Earlier this needed two separately kept booleans,
  // because a single `paused` boolean could not tell the reasons apart.
  const pausedRef = useRef<ReadonlySet<PauseReason>>(new Set());
  // Key `${postId}:${emoji}`. A ref rather than a state flag: checking and
  // setting have to happen SYNCHRONOUSLY within the same key press, before the
  // next tap even arrives; React commits a state change only on the next
  // render cycle, so a second, very fast tap could still read the old value.
  const pendingReactionsRef = useRef<Set<string>>(new Set());
  const commentMomentIdRef = useRef<string | null>(null);
  const reportMomentIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    const [
      { data: trip, error: tripError },
      { data: moments, error: momentsError },
      { pool, error: poolError, reason: poolReason },
    ] = await Promise.all([fetchTrip(tripId), fetchRecapMoments(tripId), getPool(tripId)]);
    if (!mounted.current) return;

    // Trip before pool before moments, the same order as overview.tsx: a broken
    // trip query makes the other two meaningless anyway.
    const sharedError = tripError ?? poolError ?? momentsError ?? null;
    if (sharedError || !trip) {
      setError({
        text: sharedError ?? 'Diese Reise gibt es nicht mehr.',
        canRetry: tripError === null && poolError !== null ? retryHelps(poolReason) : true,
      });
      setPhase('error');
      return;
    }

    const urlsMap = pool?.urls ?? new Map<string, MediaUrl>();
    const uploaded = moments.filter((m) => m.upload_status === 'uploaded');
    // Same filtering as overview.tsx: only moments with a pool URL belong in the
    // reel (contract 2).
    const withUrl = uploaded.filter((m) => urlsMap.has(m.id));

    setStartDate(trip.start_date);
    setUrls(urlsMap);
    setValidUntil(pool?.validUntil ?? 0);
    setPendingCount(moments.length - uploaded.length);
    setSkippedCount(pool?.skipped ?? 0);
    setPlaylist(withUrl);
    retriedRef.current.clear();
    setFailed(new Set());

    if (withUrl.length === 0) {
      setPhase('empty');
      return;
    }
    setState({ index: parseStartIndex(startParam, withUrl.length), paused: new Set(), progress: 0 });
    setPhase('ready');
  }, [tripId, startParam]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Media screens switch the status bar locally (same pattern as
  // capture/index.tsx and preview.tsx).
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, [])
  );

  // "The lights go out": the staged fade through dark when entering the player
  // (DESIGN-LANGUAGE §5).
  //
  // `reducedMotion` sits in the deps on purpose, although the staging is
  // conceptually one-off: `useReducedMotion()` always returns `false` on the
  // very first render and only resolves ASYNCHRONOUSLY once
  // `AccessibilityInfo.isReduceMotionEnabled()` comes back. With `[]` deps
  // CINEMA_FADE_REDUCED_MS would be unreachable at runtime. Same accepted
  // behaviour as SealAnimation.tsx and RevealSequence.tsx. If the hook
  // resolves to `false` (the normal case) the state value does not change and
  // the effect does not run a second time.
  const [cinemaFade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    Animated.timing(cinemaFade, {
      toValue: 0,
      duration: reducedMotion ? CINEMA_FADE_REDUCED_MS : CINEMA_FADE_DURATION_MS,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const activeMoment = playlist[state.index];
  activeIdRef.current = activeMoment?.id;
  // All derived from `state.paused` (Phase-5 final review, point 1), no own
  // state any more: that used to be two sources of truth for the same
  // information. `stopped` is the question "is ANY reason running", condensed
  // for the progress bar and VideoMoment, the only place where the difference
  // between the reasons deliberately no longer matters.
  const interstitial = state.paused.has('zwischenkarte');
  const commentsOpen = state.paused.has('kommentare');
  const reportOpen = state.paused.has('melden');
  const stopped = state.paused.size > 0;
  // Kept current directly in the render pass (same pattern as activeIdRef).
  pausedRef.current = state.paused;
  commentMomentIdRef.current = commentMomentId;
  reportMomentIdRef.current = reportMomentId;

  // Contract 1: `days` only depends on the reference-stable `playlist` plus
  // `startDate`, so it need not be recomputed on every progress tick, the same
  // performance consideration as dayChanges.
  const days = useMemo(() => groupByDays(playlist, startDate), [playlist, startDate]);
  const currentDay = useMemo(() => {
    if (!activeMoment) return null;
    return days.find((d) => d.moments.some((m) => m.id === activeMoment.id)) ?? null;
  }, [days, activeMoment]);

  useEffect(() => {
    if (playlist.length === 0) return;
    let alive = true;
    void fetchReactions(playlist.map((m) => m.id)).then(({ data, error }) => {
      if (!alive || !mounted.current) return;
      setReactions(data);
      if (error) setReactionError(error);
    });
    return () => {
      alive = false;
    };
  }, [playlist]);

  useEffect(() => {
    setReactionError(null);
    setExportNotice(null);
    setExportRunning(false);
  }, [activeMoment?.id]);

  const ownEmojis = useMemo(() => {
    if (!activeMoment || !userId) return new Set<string>();
    const list = reactions[activeMoment.id] ?? [];
    return new Set(list.filter((r) => r.user_id === userId).map((r) => r.emoji));
  }, [reactions, activeMoment, userId]);

  const otherEmojis = useMemo(() => {
    if (!activeMoment) return [];
    const list = reactions[activeMoment.id] ?? [];
    const unique = new Set<string>();
    for (const r of list) {
      if (r.user_id !== userId) unique.add(r.emoji);
    }
    return Array.from(unique);
  }, [reactions, activeMoment, userId]);

  // Tapping an emoji sets or removes OPTIMISTICALLY; if the call fails, the
  // `.then()` branch below makes exactly the opposite change again. A primary
  // key of (post_id, user_id, emoji) allows exactly these two states per person
  // and emoji anyway, so a second tap on an own reaction can only mean
  // "remove", without a second interaction path.
  const tapEmoji = (emoji: string) => {
    const moment = activeMoment;
    if (!moment || !userId) return;
    const momentId = moment.id;
    const uid = userId;
    const key = `${momentId}:${emoji}`;
    if (pendingReactionsRef.current.has(key)) return;
    pendingReactionsRef.current.add(key);

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setReactionError(null);

    const hadReacted = (reactions[momentId] ?? []).some((r) => r.emoji === emoji && r.user_id === uid);

    const add = (current: Record<string, Reaction[]>) => ({
      ...current,
      [momentId]: [...(current[momentId] ?? []), { post_id: momentId, user_id: uid, emoji }],
    });
    const remove = (current: Record<string, Reaction[]>) => ({
      ...current,
      [momentId]: (current[momentId] ?? []).filter((r) => !(r.emoji === emoji && r.user_id === uid)),
    });

    const rollback = (message: string) => {
      pendingReactionsRef.current.delete(key);
      if (!mounted.current) return;
      setReactions(hadReacted ? add : remove);
      if (activeIdRef.current === momentId) setReactionError(message);
    };

    setReactions(hadReacted ? remove : add);
    const call = hadReacted ? removeReaction(momentId, emoji) : setReaction(momentId, emoji);
    void call
      .then(({ error }) => {
        if (error) rollback(error);
        else pendingReactionsRef.current.delete(key);
      })
      .catch(() => {
        // socialApi catches every expected error path itself and returns it as
        // `{ error }` instead of throwing (see the comment there), so an actual
        // reject() here is the unexpected remainder, e.g. a runtime exception in
        // the fetch polyfill.
        rollback(
          hadReacted
            ? 'Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.'
            : 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.'
        );
      });
  };

  // Opens the comment sheet for the CURRENTLY active moment and holds that
  // moment in its own state (`commentMomentId`) instead of reading
  // `activeMoment.id` again on every access, so submitComment ALWAYS gets the
  // moment the sheet was opened for, even if the pool is refreshed in the
  // background meanwhile.
  //
  // Deliberate deviation from the brief's wording ("a swipe up opens the
  // sheet"): this button is the ONLY way to open the sheet, there is no swipe
  // gesture for it. The screen's single PanResponder (below) recognises
  // downward swipes to close the player and nothing else; using it for upward
  // swipes as well would have needed either a second, independent touch
  // surface (conflicting with the tap zones and the interstitial card) or a
  // case distinction in `onPanResponderMove`. Without a real device test that
  // combination was not worth building blind.
  const openComments = () => {
    const moment = activeMoment;
    if (!moment) return;
    const momentId = moment.id;
    const previousMomentId = commentMomentIdRef.current;
    // Set EAGERLY and synchronously, not only through the render pass below:
    // if fetchComments resolves faster than React commits the re-render, the
    // ref comparison in the `.then()` below would still see the OLD value and
    // wrongly discard the fresh answer, leaving the sheet on its spinner.
    commentMomentIdRef.current = momentId;
    setCommentMomentId(momentId);
    setCommentText('');
    setCommentSendError(null);
    if (previousMomentId !== momentId) {
      setCommentSending(false);
    }
    setComments([]);
    setCommentsError(null);
    setCommentsLoading(true);
    setState((s) => ({ ...s, paused: withReason(s.paused, 'kommentare') }));

    void fetchComments(momentId).then(({ data, error }) => {
      if (!mounted.current || commentMomentIdRef.current !== momentId) return;
      setCommentsLoading(false);
      setComments(data);
      setCommentsError(error);
    });
  };

  const closeComments = () => {
    // Takes back ONLY its own reason: a player that is paused for a DIFFERENT
    // reason stays paused after this sheet closes.
    setState((s) => ({ ...s, paused: withoutReason(s.paused, 'kommentare') }));
  };

  const saveCurrentMoment = async () => {
    const moment = activeMoment;
    if (!moment) return;
    const url = urls.get(moment.id);
    if (!url) return;
    const momentId = moment.id;
    setExportRunning(true);
    setExportNotice(null);
    const result = await saveMomentToGallery(moment, url);
    if (!mounted.current || activeIdRef.current !== momentId) return;
    setExportRunning(false);
    if (!result.ok) {
      if (result.reason === 'no_permission') {
        Alert.alert('Kein Zugriff auf die Fotobibliothek', result.text, [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Einstellungen öffnen', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      setExportNotice(result.text);
      return;
    }
    setExportNotice('In der Fotobibliothek gesichert.');
  };

  const submitComment = () => {
    const postId = commentMomentId;
    if (!postId || commentSending) return;
    setCommentSending(true);
    setCommentSendError(null);
    void writeComment(postId, commentText).then(({ error }) => {
      if (!mounted.current || commentMomentIdRef.current !== postId) return;
      setCommentSending(false);
      if (error) {
        setCommentSendError(error);
        return;
      }
      setCommentText('');
      // Deliberately NOT optimistic (unlike reactions): a fresh fetchComments
      // shows the server-assigned author name and timestamp without the player
      // having to know the signed-in person's profile itself.
      setCommentsLoading(true);
      void fetchComments(postId).then(({ data, error: reloadError }) => {
        if (!mounted.current || commentMomentIdRef.current !== postId) return;
        setCommentsLoading(false);
        setComments(data);
        setCommentsError(reloadError);
      });
    });
  };

  // Task 8, Phase 6: same base pattern as openComments, own state per moment
  // plus the structural pause reason 'melden'. Unlike comments, reporting
  // needs no loading state (nothing is fetched up front), the form starts
  // empty right away. Deliberately WITHOUT haptics of its own: DESIGN-LANGUAGE
  // §5 has a fixed vocabulary of occasions and "opening a sheet" is not one
  // of them.
  const openReport = () => {
    const moment = activeMoment;
    if (!moment) return;
    const momentId = moment.id;
    // Eager like commentMomentIdRef (see the comment there), a fast reopen must
    // not hit the old ref value.
    reportMomentIdRef.current = momentId;
    setReportMomentId(momentId);
    setReportReason('');
    setReportSendError(null);
    setReportConfirmed(false);
    setState((s) => ({ ...s, paused: withReason(s.paused, 'melden') }));
  };

  const closeReport = () => {
    // Takes back ONLY its own reason (same principle as closeComments).
    setState((s) => ({ ...s, paused: withoutReason(s.paused, 'melden') }));
  };

  const submitReport = () => {
    const postId = reportMomentId;
    if (!postId || reportSending) return;
    setReportSending(true);
    setReportSendError(null);
    void reportMoment(postId, reportReason).then(({ error }) => {
      if (!mounted.current || reportMomentIdRef.current !== postId) return;
      setReportSending(false);
      if (error) {
        setReportSendError(error);
        return;
      }
      setReportConfirmed(true);
    });
  };

  const checkAndRefreshPoolInBackground = useCallback(async () => {
    if (refreshRunningRef.current) return;
    if (!isSoonExpiring({ urls, validUntil: validUntil, skipped: skippedCount }, Date.now())) return;
    refreshRunningRef.current = true;
    try {
      const { pool } = await getPool(tripId);
      if (pool && mounted.current) {
        setUrls(pool.urls);
        setValidUntil(pool.validUntil);
      }
    } finally {
      refreshRunningRef.current = false;
    }
  }, [tripId, urls, validUntil, skippedCount]);

  // Programmatic advance (timer expiry OR video end), both end up here.
  // Contract 4: `advance()` leaves `paused` untouched, so a programmatic call
  // MUST take back MOMENT_CHANGE_REASONS itself here, otherwise the NEXT
  // moment would stand still silently after a preceding hold gesture or while
  // a retry was running.
  const advanceAutomatically = useCallback(() => {
    void checkAndRefreshPoolInBackground();
    const result = advance(state, playlist.length);
    if (result === 'ende') {
      setPhase('ended');
      return;
    }
    setState({ ...result, paused: withoutReasons(result.paused, MOMENT_CHANGE_REASONS) });
  }, [state, playlist.length, checkAndRefreshPoolInBackground]);
  // Ref indirection (same pattern as SealAnimation.tsx/onFinishedRef): the
  // auto-advance timer and the video-end event always call the newest version
  // without their own effects having to be set up again on every render.
  const advanceAutomaticallyRef = useRef(advanceAutomatically);
  advanceAutomaticallyRef.current = advanceAutomatically;

  // Same stale guard as onLoadError. A VideoMoment's `playToEnd` listener is
  // bound to that instance's `player` (effect deps `[player]`) and therefore
  // stays tied to exactly THAT moment until unmount. The reliable protection
  // is NOT the effect cleanup (its timing relative to a late native event is
  // not guaranteed) but this explicit comparison with the actually active
  // moment.
  const videoEnded = useCallback((postId: string) => {
    if (activeIdRef.current !== postId) return;
    // `blocksAutoAdvance` (playerLogic.ts) lets exactly 'halten' through
    // (contract 4, a `playToEnd` arriving during a hold gesture MUST still
    // advance) and blocks every other reason: the interstitial card has its own
    // timer and must not be overtaken, and an open sheet must not let the player
    // run on unseen underneath it (VideoMoment's own pause effect commits only
    // on the NEXT pass, so `playToEnd` can arrive inside that narrow window).
    if (blocksAutoAdvance(pausedRef.current)) return;
    advanceAutomaticallyRef.current();
  }, []);

  // Auto-advance: ONE timer for photos AND videos (durationFor yields a
  // sensible duration for both). For a video it doubles as the fallback if it
  // never loads because the network is gone: the timer advances anyway, while
  // a normally loading video usually fires `playToEnd` slightly earlier and
  // advances instead, on which React cancels this timer through its cleanup.
  useEffect(() => {
    // Covers ALL reasons, including 'halten' and 'zwischenkarte' (unlike
    // blocksAutoAdvance in videoEnded above): the regular per-moment timer is not
    // an event that a hold gesture would have to let through by way of exception.
    // `sealed` guards the same way: the reel must not run on behind a standing
    // seal, and `phase` alone does not prevent that, `load()` reaches 'ready'
    // independently of whether the seal has been peeled yet.
    if (sealed || phase !== 'ready' || state.paused.size > 0) return;
    const moment = playlist[state.index];
    if (!moment) return;
    const duration = durationFor(moment);
    const remaining = Math.max(0, duration - state.progress);
    segmentStartRef.current = Date.now() - state.progress;
    const timer = setTimeout(() => advanceAutomaticallyRef.current(), remaining);
    return () => clearTimeout(timer);
  }, [sealed, phase, state.paused, state.index, state.progress, playlist]);

  // Day interstitial card: appears BEFORE the first moment of a new day and
  // stands for 1.5 s before advancing on its own.
  //
  // `skip()` (a tap on the card) changes none of this effect's deps, so no
  // cleanup and no rerun happen when the card is skipped by tap. The timer set
  // here then stays orphaned until its regular expiry and still fires; that is
  // deliberately accepted, not designed away. What made the earlier bug was NOT
  // the orphaned timer itself but that its body reset `paused`
  // UNCONDITIONALLY instead of only its own reason.
  useEffect(() => {
    // Same `sealed` guard as the auto-advance timer above and for the same
    // reason: this effect starts its own 1.5 s timer, which must not begin
    // ticking behind a standing seal either.
    if (sealed || phase !== 'ready') return;
    if (!dayChanges(playlist, startDate, state.index)) {
      // This branch runs on EVERY index change that is NOT a day change, the
      // ordinary case. `withoutReason` itself is no-op safe (it returns the same
      // set reference), but `setState` would still receive a NEW `state` object on
      // every call and trigger a render even when 'zwischenkarte' is absent
      // anyway. The explicit `.has()` check keeps `setState` out of this most
      // frequent case entirely, so React bails out completely.
      setState((s) => (s.paused.has('zwischenkarte') ? { ...s, paused: withoutReason(s.paused, 'zwischenkarte') } : s));
      return;
    }
    setState((s) => ({ ...s, paused: withReason(s.paused, 'zwischenkarte') }));
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, paused: withoutReason(s.paused, 'zwischenkarte') }));
    }, INTERSTITIAL_DURATION_MS);
    return () => clearTimeout(timer);
  }, [sealed, phase, playlist, startDate, state.index]);

  // Videos are deliberately not preloaded: the brief does not ask for it and
  // expo-video buffers on mount by itself.
  useEffect(() => {
    if (phase !== 'ready') return;
    // Behind a standing seal nothing is on screen yet, so the CURRENT moment
    // needs the same warm-up as the ones after it: it is the exact frame the
    // peel reveals, and the seal is the loading window for it. Once the reel
    // runs the current image is already showing, and prefetching it again
    // would be pointless, so the window shifts to start only after it.
    const from = sealed ? state.index : state.index + 1;
    const upcomingUrls = playlist
      .slice(from, from + PRELOAD_COUNT)
      .filter((m) => m.type === 'photo')
      .map((m) => urls.get(m.id)?.medium_url)
      .filter((u): u is string => !!u);
    if (upcomingUrls.length > 0) void Image.prefetch(upcomingUrls);
  }, [phase, state.index, playlist, urls, sealed]);

  // A tap SKIPS the interstitial card without also advancing to the next
  // moment: the card is the only `Pressable` at this place on screen, it is
  // rendered LAST and structurally lies above the two tap zones below it, so a
  // touch during the card physically reaches only its own onPress handler. It
  // is the render order that prevents this, not a flag check.
  const skip = () => {
    setState((s) => ({ ...s, paused: withoutReason(s.paused, 'zwischenkarte') }));
  };

  const onLoadError = useCallback(
    (postId: string) => {
      if (activeIdRef.current !== postId) return;
      if (retriedRef.current.has(postId)) {
        setFailed((s) => new Set(s).add(postId));
        return;
      }
      retriedRef.current.add(postId);
      setState((s) => ({ ...s, paused: withReason(s.paused, 'neuversuch') }));
      void (async () => {
        const { pool } = await getPool(tripId);
        if (mounted.current && pool) {
          setUrls(pool.urls);
          setValidUntil(pool.validUntil);
        }
        // Additional stale guard (same principle as videoEnded): the player may long
        // since have advanced to ANOTHER moment, whose independently set pause state
        // this late answer must not overwrite. The way out deliberately does NOT sit
        // here (an unconditional reset could tear away the reason of another retry
        // still running, 'neuversuch' is ONE set entry with no reference to a
        // particular moment) but in MOMENT_CHANGE_REASONS: every ACTUAL index change
        // takes 'neuversuch' back itself, before this late answer even arrives.
        if (mounted.current && activeIdRef.current === postId) {
          setState((s) => ({ ...s, paused: withoutReason(s.paused, 'neuversuch') }));
        }
      })();
    },
    [tripId]
  );

  const onPressIn = () => {
    swipeTakenOverRef.current = false;
    touchStartRef.current = Date.now();
    const moment = playlist[state.index];
    if (!moment) return;
    const duration = durationFor(moment);
    const elapsed = Math.min(duration, Math.max(0, Date.now() - segmentStartRef.current));
    setState((s) => ({ ...s, paused: withReason(s.paused, 'halten'), progress: elapsed }));
  };

  const endTouch = (side: 'left' | 'right') => {
    // RN Pressability fires onPressOut on a tap zone EVEN IF the PanResponder
    // has taken the touch over meanwhile through responder termination (the
    // start of a real swipe); that is not a real release.
    if (swipeTakenOverRef.current) return;
    const held = Date.now() - touchStartRef.current;
    if (held < TAP_THRESHOLD_MS) {
      if (side === 'right') {
        void checkAndRefreshPoolInBackground();
        const result = advance(state, playlist.length);
        if (result === 'ende') {
          setPhase('ended');
          return;
        }
        setState({ ...result, paused: withoutReasons(result.paused, MOMENT_CHANGE_REASONS) });
        return;
      }
      void checkAndRefreshPoolInBackground();
      const backResult = goBack(state);
      setState({ ...backResult, paused: withoutReasons(backResult.paused, MOMENT_CHANGE_REASONS) });
      return;
    }
    setState((s) => ({ ...s, paused: withoutReason(s.paused, 'halten') }));
  };

  // Show mode has no route to come FROM other than the recap tab, and going
  // `back()` there would land behind the seal again on a trip already
  // opened. `replace` sends it to the overview instead, the screen the show
  // is building towards.
  const toOverview = useCallback(() => {
    router.replace({ pathname: '/recap/[id]/overview', params: { id: tripId } });
  }, [router, tripId]);

  const close = () => {
    if (mode === 'show') {
      toOverview();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/recap');
  };

  // Jump mode keeps the end card as a dead end with a button (today's
  // behaviour): someone who jumped in from a tile or the repeat pill is
  // already on the overview one screen behind and can just go back.
  useEffect(() => {
    if (phase !== 'ended' || mode !== 'show') return;
    const timer = setTimeout(toOverview, END_CARD_MS);
    return () => clearTimeout(timer);
  }, [phase, mode, toOverview]);

  const [pan] = useState(() => new Animated.ValueXY());
  // True as soon as the PanResponder has actually taken the touch over
  // (onPanResponderGrant only fires on a real takeover, unlike the merely
  // ASKING onMoveShouldSetPanResponderCapture), so that endTouch() can
  // recognise an onPressOut fired anyway for what it is: not a release but the
  // start of a swipe.
  const swipeTakenOverRef = useRef(false);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        swipeTakenOverRef.current = true;
      },
      onPanResponderMove: Animated.event([null, { dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > CLOSE_THRESHOLD_PX) {
          close();
          return;
        }
        Animated.spring(pan.y, { toValue: 0, useNativeDriver: false, ...motion.spring }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan.y, { toValue: 0, useNativeDriver: false, ...motion.spring }).start();
      },
    })
  ).current;

  // Own state, checked BEFORE the phase evaluation below and returned first:
  // while it stands, none of the phase-driven mechanics (progress bar,
  // auto-advance timer, tap zones) render at all, they simply never get to
  // their own `return`. The two phases excepted here are exactly the ones
  // with nothing behind the seal worth revealing.
  if (sealed && phase !== 'error' && phase !== 'empty') {
    const sealStageSize = Math.min(windowWidth - 2 * spacing.screen, SEAL_STAGE_MAX);
    return (
      <View testID="player-seal-stage" style={[styles.screen, styles.center]}>
        <SealPeel testID="player-seal" size={sealStageSize} onPeeled={() => setSealed(false)} />
        <Text style={[type.body, styles.centeredTextSecondary, { marginTop: spacing.l }]}>
          Dein Recap ist versiegelt. Tipp aufs Siegel, um ihn zu öffnen.
        </Text>
        {/* Final whole-branch review: a standing seal has no timer to hand it
            over eventually (unlike the interstitial card, gone in 1.5 s), so
            without this the only way out would be the OS back gesture, which
            `animation: 'fade'` on this route may disable. No tap zones and no
            swipe here on purpose (recap-show spec): the story navigation must
            not bite behind the seal, only the exit was missing. */}
        <PressScale
          testID="player-close"
          accessibilityRole="button"
          accessibilityLabel="Schliessen"
          onPress={close}
          style={[styles.closeWrap, { top: topInset }]}
        >
          <Pill style={styles.closePill}>
            <X size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </Pill>
        </PressScale>
      </View>
    );
  }

  if (phase === 'loading') {
    return (
      <View testID="player-loading" style={styles.screen}>
        <ActivityIndicator color={cinema['text-1']} />
      </View>
    );
  }

  // Show mode never WAS on the overview (it comes straight from the recap
  // tab) and close() there `replace`s onto it rather than going back, so
  // "Zurück" would claim a place this person has never been. Jump mode's
  // own close() genuinely does go back (canGoBack()) to the overview it
  // jumped in from, where the label stays accurate as it is.
  const wayBackLabel = mode === 'show' ? 'Zur Übersicht' : 'Zurück zur Übersicht';

  if (phase === 'error') {
    return (
      <View testID="player-error" style={[styles.screen, styles.center]}>
        <Text style={[type.h2, styles.centeredText]}>{error?.text}</Text>
        <View style={{ marginTop: spacing.xl, gap: spacing.base, alignItems: 'center' }}>
          {/* Only where a second attempt can achieve anything
              (features/recap/urlPool.ts). The way back below stays in any case, it is
              then the only action there is. */}
          {error?.canRetry && (
            <CinemaButton label="Nochmal versuchen" onPress={() => void load()} />
          )}
          <TextLink label={wayBackLabel} onPress={close} />
        </View>
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View testID="player-empty" style={[styles.screen, styles.center]}>
        <Text style={[type.h2, styles.centeredText]}>Diese Reise ist leer geblieben.</Text>
        <View style={{ marginTop: spacing.xl }}>
          <TextLink label={wayBackLabel} onPress={close} />
        </View>
      </View>
    );
  }

  if (phase === 'ended') {
    const stragglers = (pendingCount > 0 || skippedCount > 0) && (
      <View style={{ marginTop: spacing.base, gap: spacing.xs, alignItems: 'center' }}>
        {pendingCount > 0 && (
          <Text style={[type.secondary, styles.centeredTextSecondary]}>{pendingText(pendingCount)}</Text>
        )}
        {skippedCount > 0 && (
          <Text style={[type.secondary, styles.centeredTextSecondary]}>{skippedText(skippedCount)}</Text>
        )}
      </View>
    );
    // Show mode hands itself over on its own (the timer above), so the card
    // is just an early exit for a tap, with no button to press. Jump mode
    // keeps today's dead end with a button and close()'s back()/'/recap'.
    if (mode === 'show') {
      return (
        <Pressable testID="player-end" style={[styles.screen, styles.center]} onPress={toOverview}>
          <Text style={[type.h2, styles.centeredText]}>Das war der Recap.</Text>
          {stragglers}
        </Pressable>
      );
    }
    return (
      <View testID="player-end" style={[styles.screen, styles.center]}>
        <Text style={[type.h2, styles.centeredText]}>Das war der Recap.</Text>
        {stragglers}
        <View style={{ marginTop: spacing.xl }}>
          <CinemaButton label="Zurück zur Übersicht" onPress={close} />
        </View>
      </View>
    );
  }

  // phase === 'ready', so activeMoment is guaranteed to be set (the list is
  // never empty at this point, see load()).
  if (!activeMoment) return null;
  const url = urls.get(activeMoment.id);
  const placeTimeText = activeMoment.place_name
    ? `${activeMoment.place_name} · ${timeInZone(activeMoment.captured_at, activeMoment.captured_tz)}`
    : timeInZone(activeMoment.captured_at, activeMoment.captured_tz);

  return (
    <View testID="player-ready" style={styles.screen}>
      <Animated.View style={[styles.content, { transform: pan.getTranslateTransform() }]} {...panResponder.panHandlers}>
        <MomentView
          key={activeMoment.id}
          moment={activeMoment}
          url={url}
          failed={failed.has(activeMoment.id)}
          paused={stopped}
          onVideoEnded={() => videoEnded(activeMoment.id)}
          onError={() => onLoadError(activeMoment.id)}
        />

        <View
          testID="player-header-area"
          style={[styles.headerArea, { top: topInset }]}
          pointerEvents="box-none"
        >
          <ProgressBar
            count={playlist.length}
            activeIndex={state.index}
            durationMs={durationFor(activeMoment)}
            elapsedMs={state.progress}
            paused={stopped}
          />
          <View style={styles.headerRow}>
            <Pill style={styles.namePill}>
              {/* 32 instead of Avatar's default 36: the lower end of the
                  DESIGN-LANGUAGE §4 range (32 to 44 px), matching the compact header
                  pill. */}
              <Avatar name={activeMoment.authorName} avatarKey={activeMoment.authorAvatarKey} cinemaMode size={32} />
              <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{activeMoment.authorName}</Text>
            </Pill>
            <Pill style={styles.infoPill}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{placeTimeText}</Text>
            </Pill>
          </View>
        </View>

        <View
          testID="player-social-area"
          style={[styles.socialArea, { bottom: bottomInset }]}
          pointerEvents="box-none"
        >
          {activeMoment.caption && (
            <Pill testID="player-caption" style={styles.captionPill} pointerEvents="none">
              <Text style={[type.body, { color: cinema['text-1'] }]}>{activeMoment.caption}</Text>
            </Pill>
          )}
          <OtherReactionsPill emojis={otherEmojis} />
          <View style={styles.reactionRow}>
            {EMOJI_BAR.map((r) => (
              <EmojiPill
                key={r.id}
                id={r.id}
                emoji={r.emoji}
                label={r.label}
                active={ownEmojis.has(r.emoji)}
                onPress={() => tapEmoji(r.emoji)}
              />
            ))}
            <PressScale
              testID="player-comments-open"
              accessibilityRole="button"
              accessibilityLabel="Kommentare öffnen"
              onPress={openComments}
            >
              <Pill style={styles.commentButton}>
                <MessageCircle size={20} color={cinema['text-1']} strokeWidth={1.75} />
              </Pill>
            </PressScale>
            {/* Only visible if there is a URL for THIS moment at all (see MomentView):
                a moment that is not loading has nothing that could be saved. */}
            {url && (
              <PressScale
                testID="player-save"
                accessibilityRole="button"
                accessibilityLabel="In Galerie sichern"
                accessibilityState={{ disabled: exportRunning }}
                onPress={() => {
                  if (!exportRunning) void saveCurrentMoment();
                }}
              >
                <Pill style={styles.commentButton}>
                  {exportRunning ? (
                    <ActivityIndicator testID="player-save-loading" color={cinema['text-1']} size="small" />
                  ) : (
                    <Download size={20} color={cinema['text-1']} strokeWidth={1.75} />
                  )}
                </Pill>
              </PressScale>
            )}
          </View>
          {reactionError && (
            <Pill style={styles.reactionErrorPill}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{reactionError}</Text>
            </Pill>
          )}
          {exportNotice && (
            <Pill testID="player-export-hint" style={styles.reactionErrorPill}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{exportNotice}</Text>
            </Pill>
          )}
        </View>

        {/* Task 8, Phase 6: `onLongPress` and `delayLongPress` hang on EXACTLY the
            same Pressable as the existing tap navigation, no additional,
            potentially covered touch surface (the zIndex bug from Phase 5 came out
            of a SECOND, competing surface; here there is no second surface, only a
            second event handler on the demonstrably topmost one, see the zIndex
            tests). RN Pressability delivers onPressIn, onPressOut and onLongPress
            side by side without suppressing each other: onPressIn still pauses
            IMMEDIATELY on touch start (hold = pause, unchanged), only after
            LONG_PRESS_MS does the report sheet come on top. If the touch is released
            before that, onLongPress never fires and endTouch decides on the hold
            duration alone, as before. */}
        <Pressable
          testID="player-left"
          accessibilityRole="button"
          accessibilityLabel="Zurück zum vorherigen Moment"
          style={styles.tapZoneLeft}
          onPressIn={onPressIn}
          onPressOut={() => endTouch('left')}
          onLongPress={openReport}
          delayLongPress={LONG_PRESS_MS}
        />
        <Pressable
          testID="player-right"
          accessibilityRole="button"
          accessibilityLabel="Weiter zum nächsten Moment"
          style={styles.tapZoneRight}
          onPressIn={onPressIn}
          onPressOut={() => endTouch('right')}
          onLongPress={openReport}
          delayLongPress={LONG_PRESS_MS}
        />

        <PressScale
          testID="player-close"
          accessibilityRole="button"
          accessibilityLabel="Schliessen"
          onPress={close}
          style={[styles.closeWrap, { top: topInset }]}
        >
          <Pill style={styles.closePill}>
            <X size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </Pill>
        </PressScale>

        {interstitial && (
          <Pressable testID="player-interstitial" style={styles.interstitial} onPress={skip}>
            <Text style={[type.h1, styles.centeredText]}>
              {currentDay ? `Tag ${currentDay.number}` : 'Ein neuer Tag beginnt.'}
            </Text>
            {currentDay && (
              <Text style={[type.secondary, styles.centeredTextSecondary, { marginTop: spacing.s }]}>
                {daySubheading(currentDay)}
              </Text>
            )}
          </Pressable>
        )}
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.cinemaFade, { opacity: cinemaFade }]}
      />

      {/* SIBLING of the Animated.View with the pan handlers, not its child (same
          pattern as trip/[id]/index.tsx): the sheet has to lie above everything,
          including the tap zones. */}
      <Sheet visible={commentsOpen} title="Kommentare" onClose={closeComments} cinemaMode>
        {commentsLoading ? (
          <ActivityIndicator testID="comments-loading" color={cinema['text-1']} />
        ) : commentsError ? (
          <Text style={[type.secondary, { color: cinema['text-2'] }]}>{commentsError}</Text>
        ) : comments.length === 0 ? (
          <Text style={[type.secondary, { color: cinema['text-2'] }]}>
            Noch keine Kommentare. Schreib den ersten.
          </Text>
        ) : (
          <ScrollView testID="comment-list" style={styles.commentList}>
            {comments.map((c) => (
              <CommentRow key={c.id} comment={c} />
            ))}
          </ScrollView>
        )}
        <View style={styles.commentInputRow}>
          <View style={{ flex: 1 }}>
            <Input
              testID="comment-input"
              label="Kommentar schreiben"
              value={commentText}
              onChangeText={setCommentText}
              error={commentSendError ?? undefined}
              maxLength={COMMENT_MAX_LENGTH}
              // Without this switch `Input` strictly pulls the light palette through
              // `useTheme()` (see there), a white box in the middle of the cinema.
              cinemaMode
            />
          </View>
          <PressScale
            testID="comment-send"
            accessibilityRole="button"
            accessibilityLabel="Kommentar senden"
            disabled={commentSending || commentText.trim().length === 0}
            accessibilityState={{ disabled: commentSending || commentText.trim().length === 0 }}
            onPress={() => {
              if (commentText.trim().length === 0 || commentSending) return;
              submitComment();
            }}
          >
            <View style={styles.commentSendButton}>
              {commentSending ? (
                <ActivityIndicator color={palette['on-accent']} size="small" />
              ) : (
                <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Senden</Text>
              )}
            </View>
          </PressScale>
        </View>
      </Sheet>

      {/* Task 8, Phase 6: same SIBLING principle as the comment sheet directly
          above, over everything, including the tap zones. */}
      <Sheet visible={reportOpen} title="Diesen Moment melden" onClose={closeReport} cinemaMode>
        {reportConfirmed ? (
          <View style={{ gap: spacing.base }}>
            <Text testID="report-confirmation" style={[type.body, { color: cinema['text-1'] }]}>
              Danke. Die Person, die diese Reise angelegt hat, sieht deine Meldung.
            </Text>
            <CinemaButton label="Schliessen" onPress={closeReport} />
          </View>
        ) : (
          <View style={{ gap: spacing.base }}>
            {/* Brief, verbatim: "Der Moment bleibt sichtbar, Melden ist kein
                Verstecken." Stands here BEFORE anyone submits, not only afterwards. */}
            <Text style={[type.secondary, { color: cinema['text-2'] }]}>
              Der Moment bleibt für alle sichtbar. Die Person, die diese Reise angelegt hat,
              entscheidet, was als Nächstes passiert.
            </Text>
            <Input
              testID="report-reason"
              label="Was stimmt nicht?"
              value={reportReason}
              onChangeText={setReportReason}
              error={reportSendError ?? undefined}
              maxLength={REPORT_MAX_LENGTH}
              // Same reason as for the comment input field above.
              cinemaMode
            />
            <PressScale
              testID="report-send"
              accessibilityRole="button"
              accessibilityLabel="Meldung senden"
              disabled={reportSending || reportReason.trim().length === 0}
              accessibilityState={{ disabled: reportSending || reportReason.trim().length === 0 }}
              onPress={() => {
                if (reportReason.trim().length === 0 || reportSending) return;
                submitReport();
              }}
            >
              <View style={styles.commentSendButton}>
                {reportSending ? (
                  <ActivityIndicator color={palette['on-accent']} size="small" />
                ) : (
                  <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Melden</Text>
                )}
              </View>
            </PressScale>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  content: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen },
  centeredText: { color: cinema['text-1'], textAlign: 'center' },
  centeredTextSecondary: { color: cinema['text-2'], textAlign: 'center' },
  cinemaFade: { backgroundColor: cinema['bg-0'] },
  cinemaButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: cinema['text-1'],
  },
  textLink: { color: cinema['text-1'], textDecorationLine: 'underline' },
  headerArea: {
    position: 'absolute',
    top: spacing.xl,
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
  // No `position: absolute` any more: the pill is a normal flow child of
  // `socialArea`, which is itself positioned from the bottom edge EXACTLY
  // ONCE. Caption, other people's reactions and the emoji bar stack inside it
  // through `gap` without ever overlapping, no matter how many lines the
  // caption needs.
  captionPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.control,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  // An explicit zIndex, independent of the render order in the tree: tap zones
  // at the bottom, the interstitial card above them (blocking them
  // structurally), the close pill on top (so it stays usable WHILE the card
  // stands, otherwise the player could not be left during its 1.5 s).
  tapZoneLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', zIndex: 1 },
  tapZoneRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', zIndex: 1 },
  closeWrap: { position: 'absolute', top: spacing.xl, right: spacing.screen, zIndex: 3 },
  closePill: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // Without a zIndex this area lay UNDER the tap zones (zIndex 1, see
  // tapZoneLeft/tapZoneRight below), and every tap on an emoji or the comment
  // button physically hit player-left/-rechts and only paged on instead of
  // reacting or opening the sheet. zIndex 2 lifts it above the tap zones; it
  // stays below the interstitial card (also zIndex 2, but LATER in the tree,
  // and at equal zIndex the later rendered sibling wins in React Native), so
  // the card still covers the bar completely while it stands.
  socialArea: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.xl,
    gap: spacing.base,
    zIndex: 2,
  },
  // Six 44 px pills plus five 8 px gaps are 304 px; on a 320 pt device only
  // 272 px remain between the 24 px screen margins. `flexWrap` lets the last
  // pill (the comment button) wrap to a second line instead of running past the
  // edge; `gap` applies to both axes in React Native, including the wrapped
  // row.
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.s },
  emojiPill: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiPillActive: { backgroundColor: cinema['text-1'] },
  emojiGlyph: { fontSize: 20 },
  commentButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otherReactionsPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  reactionErrorPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  commentList: { maxHeight: 320 },
  commentRow: {
    gap: spacing.xs,
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: cinema['bg-0'],
  },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.s },
  commentSendButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: palette.accent,
  },
});
