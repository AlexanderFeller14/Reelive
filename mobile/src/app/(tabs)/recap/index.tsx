import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { TripCard } from '@/components/TripCard';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { fetchTrips } from '@/features/trips/tripsApi';
import type { Trip } from '@/features/trips/types';

// «Entwickelt» ist jede Reise, die kein Geheimnis mehr ist — 'revealed' UND
// 'archived' (Task-10-Brief: "status in ('revealed','archived')"). 'active'
// erscheint hier nie: eine laufende Reise hat höchstens ein Versprechen auf
// einen Recap, keinen — die gehört auf den Reise-Tab, nicht hierher.
function nurRecaps(trips: Trip[]): Trip[] {
  return trips.filter((t) => t.status !== 'active');
}

export default function RecapListe() {
  const { colors } = useTheme();
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  // Gleiche Dreiteilung wie reise/index.tsx: `geladen` trennt «lädt noch» von
  // «fertig», `fehler` trennt «fertig, aber nichts bekommen» von «fertig und
  // wirklich leer» — sonst behauptete ein Ladefehler «Noch kein Recap», eine
  // falsche Aussage über die Daten der Person (DESIGN-LANGUAGE §6).
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  // Schirmt setState nach Blur/Unmount ab; jeder Fokus-Zyklus setzt ihn neu
  // (gleiches Muster wie reise/index.tsx).
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const { data, error } = await fetchTrips();
    if (!aktiv.current) return;
    setTrips(data);
    setFehler(error);
    setGeladen(true);
  }, []);

  const nochmal = useCallback(async () => {
    setLaedt(true);
    await laden();
    setLaedt(false);
  }, [laden]);

  // Beim Zurückkehren neu laden: eine gerade abgeschlossene Reise soll ohne
  // App-Neustart als Recap-Karte dastehen.
  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      void laden();
      return () => {
        aktiv.current = false;
      };
    }, [laden])
  );

  const recaps = nurRecaps(trips);
  const leer = geladen && !fehler && recaps.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={styles.inhalt}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Deine Recaps</Text>

        {fehler && (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{fehler}</Text>
            <Button variant="secondary" label="Nochmal versuchen" onPress={() => void nochmal()} loading={laedt} />
          </View>
        )}

        {leer && (
          <View style={{ gap: spacing.s, marginTop: spacing.xl }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Noch kein Recap</Text>
            <Text style={[type.body, { color: colors['text-2'] }]}>
              Der erste kommt, sobald ihr eine Reise abschliesst.
            </Text>
          </View>
        )}

        {recaps.length > 0 && (
          <View style={{ gap: spacing.l }}>
            {recaps.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                onPress={() =>
                  // `/recap/[id]/uebersicht` entsteht erst in diesem Task und fehlt
                  // darum noch in der generierten (gitignorten) Routen-Liste
                  // `.expo/types/router.d.ts` — gleiche, in `aufnehmen/index.tsx`
                  // bereits etablierte Übergangslösung wie dort für
                  // `/aufnehmen/preview` (siehe Kommentar dort). Entfällt, sobald
                  // die Typen einmal mit laufendem Metro-Bundler neu erzeugt wurden.
                  router.push({ pathname: '/recap/[id]/uebersicht', params: { id: t.id } } as unknown as Href)
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.xl },
});
