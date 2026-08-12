import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { TripCard } from '@/components/TripCard';
import { Button } from '@/components/Button';
import { Fab } from '@/components/Fab';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { fetchTrips } from '@/features/trips/tripsApi';
import { groupTrips } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

export default function ReiseListe() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xl);
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [geladen, setGeladen] = useState(false);
  // Drei Zustände statt zwei, dasselbe Muster wie in [id]/einladen.tsx und
  // join/[code].tsx: `geladen` trennt «lädt noch» von «fertig», `fehler` trennt
  // «fertig, aber nichts bekommen» von «fertig und wirklich leer». Ohne diese
  // Trennung behauptete ein Ladefehler «Noch keine Reise», eine falsche
  // Aussage über die Daten des Nutzers (DESIGN-LANGUAGE §6).
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  // Schirmt setState nach Blur/Unmount ab; jeder Fokus-Zyklus setzt ihn neu.
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const { data, error } = await fetchTrips();
    if (!aktiv.current) return;
    setTrips(data);
    setFehler(error);
    setGeladen(true);
  }, []);

  // `laedt` hängt bewusst am Knopf, nicht an `laden`: Der Fokus-Lauf soll die
  // bereits stehende Liste nicht bei jeder Rückkehr mit einem Ladezustand
  // überschreiben, sichtbares Warten gehört nur dorthin, wo jemand getippt hat.
  // Der Ladezustand wird IMMER zurückgesetzt, auch wenn der Screen zwischendurch
  // den Fokus verliert: sonst bliebe `laedt` true und der Knopf käme mit einem
  // toten Spinner und deaktiviert zurück. Ein `aktiv`-Guard ist hier anders als
  // in `laden` nicht nötig, setState nach Unmount ist seit React 18 folgenlos,
  // und `laden` schützt die Daten-States ohnehin selbst.
  const nochmal = useCallback(async () => {
    setLaedt(true);
    await laden();
    setLaedt(false);
  }, [laden]);

  // Beim Zurückkehren neu laden, eine gerade angelegte Reise soll sofort dastehen.
  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      void laden();
      return () => {
        aktiv.current = false;
      };
    }, [laden])
  );

  const { laufend, recaps } = groupTrips(trips);
  const leer = geladen && !fehler && trips.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={[styles.inhalt, { paddingTop: oben }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Meine Reisen</Text>

        {fehler && (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{fehler}</Text>
            <Button
              variant="secondary"
              label="Nochmal versuchen"
              onPress={() => void nochmal()}
              loading={laedt}
            />
          </View>
        )}

        {leer && (
          <View style={{ marginTop: spacing.xl }}>
            {/* Wie die Filmrolle im leeren Recap-Tab (recap/index.tsx): das
                Bild steht NUR dort, wo sonst nichts steht. Freigestellt auf
                `bg-0`, deshalb ohne Rahmen, Radius und Schatten. */}
            <Image
              testID="leerzustand-camper"
              source={require('@/assets/images/camper-salbeigruen-transparent.png')}
              style={styles.camper}
              contentFit="contain"
              // Sagt nichts, was der Text darunter nicht schon sagt.
              accessible={false}
            />
            <View style={{ gap: spacing.s, marginTop: spacing.l }}>
              <Text style={[type.h2, { color: colors['text-1'] }]}>Noch keine Reise</Text>
              <Text style={[type.body, { color: colors['text-2'] }]}>
                Leg deine erste Reise an oder tritt einer per Einladungslink bei.
              </Text>
            </View>
          </View>
        )}

        {laufend.length > 0 && (
          <View style={{ gap: spacing.l }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Unterwegs</Text>
            {/* `cover` reicht den Platz der Karte ans Detail weiter, damit es
                dasselbe Platzhalter-Bild zeigt wie die Karte, auf die getippt
                wurde (platzhalterCover.ts). Ein reiner Darstellungs-Parameter:
                wer ohne ihn im Detail landet (Deep Link, frisch angelegte
                Reise), sieht das erste Bild. */}
            {laufend.map((t, i) => (
              <TripCard
                key={t.id}
                trip={t}
                position={i}
                onPress={() => router.push(`/reise/${t.id}?cover=${i}`)}
              />
            ))}
          </View>
        )}

        {recaps.length > 0 && (
          <View style={{ gap: spacing.l }}>
            <Text style={[type.h2, { color: colors['text-1'] }]}>Recaps</Text>
            {/* Bewusst OHNE `alsRecap`: ein Tipp hier führt in die Reise-
                Verwaltung (Mitglieder, Bearbeiten, Einladen), nicht in die
                Recap-Übersicht, die «Recap ansehen»-Pille wäre hier ein
                Versprechen, das der Tipp nicht einlöst (Review Task 10,
                Important 1). Der Recap-Tab setzt `alsRecap`, weil dort ein
                Tipp tatsächlich die Übersicht öffnet. */}
            {recaps.map((t, i) => (
              <TripCard
                key={t.id}
                trip={t}
                position={i}
                onPress={() => router.push(`/reise/${t.id}?cover=${i}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
      <Fab label="Neue Reise" onPress={() => router.push('/reise/neu')} />
    </View>
  );
}

// Der FAB schwebt mit spacing.screen Abstand vom unteren Rand und ist 56 hoch
// (siehe Fab.tsx, Design-Language §4), plus spacing.xl Luft darüber, damit die
// unterste Reise-Karte nicht dahinter verschwindet.
const FAB_AUSWEICHRAUM = spacing.screen + 56 + spacing.xl;

// Gleiche Grösse wie die Filmrolle im leeren Recap-Tab: beide Leerzustände
// sind derselbe Fall und sollen gleich schwer wiegen. Bei 1254 px Quelle
// reicht das ohne zusätzliche @2x/@3x-Dateien bis zu einem 3x-Display.
const LEERBILD = 160;

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: FAB_AUSWEICHRAUM, gap: spacing.xl },
  camper: { width: LEERBILD, height: LEERBILD, alignSelf: 'center' },
});
