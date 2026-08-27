import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Plus } from 'lucide-react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { TripHeroCard } from '@/components/TripHeroCard';
import { TripGridCard } from '@/components/TripGridCard';
import { Button } from '@/components/Button';
import { PressScale } from '@/components/PressScale';
import { StatusBarCover } from '@/components/StatusBarCover';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { fetchTrips } from '@/features/trips/tripsApi';
import { groupTrips, todaysCalendarDay } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

export default function TripList() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xl);
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Shields setState after blur/unmount; every focus cycle sets it again.
  const active = useRef(true);

  const load = useCallback(async () => {
    const { data, error: loadError } = await fetchTrips();
    if (!active.current) return;
    setTrips(data);
    setError(loadError);
    setLoaded(true);
  }, []);

  // `loading` hangs on the button by design, not on `load`: the focus run
  // must not paint a loading state over the list that already stands, visible
  // waiting belongs only where someone tapped. It is ALWAYS reset, even if the
  // screen loses focus in between, otherwise the button would come back
  // disabled with a dead spinner. Unlike `load`, no `active` guard is needed:
  // setState after unmount has been harmless since React 18, and `load`
  // protects the data states itself.
  const retry = useCallback(async () => {
    setLoading(true);
    await load();
    setLoading(false);
  }, [load]);

  // Reload on return, a trip just created should stand there right away.
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void load();
      return () => {
        active.current = false;
      };
    }, [load])
  );

  const today = todaysCalendarDay();
  const { running, planned } = groupTrips(trips, today);
  const ready = loaded && !error;
  const noTrips = ready && trips.length === 0;
  const onlyRecaps = ready && running.length === 0 && planned.length === 0 && trips.length > 0;

  // Two grid cards per row; a lone last card keeps its half width thanks
  // to the spacer next to it.
  const plannedRows: Trip[][] = [];
  for (let i = 0; i < planned.length; i += 2) plannedRows.push(planned.slice(i, i + 2));

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset }]}>
        <View style={styles.header}>
          <Text style={[type.h1, { color: colors['text-1'] }]}>Meine Reisen</Text>
          {/* The mockup (2026-08-27) moves "Neue Reise" from the floating
              FAB into the header: same primary action, same label for
              screen readers, it just no longer covers the list. */}
          <PressScale
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityLabel="Neue Reise"
            onPress={() => router.push('/trip/new')}
          >
            <View style={[styles.newTrip, { backgroundColor: colors.accent }]}>
              <Plus size={22} color={colors['on-accent']} strokeWidth={1.75} />
            </View>
          </PressScale>
        </View>

        {error && (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{error}</Text>
            <Button
              variant="secondary"
              label="Nochmal versuchen"
              onPress={() => void retry()}
              loading={loading}
            />
          </View>
        )}

        {(noTrips || onlyRecaps) && (
          <View style={{ marginTop: spacing.xl }}>
            {/* Cut out against `bg-0`, therefore without border, radius and
                shadow, same as the film reel in the empty recap tab
                (recap/index.tsx). */}
            <Image
              testID="empty-state-camper"
              source={require('@/assets/images/camper-salbeigruen-transparent.png')}
              style={styles.camper}
              contentFit="contain"
              accessible={false}
            />
            <View style={{ gap: spacing.s, marginTop: spacing.l }}>
              <Text style={[type.h2, { color: colors['text-1'] }]}>
                {noTrips ? 'Noch keine Reise' : 'Gerade keine Reise unterwegs'}
              </Text>
              <Text style={[type.body, { color: colors['text-2'] }]}>
                {noTrips
                  ? 'Leg deine erste Reise an oder tritt einer per Einladungslink bei.'
                  : 'Deine abgeschlossenen Reisen findest du im Recap-Tab.'}
              </Text>
            </View>
          </View>
        )}

        {running.length > 0 && (
          <View style={{ gap: spacing.l }}>
            {/* Always titled, unlike before the mockup: the section name
                doubles as the status the wax seal used to claim. */}
            <Text style={[type.h2, { color: colors['text-1'] }]}>
              {running.length === 1 ? 'Aktive Reise' : 'Aktive Reisen'}
            </Text>
            {running.map((t, i) => (
              <TripHeroCard
                key={t.id}
                trip={t}
                today={today}
                position={i}
                onPress={() => router.push(`/trip/${t.id}?cover=${i}`)}
              />
            ))}
          </View>
        )}

        {planned.length > 0 && (
          <View style={{ gap: spacing.l }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Geplant</Text>
            {/* Cover slots continue across the sections so that two identical
                placeholder covers never stand directly above each other. */}
            {plannedRows.map((row, r) => (
              <View key={row[0].id} style={styles.gridRow}>
                {row.map((t, c) => {
                  const slot = running.length + r * 2 + c;
                  return (
                    <TripGridCard
                      key={t.id}
                      trip={t}
                      position={slot}
                      onPress={() => router.push(`/trip/${t.id}?cover=${slot}`)}
                    />
                  );
                })}
                {row.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <StatusBarCover />
    </View>
  );
}

// Same size as the film reel in the empty recap tab: both empty states are the
// same case and should carry the same weight. With a 1254 px source that is
// enough up to a 3x display without extra @2x/@3x files.
const EMPTY_IMAGE = 160;

const styles = StyleSheet.create({
  content: {
    padding: spacing.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  newTrip: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridRow: { flexDirection: 'row', gap: spacing.base },
  camper: { width: EMPTY_IMAGE, height: EMPTY_IMAGE, alignSelf: 'center' },
});
