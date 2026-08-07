import { useEffect, useState } from 'react';
import { Switch, Text, View, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchOwnProfile, type Profile } from '@/features/auth/profileApi';
import { signOut } from '@/features/auth/authApi';
import { nurUeberWlan, setzeNurUeberWlan } from '@/features/moments/einstellungen';

export default function ProfilScreen() {
  const { colors } = useTheme();
  const { userId } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nurWlan, setNurWlan] = useState(false);

  useEffect(() => {
    if (userId) void fetchOwnProfile(userId).then(setProfile);
  }, [userId]);

  // Task 10: der gespeicherte Stand lädt einmalig beim Öffnen — der Screen
  // hat kein Fokus-Refresh-Muster wie reise/[id]/index.tsx, weil hier nichts
  // ausserhalb der App selbst den Wert verändern kann.
  useEffect(() => {
    void nurUeberWlan().then(setNurWlan);
  }, []);

  // Sofort sichtbar (kein Warten auf den Schreibvorgang) — ein liegen-
  // gebliebener Schreibfehler in AsyncStorage soll den Schalter nicht
  // zurückspringen lassen, siehe einstellungen.ts.
  const umschalten = (wert: boolean) => {
    setNurWlan(wert);
    void setzeNurUeberWlan(wert);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Card style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{profile?.display_name ?? '…'}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {profile ? `@${profile.username}` : ''}
        </Text>
      </Card>
      <Card style={styles.zeile}>
        <View style={styles.zeileText}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Nur über WLAN einsenden</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            Spart mobile Daten — deine Momente warten, bis du wieder im WLAN bist.
          </Text>
        </View>
        <Switch
          value={nurWlan}
          onValueChange={umschalten}
          trackColor={{ false: colors['bg-1'], true: colors.accent }}
          thumbColor={colors['bg-0']}
          accessibilityLabel="Nur über WLAN einsenden"
        />
      </Card>
      <Button variant="secondary" label="Abmelden" onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  zeileText: { flex: 1, gap: spacing.xs },
});
