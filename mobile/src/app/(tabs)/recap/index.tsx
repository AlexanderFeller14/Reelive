import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { TripCard } from '@/components/TripCard';
import { Button } from '@/components/Button';
import { StatusBarCover } from '@/components/StatusBarCover';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { fetchTrips } from '@/features/trips/tripsApi';
import { groupTrips, todaysCalendarDay } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

export default function RecapList() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xl);
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Shields setState after blur/unmount; every focus cycle sets it anew
  // (same pattern as trip/index.tsx).
  const active = useRef(true);

  const load = useCallback(async () => {
    const { data, error: loadError } = await fetchTrips();
    if (!active.current) return;
    setTrips(data);
    setError(loadError);
    setLoaded(true);
  }, []);

  const retry = useCallback(async () => {
    setLoading(true);
    await load();
    setLoading(false);
  }, [load]);

  // Reload when coming back: a trip that has just been closed should stand
  // there as a recap card without restarting the app.
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void load();
      return () => {
        active.current = false;
      };
    }, [load])
  );

  const { recaps } = groupTrips(trips, todaysCalendarDay());
  const empty = loaded && !error && recaps.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Deine Recaps</Text>

        {error && (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{error}</Text>
            <Button variant="secondary" label="Nochmal versuchen" onPress={() => void retry()} loading={loading} />
          </View>
        )}

        {empty && (
          <View style={{ marginTop: spacing.xl }}>
            {/* The film reel stands ONLY here, where nothing else does. As a
                recurring motif across the whole app it would be the retro
                costume the DESIGN-LANGUAGE warns about; on the one empty
                screen it is the promise of what is being waited for. Hence
                also without frame, radius and shadow: the PNG is cut out and
                stands free on `bg-0`. */}
            <Image
              testID="empty-state-film-reel"
              source={require('@/assets/images/filmrolle-freigestellt.png')}
              style={styles.filmReel}
              contentFit="contain"
              accessible={false}
            />
            <View style={{ gap: spacing.s, marginTop: spacing.l }}>
              <Text style={[type.h2, { color: colors['text-1'] }]}>Noch kein Recap</Text>
              <Text style={[type.body, { color: colors['text-2'] }]}>
                Der erste kommt, sobald ihr eine Reise abschliesst.
              </Text>
            </View>
          </View>
        )}

        {recaps.length > 0 && (
          <View style={{ gap: spacing.l }}>
            {recaps.map((t, i) => (
              <TripCard
                key={t.id}
                trip={t}
                position={i}
                asRecap
                // No `start` param: that absence is what makes the player
                // begin at the seal instead of mid-show (task 5,
                // recap-show plan).
                onPress={() => router.push({ pathname: '/recap/[id]/player', params: { id: t.id } })}
              />
            ))}
          </View>
        )}
      </ScrollView>
      <StatusBarCover />
    </View>
  );
}

// The film reel takes the full width between the screen margins (§3: screen
// margins 24), instead of the previous 160. On the one screen where nothing
// else stands, the promise may be big; the size is the statement here, and an
// image filling the surface needs no second eye-catcher beside it.
//
// `maxWidth` is not a design decision but the sharpness limit of the source:
// 1254 px divided by the threefold resolution gives 418, rounded down onto
// the 4-grid 416. Above that the PNG would have to scale up and go soft. On
// every iPhone the width stays below it (17 Pro Max: 440 minus the two 24
// margins is 392), the limit only bites on wide surfaces like the iPad.
//
// `aspectRatio` instead of a fixed height, because the width now comes from
// the device: the source is square (1254 x 1254) and the image should stay
// that way. Centred, while the text below it stays left aligned (§7).
const FILM_REEL_MAX = 416;

const styles = StyleSheet.create({
  content: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.xl },
  filmReel: { width: '100%', aspectRatio: 1, maxWidth: FILM_REEL_MAX, alignSelf: 'center' },
});
