import { useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// DESIGN-LANGUAGE §4 begrenzt Avatare auf 32–44 px. 44 ist die Obergrenze und
// zugleich das iOS-Minimum für ein Tap-Ziel — beides zusammen ist der Grund,
// warum hier genau dieser Wert steht und kein grösserer Profil-Kreis.
const GROESSE = 44;
const BADGE = 18;

// Beide Aufrufe mit denselben Optionen. `aspect` wirkt laut SDK-57-Doku nur
// unter Android; auf iOS erzwingt der System-Editor bei allowsEditing ohnehin
// ein Quadrat. Ohne Zuschnitt stünde ein Hochformat verzerrt im runden Kreis.
//
// Explizit als `ImagePicker.ImagePickerOptions` und nicht `as const`:
// `aspect` verlangt dort ein MUTABLES Tupel `[number, number]`, `as const`
// hätte es zu `readonly [1, 1]` eingefroren und liesse sich dann nicht mehr an
// launchImageLibraryAsync/launchCameraAsync übergeben (TS2345). Dieselbe Falle
// wie bei `fontVariant` in theme/tokens.ts.
const OPTIONEN: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
};

export function AvatarWaehler({
  name, avatarKey, lokaleUri = null, onGewaehlt, onEntfernen, laeuft = false,
}: {
  name: string;
  avatarKey: string | null;
  // Nur das Onboarding setzt dies (profile-setup.tsx): dort existiert die
  // Profilzeile noch nicht, wenn ein Bild gewählt wird, also gibt es noch
  // keinen `avatarKey`, unter dem sich das Bild laden liesse — nur die
  // lokale Datei-URI aus dem Bildwähler. Ist die Prop gesetzt, zeigt der
  // Kreis dieses lokale Bild direkt, ohne den Umweg über `Avatar`/`avatarUrl`.
  // Der Profil-Tab lässt die Prop weg und verhält sich unverändert.
  lokaleUri?: string | null;
  onGewaehlt: (lokaleUri: string) => void;
  onEntfernen: () => void;
  laeuft?: boolean;
}) {
  const { colors } = useTheme();
  const [offen, setOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const oeffnen = () => {
    setFehler(null);
    setOffen(true);
  };

  const waehlen = async (quelle: 'galerie' | 'kamera') => {
    setFehler(null);
    const recht = quelle === 'galerie'
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (!recht.granted) {
      setFehler(
        quelle === 'galerie'
          ? 'Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.'
          : 'Ohne Zugriff auf die Kamera geht es nicht. Du kannst das in den Einstellungen ändern.'
      );
      return;
    }

    const ergebnis = quelle === 'galerie'
      ? await ImagePicker.launchImageLibraryAsync(OPTIONEN)
      : await ImagePicker.launchCameraAsync(OPTIONEN);

    // Abbruch ist kein Fehler: das Sheet schliesst, sonst nichts.
    if (ergebnis.canceled || !ergebnis.assets?.[0]) {
      setOffen(false);
      return;
    }
    setOffen(false);
    onGewaehlt(ergebnis.assets[0].uri);
  };

  return (
    <View>
      <PressScale
        testID="avatar-waehler"
        accessibilityRole="button"
        accessibilityLabel={avatarKey ? 'Profilbild ändern' : 'Profilbild hinzufügen'}
        onPress={oeffnen}
      >
        <View>
          {lokaleUri ? (
            <View style={[styles.lokalerKreis, { borderColor: colors['bg-0'], backgroundColor: colors['bg-1'] }]}>
              <Image testID="avatar-bild" source={{ uri: lokaleUri }} style={styles.lokalesBild} contentFit="cover" />
            </View>
          ) : (
            <Avatar name={name} avatarKey={avatarKey} size={GROESSE} />
          )}
          {/* Ohne dieses Badge liest sich der Kreis als blosse Anzeige. Es
              sagt «hier lässt sich etwas ändern», ohne eine zweite Zeile Text. */}
          <View
            testID="avatar-waehler-badge"
            style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors['bg-0'] }]}
          >
            <Camera size={10} color={colors['on-accent']} strokeWidth={1.75} />
          </View>
          {laeuft && (
            <View style={[styles.spinner, { backgroundColor: colors['bg-0'] }]}>
              <ActivityIndicator testID="avatar-laeuft" size="small" color={colors['text-1']} />
            </View>
          )}
        </View>
      </PressScale>

      {fehler && (
        <Text style={[type.secondary, styles.fehler, { color: colors.danger }]}>{fehler}</Text>
      )}

      <Sheet sichtbar={offen} titel="Profilbild" onSchliessen={() => setOffen(false)}>
        <PressScale accessibilityRole="button" onPress={() => void waehlen('galerie')}>
          <Text style={[type.bodyMedium, styles.eintrag, { color: colors['text-1'] }]}>
            Foto auswählen
          </Text>
        </PressScale>
        <PressScale accessibilityRole="button" onPress={() => void waehlen('kamera')}>
          <Text style={[type.bodyMedium, styles.eintrag, { color: colors['text-1'] }]}>
            Selfie aufnehmen
          </Text>
        </PressScale>
        {avatarKey && (
          <PressScale
            accessibilityRole="button"
            onPress={() => {
              setOffen(false);
              onEntfernen();
            }}
          >
            <Text style={[type.bodyMedium, styles.eintrag, { color: colors.danger }]}>
              Bild entfernen
            </Text>
          </PressScale>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  // Gleiche Masse wie Avatar/kreis() (GROESSE=44, 2 px Ring, rund), aber
  // hier lokal statt importiert: `Avatar` baut seine Kreisform intern über
  // avatarUrl(avatarKey), das für eine lokale Datei-URI nicht passt (die
  // Funktion erwartet einen Storage-Schlüssel, keine file://-URI).
  lokalerKreis: {
    width: GROESSE, height: GROESSE, borderRadius: radius.pill,
    borderWidth: 2, overflow: 'hidden',
  },
  lokalesBild: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: BADGE,
    height: BADGE,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    // absoluteFillObject gibt es in dieser RN-Version nicht (mehr) — nur
    // `absoluteFill` selbst, ein zur Laufzeit gewöhnliches (im Dev-Build
    // eingefrorenes) Objekt, das sich genauso spreaden lässt.
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  eintrag: { paddingVertical: spacing.m },
  fehler: { marginTop: spacing.xs },
});
