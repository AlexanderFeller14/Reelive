import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { DateRangeField } from '@/components/DateRangeField';
import { StatusBarCover } from '@/components/StatusBarCover';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { fetchTrip, updateTrip } from '@/features/trips/tripsApi';
import { validateDateRange } from '@/features/trips/tripDay';
import type { Selection } from '@/features/trips/calendar';

export default function EditTrip() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xxl);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [dateRange, setDateRange] = useState<Selection>({ start: null, end: null });
  const [nameError, setNameError] = useState<string | undefined>();
  const [dateRangeError, setDateRangeError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    void fetchTrip(id).then(({ data, error }) => {
      if (!active) return;
      setLoadError(error ?? (data ? null : 'Diese Reise gibt es nicht mehr.'));
      if (data) {
        setName(data.name);
        setDateRange({ start: data.start_date, end: data.end_date });
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const save = async () => {
    const nextNameError = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const { start, end } = dateRange;
    // Same check as in the create screen: the calendar hands over either both
    // ends or neither, `validateDateRange` stays in front as the last check.
    const nextRangeError = !start || !end ? 'Trag den Zeitraum ein.' : validateDateRange(start, end);
    setNameError(nextNameError ?? undefined);
    setDateRangeError(nextRangeError ?? undefined);
    setSaveError(null);
    if (nextNameError || nextRangeError || !start || !end) return;

    setLoading(true);
    const { error } = await updateTrip(id, { name, startDate: start, endDate: end });
    setLoading(false);
    if (error) return setSaveError(error);
    router.back();
  };

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  if (loadError) {
    return (
      <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: topInset }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Reise bearbeiten</Text>
        <Text style={[type.body, { color: colors.danger }]}>{loadError}</Text>
        <Button variant="primary" label="Nochmal versuchen" onPress={() => setAttempt((v) => v + 1)} />
        <Button variant="text" label="Zurück" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    // Like the create screen: since the button sticks to the bottom, the
    // screen needs keyboard avoidance, otherwise the keyboard covers it while
    // typing the name. The spacing sits on the inner view, because with
    // `behavior="padding"` the KeyboardAvoidingView writes its own
    // `paddingBottom` over the screen margin and the button sticks to the tab
    // bar.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors['bg-0'] }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.screen, { paddingTop: topInset }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Reise bearbeiten</Text>
        <Input label="Name der Reise" value={name} onChangeText={setName} error={nameError} />
        <DateRangeField value={dateRange} onChange={setDateRange} error={dateRangeError} />
        {/* Like the create screen: button to the bottom edge, fields stay up. */}
        <View style={styles.filler} />
        {saveError && <Text style={[type.body, { color: colors.danger }]}>{saveError}</Text>}
        <Button variant="primary" label="Speichern" onPress={save} loading={loading} />
      </View>
      {/* Inside the KeyboardAvoidingView, whose box stays the full screen:
          only the inner view shrinks when the keyboard pads it, so the strip
          keeps sitting at the very top while the form slides up under it. */}
      <StatusBarCover />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  filler: { flex: 1 },
});
