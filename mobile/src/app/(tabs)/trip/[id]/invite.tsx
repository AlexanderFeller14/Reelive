import { useCallback, useRef, useState } from 'react';
import { Share, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { fetchInviteCode } from '@/features/trips/tripsApi';
import { createInviteUrl } from '@/features/trips/inviteLink';

export default function Invite() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xxl);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);

  const load = useCallback(async () => {
    const { data, error: readError } = await fetchInviteCode(id);
    if (!active.current) return;
    setUrl(data ? createInviteUrl(data) : null);
    setError(readError);
    setLoaded(true);
  }, [id]);

  // Reload on focus, not only on mount: removing someone in the detail screen
  // rotates the invite_code server side (migration 20260807090000), which no
  // test here can see through the mocked api.
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void load();
      return () => {
        active.current = false;
      };
    }, [load])
  );

  const share = async () => {
    if (!url) return;
    await Share.share({ message: `Komm mit auf die Reise: ${url}` });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: topInset }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Freunde einladen</Text>
      <Text style={[type.body, { color: colors['text-2'] }]}>
        Scannen oder Link schicken. Deine Freunde können jederzeit dazukommen, auch mitten in der Reise.
      </Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        Entfernst du jemanden aus der Reise, bekommt sie einen neuen Link. Teil ihn dann noch einmal.
      </Text>

      <View style={styles.qr}>
        {url ? (
          // QRCode takes fixed colour values instead of style props, the token
          // values are passed through on purpose, no new hex values.
          <QRCode value={url} size={220} color={palette['text-1']} backgroundColor={palette['bg-0']} />
        ) : loaded ? (
          <Text style={[type.body, { color: colors.danger }]}>
            {error ?? 'Der Einladungslink konnte nicht geladen werden. Probier es gleich nochmal.'}
          </Text>
        ) : (
          // Skeleton (DESIGN-LANGUAGE §4): a calm bg-1 surface instead of
          // empty white while the code is still loading.
          <View style={[styles.skeleton, { backgroundColor: colors['bg-1'] }]} />
        )}
      </View>

      <Button
        variant="primary"
        label="Link teilen"
        onPress={() => void share()}
        loading={!loaded}
        disabled={loaded && !url}
      />
      <Button
        variant="text"
        label="Später"
        // Back, not forward: both ways onto this screen (detail push,
        // create flow) leave the trip detail beneath it, so leaving
        // animates as a return instead of a next window sliding in from
        // the right. The guard covers a cold start straight onto this
        // route, where there is nothing beneath to return to.
        onPress={() => (router.canGoBack() ? router.back() : router.replace(`/trip/${id}`))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  // The QR code is the one element this screen wants to show and therefore
  // gets the room between text and buttons, instead of sticking under the text
  // at a fixed distance. The title stays at the top where the reading axis
  // begins (DESIGN-LANGUAGE §2), the buttons slide to the bottom edge, within
  // thumb reach.
  qr: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  skeleton: { width: 220, height: 220, borderRadius: radius.card },
});
