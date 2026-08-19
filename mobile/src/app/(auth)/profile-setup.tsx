import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { AvatarSheetInhalt, AvatarWaehler } from '@/components/AvatarWaehler';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { AvatarZuschnitt } from '@/components/AvatarZuschnitt';
import { setzeAvatar } from '@/features/auth/avatarApi';
import type { Ausschnitt } from '@/features/auth/zuschnitt';
import { createProfile, validateDisplayName, validateUsername } from '@/features/auth/profileApi';

export default function ProfileSetupScreen() {
  const { colors } = useTheme();
  const oben = useTopInset(spacing.xxl);
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
  // Der gewählte Ausschnitt gehört zum gewählten Bild und muss deshalb bis zum
  // Absenden mitwandern: hochgeladen wird hier erst in `submit`, weil die
  // Profilzeile vorher noch nicht existiert.
  const [bildAusschnitt, setBildAusschnitt] = useState<Ausschnitt | null>(null);
  // Das eben gewählte Bild, solange sein Ausschnitt noch bestimmt wird.
  const [zuschnitt, setZuschnitt] = useState<
    { uri: string; breite: number; hoehe: number } | null
  >(null);
  // Der Screen hält den Zustand des Sheets, nicht der Kreis: das Sheet legt
  // sich per StyleSheet.absoluteFill über seinen Elternteil und muss deshalb
  // neben dem Formular stehen, nicht darin (Begründung in AvatarWaehler.tsx).
  const [bildSheetSichtbar, setBildSheetSichtbar] = useState(false);

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
      const ergebnis = await setzeAvatar(userId, bildUri, null, bildAusschnitt ?? undefined);
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
    // Zwei Ebenen statt einer: das Formular trägt die Innenabstände (und wäre
    // als Elternteil des Sheets ein 24-px-eingerücktes Band mitten im Screen),
    // dieser Rahmen hier trägt nur Fläche und Höhe und ist der Elternteil, den
    // `StyleSheet.absoluteFill` im Sheet meint. Dieselbe Aufteilung wie in
    // profil.tsx, dort mit einer ScrollView statt des Formulars.
    <View style={[styles.rahmen, { backgroundColor: colors['bg-0'] }]}>
      <View testID="onboarding-formular" style={[styles.formular, { paddingTop: oben }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Fast geschafft</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          So sehen dich deine Freunde im Recap.
        </Text>
        <View style={styles.bildZeile}>
          <AvatarWaehler
            name={displayName}
            avatarKey={null}
            lokaleUri={bildUri}
            onOeffnen={() => setBildSheetSichtbar(true)}
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

      <Sheet sichtbar={bildSheetSichtbar} titel="Profilbild" onSchliessen={() => setBildSheetSichtbar(false)}>
        <AvatarSheetInhalt
          avatarKey={null}
          lokaleUri={bildUri}
          onGewaehlt={(uri, breite, hoehe) => setZuschnitt({ uri, breite, hoehe })}
          onEntfernen={() => {
            setBildUri(null);
            setBildAusschnitt(null);
          }}
          onSchliessen={() => setBildSheetSichtbar(false)}
        />
      </Sheet>

      {/* Wie im Profil-Tab: der Ausschnitt wird in der App gewählt, seit
          `allowsEditing` den Bildwähler an grossen Bildern scheitern liess. */}
      {zuschnitt && (
        <AvatarZuschnitt
          uri={zuschnitt.uri}
          breite={zuschnitt.breite}
          hoehe={zuschnitt.hoehe}
          onAbbrechen={() => setZuschnitt(null)}
          onFertig={(bereich) => {
            setBildUri(zuschnitt.uri);
            setBildAusschnitt(bereich);
            setZuschnitt(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // `rahmen` trägt nur Fläche und Höhe — er ist der Bezugsrahmen des Sheets
  // und darf deshalb KEINE Innenabstände haben, sonst sässe das Sheet 24 px
  // vom Rand entfernt. Alles Formularhafte (Polster, Abstände) liegt eine
  // Ebene tiefer in `formular`; zusammen ergeben sie exakt die Masse, die
  // vorher am einzelnen `screen`-Style hingen.
  rahmen: { flex: 1 },
  formular: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  bildZeile: { alignItems: 'center', gap: spacing.s },
});
