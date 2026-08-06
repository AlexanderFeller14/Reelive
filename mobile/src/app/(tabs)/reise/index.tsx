import { useCallback, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { TripCard } from '@/components/TripCard';
import { Fab } from '@/components/Fab';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { fetchTrips } from '@/features/trips/tripsApi';
import { groupTrips } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

export default function ReiseListe() {
  const { colors } = useTheme();
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [geladen, setGeladen] = useState(false);

  // Beim Zurückkehren neu laden — eine gerade angelegte Reise soll sofort dastehen.
  useFocusEffect(
    useCallback(() => {
      let aktiv = true;
      void fetchTrips().then((t) => {
        if (!aktiv) return;
        setTrips(t);
        setGeladen(true);
      });
      return () => {
        aktiv = false;
      };
    }, [])
  );

  const { laufend, recaps } = groupTrips(trips);
  const leer = geladen && trips.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={styles.inhalt}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Meine Reisen</Text>

        {leer && (
          <View style={{ gap: spacing.s, marginTop: spacing.xl }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Noch keine Reise</Text>
            <Text style={[type.body, { color: colors['text-2'] }]}>
              Leg deine erste Reise an oder tritt einer per Einladungslink bei.
            </Text>
          </View>
        )}

        {laufend.length > 0 && (
          <View style={{ gap: spacing.l }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Unterwegs</Text>
            {laufend.map((t) => (
              <TripCard key={t.id} trip={t} onPress={() => router.push(`/reise/${t.id}`)} />
            ))}
          </View>
        )}

        {recaps.length > 0 && (
          <View style={{ gap: spacing.l }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Recaps</Text>
            {recaps.map((t) => (
              <TripCard key={t.id} trip={t} onPress={() => router.push(`/reise/${t.id}`)} />
            ))}
          </View>
        )}
      </ScrollView>
      <Fab label="Neue Reise" onPress={() => router.push('/reise/neu')} />
    </View>
  );
}

// Der FAB schwebt mit spacing.screen Abstand vom unteren Rand und ist 56 hoch
// (siehe Fab.tsx, Design-Language §4) — plus spacing.xl Luft darüber, damit die
// unterste Reise-Karte nicht dahinter verschwindet.
const FAB_AUSWEICHRAUM = spacing.screen + 56 + spacing.xl;

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: FAB_AUSWEICHRAUM, gap: spacing.xl },
});
