import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Zeitraumfeld } from '@/components/Zeitraumfeld';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useAuth } from '@/features/auth/AuthProvider';
import { createTrip } from '@/features/trips/tripsApi';
import { validateDateRange } from '@/features/trips/tripDay';
import type { Auswahl } from '@/features/trips/kalender';

export default function NeueReise() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xxl);
  const router = useRouter();
  const { userId } = useAuth();
  const [name, setName] = useState('');
  const [zeitraum, setZeitraum] = useState<Auswahl>({ start: null, end: null });
  const [nameFehler, setNameFehler] = useState<string | undefined>();
  const [zeitraumFehler, setZeitraumFehler] = useState<string | undefined>();
  const [laedt, setLaedt] = useState(false);

  const absenden = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const { start, end } = zeitraum;
    // Der Kalender liefert entweder beide Enden oder keines, und ein Ende vor
    // dem Beginn kann er nicht erzeugen. Es bleibt der eine Fall, dass gar
    // nichts gewählt wurde. `validateDateRange` steht trotzdem als letzte
    // Prüfung davor, sie kostet nichts und hält den Fall abgedeckt, falls der
    // Zeitraum je aus einer anderen Quelle käme.
    const zFehler = !start || !end ? 'Trag den Zeitraum ein.' : validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setZeitraumFehler(zFehler ?? undefined);
    if (nFehler || zFehler || !start || !end || !userId) return;

    setLaedt(true);
    const { id, error } = await createTrip({
      name, startDate: start, endDate: end, ownerId: userId,
    });
    setLaedt(false);
    if (error || !id) return setNameFehler(error ?? undefined);
    // Direkt weiter zum Einladen (App-Konzept §5.3); replace, damit «zurück»
    // wieder in der Liste landet und nicht im ausgefüllten Formular.
    router.replace(`/reise/${id}/einladen`);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: oben }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Neue Reise</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        Name und Zeitraum reichen. Freunde lädst du gleich danach ein.
      </Text>
      <Input label="Name der Reise" value={name} onChangeText={setName} error={nameFehler} placeholder="Norwegen mit dem Camper" autoFocus />
      <Zeitraumfeld wert={zeitraum} onAendern={setZeitraum} fehler={zeitraumFehler} />
      <Button variant="primary" label="Reise anlegen" onPress={absenden} loading={laedt} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
});
