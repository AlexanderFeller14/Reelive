import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { normalizePhone } from '@/features/auth/phone';
import { requestOtp } from '@/features/auth/authApi';

export default function PhoneScreen() {
  const { colors } = useTheme();
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
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
