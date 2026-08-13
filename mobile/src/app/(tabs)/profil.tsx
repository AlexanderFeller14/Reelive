import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { AvatarSheetInhalt, AvatarWaehler } from '@/components/AvatarWaehler';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useAuth } from '@/features/auth/AuthProvider';
import { AvatarZuschnitt } from '@/components/AvatarZuschnitt';
import { entferneAvatar, setzeAvatar } from '@/features/auth/avatarApi';
import type { Ausschnitt } from '@/features/auth/zuschnitt';
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
  // das freigestellte Kopfbild ohne Rahmen anfängt und dadurch höher wirkt als
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
  //
  // `bildSheetSichtbar` liegt aus demselben Grund HIER wie
  // `loeschSheetSichtbar` darüber: das Sheet muss ein Geschwister der
  // ScrollView sein (Begründung am Lösch-Sheet unten und ausführlich in
  // AvatarWaehler.tsx), also hält der Screen seinen Zustand, nicht der Kreis
  // oben in der Karte.
  const [bildSheetSichtbar, setBildSheetSichtbar] = useState(false);
  const [bildLaeuft, setBildLaeuft] = useState(false);
  // Das gewählte, noch nicht zugeschnittene Bild. Solange es steht, liegt der
  // Zuschnitt-Screen über allem.
  const [zuschnitt, setZuschnitt] = useState<
    { uri: string; breite: number; hoehe: number } | null
  >(null);
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
  const bildSetzen = async (uri: string, ausschnitt: Ausschnitt) => {
    if (!userId) return;
    setBildLaeuft(true);
    setBildFehler(null);
    const { avatarKey, error } = await setzeAvatar(
      userId, uri, profile?.avatar_key ?? null, ausschnitt,
    );
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
      <ScrollView testID="profil-inhalt" contentContainerStyle={[styles.inhalt, { paddingTop: oben }]}>
        {/* Kopfbild des Profil-Tabs, seit dem Bildertausch vom 2026-08-13 das
            eigene Profilbild statt des Reisepasses: gross, mittig, und
            weiterhin DAS Tap-Ziel zum Ändern — der Sheet-Zustand liegt
            unverändert beim Screen (Begründung am State oben). */}
        <View style={styles.kopfbild}>
          <AvatarWaehler
            gross
            name={profile?.display_name ?? ''}
            avatarKey={profile?.avatar_key ?? null}
            laeuft={bildLaeuft}
            onOeffnen={() => setBildSheetSichtbar(true)}
          />
        </View>
        {bildFehler && (
          <Text style={[type.secondary, { color: colors.danger }]}>{bildFehler}</Text>
        )}
        {/* `styles.zeile`/`zeileText` statt eigener `profilZeile`/`profilText`:
            Bild-links-Text-rechts ist exakt dieselbe Zeilenform wie die
            WLAN-Karte darunter, wertgleich bis auf den Token (`spacing.m`
            Aussenabstand, `spacing.xs` innen). Zwei Stylesheet-Einträge mit
            identischem Inhalt wären keine zweite Bedeutung, nur ein zweiter
            Name für dieselbe. */}
        <Card style={styles.zeile}>
          {/* Der Reisepass, klein in derselben 44er-Kante, in der vorher der
              Avatar-Kreis stand. Freigestellt auf der Karte, ohne Rahmen und
              Radius, und aus dem Accessibility-Baum genommen: er sagt nichts,
              was Name und Handle daneben nicht schon sagen. */}
          <Image
            testID="profil-reisepass"
            source={require('@/assets/images/reisepass-rot-transparent.png')}
            style={styles.reisepass}
            contentFit="contain"
            accessible={false}
          />
          <View style={styles.zeileText}>
            <Text style={[type.h1, { color: colors['text-1'] }]}>{profile?.display_name ?? '…'}</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>
              {profile ? `@${profile.username}` : ''}
            </Text>
          </View>
        </Card>
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

      {/* Beide Sheets sind Geschwister der ScrollView, nicht ihre Kinder: ein
          Sheet legt sich per StyleSheet.absoluteFill über seinen Elternteil,
          im Scroll-Inhalt läge es am Inhalt statt am Screen. Das Bild-Sheet
          hing bis zur Merge-Fixrunde im Kreis-Wrapper der Karte oben und war
          dort 44 px breit — die ausführliche Begründung steht in
          AvatarWaehler.tsx. */}
      <Sheet sichtbar={bildSheetSichtbar} titel="Profilbild" onSchliessen={() => setBildSheetSichtbar(false)}>
        <AvatarSheetInhalt
          avatarKey={profile?.avatar_key ?? null}
          onGewaehlt={(uri, breite, hoehe) => setZuschnitt({ uri, breite, hoehe })}
          onEntfernen={() => void bildEntfernen()}
          onSchliessen={() => setBildSheetSichtbar(false)}
        />
      </Sheet>

      {/* Der Zuschnitt liegt über allem und ist deshalb der letzte Knoten:
          `allowsEditing` musste aus dem Bildwähler raus (es liess grosse
          Bilder scheitern), also wählt man den Ausschnitt hier. */}
      {zuschnitt && (
        <AvatarZuschnitt
          uri={zuschnitt.uri}
          breite={zuschnitt.breite}
          hoehe={zuschnitt.hoehe}
          onAbbrechen={() => setZuschnitt(null)}
          onFertig={(bereich) => {
            const gewaehlt = zuschnitt;
            setZuschnitt(null);
            void bildSetzen(gewaehlt.uri, bereich);
          }}
        />
      )}

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

// Seit dem Bildertausch (2026-08-13) steht der Reisepass klein in der
// Namens-Karte: dieselbe 44er-Kante wie der Avatar-Kreis, der vorher dort
// stand, damit die Zeile ihre Form behält. Das grosse Kopfbild ist jetzt das
// Profilbild (AvatarWaehler `gross`, 160). Die 1254-px-Quelle ist für 44
// weit überdimensioniert, aber dieselbe Datei zweimal abzulegen wäre nur
// Gewicht im Bundle.
const REISEPASS = 44;

const styles = StyleSheet.create({
  inhalt: {
    padding: spacing.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.l,
  },
  kopfbild: { alignItems: 'center' },
  reisepass: { width: REISEPASS, height: REISEPASS },
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
