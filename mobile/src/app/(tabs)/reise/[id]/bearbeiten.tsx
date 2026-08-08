import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { fetchTrip, updateTrip } from '@/features/trips/tripsApi';
import { formatGermanDate, parseGermanDate, validateDateRange } from '@/features/trips/tripDay';

export default function ReiseBearbeiten() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xxl);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [beginn, setBeginn] = useState('');
  const [ende, setEnde] = useState('');
  const [nameFehler, setNameFehler] = useState<string | undefined>();
  const [beginnFehler, setBeginnFehler] = useState<string | undefined>();
  const [endeFehler, setEndeFehler] = useState<string | undefined>();
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
      // Vorher blieb das Formular bei einem Lesefehler einfach leer stehen —
      // es sah aus wie eine Reise ohne Namen und ohne Daten, also wie ein
      // Zustand der Daten statt wie ein Fehler beim Lesen. Jetzt sagt der
      // Screen, was los ist, und bietet den einen sinnvollen Schritt an.
      setLadefehler(error ?? (data ? null : 'Diese Reise gibt es nicht mehr.'));
      if (data) {
        setName(data.name);
        setBeginn(formatGermanDate(data.start_date));
        setEnde(formatGermanDate(data.end_date));
      }
      setGeladen(true);
    });
    return () => {
      aktiv = false;
    };
  }, [id, versuch]);

  const speichern = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const start = parseGermanDate(beginn);
    const end = parseGermanDate(ende);
    // Feldgenaue Zuordnung wie im Anlege-Screen (DESIGN-LANGUAGE §4).
    const bFehler = start ? null : 'Trag den Beginn ein, z.B. 01.08.2026.';
    const eFehler = end ? (start ? validateDateRange(start, end) : null) : 'Trag das Ende ein, z.B. 14.08.2026.';
    setNameFehler(nFehler ?? undefined);
    setBeginnFehler(bFehler ?? undefined);
    setEndeFehler(eFehler ?? undefined);
    setSpeicherFehler(null);
    if (nFehler || bFehler || eFehler || !start || !end) return;

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
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: oben }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Reise bearbeiten</Text>
      <Input label="Name der Reise" value={name} onChangeText={setName} error={nameFehler} />
      <Input label="Beginn" value={beginn} onChangeText={setBeginn} error={beginnFehler} keyboardType="numbers-and-punctuation" />
      <Input label="Ende" value={ende} onChangeText={setEnde} error={endeFehler} keyboardType="numbers-and-punctuation" />
      {speicherFehler && <Text style={[type.body, { color: colors.danger }]}>{speicherFehler}</Text>}
      <Button variant="primary" label="Speichern" onPress={speichern} loading={laedt} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
});
