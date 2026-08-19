import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { signInWith } from '@/features/auth/authApi';

const APPLE_ENABLED = process.env.EXPO_PUBLIC_AUTH_APPLE === 'true';
const GOOGLE_ENABLED = process.env.EXPO_PUBLIC_AUTH_GOOGLE === 'true';

export default function WelcomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      {/* Placeholder: the Reelive wordmark will become an SVG asset
          (DESIGN-LANGUAGE §2). Until it exists: a plain Figtree line. */}
      <Text style={[type.h3, { color: colors['text-1'] }]}>Reelive</Text>
      <Text style={[type.h1, { color: colors['text-1'] }]}>
        Eure Reise. Alle Perspektiven. Ein Recap.
      </Text>
      <View style={{ gap: spacing.m, marginTop: spacing.xl }}>
        {APPLE_ENABLED && (
          <Button variant="secondary" label="Mit Apple fortfahren" onPress={() => void signInWith('apple')} />
        )}
        {GOOGLE_ENABLED && (
          <Button variant="secondary" label="Mit Google fortfahren" onPress={() => void signInWith('google')} />
        )}
        <Button variant="primary" label="Mit Handynummer fortfahren" onPress={() => router.push('/phone')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end', padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.s },
});
