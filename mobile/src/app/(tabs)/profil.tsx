import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { AvatarWaehler } from '@/components/AvatarWaehler';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useAuth } from '@/features/auth/AuthProvider';
import { entferneAvatar, setzeAvatar } from '@/features/auth/avatarApi';
import { fetchOwnProfile, type Profile } from '@/features/auth/profileApi';
import { signOut } from '@/features/auth/authApi';
import { nurUeberWlan, setzeNurUeberWlan } from '@/features/moments/einstellungen';
import { holeLoeschZahlen, loescheKonto, zahlenText, type LoeschZahlen } from '@/features/konto/kontoApi';

// Task 9, Phase 6: der destruktive Bestätigungsknopf im Löschdialog. Kein
// Filled-Button (DESIGN-LANGUAGE §4 kennt nur `accent` als Fläche für einen
// Primär-Button, ein zweiter, fest verdrahteter Füllton hätte keine
// Grundlage im Styleguide), stattdessen dieselbe Outline-Archetype wie
// `Button variant="secondary"`, nur in `danger` statt `text-1` eingefärbt.
// Gleiche Begründung wie die bereits bestehenden danger-Textlinks
// (TeilenSheetInhalt „Link deaktivieren", MeldungZeile „Moment entfernen").
function GefahrKnopf({
  label, onPress, disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <PressScale
      testID="konto-endgueltig-loeschen"
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={() => {
        if (!disabled) onPress();
      }}
    >
      <View style={[styles.gefahrKnopf, { borderColor: colors.danger }]}>
        {disabled ? (
          <ActivityIndicator testID="konto-loeschen-laeuft" color={colors.danger} size="small" />
        ) : (
          <Text style={[type.bodyMedium, { color: colors.danger }]}>{label}</Text>
        )}
      </View>
    </PressScale>
  );
}

export default function ProfilScreen() {
  const { colors } = useTheme();
  // Der Screen wird jetzt von oben nach unten gelesen (Bild, Name, Einstellungen),
  // nicht mehr vertikal zentriert, deshalb dieselbe Oberkante wie Reise- und
  // Recap-Tab: das Bild soll nicht hinter Statusleiste oder Dynamic Island geraten.
  //
  // Plus einen Rasterschritt (§3: 4 · 8 · 12 · 16 · 24 · 32 · 48) obendrauf, weil
  // der freigestellte Reisepass ohne Rahmen anfängt und dadurch höher wirkt als
  // eine Karte an derselben Kante. ADDIERT statt als grössere Basis: `useOberkante`
  // nimmt das Maximum aus Basis und Systembereich, und der ist auf Geräten mit
  // Insel ohnehin schon grösser (59 + 16), eine Basis von 48 statt 32 bliebe dort
  // also wirkungslos.
  const oben = useOberkante(spacing.xl) + spacing.l;
  const { userId } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nurWlan, setNurWlan] = useState(false);

  // Task 9: Konto-Löschung. `zahlenPhase`/`zahlen` trennen "noch nicht
  // geladen" von "geladen" so scharf, dass der Bestätigungsknopf STRUKTURELL
  // nicht existiert, bevor `zahlen` feststeht (Brief, wörtlich: "Ohne
  // geladene Zahlen darf nicht bestätigt werden können."), kein blosses
  // `disabled`, das sich vergessen liesse, sondern ein fehlender Zweig im
  // JSX (siehe Sheet unten).
  const [loeschSheetSichtbar, setLoeschSheetSichtbar] = useState(false);
  const [zahlenPhase, setZahlenPhase] = useState<'laedt' | 'bereit' | 'fehler'>('laedt');
  const [zahlen, setZahlen] = useState<LoeschZahlen | null>(null);
  const [zahlenFehler, setZahlenFehler] = useState<string | null>(null);
  const [loeschtLaeuft, setLoeschtLaeuft] = useState(false);
  const [loeschFehler, setLoeschFehler] = useState<string | null>(null);

  // Task 6: Profilbild setzen/entfernen. `bildLaeuft` teilen sich beide
  // Vorgänge (nur einer kann gleichzeitig laufen, der Wähler ist währenddessen
  // ohnehin geschlossen), `bildFehler` steht unter dem Kreis, bis der nächste
  // Versuch ihn löscht.
  const [bildLaeuft, setBildLaeuft] = useState(false);
  const [bildFehler, setBildFehler] = useState<string | null>(null);

  useEffect(() => {
    if (userId) void fetchOwnProfile(userId).then(setProfile);
  }, [userId]);

  // Task 10: der gespeicherte Stand lädt einmalig beim Öffnen, der Screen
  // hat kein Fokus-Refresh-Muster wie reise/[id]/index.tsx, weil hier nichts
  // ausserhalb der App selbst den Wert verändern kann.
  useEffect(() => {
    void nurUeberWlan().then(setNurWlan);
  }, []);

  // Sofort sichtbar (kein Warten auf den Schreibvorgang), ein liegen-
  // gebliebener Schreibfehler in AsyncStorage soll den Schalter nicht
  // zurückspringen lassen, siehe einstellungen.ts.
  const umschalten = (wert: boolean) => {
    setNurWlan(wert);
    void setzeNurUeberWlan(wert);
  };

  // Öffnet den Dialog und holt die Zahlen SOFORT, es gibt keinen Weg, den
  // Dialog ohne diesen Aufruf zu öffnen, also auch keinen Weg, die
  // Bestätigung zu sehen, bevor die Zahlen unterwegs sind.
  const kontoLoeschenOeffnen = () => {
    setLoeschSheetSichtbar(true);
    setZahlenPhase('laedt');
    setZahlen(null);
    setZahlenFehler(null);
    setLoeschFehler(null);
    void holeLoeschZahlen().then(({ data, error }) => {
      if (error || !data) {
        setZahlenFehler(error ?? 'Die Zahlen konnten nicht ermittelt werden. Probier es gleich nochmal.');
        setZahlenPhase('fehler');
        return;
      }
      setZahlen(data);
      setZahlenPhase('bereit');
    });
  };

  const kontoLoeschenSchliessen = () => setLoeschSheetSichtbar(false);

  // Nach Erfolg: abmelden und zurück auf den Welcome-Screen (Brief, wörtlich).
  // signOut() räumt zusätzlich den Push-Token auf (RLS-Delete, das nach
  // erfolgreicher Kontolöschung ohnehin auf 0 Zeilen trifft, kein Fehler,
  // DELETE ist idempotent) und meldet lokal ab; die eigentliche Navigation
  // übernimmt danach der globale Guard im Root-Layout (resolveRoute('signedOut')
  // → '/welcome'), genau wie beim normalen «Abmelden»-Knopf unten, kein
  // zweiter, redundanter router.replace() hier.
  const kontoLoeschen = async () => {
    setLoeschtLaeuft(true);
    setLoeschFehler(null);
    const { error } = await loescheKonto();
    if (error) {
      setLoeschtLaeuft(false);
      setLoeschFehler(error);
      return;
    }
    await signOut();
  };

  // Der neue Schlüssel wird lokal in den State geschrieben, statt das Profil
  // neu zu laden: die Antwort von setzeAvatar IST der neue Stand, ein zweiter
  // Rundgang zur Datenbank brächte dasselbe Ergebnis eine Netzlatenz später.
  const bildSetzen = async (uri: string) => {
    if (!userId) return;
    setBildLaeuft(true);
    setBildFehler(null);
    const { avatarKey, error } = await setzeAvatar(userId, uri, profile?.avatar_key ?? null);
    setBildLaeuft(false);
    // Bei einem Fehler bleibt das bisherige Bild stehen: der Aufruf schreibt
    // NICHTS in den State, `avatarKey` ist hier ohnehin `null` und würde ein
    // vorhandenes Bild sonst fälschlich löschen.
    if (error) return setBildFehler(error);
    setProfile((vorher) => (vorher ? { ...vorher, avatar_key: avatarKey } : vorher));
  };

  const bildEntfernen = async () => {
    if (!userId) return;
    setBildLaeuft(true);
    setBildFehler(null);
    const { error } = await entferneAvatar(userId, profile?.avatar_key ?? null);
    setBildLaeuft(false);
    if (error) return setBildFehler(error);
    setProfile((vorher) => (vorher ? { ...vorher, avatar_key: null } : vorher));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      {/* Scrollbar statt fester Höhe: mit dem Bild darüber wird der Inhalt auf
          kleinen Geräten länger als der Screen, und die destruktive Zone unten
          darf nie ausserhalb des Sichtbaren enden. */}
      <ScrollView contentContainerStyle={[styles.inhalt, { paddingTop: oben }]}>
        {/* Kopfbild des Profil-Tabs. Anders als Camper, Filmrolle und Flugticket
            steht dieses Bild nicht in einem Leerzustand, sondern über gefülltem
            Inhalt. Freigestellt auf `bg-0`, also ohne Rahmen, Radius und
            Schatten, und aus dem Accessibility-Baum genommen: es sagt nichts,
            was der Name darunter nicht schon sagt. */}
        <Image
          testID="profil-reisepass"
          source={require('@/assets/images/reisepass-rot-transparent.png')}
          style={styles.reisepass}
          contentFit="contain"
          accessible={false}
        />
        {/* `styles.zeile`/`zeileText` statt eigener `profilZeile`/`profilText`:
            Bild-links-Text-rechts ist exakt dieselbe Zeilenform wie die
            WLAN-Karte darunter, wertgleich bis auf den Token (`spacing.m`
            Aussenabstand, `spacing.xs` innen). Zwei Stylesheet-Einträge mit
            identischem Inhalt wären keine zweite Bedeutung, nur ein zweiter
            Name für dieselbe. */}
        <Card style={styles.zeile}>
          <AvatarWaehler
            name={profile?.display_name ?? ''}
            avatarKey={profile?.avatar_key ?? null}
            laeuft={bildLaeuft}
            onGewaehlt={(uri) => void bildSetzen(uri)}
            onEntfernen={() => void bildEntfernen()}
          />
          <View style={styles.zeileText}>
            <Text style={[type.h1, { color: colors['text-1'] }]}>{profile?.display_name ?? '…'}</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>
              {profile ? `@${profile.username}` : ''}
            </Text>
          </View>
        </Card>
        {bildFehler && (
          <Text style={[type.secondary, { color: colors.danger }]}>{bildFehler}</Text>
        )}
        <Card style={styles.zeile}>
          <View style={styles.zeileText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Nur über WLAN einsenden</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>
              Spart mobile Daten. Deine Momente warten, bis du wieder im WLAN bist.
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

        {/* Task 9: "unter allem anderen, in danger" (Brief, wörtlich),
            eigener Abstand, damit die destruktive Zone sich sichtbar vom
            Rest absetzt, ohne eine zweite Fläche/Karte einzuführen. */}
        <PressScale
          testID="konto-loeschen-oeffnen"
          accessibilityRole="button"
          onPress={kontoLoeschenOeffnen}
        >
          <Text style={[type.bodyMedium, styles.kontoLoeschenText, { color: colors.danger }]}>
            Konto löschen
          </Text>
        </PressScale>
      </ScrollView>

      {/* Geschwister der ScrollView, nicht ihr Kind: das Sheet legt sich per
          StyleSheet.absoluteFill über seinen Elternteil, im Scroll-Inhalt läge
          es am Inhalt statt am Screen. */}
      <Sheet sichtbar={loeschSheetSichtbar} titel="Konto löschen?" onSchliessen={kontoLoeschenSchliessen}>
        {zahlenPhase === 'laedt' && (
          <View style={styles.zahlenLaedt}>
            <ActivityIndicator testID="loeschen-zahlen-laedt" color={colors['text-1']} />
          </View>
        )}
        {zahlenPhase === 'fehler' && (
          <View style={{ gap: spacing.base }}>
            <Text style={[type.body, { color: colors.danger }]}>{zahlenFehler}</Text>
            <Button variant="secondary" label="Nochmal versuchen" onPress={kontoLoeschenOeffnen} />
          </View>
        )}
        {/* Der Bestätigungsknopf existiert NUR in diesem Zweig, ohne
            geladene Zahlen (Phasen 'laedt'/'fehler') gibt es ihn im Baum
            schlicht nicht (Brief, siehe Kommentar am State oben). */}
        {zahlenPhase === 'bereit' && zahlen && (
          <View style={{ gap: spacing.base }}>
            <Text style={[type.body, { color: colors['text-2'] }]}>{zahlenText(zahlen)}</Text>
            {loeschFehler && <Text style={[type.body, { color: colors.danger }]}>{loeschFehler}</Text>}
            <GefahrKnopf
              label="Konto endgültig löschen"
              onPress={() => void kontoLoeschen()}
              disabled={loeschtLaeuft}
            />
            <Button
              variant="secondary"
              label="Abbrechen"
              onPress={kontoLoeschenSchliessen}
              disabled={loeschtLaeuft}
            />
          </View>
        )}
      </Sheet>
    </View>
  );
}

// Grösser als die 160 der drei Leerzustands-Bilder (Camper, Filmrolle,
// Flugticket), obwohl es über gefülltem Inhalt steht: der Reisepass steht
// hochkant und füllt sein quadratisches Bildfeld nur etwa zur halben Breite,
// bei gleicher Kantenlänge wöge er also sichtbar leichter als die anderen
// drei. Bei 1254 px Quelle reicht das ohne @2x/@3x bis zu einem 3x-Display.
const REISEPASS = 200;

const styles = StyleSheet.create({
  inhalt: {
    padding: spacing.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.l,
  },
  reisepass: { width: REISEPASS, height: REISEPASS, alignSelf: 'center' },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  zeileText: { flex: 1, gap: spacing.xs },
  kontoLoeschenText: { textDecorationLine: 'underline', textAlign: 'center' },
  zahlenLaedt: { alignItems: 'center', paddingVertical: spacing.l },
  gefahrKnopf: {
    height: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
});
