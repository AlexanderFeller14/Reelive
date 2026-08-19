import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { peekInvite, redeemInvite } from '@/features/trips/tripsApi';
import { rememberInvite } from '@/features/trips/inviteLink';
import { resolveTargetPath } from '@/features/trips/joinFlow';
import { formatRange } from '@/features/trips/tripDay';
import type { InvitePreview } from '@/features/trips/types';

export default function JoinScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { status } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    void peekInvite(code).then(({ data, error: peekError }) => {
      if (!active) return;
      setPreview(data);
      setLoadError(peekError);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [code, attempt]);

  const join = async () => {
    if (status !== 'signedIn') {
      await rememberInvite(code);
      router.replace('/welcome');
      return;
    }
    setLoading(true);
    const result = await redeemInvite(code);
    setLoading(false);
    const targetPath = resolveTargetPath(result);
    if (targetPath) {
      router.replace(targetPath);
      return;
    }
    setError(
      result.status === 'not_active'
        ? 'Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.'
        : 'Diesen Einladungslink gibt es nicht mehr.'
    );
  };

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  const open = preview !== null && preview.status === 'active';
  const message =
    error ??
    loadError ??
    (preview === null
      ? 'Diesen Einladungslink gibt es nicht mehr.'
      : preview.status !== 'active'
        ? 'Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.'
        : null);

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      {preview && (
        <>
          <Text style={[type.label, { color: colors['text-2'] }]}>
            {`${preview.owner_display_name} nimmt dich mit`}
          </Text>
          <Text style={[type.h1, { color: colors['text-1'] }]}>{preview.name}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(preview.start_date, preview.end_date)}
          </Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {`${preview.member_count} ${preview.member_count === 1 ? 'Person ist' : 'Personen sind'} dabei`}
          </Text>
        </>
      )}

      {message && <Text style={[type.body, { color: colors.danger }]}>{message}</Text>}

      <View style={{ marginTop: spacing.xl }}>
        {loadError ? (
          <Button variant="primary" label="Nochmal versuchen" onPress={() => setAttempt((n) => n + 1)} />
        ) : open && !error ? (
          <Button variant="primary" label="Reise beitreten" onPress={() => void join()} loading={loading} />
        ) : (
          <Button variant="secondary" label="Zu meinen Reisen" onPress={() => router.replace('/trip')} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.s },
});
