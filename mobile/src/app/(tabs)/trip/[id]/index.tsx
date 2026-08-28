import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, useWindowDimensions, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Ellipsis, Flag, Share2, X } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Avatar, AvatarGroup } from '@/components/Avatar';
import { ReliefBadge } from '@/components/ReliefBadge';
import { SealedStack } from '@/components/SealedStack';
import { Button } from '@/components/Button';
import { TripCover } from '@/components/TripCover';
import { RevealSequence } from '@/components/RevealSequence';
import { TripClosedAnimation } from '@/components/TripClosedAnimation';
import { Sheet, SHEET_SCROLL_RATIO } from '@/components/Sheet';
import { StatusBarCover } from '@/components/StatusBarCover';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { deleteTrip, fetchMembers, fetchTrip, removeMember } from '@/features/trips/tripsApi';
import { formatRange, todaysCalendarDay, tripDay, tripLength } from '@/features/trips/tripDay';
import type { Trip, TripMember } from '@/features/trips/types';
import { ownMomentCount } from '@/features/moments/counter';
import * as queueDb from '@/features/moments/queueDb';
import { pendingCount } from '@/features/moments/queueLogic';
import type { QueueJob, DiscardedMoment } from '@/features/moments/types';
import { revealTrip } from '@/features/recap/recapApi';
import { markRevealSeen, hasSeenReveal } from '@/features/recap/seen';
import { getPool } from '@/features/recap/urlPool';
import { removeMoment, fetchReports, dismissReport, type Report } from '@/features/recap/reportApi';
import { isRecapShared } from '@/features/sharing/linkManagementApi';
import { LINK_REACH_TEXT } from '@/features/sharing/texts';

// Fire and forget: a device without a working vibration motor (simulator,
// web) must never hold the dialog back, so the promise is dropped on
// purpose instead of awaited.
function warningHaptics() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

function pendingText(count: number): string {
  return `${count} ${count === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

// One fixed reference instead of a fresh literal every time: load() runs on
// every focus, and a new array would make setDiscarded() trigger a rerender
// each time although nothing changed.
const NO_DISCARDED: DiscardedMoment[] = [];

function discardedTitle(count: number): string {
  return count === 1 ? 'Ein Moment konnte nicht mehr eingesendet werden' : `${count} Momente konnten nicht mehr eingesendet werden`;
}

function pendingMomentsReassurance(count: number): string {
  return count === 1
    ? 'Dein wartender Moment kommt noch durch, er ist vor der Aufdeckung entstanden.'
    : `Deine ${count} wartenden Momente kommen noch durch, sie sind vor der Aufdeckung entstanden.`;
}

function reportsText(count: number): string {
  return count === 1 ? 'Ein gemeldeter Moment' : `${count} gemeldete Momente`;
}

function formatReportTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    // A JS engine shipped without the de-DE locale data throws here. Jest
    // runs on a full-ICU Node and never sees that path, only a device can.
    return '';
  }
}

function ReportRow({
  report, previewUrl, running, error, onRemove, onDismiss,
}: {
  report: Report;
  previewUrl: string | null;
  running: boolean;
  error: string | undefined;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View testID={`report-${report.id}`} style={[styles.reportRow, { borderBottomColor: colors.line }]}>
      <View style={styles.reportHead}>
        {previewUrl ? (
          <Image
            testID={`report-preview-${report.id}`}
            source={{ uri: previewUrl }}
            style={[styles.reportImage, { backgroundColor: colors['bg-1'] }]}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.reportImage, { backgroundColor: colors['bg-1'] }]} />
        )}
        <View style={styles.reportText}>
          <Text style={[type.body, { color: colors['text-1'] }]}>{report.reason}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{formatReportTime(report.created_at)}</Text>
        </View>
      </View>
      {error && <Text style={[type.secondary, { color: colors.danger }]}>{error}</Text>}
      {running ? (
        <ActivityIndicator testID={`report-loading-${report.id}`} color={colors['text-1']} />
      ) : (
        <View style={styles.reportActions}>
          <PressScale accessibilityRole="button" onPress={onDismiss}>
            <Text style={[type.bodyMedium, styles.reportActionText, { color: colors['text-1'] }]}>
              Meldung verwerfen
            </Text>
          </PressScale>
          <PressScale accessibilityRole="button" onPress={onRemove}>
            <Text style={[type.bodyMedium, styles.reportActionText, { color: colors.danger }]}>
              Moment entfernen
            </Text>
          </PressScale>
        </View>
      )}
    </View>
  );
}

// No box and no warning colour: this is not an alarm, it is a missing piece
// of information. It names cause and way out without apologising
// (DESIGN-LANGUAGE §6).
const SHARED_UNKNOWN =
  'Ob dieser Recap geteilt ist, liess sich gerade nicht prüfen. Schau gleich nochmal rein.';

function travellersLabel(count: number): string {
  return `Wer dabei ist, ${count} ${count === 1 ? 'Person' : 'Personen'}`;
}

export default function TripDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  // No header above this screen: the scroll content started at the designed
  // 24 and therefore sat behind the status bar and the island.
  const topInset = useTopInset(spacing.screen);
  // Caps the traveller list inside the sheet. Without a limit it would grow
  // up to the panel's 85 % ceiling and lose its last rows without a trace,
  // on a big trip exactly the people who joined last (see
  // SHEET_SCROLL_RATIO in Sheet.tsx).
  const { height: windowHeight } = useWindowDimensions();
  const { id, cover } = useLocalSearchParams<{ id: string; cover?: string }>();
  const coverPosition = Number(cover) || 0;
  const { userId } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);
  const [pending, setPending] = useState(0);
  const [discarded, setDiscarded] = useState<DiscardedMoment[]>([]);
  const [reportCount, setReportCount] = useState(0);
  const [membersVisible, setMembersVisible] = useState(false);
  const [manageVisible, setManageVisible] = useState(false);
  const [moderationVisible, setModerationVisible] = useState(false);
  const [moderationPhase, setModerationPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string | null>>(new Map());
  const [actionRunningFor, setActionRunningFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [sequenceVisible, setSequenceVisible] = useState(false);
  const [revealReady, setRevealReady] = useState(false);
  // The closing interstitial the owner gets after finishing the trip here
  // (the wax lands on the ticket); it stands in for the reveal sequence on
  // this one path, see finishTrip().
  const [closedVisible, setClosedVisible] = useState(false);
  // Two separate guards instead of one. `revealCheckRunningRef` only covers
  // the window while `hasSeenReveal()` is still outstanding;
  // `revealDecidedRef` is set only AFTER a decision was actually applied.
  //
  // The split exists because of a navigation finding: the original single
  // ref was set BEFORE the await and never taken back in the abort path
  // (`if (!active.current) return`). Lost the screen its focus during the
  // AsyncStorage read (tab switch, a push to `/trip/[id]/invite`, the screen
  // stays mounted), it hung at true for the rest of that mount and a
  // revealed trip showed NEITHER the sequence NOR «Recap starten». Jest
  // cannot take focus away mid-await, so no test guards this ordering.
  const revealCheckRunningRef = useRef(false);
  const revealDecidedRef = useRef(false);
  // Shields setState after blur/unmount, same pattern as in the sibling
  // list screen: every focus cycle gets its own guard, set to false when the
  // screen is left, so a late-resolving load writes no state onto a screen
  // that is gone.
  const active = useRef(true);

  const [shared, setShared] = useState<boolean | null>(false);

  const load = useCallback(async () => {
    const [t, m, c, jobs, discardedEntries, reportsResult] = await Promise.all([
      fetchTrip(id),
      fetchMembers(id),
      ownMomentCount(id).catch(() => null),
      queueDb.allJobs().catch((): QueueJob[] => []),
      userId
        ? queueDb.discardedMoments(id, userId).catch(() => NO_DISCARDED)
        : Promise.resolve(NO_DISCARDED),
      // Called without checking the owner role: reports_select_owner (RLS)
      // silently returns zero rows to anyone else, no error.
      fetchReports(id),
    ]);
    if (!active.current) return;
    setTrip(t.data);
    setError(t.error);
    setMembers(m.data);
    setMembersError(m.error);
    setCounter(c ?? t.data?.my_post_count ?? 0);
    setPending(pendingCount(jobs.filter((job) => job.trip_id === id)));
    setDiscarded(discardedEntries);
    setReportCount(reportsResult.error ? 0 : reportsResult.data.length);
    setLoaded(true);

    if (t.data && t.data.status !== 'active') {
      const sharedResult = await isRecapShared(id);
      if (!active.current) return;
      setShared(sharedResult.data);
    } else {
      setShared(false);
    }

    if (
      t.data &&
      t.data.status !== 'active' &&
      !revealDecidedRef.current &&
      !revealCheckRunningRef.current
    ) {
      revealCheckRunningRef.current = true;
      const seen = await hasSeenReveal(id);
      revealCheckRunningRef.current = false;
      if (!active.current) return;
      revealDecidedRef.current = true;
      if (seen) {
        setRevealReady(true);
      } else {
        setSequenceVisible(true);
      }
    }
  }, [id, userId]);

  const sequenceFinished = useCallback(() => {
    setSequenceVisible(false);
    setRevealReady(true);
    void markRevealSeen(id);
  }, [id]);

  const closedFinished = useCallback(() => {
    setClosedVisible(false);
    setRevealReady(true);
    void markRevealSeen(id);
  }, [id]);

  // No `start` param, exactly like the recap card (recap/index.tsx): that
  // absence is what puts the seal in front of the show instead of landing
  // straight in the overview, unceremoniously, on a button whose own label
  // says "starten" (final whole-branch review).
  const toRecap = () => {
    router.push({ pathname: '/recap/[id]/player', params: { id } });
  };

  const acknowledgeDiscarded = useCallback(() => {
    if (!userId) return;
    setDiscarded(NO_DISCARDED);
    void queueDb.acknowledgeDiscarded(id, userId).catch(() => {});
  }, [id, userId]);

  // `loading` hangs on the button, not on the focus run: visible waiting
  // belongs only where somebody tapped. It is ALWAYS reset, even if the
  // screen loses focus in between, otherwise the button would come back
  // with a dead spinner and disabled. An `active` guard is not needed here,
  // unlike in `load`: setState after unmount is a no-op since React 18.
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

  const openFinishSheet = () => {
    setManageVisible(false);
    setRevealError(null);
    warningHaptics();
    setConfirmVisible(true);
  };

  const closeFinishSheet = () => {
    setConfirmVisible(false);
  };

  const finishTrip = async () => {
    setRevealLoading(true);
    setRevealError(null);
    const { error: revealFailed } = await revealTrip(id);
    if (revealFailed) {
      setRevealError(revealFailed);
      setRevealLoading(false);
      return;
    }
    setRevealLoading(false);
    setConfirmVisible(false);
    // The owner gets the closing interstitial instead of the reveal
    // sequence: the wax going ON the ticket and the lock breaking open right
    // after would tell two opposite stories. Decided BEFORE the reload, so
    // load() sees the reveal as handled and doesn't start the sequence
    // underneath the cover; «Recap starten» follows once the interstitial is
    // through (closedFinished). Leaving the screen mid-cover loses nothing:
    // the reveal isn't marked seen until then, so the next visit plays the
    // sequence as for any member.
    revealDecidedRef.current = true;
    setClosedVisible(true);
    void load();
  };

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  if (!trip) {
    return (
      <View style={[styles.empty, { backgroundColor: colors['bg-0'] }]}>
        <Text style={[type.body, { color: colors.danger }]}>
          {error ?? 'Diese Reise gibt es nicht mehr.'}
        </Text>
        {error && (
          <Button variant="secondary" label="Nochmal versuchen" onPress={() => void retry()} loading={loading} />
        )}
        <Button variant="text" label="Zu meinen Reisen" onPress={() => router.replace('/trip')} />
      </View>
    );
  }

  const isOwner = trip.owner_id === userId;
  const isActive = trip.status === 'active';
  const today = todaysCalendarDay();
  const day = tripDay(trip.start_date, today);
  const length = tripLength(trip.start_date, trip.end_date);
  const tripEnded = today >= trip.end_date;
  const showsFinish = isOwner && isActive;

  // Three ways lead here: the button at the end of the screen, the one in
  // the traveller sheet and the one in the management. Closing both panels
  // first applies to all of them, it costs the screen route nothing
  // (nothing is open there anyway) and prevents a sheet from lying over the
  // trip when coming back from the invite screen.
  const invite = () => {
    setMembersVisible(false);
    setManageVisible(false);
    router.push(`/trip/${id}/invite`);
  };

  const editTrip = () => {
    setManageVisible(false);
    router.push(`/trip/${id}/edit`);
  };

  const removeTraveller = (m: TripMember) => {
    warningHaptics();
    Alert.alert(`${m.display_name} entfernen?`, 'Bereits eingesendete Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          void removeMember(id, m.user_id).then(({ error: removeFailed }) => {
            if (removeFailed) return Alert.alert('Nicht entfernt', removeFailed);
            void load();
          });
        },
      },
    ]);
  };

  const leaveTrip = () => {
    warningHaptics();
    Alert.alert('Reise verlassen?', 'Deine bereits eingesendeten Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: () => {
          if (!userId) return;
          void removeMember(id, userId).then(({ error: leaveFailed }) => {
            if (leaveFailed) return Alert.alert('Nicht verlassen', leaveFailed);
            router.replace('/trip');
          });
        },
      },
    ]);
  };

  const deleteThisTrip = () => {
    warningHaptics();
    Alert.alert('Reise löschen?', 'Die Reise und alle Momente darin verschwinden für alle.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          void deleteTrip(id).then(({ error: deleteFailed }) => {
            if (deleteFailed) return Alert.alert('Nicht gelöscht', deleteFailed);
            router.replace('/trip');
          });
        },
      },
    ]);
  };

  const openModeration = () => {
    setModerationVisible(true);
    setModerationPhase('loading');
    setModerationError(null);
    setActionError({});
    void Promise.all([fetchReports(id), getPool(id)]).then(([{ data: list, error: listError }, { pool }]) => {
      if (!active.current) return;
      if (listError) {
        setModerationError(listError);
        setModerationPhase('error');
        return;
      }
      setReports(list);
      setReportCount(list.length);
      const urls = new Map<string, string | null>();
      for (const r of list) urls.set(r.post_id, pool?.urls.get(r.post_id)?.thumb_url ?? null);
      setPreviewUrls(urls);
      setModerationPhase('ready');
    });
  };

  const closeModeration = () => setModerationVisible(false);

  const dismissThisReport = (report: Report) => {
    setActionRunningFor(report.id);
    setActionError((current) => {
      if (!(report.id in current)) return current;
      const next = { ...current };
      delete next[report.id];
      return next;
    });
    void dismissReport(report.id).then(({ error: dismissFailed }) => {
      if (!active.current) return;
      setActionRunningFor(null);
      if (dismissFailed) {
        setActionError((current) => ({ ...current, [report.id]: dismissFailed }));
        return;
      }
      setReports((list) => list.filter((r) => r.id !== report.id));
      setReportCount((n) => Math.max(0, n - 1));
    });
  };

  const removeReportedMoment = (report: Report) => {
    warningHaptics();
    Alert.alert(
      'Moment entfernen?',
      'Der Moment verschwindet für alle Mitreisenden. Das lässt sich nicht rückgängig machen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => {
            setActionRunningFor(report.id);
            void removeMoment(report.post_id).then(({ error: removeFailed }) => {
              if (!active.current) return;
              setActionRunningFor(null);
              if (removeFailed) {
                setActionError((current) => ({ ...current, [report.id]: removeFailed }));
                return;
              }
              // reports.post_id -> posts is ON DELETE CASCADE (see
              // reportApi.ts), the report is already gone server-side. The
              // list here follows immediately on the client.
              setReports((list) => list.filter((r) => r.id !== report.id));
              setReportCount((n) => Math.max(0, n - 1));
            });
          },
        },
      ]
    );
  };

  return (
    // Fragment instead of a single root element: the sheets and the reveal
    // overlay must be SIBLINGS of the ScrollView, not its children. Inside
    // the ScrollView their StyleSheet.absoluteFill would cover the
    // (potentially scrollable, taller) content area instead of the fixed
    // screen.
    <>
    <ScrollView
      style={{ backgroundColor: colors['bg-0'] }}
      contentContainerStyle={[styles.content, { paddingTop: topInset }]}
    >
      <TripCover position={coverPosition}>
        {/* The wax seal image left this corner for the recap overview's
            peel: while the trip runs, the raised white badge says the same
            thing in the badge language of the light UI on covers (§4). */}
        {isActive && (
          <View style={styles.sealedAnchor}>
            <ReliefBadge testID="sealed-badge" contentStyle={styles.sealedBadgeBox}>
              <Image
                testID="sealed-badge-seal"
                source={require('@/assets/images/rotes-brief-wachssiegel-transparent.png')}
                style={styles.sealedBadgeSeal}
                contentFit="contain"
                accessible={false}
              />
              <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Versiegelt</Text>
            </ReliefBadge>
          </View>
        )}
        {/* Everything that manages the trip lives behind this one pill, so
            the screen below can end on a single call to action instead of
            a stack of four buttons. It wears the raised white ReliefBadge,
            the badge language of the light UI on covers (§4). */}
        <PressScale
          testID="manage-open"
          accessibilityRole="button"
          accessibilityLabel="Reise verwalten"
          style={styles.manageAnchor}
          onPress={() => setManageVisible(true)}
        >
          <ReliefBadge contentStyle={styles.managePill}>
            <Ellipsis size={20} color={colors['text-1']} strokeWidth={1.75} />
          </ReliefBadge>
        </PressScale>
      </TripCover>

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {formatRange(trip.start_date, trip.end_date)}
        </Text>
        {/* Up to and including the last day, no further: tied to the day
            rather than to `tripEnded`, so that day 14 of 14 still stands on
            the closing day, while a trip left open afterwards no longer
            counts into nowhere («Tag 21 von 14»). */}
        {isActive && day > 0 && day <= length && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{`Tag ${day} von ${length}`}</Text>
        )}

        {membersError ? (
          <Text style={[type.body, { color: colors.danger, marginTop: spacing.m }]}>{membersError}</Text>
        ) : members.length > 0 ? (
          <PressScale
            testID="members-open"
            accessibilityRole="button"
            accessibilityLabel={travellersLabel(members.length)}
            onPress={() => setMembersVisible(true)}
          >
            {/* The circles alone say neither that they can be tapped nor
                how many people the "+1" stands for. The underlined line
                next to them says both, and it is the only underlined text
                on this screen, so it reads as a way rather than as
                decoration. */}
            <View style={styles.travellerRow}>
              <AvatarGroup
                faces={members.map((m) => ({ name: m.display_name, avatarKey: m.avatar_key }))}
              />
              <Text style={[type.secondary, styles.travellerLink, { color: colors['text-2'] }]}>
                {`${members.length} dabei`}
              </Text>
            </View>
          </PressScale>
        ) : null}
      </View>

      {/* The counter now stands directly under the trip, before any call to
          action: it is what this screen is about while the trip is sealed.
          The stack next to it shows the same moments as a picture, the
          explanation below runs the full width and therefore stays whole. */}
      <View style={{ gap: spacing.xs }}>
        <View style={styles.counterRow}>
          <Text style={[type.display, { color: colors['text-1'] }]}>{String(counter)}</Text>
          <SealedStack count={counter} />
        </View>
        <Text style={[type.body, { color: colors['text-2'] }]}>
          Momente eingefangen, bis zum Recap versiegelt.
        </Text>
        {pending > 0 && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{pendingText(pending)}</Text>
        )}
      </View>

      {shared === true && (
        <View testID="shared-hint" style={[styles.sharedBox, { backgroundColor: colors['bg-1'] }]}>
          <Share2 size={20} color={colors['text-1']} strokeWidth={1.75} />
          <View style={styles.sharedText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Dieser Recap ist geteilt</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{LINK_REACH_TEXT}</Text>
          </View>
        </View>
      )}

      {shared === null && (
        <Text testID="shared-unknown" style={[type.secondary, { color: colors['text-2'] }]}>
          {SHARED_UNKNOWN}
        </Text>
      )}

      {discarded.length > 0 && (
        <View style={[styles.discardedBox, { backgroundColor: colors['bg-1'] }]}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>
            {discardedTitle(discarded.length)}
          </Text>
          {discarded.map((d) => (
            <Text key={d.id} style={[type.secondary, { color: colors['text-2'] }]}>
              {d.grund}
            </Text>
          ))}
          <Button variant="secondary" label="Verstanden" onPress={acknowledgeDiscarded} />
        </View>
      )}

      {isOwner && reportCount > 0 && (
        <PressScale
          testID="moderation-open"
          accessibilityRole="button"
          accessibilityLabel={reportsText(reportCount)}
          onPress={openModeration}
        >
          <View style={[styles.reportsBox, { backgroundColor: colors['bg-1'] }]}>
            <Flag size={20} color={colors['text-1']} strokeWidth={1.75} />
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{reportsText(reportCount)}</Text>
          </View>
        </PressScale>
      )}

      {/* ONE primary closes the screen, the one thing that is due right
          now; a running trip pairs it with finishing in the white secondary
          dress underneath (the same doubling the management sheet keeps).
          Which primary is due follows the trip's state, and the states
          exclude each other: a revealed trip is no longer active.
          `membersVisible`/`confirmVisible` let the primary step back while
          a panel with an accent surface of its own stands over it (§4: at
          most one per screen). The management needs no such exception, it
          carries no accent surface. */}
      {revealReady ? (
        <Button
          variant={confirmVisible ? 'secondary' : 'primary'}
          label="Recap starten"
          onPress={toRecap}
        />
      ) : showsFinish && tripEnded ? (
        <View style={{ gap: spacing.m }}>
          <Text style={[type.body, { color: colors['text-2'] }]}>
            Eure Reise ist zu Ende. Zeit für den Recap.
          </Text>
          <Button
            variant={confirmVisible || membersVisible ? 'secondary' : 'primary'}
            label="Reise abschliessen"
            onPress={openFinishSheet}
          />
        </View>
      ) : isOwner && isActive ? (
        <View style={{ gap: spacing.m }}>
          <Button
            variant={confirmVisible || membersVisible ? 'secondary' : 'primary'}
            label="Freunde einladen"
            onPress={invite}
          />
          <Button variant="secondary" label="Reise abschliessen" onPress={openFinishSheet} />
        </View>
      ) : null}
    </ScrollView>
    {/* Before the sheets and the reveal overlay: their backdrop must keep
        covering the whole screen, including the status bar strip. */}
    <StatusBarCover />

    {/* Everything that is about the trip rather than about this moment.
        No accent surface in here on purpose: a list of ways has no one main
        way, and the screen behind it keeps its own (see the button block
        above). Same reasoning as the moderation sheet, which carries none
        either. */}
    <Sheet visible={manageVisible} title="Reise verwalten" onClose={() => setManageVisible(false)}>
      {isOwner && isActive && (
        tripEnded ? (
          <Button variant="secondary" label="Freunde einladen" onPress={invite} />
        ) : (
          <Button variant="secondary" label="Reise abschliessen" onPress={openFinishSheet} />
        )
      )}
      {isOwner && <Button variant="secondary" label="Reise bearbeiten" onPress={editTrip} />}
      {/* Destructive, and therefore a link rather than a surface, set apart
          from the ways above it by the sheet's own gap. */}
      <Button
        variant="text"
        label={isOwner ? 'Reise löschen' : 'Reise verlassen'}
        onPress={isOwner ? deleteThisTrip : leaveTrip}
      />
    </Sheet>

    <Sheet visible={confirmVisible} title="Reise abschliessen?" onClose={closeFinishSheet}>
      <Text style={[type.body, { color: colors['text-2'] }]}>
        Danach kann niemand mehr neue Momente aufnehmen. Bereits aufgenommene Momente von allen
        kommen noch durch, und alle sehen den Recap. Das lässt sich nicht rückgängig machen.
      </Text>
      {pending > 0 && (
        <Text style={[type.secondary, { color: colors['text-2'] }]}>{pendingMomentsReassurance(pending)}</Text>
      )}
      {revealError && <Text style={[type.body, { color: colors.danger }]}>{revealError}</Text>}
      <Button variant="primary" label="Abschliessen" onPress={() => void finishTrip()} loading={revealLoading} />
      <Button variant="secondary" label="Abbrechen" onPress={closeFinishSheet} disabled={revealLoading} />
    </Sheet>

    <Sheet visible={membersVisible} title="Wer dabei ist" onClose={() => setMembersVisible(false)}>
      <ScrollView style={{ maxHeight: windowHeight * SHEET_SCROLL_RATIO }}>
        <View style={{ gap: spacing.base }}>
          {members.map((m) => (
            <View key={m.user_id} style={styles.row}>
              <Avatar name={m.display_name} avatarKey={m.avatar_key} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{m.display_name}</Text>
                <Text style={[type.secondary, { color: colors['text-2'] }]}>
                  {m.role === 'owner' ? 'Hat die Reise angelegt' : `@${m.username}`}
                </Text>
              </View>
              {isOwner && isActive && m.user_id !== userId && (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={`${m.display_name} entfernen`}
                  onPress={() => removeTraveller(m)}
                >
                  <X size={20} color={colors['text-2']} strokeWidth={1.75} />
                </PressScale>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      {isOwner && isActive && <Button variant="primary" label="Freunde einladen" onPress={invite} />}
    </Sheet>

    <Sheet visible={moderationVisible} title="Gemeldete Momente" onClose={closeModeration}>
      {moderationPhase === 'loading' ? (
        <ActivityIndicator testID="moderation-loading" color={colors['text-1']} />
      ) : moderationPhase === 'error' ? (
        <View style={{ gap: spacing.base }}>
          <Text style={[type.body, { color: colors.danger }]}>{moderationError}</Text>
          <Button variant="secondary" label="Nochmal versuchen" onPress={openModeration} />
        </View>
      ) : reports.length === 0 ? (
        <Text style={[type.secondary, { color: colors['text-2'] }]}>Keine offenen Meldungen mehr.</Text>
      ) : (
        <ScrollView testID="moderation-list" style={styles.moderationList}>
          {reports.map((r) => (
            <ReportRow
              key={r.id}
              report={r}
              previewUrl={previewUrls.get(r.post_id) ?? null}
              running={actionRunningFor === r.id}
              error={actionError[r.id]}
              onDismiss={() => dismissThisReport(r)}
              onRemove={() => removeReportedMoment(r)}
            />
          ))}
        </ScrollView>
      )}
    </Sheet>

    <RevealSequence visible={sequenceVisible} onFinished={sequenceFinished} />
    <TripClosedAnimation
      visible={closedVisible}
      onFinished={closedFinished}
      title={trip.name}
      range={formatRange(trip.start_date, trip.end_date)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.xl },
  empty: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  // The number reads from the left, the stack lies at the right edge of the
  // screen. `flex-end` on the cross axis puts both on the same floor: the
  // display digit is much taller than the cards, centred they would hang
  // above them.
  counterRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  travellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginTop: spacing.m,
    alignSelf: 'flex-start',
  },
  travellerLink: { textDecorationLine: 'underline' },
  // Positioned absolutely instead of riding the overlay's flow: TripCover
  // is shared with the recap card, whose play pill sits at the BOTTOM edge,
  // so the overlay pushes its children down (justifyContent: 'flex-end'
  // there). This pill belongs into the corner opposite the sealed badge and has to
  // stay there no matter how that flow is set. Yoga positions an absolute
  // child against the parent's padding box; the extra m on top of the
  // overlay's 12 px inset makes 24, the same air the sealed badge keeps,
  // so both corners stand clear of the cover's 24 px curve.
  manageAnchor: { position: 'absolute', top: spacing.m, right: spacing.m },
  // The badge holds the corner the wax seal used to hang over. More air
  // than the manage pill's xs: with the overlay's 12 px this makes 24, so
  // the badge stands clear of the corner curve instead of hugging it.
  sealedAnchor: { position: 'absolute', top: spacing.m, left: spacing.m },
  // Tighter than the badge's default text padding: this badge is quieter
  // than the hero card's pair, the seal carries it, not the box.
  sealedBadgeBox: { paddingHorizontal: spacing.s, paddingVertical: spacing.xs },
  // The badge leads with the wax seal itself in miniature (the hero card's
  // liveDot slot). 22 px lets the wax read as a seal while staying close to
  // the text line's 24 px, so the compact box stays text-tall.
  sealedBadgeSeal: { width: 22, height: 22 },
  // Fixed round box instead of the badge's text padding; look and
  // relief stay ReliefBadge's business. 32 matches the sealed badge's
  // height exactly, so the two corners sit on one line, and stays on the
  // avatar scale's small end (§4).
  managePill: {
    width: 32,
    height: 32,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
  },
  // A set-off surface instead of a shadow (DESIGN-LANGUAGE §3: a shadow
  // means "floats"). Radius 12 like every other surface of this size.
  discardedBox: { borderRadius: radius.control, padding: spacing.base, gap: spacing.m },
  // Same shape as reportsBox below: icon left, text right. It is NOT a
  // button, unlike that one, there is nothing to tap here, the row is an
  // announcement. Hence no PressScale around it either.
  sharedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.m,
    borderRadius: radius.control,
    padding: spacing.base,
  },
  sharedText: { flex: 1, gap: spacing.xs },
  reportsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    borderRadius: radius.control,
    padding: spacing.base,
  },
  moderationList: { maxHeight: 420 },
  // borderBottomColor comes inline from useTheme() (see ReportRow): a
  // hairline tone is a colour value and, like every other colour value in
  // this codebase, does not belong in a static StyleSheet
  // (DESIGN-LANGUAGE §9: no fixed hex values in the code, everything
  // through tokens).
  reportRow: { gap: spacing.s, paddingVertical: spacing.base, borderBottomWidth: 1 },
  reportHead: { flexDirection: 'row', gap: spacing.m },
  reportImage: { width: 56, height: 56, borderRadius: radius.control },
  reportText: { flex: 1, gap: spacing.xs },
  reportActions: { flexDirection: 'row', gap: spacing.l },
  reportActionText: { textDecorationLine: 'underline' },
});
