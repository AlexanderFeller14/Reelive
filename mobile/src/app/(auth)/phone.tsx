import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { normalizePhone } from '@/features/auth/phone';
import { requestOtp } from '@/features/auth/authApi';

export default function PhoneScreen() {
  const { colors } = useTheme();
  const oben = useTopInset(spacing.xxl);
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const phone = normalizePhone(input);
    if (!phone) {
      setError('Das ist keine gültige Handynummer. Gib sie mit Vorwahl ein, z.B. +41 79 …');
      return;
    }
    setError(undefined);
    setLoading(true);
    const { error: apiError } = await requestOtp(phone);
    setLoading(false);
    if (apiError) return setError(apiError);
    router.push({ pathname: '/otp', params: { phone } });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: oben }]}>
      <Text style={[type.label, { color: colors['text-2'] }]}>Schritt 1 von 2</Text>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Deine Handynummer</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        Wir schicken dir einen Code per SMS.
      </Text>
      <View style={{ gap: spacing.l, marginTop: spacing.base }}>
        <Input
          label="Handynummer"
          value={input}
          onChangeText={setInput}
          error={error}
          keyboardType="phone-pad"
          autoFocus
          placeholder="+41 79 123 45 67"
        />
        <Button variant="primary" label="Code senden" onPress={submit} loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.s },
});
