import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchOwnProfile, type Profile } from '@/features/auth/profileApi';
import { signOut } from '@/features/auth/authApi';

export default function ProfilScreen() {
  const { colors } = useTheme();
  const { userId } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (userId) void fetchOwnProfile(userId).then(setProfile);
  }, [userId]);

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Card style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{profile?.display_name ?? '…'}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {profile ? `@${profile.username}` : ''}
        </Text>
      </Card>
      <Button variant="secondary" label="Abmelden" onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
