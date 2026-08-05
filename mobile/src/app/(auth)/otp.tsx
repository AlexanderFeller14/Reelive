import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { requestOtp, verifyOtp } from '@/features/auth/authApi';

export default function OtpScreen() {
  const { colors } = useTheme();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const { error: apiError } = await verifyOtp(phone, code);
    setLoading(false);
    if (apiError) setError(apiError);
    // Erfolg: onAuthStateChange feuert, der Guard (Root-Layout) leitet weiter.
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
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
      <Button variant="text" label="Code erneut senden" onPress={() => void requestOtp(phone)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
