import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { peekInvite, redeemInvite } from '@/features/trips/tripsApi';
import { rememberInvite } from '@/features/trips/inviteLink';
import { ermittleZielPfad } from '@/features/trips/joinFlow';
import { formatRange } from '@/features/trips/tripDay';
import type { InvitePreview } from '@/features/trips/types';

export default function JoinScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { status } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  // Getrennt von `fehler`: das hier ist ein Ladefehler der Vorschau und darf
  // wiederholt werden, `fehler` kommt vom Beitritt selbst und ist endgueltig.
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    let aktiv = true;
    setGeladen(false);
    void peekInvite(code).then(({ data, error }) => {
      if (!aktiv) return;
      setPreview(data);
      setLadefehler(error);
      setGeladen(true);
    });
    return () => {
      aktiv = false;
    };
  }, [code, versuch]);

  const beitreten = async () => {
    // Ohne Session zuerst anmelden — der Code wartet solange und wird vom
    // Root-Layout eingelöst, sobald Session und Profil stehen.
    if (status !== 'signedIn') {
      await rememberInvite(code);
      router.replace('/welcome');
      return;
    }
    setLaedt(true);
    const ergebnis = await redeemInvite(code);
    setLaedt(false);
    const zielPfad = ermittleZielPfad(ergebnis);
    if (zielPfad) {
      router.replace(zielPfad);
      return;
    }
    setFehler(
      ergebnis.status === 'not_active'
        ? 'Diese Reise ist schon abgeschlossen. Frag nach dem Recap-Link.'
        : 'Diesen Einladungslink gibt es nicht mehr.'
    );
  };

  if (!geladen) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  const offen = preview !== null && preview.status === 'active';
  const meldung =
    fehler ??
    ladefehler ??
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

      {meldung && <Text style={[type.body, { color: colors.danger }]}>{meldung}</Text>}

      <View style={{ marginTop: spacing.xl }}>
        {ladefehler ? (
          // Ein Ladefehler ist kein Urteil ueber die Einladung — der einzig
          // sinnvolle naechste Schritt ist, es nochmal zu versuchen.
          <Button variant="primary" label="Nochmal versuchen" onPress={() => setVersuch((v) => v + 1)} />
        ) : offen && !fehler ? (
          <Button variant="primary" label="Reise beitreten" onPress={() => void beitreten()} loading={laedt} />
        ) : (
          <Button variant="secondary" label="Zu meinen Reisen" onPress={() => router.replace('/reise')} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.s },
});
