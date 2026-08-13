import { useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// Der Bildwähler besteht aus ZWEI Teilen, die im Baum an verschiedenen Stellen
// hängen müssen — genau deshalb der Schnitt:
//
//   `AvatarWaehler`     — der 44-px-Kreis mit Kamera-Badge, ein Tap-Ziel. Er
//                         steht dort, wo das Profilbild hingehört (Profil-
//                         Karte, Onboarding-Zeile), und meldet den Tap per
//                         `onOeffnen` nach oben.
//   `AvatarSheetInhalt` — die drei Einträge samt Auswahl-Flow. Sie stehen im
//                         `Sheet`, und das `Sheet` gehört dem SCREEN.
//
// Warum das nicht eine Komponente sein kann: `Sheet` ist kein `Modal`. Seine
// Wurzel ist ein `KeyboardAvoidingView` mit `StyleSheet.absoluteFill`, sein
// Panel liegt `position:'absolute'` an `left/right/bottom: 0` (Sheet.tsx). In
// Yoga löst ein absolut positioniertes Kind gegen seinen UNMITTELBAREN
// Elternteil auf, nicht gegen den Screen. Hing das Sheet — wie bis zur
// Merge-Fixrunde — im Wrapper des Kreises, dann war es genau so gross wie
// dieser Wrapper: im Profil-Tab ein 44 px breiter, mitscrollender Streifen an
// der Stelle des Avatars, mit einem 44 × 44 grossen «Vollbild»-Hintergrund und
// negativer Restbreite für «Foto auswählen» (das Panel hat 2 × 24 px
// Innenabstand); im Onboarding ein kurzes Band mitten im Formular.
//
// Jedes andere Sheet dieser App ist Geschwister der ScrollView seines Screens
// (reise/[id]/index.tsx, recap/[id]/karte|player|uebersicht.tsx), und
// profil.tsx schreibt die Regel über seinem Lösch-Sheet sogar hin.
//
// Kein Test hatte das gefunden, und keiner konnte es: Jest führt kein
// Yoga-Layout aus, RNTL findet den Text im Elementbaum unabhängig von jeder
// Geometrie. Was sich stattdessen prüfen lässt, ist die Baumstellung selbst —
// und genau das tun die Screen-Tests jetzt (profilTab.test.tsx,
// profile-setup.test.tsx: `sheet-root` liegt NICHT in der ScrollView bzw.
// nicht in der Bildzeile).
//
// Warum die Einträge nicht einfach in beiden Screens stehen: dann stünde der
// ganze Auswahl-Flow zweimal da (Berechtigung, Zuschnitt, Abbruch,
// Fehlermeldung). Dasselbe Muster wie `TeilenSheetInhalt`
// (features/teilen/TeilenSheetInhalt.tsx): der Inhalt ist eine eigene
// Komponente, das `Sheet` steht an der Stelle, an der es hingehört.

// DESIGN-LANGUAGE §4 begrenzt Avatare auf 32–44 px. 44 ist die Obergrenze und
// zugleich das iOS-Minimum für ein Tap-Ziel — beides zusammen ist der Grund,
// warum in Karten und im Onboarding genau dieser Wert steht.
const GROESSE = 44;
const BADGE = 18;
// Die Hero-Variante des Profil-Tabs (Bildertausch 2026-08-13): dort ist der
// Kreis kein Karten-Avatar nach §4, sondern das Kopfbild des Tabs, dieselbe
// Kante wie die 160er-Leerzustandsbilder (Camper, Filmrolle, Flugticket).
// Das Badge wächst mit, 18 px an einem 160er-Kreis läse sich als Staubkorn.
const GROSS_GROESSE = 160;
const GROSS_BADGE = 32;
// Der Badge-Mittelpunkt sitzt auf dem Kreisrand bei 45°. Der Abstand zur
// Kastenkante folgt daraus: groesse − badge/2 − (groesse/2)·(1 + 1/√2),
// also −2.6 bzw. 7.4 — gerundet die beiden Werte hier. Fest notiert statt
// gerechnet, damit die bisherige Badge-Lage der 44er-Kreise exakt bleibt.
const BADGE_VERSATZ = -2;
const GROSS_BADGE_VERSATZ = 8;

// Beide Aufrufe mit denselben Optionen. `aspect` wirkt laut SDK-57-Doku nur
// unter Android; auf iOS erzwingt der System-Editor bei allowsEditing ohnehin
// ein Quadrat. Ohne Zuschnitt stünde ein Hochformat verzerrt im runden Kreis.
//
// Explizit als `ImagePicker.ImagePickerOptions` und nicht `as const`:
// `aspect` verlangt dort ein MUTABLES Tupel `[number, number]`, `as const`
// hätte es zu `readonly [1, 1]` eingefroren und liesse sich dann nicht mehr an
// launchImageLibraryAsync/launchCameraAsync übergeben (TS2345). Dieselbe Falle
// wie bei `fontVariant` in theme/tokens.ts.
// ---------------------------------------------------------------------------
// KEIN `allowsEditing`. Das ist der Kern eines Fehlers vom 2026-08-13.
// ---------------------------------------------------------------------------
// Mit `allowsEditing: true` benutzt expo-image-picker auf iOS nicht den
// modernen Foto-Picker, sondern den alten UIImagePickerController — nur der
// kann zuschneiden. Der lädt die Vorlage vollständig in den Speicher, und bei
// einem grossen Bild räumt das System ihn ab. Was in der App ankommt, ist dann
// `canceled: true`: nicht von einem echten Abbruch zu unterscheiden, ohne
// Ausnahme, ohne Meldung. Gemessen genau so — ein 1320×1320-Bild kam durch, ein
// grösseres lieferte wortlos `canceled`.
//
// Das Quadrat entsteht deshalb jetzt in der App: features/auth/avatarApi.ts
// schneidet mittig auf die kürzere Kante zu. Wer `allowsEditing` hier
// zurückholt, holt den Fehler mit zurück.
//
// `quality` bleibt bei 1: heruntergerechnet wird ohnehin in avatarApi, und eine
// zweite verlustbehaftete Stufe davor kostet nur Qualität.
const OPTIONEN: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  quality: 1,
};

// Zwei Quellen, eine Bedeutung: Der Profil-Tab kennt nur einen bereits
// GESPEICHERTEN Schlüssel (`avatarKey`), das Onboarding nur eine noch NICHT
// hochgeladene lokale Datei (`lokaleUri`), aber beides heisst dasselbe — «es
// gibt gerade ein Bild, das sich entfernen liesse». Vorher hingen
// Badge-Beschriftung und der «Bild entfernen»-Eintrag allein an `avatarKey`;
// im Onboarding ist der aber strukturell IMMER null (profile-setup.tsx), also
// blieb ein frisch gewähltes Bild dort für immer «nicht entfernbar» — ein
// Review-Fund, der genau diese Lücke aufdeckte.
//
// Als Funktion und nicht zweimal ausgeschrieben: seit dem Schnitt oben brauchen
// BEIDE Hälften die Antwort (der Kreis für sein Accessibility-Label, der
// Sheet-Inhalt für den Entfernen-Eintrag), und sie müssen dieselbe geben.
function hatProfilbild(avatarKey: string | null, lokaleUri: string | null): boolean {
  return !!avatarKey || !!lokaleUri;
}

export function AvatarWaehler({
  name, avatarKey, lokaleUri = null, onOeffnen, laeuft = false, gross = false,
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
  // Der Screen öffnet sein eigenes Sheet — dieselbe Aufteilung, die profil.tsx
  // beim Lösch-Sheet ohnehin schon fährt (`loeschSheetSichtbar`).
  onOeffnen: () => void;
  laeuft?: boolean;
  // Hero-Kopfbild des Profil-Tabs (siehe GROSS_GROESSE oben). Onboarding und
  // Karten lassen die Prop weg und bleiben bei den 44 aus §4.
  gross?: boolean;
}) {
  const { colors } = useTheme();
  const hatBild = hatProfilbild(avatarKey, lokaleUri);
  const groesse = gross ? GROSS_GROESSE : GROESSE;
  const badge = gross ? GROSS_BADGE : BADGE;
  const versatz = gross ? GROSS_BADGE_VERSATZ : BADGE_VERSATZ;

  return (
    <PressScale
      testID="avatar-waehler"
      accessibilityRole="button"
      accessibilityLabel={hatBild ? 'Profilbild ändern' : 'Profilbild hinzufügen'}
      onPress={onOeffnen}
    >
      <View>
        {lokaleUri ? (
          <View
            testID="avatar-waehler-lokal"
            style={[styles.lokalerKreis, {
              width: groesse, height: groesse,
              borderColor: colors['bg-0'], backgroundColor: colors['bg-1'],
            }]}
          >
            <Image testID="avatar-bild" source={{ uri: lokaleUri }} style={styles.lokalesBild} contentFit="cover" />
          </View>
        ) : (
          <Avatar name={name} avatarKey={avatarKey} size={groesse} />
        )}
        {/* Ohne dieses Badge liest sich der Kreis als blosse Anzeige. Es
            sagt «hier lässt sich etwas ändern», ohne eine zweite Zeile Text.
            Die Icon-Grösse folgt dem Badge im Verhältnis der 18er-Fassung. */}
        <View
          testID="avatar-waehler-badge"
          style={[styles.badge, {
            width: badge, height: badge, right: versatz, bottom: versatz,
            backgroundColor: colors.accent, borderColor: colors['bg-0'],
          }]}
        >
          <Camera size={gross ? 16 : 10} color={colors['on-accent']} strokeWidth={1.75} />
        </View>
        {laeuft && (
          <View style={[styles.spinner, { backgroundColor: colors['bg-0'] }]}>
            <ActivityIndicator testID="avatar-laeuft" size="small" color={colors['text-1']} />
          </View>
        )}
      </View>
    </PressScale>
  );
}

// Gehört in ein `<Sheet titel="Profilbild">` des Screens. Rendert nur die
// Einträge; Höhe, Griff, Hintergrund und das Schliessen per Wisch macht Sheet.
export function AvatarSheetInhalt({
  avatarKey, lokaleUri = null, onGewaehlt, onEntfernen, onSchliessen,
}: {
  avatarKey: string | null;
  lokaleUri?: string | null;
  // Die Masse kommen mit, weil der Zuschnitt-Screen sie braucht und der
  // Bildwähler sie ohnehin liefert. Sie nachträglich noch einmal zu messen
  // hiesse, ein grosses Original ein zweites Mal zu dekodieren.
  onGewaehlt: (lokaleUri: string, breite: number, hoehe: number) => void;
  onEntfernen: () => void;
  onSchliessen: () => void;
}) {
  const { colors } = useTheme();
  // Kein Zurücksetzen beim Öffnen nötig: `Sheet` gibt `null` zurück, solange
  // es unsichtbar ist (Sheet.tsx), diese Komponente wird dabei ausgehängt und
  // startet beim nächsten Öffnen mit frischem State.
  const [fehler, setFehler] = useState<string | null>(null);
  const hatBild = hatProfilbild(avatarKey, lokaleUri);

  const waehlen = async (quelle: 'galerie' | 'kamera') => {
    setFehler(null);
    const recht = quelle === 'galerie'
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (!recht.granted) {
      // Das Sheet bleibt mit Absicht OFFEN: die Meldung steht darin, zwischen
      // den Einträgen, und wäre auf dem Screen darunter vom Hintergrund des
      // Sheets verdeckt. Spec §5.2 verlangt «eine Meldung im Sheet statt eines
      // stummen Nichts» — bis zur Merge-Fixrunde stand der Text ausserhalb,
      // also unter dem Backdrop, und war damit genau dieses stumme Nichts.
      setFehler(
        quelle === 'galerie'
          ? 'Ohne Zugriff auf deine Fotos geht es nicht. Du kannst das in den Einstellungen ändern.'
          : 'Ohne Zugriff auf die Kamera geht es nicht. Du kannst das in den Einstellungen ändern.'
      );
      return;
    }

    // try/catch, weil der Aufrufer `void waehlen(…)` schreibt: eine geworfene
    // Ausnahme wäre sonst eine unbehandelte Promise-Ablehnung und damit für
    // die Person vor dem Gerät ein stummes Nichts. Genau das war beim Fehler
    // vom 2026-08-13 der Grund, warum nichts zu sehen war.
    let ergebnis: ImagePicker.ImagePickerResult;
    try {
      ergebnis = quelle === 'galerie'
        ? await ImagePicker.launchImageLibraryAsync(OPTIONEN)
        : await ImagePicker.launchCameraAsync(OPTIONEN);
    } catch (fehlerObjekt) {
      console.error('[AvatarWaehler] Bildwaehler hat geworfen', fehlerObjekt);
      setFehler('Das Bild liess sich nicht öffnen. Probier es nochmal oder nimm ein anderes.');
      return;
    }

    onSchliessen();
    // Abbruch ist kein Fehler: das Sheet schliesst, sonst nichts.
    //
    // Achtung, hier steckt eine Grenze der Plattform: Ein gescheiterter
    // Bildwähler meldet sich GENAUSO — `canceled: true`, ohne Ausnahme. Die
    // beiden Fälle sind an dieser Stelle nicht auseinanderzuhalten, deshalb
    // steht hier auch keine Fehlermeldung: Sie träfe jeden echten Abbruch mit.
    // Der Weg dagegen ist, das Scheitern gar nicht erst zu provozieren — siehe
    // die Begründung bei OPTIONEN, warum `allowsEditing` fehlt.
    if (ergebnis.canceled || !ergebnis.assets?.[0]) return;
    const gewaehlt = ergebnis.assets[0];
    onGewaehlt(gewaehlt.uri, gewaehlt.width, gewaehlt.height);
  };

  return (
    <>
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
      {hatBild && (
        <PressScale
          accessibilityRole="button"
          onPress={() => {
            onSchliessen();
            onEntfernen();
          }}
        >
          <Text style={[type.bodyMedium, styles.eintrag, { color: colors.danger }]}>
            Bild entfernen
          </Text>
        </PressScale>
      )}
      {fehler && (
        <Text testID="avatar-waehler-fehler" style={[type.secondary, { color: colors.danger }]}>
          {fehler}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // Gleiche Form wie Avatar/kreis() (2 px Ring, rund), aber hier lokal statt
  // importiert: `Avatar` baut seine Kreisform intern über avatarUrl(avatarKey),
  // das für eine lokale Datei-URI nicht passt (die Funktion erwartet einen
  // Storage-Schlüssel, keine file://-URI). Die Kantenlänge kommt inline aus
  // `groesse`, weil sie seit der Hero-Variante zwei Werte kennt.
  lokalerKreis: {
    borderRadius: radius.pill,
    borderWidth: 2, overflow: 'hidden',
  },
  lokalesBild: { width: '100%', height: '100%' },
  // Masse und Lage kommen inline (badge/versatz), Begründung bei den
  // Konstanten oben.
  badge: {
    position: 'absolute',
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
});
