import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { DateRangeField } from '@/components/DateRangeField';
import { StatusBarCover } from '@/components/StatusBarCover';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { createTrip } from '@/features/trips/tripsApi';
import { validateDateRange } from '@/features/trips/tripDay';
import type { Selection } from '@/features/trips/calendar';

export default function NewTrip() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xxl);
  const router = useRouter();
  const { userId } = useAuth();
  const [name, setName] = useState('');
  const [dateRange, setDateRange] = useState<Selection>({ start: null, end: null });
  const [nameError, setNameError] = useState<string | undefined>();
  const [dateRangeError, setDateRangeError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const nextNameError = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const { start, end } = dateRange;
    // The calendar hands over either both ends or neither, and it cannot
    // produce an end before the start. `validateDateRange` stays in front as
    // the last check anyway: it costs nothing and keeps the case covered
    // should the date range ever come from another source.
    const nextRangeError = !start || !end ? 'Trag den Zeitraum ein.' : validateDateRange(start, end);
    setNameError(nextNameError ?? undefined);
    setDateRangeError(nextRangeError ?? undefined);
    if (nextNameError || nextRangeError || !start || !end || !userId) return;

    setLoading(true);
    const { id, error } = await createTrip({
      name, startDate: start, endDate: end, ownerId: userId,
    });
    setLoading(false);
    if (error || !id) return setNameError(error ?? undefined);
    router.replace(`/trip/${id}/invite`);
  };

  return (
    // Since the button sticks to the bottom, the screen needs keyboard
    // avoidance: the name field has `autoFocus`, so the keyboard stands right
    // away and used to cover it. Same pattern as preview.tsx: `padding` on
    // iOS, Android handles it through windowSoftInputMode on the window.
    //
    // The spacing sits on the INNER view, not on the KeyboardAvoidingView:
    // with `behavior="padding"` that one sets its own `paddingBottom` and
    // thereby overwrote the screen margin as soon as no keyboard stood. The
    // button then stuck directly to the tab bar.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors['bg-0'] }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.screen, { paddingTop: topInset }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Neue Reise</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          Name und Zeitraum reichen. Freunde lädst du gleich danach ein.
        </Text>
        <Input label="Name der Reise" value={name} onChangeText={setName} error={nameError} placeholder="Norwegen mit dem Camper" autoFocus />
        <DateRangeField value={dateRange} onChange={setDateRange} error={dateRangeError} />
        {/* Pushes the button to the bottom edge, within thumb reach, instead
            of letting it stick in the middle of the picture. The fields stay
            at the top where the reading axis begins: with centred content the
            whole block would jump as soon as an error message appears under
            one field. */}
        <View style={styles.filler} />
        <Button variant="primary" label="Reise anlegen" onPress={submit} loading={loading} />
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
