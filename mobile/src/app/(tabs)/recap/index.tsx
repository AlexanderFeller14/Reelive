import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { TripCard } from '@/components/TripCard';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { fetchTrips } from '@/features/trips/tripsApi';
import { groupTrips } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

export default function RecapListe() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xl);
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  // Gleiche Dreiteilung wie reise/index.tsx: `geladen` trennt «lädt noch» von
  // «fertig», `fehler` trennt «fertig, aber nichts bekommen» von «fertig und
  // wirklich leer», sonst behauptete ein Ladefehler «Noch kein Recap», eine
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

  // Dieselbe Filterung wie in reise/index.tsx, dort schon als groupTrips
  // gebaut, keine zweite, gleichlautende Funktion für dasselbe Kriterium
  // (Review Task 10, Kleinigkeit).
  const { recaps } = groupTrips(trips);
  const leer = geladen && !fehler && recaps.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={[styles.inhalt, { paddingTop: oben }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Deine Recaps</Text>

        {fehler && (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{fehler}</Text>
            <Button variant="secondary" label="Nochmal versuchen" onPress={() => void nochmal()} loading={laedt} />
          </View>
        )}

        {leer && (
          <View style={{ marginTop: spacing.xl }}>
            {/* Die Filmrolle steht NUR hier, wo sonst nichts steht. Als
                wiederkehrendes Motiv über der ganzen App wäre sie das
                Retro-Kostüm, vor dem die Leitidee der DESIGN-LANGUAGE warnt;
                auf dem einen leeren Screen ist sie das Versprechen, worauf
                man wartet. Deshalb auch ohne Rahmen, Radius und Schatten:
                das PNG ist freigestellt und steht frei auf `bg-0`. */}
            <Image
              testID="leerzustand-filmrolle"
              source={require('@/assets/images/filmrolle-freigestellt.png')}
              style={styles.filmrolle}
              contentFit="contain"
              // Das Bild sagt nichts, was der Text darunter nicht schon sagt.
              // Im Accessibility-Baum kündigte es «Noch kein Recap» mit einem
              // nutzlosen «Bild» an.
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
                alsRecap
                onPress={() => router.push(`/recap/${t.id}/uebersicht`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Die Filmrolle nimmt die volle Breite zwischen den Screen-Rändern ein (§3:
// Screen-Ränder 24), statt der bisherigen 160. Auf dem einen Screen, auf dem
// sonst nichts steht, darf das Versprechen gross sein; die Grösse ist hier
// selbst die Aussage, und ein Bild, das die Fläche füllt, braucht keinen
// zweiten Blickfang daneben.
//
// `maxWidth` ist keine Gestaltungsentscheidung, sondern die Schärfegrenze der
// Quelle: 1254 px geteilt durch die dreifache Auflösung ergibt 418, auf den
// 4er-Raster abgerundet 416. Darüber müsste das PNG hochskalieren und würde
// weich. Auf jedem iPhone bleibt die Breite darunter (17 Pro Max: 440 minus
// die beiden 24er-Ränder sind 392), die Grenze greift erst auf breiten
// Flächen wie dem iPad.
//
// `aspectRatio` statt einer festen Höhe, weil die Breite jetzt vom Gerät
// kommt: die Quelle ist quadratisch (1254 x 1254), das Bild soll es bleiben.
// Zentriert, während der Text darunter linksbündig bleibt (§7: Text ist
// linksbündig, nur inszenierte Momente zentrieren).
const FILMROLLE_MAX = 416;

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.xl },
  filmrolle: { width: '100%', aspectRatio: 1, maxWidth: FILMROLLE_MAX, alignSelf: 'center' },
});
