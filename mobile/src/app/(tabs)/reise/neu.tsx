import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { createTrip } from '@/features/trips/tripsApi';
import { parseGermanDate, validateDateRange } from '@/features/trips/tripDay';

export default function NeueReise() {
  const { colors } = useTheme();
  const router = useRouter();
  const { userId } = useAuth();
  const [name, setName] = useState('');
  const [beginn, setBeginn] = useState('');
  const [ende, setEnde] = useState('');
  const [nameFehler, setNameFehler] = useState<string | undefined>();
  const [datumFehler, setDatumFehler] = useState<string | undefined>();
  const [laedt, setLaedt] = useState(false);

  const absenden = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const start = parseGermanDate(beginn);
    const end = parseGermanDate(ende);
    const dFehler = validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setDatumFehler(dFehler ?? undefined);
    if (nFehler || dFehler || !start || !end || !userId) return;

    setLaedt(true);
    const { id, error } = await createTrip({ name, startDate: start, endDate: end, ownerId: userId });
    setLaedt(false);
    if (error || !id) return setNameFehler(error ?? undefined);
    // Direkt weiter zum Einladen (App-Konzept §5.3); replace, damit «zurück»
    // wieder in der Liste landet und nicht im ausgefüllten Formular.
    router.replace(`/reise/${id}/einladen`);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Neue Reise</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        Name und Zeitraum reichen — Freunde lädst du gleich danach ein.
      </Text>
      <Input label="Name der Reise" value={name} onChangeText={setName} error={nameFehler} placeholder="Norwegen mit dem Camper" autoFocus />
      <Input label="Beginn" value={beginn} onChangeText={setBeginn} keyboardType="numbers-and-punctuation" placeholder="01.08.2026" />
      <Input label="Ende" value={ende} onChangeText={setEnde} error={datumFehler} keyboardType="numbers-and-punctuation" placeholder="14.08.2026" />
      <Button variant="primary" label="Reise anlegen" onPress={absenden} loading={laedt} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
});
