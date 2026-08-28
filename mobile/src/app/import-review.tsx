import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { CinemaButton, CinemaTextLink } from '@/components/CinemaButton';
import { ImportTile, type TileStatus } from '@/components/ImportTile';
import { MomentSubmissionAnimation } from '@/components/MomentSubmissionAnimation';
import { cinema, spacing, type } from '@/theme/tokens';
import { useBottomInset, useTopInset } from '@/theme/useTopInset';
import * as media from '@/features/moments/media';
import { takeImport } from '@/features/moments/importHandoff';
import { discardRefused, submitImports, type ImportItemEvent } from '@/features/moments/libraryImportSubmit';
import { refusalSummary, type AcceptedMedia, type RefusalReason } from '@/features/moments/libraryImport';

const COLUMNS = 3;

const REASON_LABEL: Record<RefusalReason, string> = {
  outside_period: 'Ausserhalb der Reise',
  too_long: 'Zu lang',
  unknown_length: 'Ohne Länge',
  unknown_date: 'Ohne Datum',
  failed: 'Nicht gesichert',
};

type Item = {
  key: string;
  accepted: AcceptedMedia | null;
  reason: RefusalReason | null;
  uri: string;
  kind: 'photo' | 'video';
  durationS: number | null;
  thumb: string | null;
  status: TileStatus;
  progress: number;
};

type Phase = 'review' | 'submitting' | 'celebrating' | 'nothing';

function momentsText(count: number): string {
  return count === 1 ? '1 Moment' : `${count} Momente`;
}

// The review of a library selection (spec 2026-08-28-fotos-import-pruefung):
// a full-screen stack route over the tabs, like /preview. It takes the
// assessed selection from the handoff, shows every element as a tile,
// lets accepted ones be dropped, runs the batch with progress per tile,
// celebrates, and goes back. Everything the camera screen used to do
// after the picker now lives here.
export default function ImportReviewScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const topInset = useTopInset(spacing.xl);
  const bottomInset = useBottomInset(spacing.xl);
  const [handoff] = useState(() => takeImport());
  const [items, setItems] = useState<Item[]>(() =>
    handoff
      ? [
          ...handoff.accepted.map<Item>((entry) => ({
            key: entry.media.uri,
            accepted: entry,
            reason: null,
            uri: entry.media.uri,
            kind: entry.media.kind,
            durationS: entry.duration_s,
            thumb: entry.media.kind === 'photo' ? entry.media.uri : null,
            status: 'ready',
            progress: 0,
          })),
          ...handoff.refused.map<Item>((entry) => ({
            key: entry.media.uri,
            accepted: null,
            reason: entry.reason,
            uri: entry.media.uri,
            kind: entry.media.kind,
            durationS: entry.media.durationMs != null ? Math.round(entry.media.durationMs / 1000) : null,
            thumb: entry.media.kind === 'photo' ? entry.media.uri : null,
            status: 'ready',
            progress: 0,
          })),
        ]
      : []
  );
  const [phase, setPhase] = useState<Phase>('review');
  const [done, setDone] = useState(0);
  const [submitted, setSubmitted] = useState(0);
  // Shields setState after unmount: the batch and the still frames run on
  // promises that outlive a screen someone navigated away from.
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // Cinema look while this screen stands, like the preview.
  useEffect(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []);

  // Without a handoff (deep link, a restart mid-way) there is nothing to
  // review: back to the camera, same as the preview without a source.
  useEffect(() => {
    if (!handoff) router.replace('/capture');
  }, [handoff, router]);

  // Video still frames load one after the other; each tile shows its
  // placeholder until its own frame is in.
  useEffect(() => {
    let cancelled = false;
    const videos = items.filter((item) => item.kind === 'video' && item.thumb === null);
    void (async () => {
      for (const video of videos) {
        try {
          const frame = await getThumbnailAsync(video.uri, { time: 0 });
          if (cancelled || !active.current) return;
          setItems((current) =>
            current.map((item) => (item.key === video.key ? { ...item, thumb: frame.uri } : item))
          );
        } catch (error) {
          console.error('[import-review] still frame failed', video.uri, error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only on mount: dropped tiles need no frame, and a frame that arrives
    // for a dropped tile is filtered by key anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptedItems = useMemo(() => items.filter((item) => item.accepted !== null), [items]);
  const refusedEntries = useMemo(() => handoff?.refused ?? [], [handoff]);

  const backToCamera = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/capture');
  }, [router]);

  const removeItem = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item || phase !== 'review') return;
    media.discardFile(item.uri);
    setItems((current) => current.filter((entry) => entry.key !== key));
  };

  // Abbrechen, or the back gesture while reviewing: nothing entered the
  // queue, so every remaining copy (accepted and refused alike) leaves tmp.
  const cancel = () => {
    if (phase !== 'review') return;
    for (const item of acceptedItems) media.discardFile(item.uri);
    discardRefused(refusedEntries.map((entry) => entry.media));
    backToCamera();
  };

  const submit = async () => {
    if (!handoff || phase !== 'review' || acceptedItems.length === 0) return;
    const batch = acceptedItems.map((item) => item.accepted as AcceptedMedia);
    setPhase('submitting');
    setDone(0);
    let outcome: { submitted: number; failed: number };
    try {
      outcome = await submitImports(
        batch,
        { tripId: handoff.tripId, authorId: handoff.authorId },
        (finished) => {
          if (active.current) setDone(finished);
        },
        (index, event: ImportItemEvent) => {
          if (!active.current) return;
          const key = batch[index].media.uri;
          setItems((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    ...item,
                    status: event.stage,
                    progress: event.stage === 'converting' ? event.progress : item.progress,
                  }
                : item
            )
          );
        }
      );
    } catch (error) {
      // submitImports catches per element; this is the queue itself failing
      // to initialize. Every element then counts as failed.
      console.error('[import-review] batch failed', error);
      outcome = { submitted: 0, failed: batch.length };
    }
    // The refused copies were only kept for their tiles.
    discardRefused(refusedEntries.map((entry) => entry.media));
    if (!active.current) return;
    setSubmitted(outcome.submitted);
    setPhase(outcome.submitted > 0 ? 'celebrating' : 'nothing');
  };

  if (!handoff) return null;

  const gap = spacing.s;
  const tileSize = Math.floor((width - spacing.screen * 2 - gap * (COLUMNS - 1)) / COLUMNS);
  const reviewing = phase === 'review';
  const submittingCount = acceptedItems.length;
  const summary = refusalSummary(
    refusedEntries.map((entry) => entry.reason),
    handoff.accepted.length + refusedEntries.length,
    handoff.period,
    handoff.maxVideoSeconds,
    'preview'
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ animation: 'none', gestureEnabled: reviewing }} />
      <View style={[styles.header, { paddingTop: topInset }]}>
        <View style={styles.headerTexts}>
          <Text style={[type.h2, { color: cinema['text-1'] }]}>
            {phase === 'submitting' ? `${done} von ${submittingCount} Momenten` : 'Einsenden?'}
          </Text>
          <Text numberOfLines={1} style={[type.secondary, { color: cinema['text-2'] }]}>
            {handoff.tripName}
          </Text>
        </View>
        {reviewing && <CinemaTextLink label="Abbrechen" onPress={cancel} />}
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={[styles.grid, { gap }]}
        renderItem={({ item, index }) => (
          <ImportTile
            testID={`import-tile-${index}`}
            thumb={item.thumb}
            kind={item.kind}
            durationS={item.durationS}
            status={item.status}
            progress={item.progress}
            reason={item.reason ? REASON_LABEL[item.reason] : null}
            onRemove={reviewing && item.accepted ? () => removeItem(item.key) : null}
            size={tileSize}
          />
        )}
        ListFooterComponent={
          summary ? (
            <Text style={[type.secondary, styles.summary, { color: cinema['text-2'] }]}>{summary}</Text>
          ) : null
        }
      />
      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        {phase === 'nothing' ? (
          <>
            <Text style={[type.body, { color: cinema['text-1'] }]}>Keiner der Momente liess sich sichern.</Text>
            <CinemaButton label="Zurück" onPress={backToCamera} />
          </>
        ) : (
          <>
            <Text style={[type.body, { color: cinema['text-1'] }]}>
              {acceptedItems.length === 0
                ? 'Nichts zum Einsenden'
                : acceptedItems.length === 1
                  ? '1 Moment passt in den Reisezeitraum'
                  : `${acceptedItems.length} Momente passen in den Reisezeitraum`}
            </Text>
            <CinemaButton
              label={acceptedItems.length === 0 ? 'Einsenden' : `${momentsText(acceptedItems.length)} einsenden`}
              onPress={() => void submit()}
              disabled={!reviewing || acceptedItems.length === 0}
            />
          </>
        )}
      </View>
      <MomentSubmissionAnimation
        visible={phase === 'celebrating'}
        onFinished={backToCamera}
        counter={handoff.counterBefore}
        added={submitted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  header: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.base,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.m,
  },
  headerTexts: { flexShrink: 1, gap: spacing.xs },
  grid: { paddingHorizontal: spacing.screen, paddingBottom: spacing.l },
  summary: { marginTop: spacing.base },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.base,
    gap: spacing.m,
    backgroundColor: cinema['bg-0'],
  },
});
