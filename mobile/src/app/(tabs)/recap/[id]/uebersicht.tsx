import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronLeft } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { fetchTrip } from '@/features/trips/tripsApi';
import type { Trip } from '@/features/trips/types';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { gruppiereNachTagen } from '@/features/recap/tage';
import type { RecapMoment, RecapTag } from '@/features/recap/types';
import { holeVorrat, type MedienUrl, type Vorrat } from '@/features/recap/urlVorrat';

// Nur der Tag selbst — nicht der Wochentag, den will hier niemand wissen.
const MONATE_LANG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function formatTagesdatum(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONATE_LANG[m - 1]}`;
}

// «Tag 3 · Lissabon · 12. August» (Brief/Spec §8.3). Der Ort entfällt, wenn
// keiner der Momente einen `place_name` trägt (tage.ortDesTages liefert dann
// `null`) — kein erfundener Platzhaltertext.
//
// Bewusst NUR `tag.datum` und `tag.nummer` gelesen, nie `captured_at`/
// `captured_tz` eines einzelnen Moments dieses Tages: bei einer Reise
// ostwärts über die Datumsgrenze kann `tag.datum` vom eigenen Ortsdatum
// EINZELNER Momente abweichen, die die monotone Tagesvergabe in diesen Tag
// gezogen hat (siehe Kommentarkopf von tage.ts). `tag.datum` ist trotzdem
// die einzig ehrliche Angabe für DEN TAG als Ganzes — eine Überschrift, die
// stattdessen das Datum irgendeines seiner Momente anzeigt, würde für genau
// diese Momente lügen.
function tagesueberschrift(tag: RecapTag): string {
  const teile = [`Tag ${tag.nummer}`];
  if (tag.ort) teile.push(tag.ort);
  teile.push(formatTagesdatum(tag.datum));
  return teile.join(' · ');
}

// Gleiche Formulierung wie `wartendText` im Schwester-Screen
// (reise/[id]/index.tsx) für denselben Zustand — «hochladen» steht in
// DESIGN-LANGUAGE §6 auf der Nie-Liste des Vokabulars («einsenden», nie
// «hochladen»); der Brief hatte den Satz nur als Beispiel vorgegeben, nicht
// als Zitat (Review Task 10, Kleinigkeit). Singular/Plural wie überall sonst
// im Projekt: die Zahl bleibt auch im Singular stehen.
function unterwegsText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

// Task-10-Brief, zweiter Hinweis: `ausgelassen` ist etwas ANDERES als
// «wartet noch auf Upload» — die Function hat für diese Momente eine URL
// versucht und keine bekommen (kaputtes/fehlendes Objekt, Signierfehler).
// Eine ehrliche Zeile statt einer Fehlernummer: sie sagt, was die Person tun
// kann (später nochmal reinschauen), ohne eine Ursache zu erfinden, die
// niemand von hier aus kennt.
function ausgelassenText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

// Ruhige bg-1-Fläche mit Opacity-Puls (DESIGN-LANGUAGE §4: "Skeleton:
// bg-1-Blöcke, Opacity-Puls 0.6 ↔ 1.0, kein Gradient-Shimmer"). Reine
// Presentation, deshalb lokal statt als eigene Komponentendatei — nichts
// davon wird ausserhalb dieses Screens gebraucht.
function SkelettBlock({ style }: { style: object }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const puls = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.gentle, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: motion.duration.gentle, useNativeDriver: true }),
      ])
    );
    puls.start();
    return () => puls.stop();
  }, [reducedMotion, opacity]);

  return <Animated.View style={[style, { backgroundColor: colors['bg-1'], opacity }]} />;
}

function SkelettScreen() {
  const { colors } = useTheme();
  return (
    <View testID="recap-skeleton" style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <View style={styles.inhalt}>
        <SkelettBlock style={{ width: 160, height: 30, borderRadius: radius.control }} />
        <View style={[styles.kachelRaster, { marginTop: spacing.xl }]}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkelettBlock key={i} style={styles.kachel} />
          ))}
        </View>
      </View>
    </View>
  );
}

function TagesAbschnitt({
  tag, urls, indexById, onTip,
}: {
  tag: RecapTag;
  urls: Map<string, MedienUrl>;
  indexById: Map<string, number>;
  onTip: (index: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.m }}>
      <Text style={[type.h2, { color: colors['text-1'] }]}>{tagesueberschrift(tag)}</Text>
      <View style={styles.kachelRaster}>
        {tag.momente.map((m) => {
          const url = urls.get(m.id);
          const index = indexById.get(m.id);
          // Beide sind für jeden Moment in `tag.momente` garantiert gesetzt:
          // `tag` kommt aus gruppiereNachTagen(mitBild, …), `indexById` ist
          // aus genau demselben `mitBild` gebaut (siehe unten) — ein Moment
          // ohne Bild taucht in `tag.momente` gar nicht erst auf.
          if (!url || index === undefined) return null;
          return (
            <PressScale
              key={m.id}
              scaleTo={0.96}
              accessibilityRole="button"
              accessibilityLabel={`Moment ${index + 1} öffnen`}
              testID={`recap-kachel-${m.id}`}
              onPress={() => onTip(index)}
            >
              <View style={[styles.kachel, { backgroundColor: colors['bg-1'] }]}>
                <Image
                  testID={`recap-bild-${m.id}`}
                  source={{ uri: url.thumb_url ?? url.medium_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                />
              </View>
            </PressScale>
          );
        })}
      </View>
    </View>
  );
}

export default function RecapUebersicht() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [momente, setMomente] = useState<RecapMoment[]>([]);
  const [vorrat, setVorrat] = useState<Vorrat | null>(null);
  // Gleiche Dreiteilung wie überall sonst im Projekt: `geladen` trennt «lädt
  // noch» von «fertig», `fehler` bündelt den ersten Fehlschlag der drei
  // parallelen Abrufe (Reise, Momente, Vorrat) — Priorität Reise vor Vorrat
  // vor Momenten, weil eine kaputte Reise-Abfrage die anderen beiden
  // ohnehin bedeutungslos macht.
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const [{ data: t, error: tFehler }, { data: m, error: mFehler }, { vorrat: v, error: vFehler }] = await Promise.all([
      fetchTrip(id),
      fetchRecapMomente(id),
      holeVorrat(id),
    ]);
    if (!aktiv.current) return;
    setTrip(t);
    setMomente(m);
    setVorrat(v);
    setFehler(tFehler ?? vFehler ?? mFehler ?? null);
    setGeladen(true);
  }, [id]);

  const nochmal = useCallback(async () => {
    setLaedt(true);
    await laden();
    setLaedt(false);
  }, [laden]);

  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      void laden();
      return () => {
        aktiv.current = false;
      };
    }, [laden])
  );

  const zurueck = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/recap');
  };

  const zumPlayer = (index: number) => {
    // `/recap/[id]/player` entsteht erst in Task 11 und fehlt darum noch in
    // der generierten (gitignorten) Routen-Liste `.expo/types/router.d.ts` —
    // gleiche Übergangslösung wie schon in `aufnehmen/index.tsx` für
    // `/aufnehmen/preview` (siehe Kommentar dort). Entfällt ersatzlos, sobald
    // Task 11 die Route anlegt und die Typen einmal neu erzeugt wurden.
    router.push({ pathname: '/recap/[id]/player', params: { id, start: String(index) } } as unknown as Href);
  };

  if (!geladen) return <SkelettScreen />;

  const kopf = (
    <View style={styles.kopfzeile}>
      <PressScale accessibilityRole="button" accessibilityLabel="Zurück" onPress={zurueck}>
        <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
      </PressScale>
    </View>
  );

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
        <View style={styles.inhalt}>
          {kopf}
          <Text style={[type.body, { color: colors.danger }]}>{fehler ?? 'Diese Reise gibt es nicht mehr.'}</Text>
          {fehler && <Button variant="secondary" label="Nochmal versuchen" onPress={() => void nochmal()} loading={laedt} />}
        </View>
      </View>
    );
  }

  // Nachzügler (upload_status='pending') fehlen im Raster — für sie gibt es
  // kein Objekt im Speicher, eine Kachel wäre eine schwarze Fläche
  // (Task-10-Brief). Dasselbe gilt für uploadete Momente, für die der Vorrat
  // trotzdem keine URL ausstellen konnte (`urls.has` false) — die Zahl dafür
  // ist `vorrat.ausgelassen`, eine EIGENE, vom Server gezählte Grösse, keine
  // hier selbst nachgerechnete Differenz (Task-10-Brief, zweiter Hinweis).
  const urls = vorrat?.urls ?? new Map<string, MedienUrl>();
  const uploaded = momente.filter((m) => m.upload_status === 'uploaded');
  const mitBild = uploaded.filter((m) => urls.has(m.id));
  const indexById = new Map(mitBild.map((m, i) => [m.id, i] as const));
  const tage = gruppiereNachTagen(mitBild, trip.start_date);
  const pendingAnzahl = momente.length - uploaded.length;
  const ausgelassenAnzahl = vorrat?.ausgelassen ?? 0;
  const komplettLeer = tage.length === 0 && pendingAnzahl === 0 && ausgelassenAnzahl === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={styles.inhalt}>
        {kopf}
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>

        {fehler ? (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{fehler}</Text>
            <Button variant="secondary" label="Nochmal versuchen" onPress={() => void nochmal()} loading={laedt} />
          </View>
        ) : komplettLeer ? (
          <Text style={[type.h2, { color: colors['text-1'], marginTop: spacing.xl }]}>
            Diese Reise ist leer geblieben.
          </Text>
        ) : (
          <View style={{ gap: spacing.xl, marginTop: spacing.xl }}>
            {tage.map((tag) => (
              <TagesAbschnitt key={tag.nummer} tag={tag} urls={urls} indexById={indexById} onTip={zumPlayer} />
            ))}
          </View>
        )}

        {!fehler && (pendingAnzahl > 0 || ausgelassenAnzahl > 0) && (
          <View style={{ gap: spacing.xs, marginTop: spacing.xl }}>
            {pendingAnzahl > 0 && (
              <Text style={[type.secondary, { color: colors['text-2'] }]}>{unterwegsText(pendingAnzahl)}</Text>
            )}
            {ausgelassenAnzahl > 0 && (
              <Text style={[type.secondary, { color: colors['text-2'] }]}>{ausgelassenText(ausgelassenAnzahl)}</Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.m },
  kopfzeile: { flexDirection: 'row', alignItems: 'center' },
  // Drei Spalten. Lücke explizit `spacing.xs` über `columnGap`/`rowGap` —
  // NICHT über `justifyContent: 'space-between'` (Review Task 10, Minor):
  // das liess die Lücke aus dem verbleibenden Rest-Raum entstehen, je nach
  // Gerätebreite unterschiedlich gross und nie exakt aus dem 4er-Raster.
  // `columnGap`/`rowGap` sind seit RN 0.71 vollwertig, auch kombiniert mit
  // `flexWrap` — die Lücke ist damit immer exakt `spacing.xs`, unabhängig
  // von der Gerätebreite.
  kachelRaster: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', columnGap: spacing.xs, rowGap: spacing.xs },
  kachel: { width: '31.5%', aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
});
