import { useCallback, useRef, useState } from 'react';
import { Share, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { fetchInviteCode } from '@/features/trips/tripsApi';
import { createInviteUrl } from '@/features/trips/inviteLink';

export default function Einladen() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xxl);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [url, setUrl] = useState<string | null>(null);
  // Getrennt von `url`: `null` ist zwei verschiedene Zustände, „lädt noch"
  // (geladen=false) und „kein Code bekommen" (geladen=true, url=null).
  // Letzteres muss der Screen sichtbar machen statt still eine leere Fläche
  // zu zeigen (DESIGN-LANGUAGE §6: Ursache + Lösung).
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const { data, error } = await fetchInviteCode(id);
    if (!aktiv.current) return;
    setUrl(data ? createInviteUrl(data) : null);
    setFehler(error);
    setGeladen(true);
  }, [id]);

  // Beim Fokussieren neu laden statt nur beim Mounten: Ein Rauswurf im
  // Detailscreen rotiert den invite_code (Migration 20260807090000). Ein offen
  // liegengebliebener Einladen-Screen würde sonst einen QR-Code zeigen, der
  // schon nicht mehr gilt.
  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      void laden();
      return () => {
        aktiv.current = false;
      };
    }, [laden])
  );

  const teilen = async () => {
    if (!url) return;
    await Share.share({ message: `Komm mit auf die Reise: ${url}` });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: oben }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Freunde einladen</Text>
      <Text style={[type.body, { color: colors['text-2'] }]}>
        Scannen oder Link schicken. Deine Freunde können jederzeit dazukommen, auch mitten in der Reise.
      </Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        Entfernst du jemanden aus der Reise, bekommt sie einen neuen Link. Teil ihn dann noch einmal.
      </Text>

      <View style={styles.qr}>
        {url ? (
          // QRCode nimmt feste Farbwerte statt Style-Props, bewusst die
          // Token-Werte durchgereicht, keine neuen Hex-Werte.
          <QRCode value={url} size={220} color={palette['text-1']} backgroundColor={palette['bg-0']} />
        ) : geladen ? (
          <Text style={[type.body, { color: colors.danger }]}>
            {fehler ?? 'Der Einladungslink konnte nicht geladen werden. Probier es gleich nochmal.'}
          </Text>
        ) : (
          // Skeleton (DESIGN-LANGUAGE §4): ruhige bg-1-Fläche statt leerem
          // Weiss, solange der Code noch lädt.
          <View style={[styles.skeleton, { backgroundColor: colors['bg-1'] }]} />
        )}
      </View>

      <Button
        variant="primary"
        label="Link teilen"
        onPress={() => void teilen()}
        loading={!geladen}
        disabled={geladen && !url}
      />
      <Button variant="text" label="Später" onPress={() => router.replace(`/reise/${id}`)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  // Der QR-Code ist das eine Element, das dieser Screen zeigen will, und
  // bekommt deshalb den Raum zwischen Text und Knöpfen, statt mit festem
  // Abstand unter dem Text zu kleben. Der Titel bleibt oben, wo die Leseachse
  // beginnt (DESIGN-LANGUAGE §2: Headlines tragen den Screen), die Knöpfe
  // rutschen ans untere Ende, in Daumenreichweite. Nur `flex: 1` an dieser
  // einen Stelle, der Rest des Screens bleibt unverändert.
  qr: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  skeleton: { width: 220, height: 220, borderRadius: radius.card },
});
