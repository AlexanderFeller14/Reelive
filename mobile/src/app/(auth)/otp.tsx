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
  const oben = useTopInset(spacing.xxl);
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  // «Code erneut senden» loeste vorher requestOtp aus und verwarf das Ergebnis:
  // ob ein neuer Code unterwegs war oder Supabase mit 429 abgewiesen hatte, sah
  // der Screen gleich aus, naemlich nach nichts. Wer keinen Code bekam, tippte
  // dann in Endlosschleife auf einen Knopf, der nie antwortet.
  const [erneut, setErneut] = useState<{ text: string; fehler: boolean } | null>(null);
  const [erneutLaeuft, setErneutLaeuft] = useState(false);

  const submit = async () => {
    setLoading(true);
    const { error: apiError } = await verifyOtp(phone, code);
    setLoading(false);
    if (apiError) setError(apiError);
    // Erfolg: onAuthStateChange feuert, der Guard (Root-Layout) leitet weiter.
  };

  const erneutSenden = async () => {
    setErneutLaeuft(true);
    setErneut(null);
    const { error: apiError } = await requestOtp(phone);
    setErneutLaeuft(false);
    setErneut({ text: apiError ?? 'Neuer Code ist unterwegs.', fehler: !!apiError });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: oben }]}>
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
          onPress={() => void erneutSenden()}
          loading={erneutLaeuft}
        />
        {erneut && (
          <Text style={[type.secondary, { color: erneut.fehler ? colors.danger : colors['text-2'] }]}>
            {erneut.text}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.s },
});
