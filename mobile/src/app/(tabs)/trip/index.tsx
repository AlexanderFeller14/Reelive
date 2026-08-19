import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { TripCard } from '@/components/TripCard';
import { Button } from '@/components/Button';
import { Fab } from '@/components/Fab';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { fetchTrips } from '@/features/trips/tripsApi';
import { groupTrips } from '@/features/trips/tripDay';
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

  const { ongoing, recaps } = groupTrips(trips);
  const ready = loaded && !error;
  const noTrips = ready && trips.length === 0;
  const onlyRecaps = ready && ongoing.length === 0 && recaps.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Meine Reisen</Text>

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
              testID="leerzustand-camper"
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

        {ongoing.length > 0 && (
          <View style={{ gap: spacing.l }}>
            {ongoing.map((t, i) => (
              <TripCard
                key={t.id}
                trip={t}
                position={i}
                onPress={() => router.push(`/trip/${t.id}?cover=${i}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
      <Fab label="Neue Reise" onPress={() => router.push('/trip/new')} />
    </View>
  );
}

// The FAB floats spacing.screen above the bottom edge and is 56 tall (see
// Fab.tsx, Design-Language §4), plus spacing.xl of air above it, so that the
// lowest trip card does not disappear behind it.
const FAB_CLEARANCE = spacing.screen + 56 + spacing.xl;

// Same size as the film reel in the empty recap tab: both empty states are the
// same case and should carry the same weight. With a 1254 px source that is
// enough up to a 3x display without extra @2x/@3x files.
const EMPTY_IMAGE = 160;

const styles = StyleSheet.create({
  content: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: FAB_CLEARANCE, gap: spacing.xl },
  camper: { width: EMPTY_IMAGE, height: EMPTY_IMAGE, alignSelf: 'center' },
});
