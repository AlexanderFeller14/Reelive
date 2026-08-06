import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { fetchTrip, updateTrip } from '@/features/trips/tripsApi';
import { formatGermanDate, parseGermanDate, validateDateRange } from '@/features/trips/tripDay';

export default function ReiseBearbeiten() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [beginn, setBeginn] = useState('');
  const [ende, setEnde] = useState('');
  const [nameFehler, setNameFehler] = useState<string | undefined>();
  const [datumFehler, setDatumFehler] = useState<string | undefined>();
  const [laedt, setLaedt] = useState(false);

  useEffect(() => {
    void fetchTrip(id).then((t) => {
      if (!t) return;
      setName(t.name);
      setBeginn(formatGermanDate(t.start_date));
      setEnde(formatGermanDate(t.end_date));
    });
  }, [id]);

  const speichern = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const start = parseGermanDate(beginn);
    const end = parseGermanDate(ende);
    const dFehler = validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setDatumFehler(dFehler ?? undefined);
    if (nFehler || dFehler || !start || !end) return;

    setLaedt(true);
    const { error } = await updateTrip(id, { name, startDate: start, endDate: end });
    setLaedt(false);
    if (error) return setNameFehler(error);
    router.back();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Reise bearbeiten</Text>
      <Input label="Name der Reise" value={name} onChangeText={setName} error={nameFehler} />
      <Input label="Beginn" value={beginn} onChangeText={setBeginn} keyboardType="numbers-and-punctuation" />
      <Input label="Ende" value={ende} onChangeText={setEnde} error={datumFehler} keyboardType="numbers-and-punctuation" />
      <Button variant="primary" label="Speichern" onPress={speichern} loading={laedt} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
});
