import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Zeitraumfeld } from '@/components/Zeitraumfeld';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { fetchTrip, updateTrip } from '@/features/trips/tripsApi';
import { validateDateRange } from '@/features/trips/tripDay';
import type { Selection } from '@/features/trips/calendar';

export default function ReiseBearbeiten() {
  const { colors } = useTheme();
  const oben = useTopInset(spacing.xxl);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [zeitraum, setZeitraum] = useState<Selection>({ start: null, end: null });
  const [nameFehler, setNameFehler] = useState<string | undefined>();
  const [zeitraumFehler, setZeitraumFehler] = useState<string | undefined>();
  const [laedt, setLaedt] = useState(false);
  // Drei getrennte Zustaende, weil sie drei verschiedene Dinge bedeuten und
  // verschiedene naechste Schritte haben: die Vorschau laedt noch, das Laden
  // ist gescheitert (wiederholbar), das Speichern ist gescheitert (Formular
  // steht, Eingaben bleiben erhalten).
  const [geladen, setGeladen] = useState(false);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null);
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    let aktiv = true;
    setGeladen(false);
    void fetchTrip(id).then(({ data, error }) => {
      if (!aktiv) return;
      // Vorher blieb das Formular bei einem Lesefehler einfach leer stehen,
      // es sah aus wie eine Reise ohne Namen und ohne Daten, also wie ein
      // Zustand der Daten statt wie ein Fehler beim Lesen. Jetzt sagt der
      // Screen, was los ist, und bietet den einen sinnvollen Schritt an.
      setLadefehler(error ?? (data ? null : 'Diese Reise gibt es nicht mehr.'));
      if (data) {
        setName(data.name);
        // Ohne Umformatierung: der Kalender rechnet in denselben
        // ISO-Kalendertagen, die die Datenbank liefert.
        setZeitraum({ start: data.start_date, end: data.end_date });
      }
      setGeladen(true);
    });
    return () => {
      aktiv = false;
    };
  }, [id, versuch]);

  const speichern = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const { start, end } = zeitraum;
    // Gleiche Prüfung wie im Anlege-Screen: der Kalender liefert entweder beide
    // Enden oder keines, `validateDateRange` bleibt als letzte Prüfung davor.
    const zFehler = !start || !end ? 'Trag den Zeitraum ein.' : validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setZeitraumFehler(zFehler ?? undefined);
    setSpeicherFehler(null);
    if (nFehler || zFehler || !start || !end) return;

    setLaedt(true);
    const { error } = await updateTrip(id, { name, startDate: start, endDate: end });
    setLaedt(false);
    // Der Fehler gehoert NICHT in den Namensfeld-Slot: er sagt nichts ueber den
    // Namen aus (DESIGN-LANGUAGE §4 will feldgenaue Zuordnung, und «Probier es
    // gleich nochmal» unter dem Namensfeld behauptet, der Name sei schuld).
    if (error) return setSpeicherFehler(error);
    router.back();
  };

  if (!geladen) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  if (ladefehler) {
    return (
      <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: oben }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Reise bearbeiten</Text>
        <Text style={[type.body, { color: colors.danger }]}>{ladefehler}</Text>
        <Button variant="primary" label="Nochmal versuchen" onPress={() => setVersuch((v) => v + 1)} />
        <Button variant="text" label="Zurück" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    // Wie im Anlege-Screen: seit der Knopf unten klebt, braucht der Screen
    // Tastatur-Ausweichlogik, sonst verdeckt die Tastatur ihn beim Tippen des
    // Namens. Die Abstände liegen am inneren View, weil `behavior="padding"`
    // das eigene `paddingBottom` der KeyboardAvoidingView sonst über den
    // Screen-Rand schreibt und der Knopf auf der Tab-Bar klebt.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors['bg-0'] }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.screen, { paddingTop: oben }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Reise bearbeiten</Text>
        <Input label="Name der Reise" value={name} onChangeText={setName} error={nameFehler} />
        <Zeitraumfeld wert={zeitraum} onAendern={setZeitraum} fehler={zeitraumFehler} />
        {/* Wie im Anlege-Screen: Knopf ans untere Ende, Felder bleiben oben. */}
        <View style={styles.fueller} />
        {speicherFehler && <Text style={[type.body, { color: colors.danger }]}>{speicherFehler}</Text>}
        <Button variant="primary" label="Speichern" onPress={speichern} loading={laedt} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  fueller: { flex: 1 },
});
