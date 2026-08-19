import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { requestOtp, verifyOtp } from '@/features/auth/authApi';

export default function OtpScreen() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xxl);
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [resend, setResend] = useState<{ text: string; error: boolean } | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const { error: apiError } = await verifyOtp(phone, code);
    setLoading(false);
    if (apiError) setError(apiError);
    // On success onAuthStateChange fires and the guard (root layout) moves on.
  };

  const resendCode = async () => {
    setResendLoading(true);
    setResend(null);
    const { error: apiError } = await requestOtp(phone);
    setResendLoading(false);
    setResend({ text: apiError ?? 'Neuer Code ist unterwegs.', error: !!apiError });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: topInset }]}>
      <Text style={[type.label, { color: colors['text-2'] }]}>Schritt 2 von 2</Text>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Dein Code</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        {`Wir haben dir einen Code an ${phone} geschickt.`}
      </Text>
      <View style={{ gap: spacing.l, marginTop: spacing.base }}>
        <Input
          label="Code"
          value={code}
          onChangeText={setCode}
          error={error}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          placeholder="123456"
        />
        <Button variant="primary" label="Bestätigen" onPress={submit} loading={loading} disabled={code.length !== 6} />
        <Button
          variant="text"
          label="Code erneut senden"
          onPress={() => void resendCode()}
          loading={resendLoading}
        />
        {resend && (
          <Text style={[type.secondary, { color: resend.error ? colors.danger : colors['text-2'] }]}>
            {resend.text}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.s },
});
