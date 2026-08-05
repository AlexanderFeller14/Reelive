import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { createProfile, validateDisplayName, validateUsername } from '@/features/auth/profileApi';

export default function ProfileSetupScreen() {
  const { colors } = useTheme();
  const { userId, refreshProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [displayNameError, setDisplayNameError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const uErr = validateUsername(username);
    const dErr = validateDisplayName(displayName);
    setUsernameError(uErr ?? undefined);
    setDisplayNameError(dErr ?? undefined);
    if (uErr || dErr || !userId) return;
    setLoading(true);
    const { error } = await createProfile(userId, username, displayName);
    setLoading(false);
    if (error) return setUsernameError(error);
    await refreshProfile(); // Guard leitet zu den Tabs weiter
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Fast geschafft</Text>
      <Input
        label="Username"
        value={username}
        onChangeText={(t) => setUsername(t.toLowerCase())}
        error={usernameError}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="lea_2026"
      />
      <Input
        label="Anzeigename"
        value={displayName}
        onChangeText={setDisplayName}
        error={displayNameError}
        placeholder="Lea"
      />
      <Button variant="primary" label="Los geht's" onPress={submit} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
