import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { AvatarWaehler } from '@/components/AvatarWaehler';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useAuth } from '@/features/auth/AuthProvider';
import { setzeAvatar } from '@/features/auth/avatarApi';
import { createProfile, validateDisplayName, validateUsername } from '@/features/auth/profileApi';

export default function ProfileSetupScreen() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xxl);
  const { userId, refreshProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [displayNameError, setDisplayNameError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [formularFehler, setFormularFehler] = useState<string | null>(null);
  // Nur die lokale URI, solange die Profilzeile noch nicht existiert. Anders
  // als im Profil-Tab (Task 6) gibt es hier noch nichts, was ein Upload
  // sofort persistieren könnte — der Upload folgt erst in submit().
  const [bildUri, setBildUri] = useState<string | null>(null);

  const submit = async () => {
    const uErr = validateUsername(username);
    const dErr = validateDisplayName(displayName);
    setUsernameError(uErr ?? undefined);
    setDisplayNameError(dErr ?? undefined);
    setFormularFehler(null);
    if (uErr || dErr || !userId) return;
    setLoading(true);

    // Das Bild wird erst hier hochgeladen, nicht schon bei der Auswahl: vorher
    // gibt es die Profilzeile noch nicht, und ein Abbruch des Onboardings
    // hinterliesse ein Objekt, das zu niemandem gehört.
    //
    // Scheitert der Upload, geht es OHNE Bild weiter. Der Name ist das
    // Pflichtfeld, das Bild die Zugabe; jemanden am Onboarding scheitern zu
    // lassen, weil ein Foto nicht durchkam, wäre die falsche Gewichtung.
    let avatarKey: string | null = null;
    if (bildUri) {
      const ergebnis = await setzeAvatar(userId, bildUri, null);
      avatarKey = ergebnis.avatarKey;
    }
    // Achtung: setzeAvatar() setzt intern `profiles.avatar_key` per UPDATE —
    // hier trifft das auf null Zeilen, weil die Zeile noch nicht existiert.
    // Das ist kein Fehler (ein UPDATE ohne Treffer liefert keinen), und der
    // zurückgegebene Schlüssel stimmt trotzdem, weil er VOR dem Upload
    // gebildet wird (neuerAvatarSchluessel). Der Wert landet erst über
    // createProfile unten tatsächlich in der Zeile.

    const { error, feld } = await createProfile(userId, username, displayName, avatarKey);
    setLoading(false);
    if (error) {
      if (feld === 'username') return setUsernameError(error);
      return setFormularFehler(error);
    }
    await refreshProfile(); // Guard leitet zu den Tabs weiter
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'], paddingTop: oben }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Fast geschafft</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        So sehen dich deine Freunde im Recap.
      </Text>
      <View style={styles.bildZeile}>
        <AvatarWaehler
          name={displayName}
          avatarKey={null}
          lokaleUri={bildUri}
          onGewaehlt={setBildUri}
          onEntfernen={() => setBildUri(null)}
        />
        <Text style={[type.secondary, { color: colors['text-2'] }]}>Profilbild (optional)</Text>
      </View>
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
      {formularFehler && (
        <Text style={[type.body, { color: colors.danger }]}>{formularFehler}</Text>
      )}
      <Button variant="primary" label="Los geht's" onPress={submit} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  bildZeile: { alignItems: 'center', gap: spacing.s },
});
