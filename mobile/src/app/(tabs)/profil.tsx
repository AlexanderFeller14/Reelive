import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, Switch, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Pencil } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { AvatarSheetContent, AvatarPicker } from '@/components/AvatarPicker';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useAuth } from '@/features/auth/AuthProvider';
import { AvatarCropper } from '@/components/AvatarCropper';
import { Input } from '@/components/Input';
import { removeAvatar, setzeAvatar } from '@/features/auth/avatarApi';
import type { Crop } from '@/features/auth/crop';
import {
  fetchOwnProfile, updateProfile, validateDisplayName, type Profile,
} from '@/features/auth/profileApi';
import { signOut } from '@/features/auth/authApi';
import { wifiOnly, setWifiOnly } from '@/features/moments/settings';
import { notificationsActive, setNotificationsActive } from '@/features/push/settings';
import { deregisterPushToken, registerPushToken } from '@/features/push/pushApi';
import { fetchDeletionCounts, deleteAccount, deletionSummaryText, type DeletionCounts } from '@/features/account/accountApi';

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
  const oben = useTopInset(spacing.xl) + spacing.l;
  const { userId } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nurWlan, setNurWlan] = useState(false);
  // Default AN wie in push/einstellungen.ts dokumentiert: die Registrierung
  // lief bisher bei jedem signedIn automatisch, der Schalter darf bestehende
  // Installationen nicht stummschalten.
  const [benachrichtigungen, setBenachrichtigungen] = useState(true);
  const [pushHinweis, setPushHinweis] = useState<string | null>(null);

  // Task 9: Konto-Löschung. `zahlenPhase`/`zahlen` trennen "noch nicht
  // geladen" von "geladen" so scharf, dass der Bestätigungsknopf STRUKTURELL
  // nicht existiert, bevor `zahlen` feststeht (Brief, wörtlich: "Ohne
  // geladene Zahlen darf nicht bestätigt werden können."), kein blosses
  // `disabled`, das sich vergessen liesse, sondern ein fehlender Zweig im
  // JSX (siehe Sheet unten).
  const [loeschSheetSichtbar, setLoeschSheetSichtbar] = useState(false);
  const [zahlenPhase, setZahlenPhase] = useState<'laedt' | 'bereit' | 'fehler'>('laedt');
  const [zahlen, setZahlen] = useState<DeletionCounts | null>(null);
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

  // «Anzeigename ändern»: KEIN Bottom-Sheet, sondern ein Vollbild-Overlay wie
  // der AvatarZuschnitt (Gerätefund + Entscheid 2026-08-13): im Sheet am
  // unteren Rand sassen die Eingabefelder genau dort, wo die Tastatur steht.
  // Im Vollbild stehen sie oben, die Tastatur hat den Platz darunter für
  // sich. Der USERNAME hat hier bewusst kein Feld (Entscheid 2026-08-13,
  // Begründung an updateProfile in profileApi.ts): fest, bis es eine
  // serverseitige Bremse gibt. Der Entwurf ist eigener State und kein
  // Schreiben in `profile`: solange nicht gespeichert ist, bleibt der
  // gespeicherte Stand die einzige Wahrheit auf dem Screen dahinter.
  const [nameEditorSichtbar, setNameEditorSichtbar] = useState(false);
  const [nameEntwurf, setNameEntwurf] = useState('');
  const [nameAnzeigeFehler, setNameAnzeigeFehler] = useState<string | undefined>();
  const [nameFormFehler, setNameFormFehler] = useState<string | null>(null);
  const [nameLaeuft, setNameLaeuft] = useState(false);
  // Nach der Server-Bestätigung, bis der Editor zu ist: der Speichern-Knopf
  // zeigt das Häkchen (Button `erfolg`) und beide Knöpfe sind gesperrt.
  const [nameGespeichert, setNameGespeichert] = useState(false);
  // Der Speicher-Moment (§5, Micro-Interaction, KEINE Inszenierung — die
  // 700–900 ms bleiben Versiegeln/Reveal vorbehalten): ein Fortschrittswert
  // treibt den Pop der Vorschau-Karte (Interpolation 1 → 1.05 → 1, dasselbe
  // Muster wie SealAnimation.tsx), danach blendet der Editor mit duration-base
  // aus. Beide als Animated.Value im State, wie PressScale und Sheet es halten.
  const [momentPop] = useState(() => new Animated.Value(0));
  const [editorDeckkraft] = useState(() => new Animated.Value(1));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (userId) void fetchOwnProfile(userId).then(setProfile);
  }, [userId]);

  // Task 10: der gespeicherte Stand lädt einmalig beim Öffnen, der Screen
  // hat kein Fokus-Refresh-Muster wie reise/[id]/index.tsx, weil hier nichts
  // ausserhalb der App selbst den Wert verändern kann. Gilt für beide
  // Schalter gleichermassen.
  useEffect(() => {
    void wifiOnly().then(setNurWlan);
    void notificationsActive().then(setBenachrichtigungen);
  }, []);

  // Sofort sichtbar (kein Warten auf den Schreibvorgang), ein liegen-
  // gebliebener Schreibfehler in AsyncStorage soll den Schalter nicht
  // zurückspringen lassen, siehe einstellungen.ts.
  const umschalten = (wert: boolean) => {
    setNurWlan(wert);
    void setWifiOnly(wert);
  };

  // Der Schalter steuert die Geräte-Registrierung: aus löscht den eigenen
  // Token (nur dieses Gerät, siehe deregistrierePushToken), an registriert
  // ihn und fragt dabei bei Bedarf die Systemberechtigung an.
  // 'fehler'/'nicht-unterstuetzt' bleiben stumm und lassen den Wunsch AN
  // stehen: das ist der Alltag in Expo Go und im Simulator (Task-4-Brief),
  // und beim nächsten App-Start versucht das Root-Layout es erneut. Nur die
  // ABGELEHNTE Berechtigung ist behebbar und bekommt deshalb Rückmeldung —
  // der Schalter springt zurück, damit er nie AN zeigt, während das System
  // nie etwas zustellen wird.
  const benachrichtigungenUmschalten = async (wert: boolean) => {
    setBenachrichtigungen(wert);
    setPushHinweis(null);
    await setNotificationsActive(wert);
    if (!wert) {
      void deregisterPushToken();
      return;
    }
    if (!userId) return;
    const ergebnis = await registerPushToken(userId);
    if (ergebnis === 'keine-berechtigung') {
      setBenachrichtigungen(false);
      await setNotificationsActive(false);
      setPushHinweis('Ohne Zugriff auf Mitteilungen geht es nicht. Du kannst das in den Einstellungen ändern.');
    }
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
    void fetchDeletionCounts().then(({ data, error }) => {
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
    const { error } = await deleteAccount();
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
  const bildSetzen = async (uri: string, ausschnitt: Crop) => {
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
    const { error } = await removeAvatar(userId, profile?.avatar_key ?? null);
    setBildLaeuft(false);
    if (error) return setBildFehler(error);
    setProfile((vorher) => (vorher ? { ...vorher, avatar_key: null } : vorher));
  };

  // Öffnet mit dem GESPEICHERTEN Wert, nicht mit einem etwaigen alten
  // Entwurf: wer den Editor zumacht und wieder öffnet, fängt beim Stand der
  // Wahrheit an, nicht bei einem halb getippten Versuch.
  const nameBearbeitenOeffnen = () => {
    if (!profile) return;
    setNameEntwurf(profile.display_name);
    setNameAnzeigeFehler(undefined);
    setNameFormFehler(null);
    // Der Editor bleibt beim Schliessen gemountet (der Screen rendert nur
    // `sichtbar=false`), die Animated-Werte überleben also — ohne Reset
    // startete das nächste Öffnen unsichtbar bzw. mitten im Pop (dieselbe
    // Falle wie beim Wisch-Offset in Sheet.tsx).
    momentPop.setValue(0);
    editorDeckkraft.setValue(1);
    setNameLaeuft(false);
    setNameGespeichert(false);
    setNameEditorSichtbar(true);
  };

  const nameSpeichern = async () => {
    if (!userId) return;
    // Dieselbe Reihenfolge wie das Onboarding (profile-setup.tsx): erst der
    // Validator mit feldgenauer Meldung, erst dann zum Server.
    const dErr = validateDisplayName(nameEntwurf);
    setNameAnzeigeFehler(dErr ?? undefined);
    setNameFormFehler(null);
    if (dErr) return;
    setNameLaeuft(true);
    const { error } = await updateProfile(userId, nameEntwurf);
    if (error) {
      setNameLaeuft(false);
      return setNameFormFehler(error);
    }
    // Wie beim Profilbild: die Antwort IST der neue Stand, kein zweiter
    // Rundgang zur Datenbank. Getrimmt wie updateProfile es schreibt.
    setProfile((vorher) => (vorher
      ? { ...vorher, display_name: nameEntwurf.trim() }
      : vorher));
    // Der Speicher-Moment. Das Häkchen löst den Spinner ab (`erfolg` sperrt
    // den Knopf weiter, ein zweiter Tap schickt also nichts erneut ab) und
    // steht sichtbar, BEVOR der Screen wechselt. Haptik light, nicht
    // success: §5 reserviert success für Versiegeln und Reveal.
    setNameLaeuft(false);
    setNameGespeichert(true);
    const schliessen = () => setNameEditorSichtbar(false);
    // Haltephase nach dem Pop (Wunsch vom 2026-08-14): das Häkchen soll
    // einen Atemzug stehen, bevor der Screen wechselt — sonst wirkt der
    // Erfolg wie weggerissen. `gentle` statt eines erfundenen Werts; die
    // Stille zählt nicht als Bewegung, deshalb gilt sie auch im
    // reduced-motion-Zweig vor dessen 200-ms-Fade.
    const halten = Animated.delay(motion.duration.gentle);
    const abgang = (dauer: number) => Animated.timing(editorDeckkraft, {
      toValue: 0,
      duration: dauer,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    });
    if (reducedMotion) {
      // §5: alles wird zu 200-ms-Fades, kein Pop.
      Animated.sequence([halten, abgang(200)]).start(schliessen);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.sequence([
      Animated.timing(momentPop, {
        toValue: 1,
        duration: motion.duration.gentle,
        easing: Easing.bezier(...motion.easeSmooth),
        useNativeDriver: true,
      }),
      halten,
      abgang(motion.duration.base),
    ]).start(schliessen);
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
          <AvatarPicker
            large
            name={profile?.display_name ?? ''}
            avatarKey={profile?.avatar_key ?? null}
            loading={bildLaeuft}
            onOpen={() => setBildSheetSichtbar(true)}
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
        {/* Die ganze Karte ist das Tap-Ziel für «Namen bearbeiten» — sie
            enthält seit dem Bildertausch kein eigenes Tap-Ziel mehr (der
            Bildwähler steht oben), ein zweites darin würde sie zerteilen
            (dieselbe Begründung wie bei der Reise-Karte in Avatar.tsx). */}
        <PressScale
          testID="name-bearbeiten-oeffnen"
          accessibilityRole="button"
          accessibilityLabel="Anzeigename ändern"
          onPress={nameBearbeitenOeffnen}
        >
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
            {/* Der Stift sagt «hier lässt sich etwas ändern», dieselbe Rolle
                wie das Kamera-Badge am Profilbild oben. Lucide-Outline, nie
                Emoji (§7); in text-2, weil er Hinweis ist, nicht Aktion —
                das Tap-Ziel bleibt die ganze Karte. Im View-Wrapper wie das
                Badge in AvatarWaehler.tsx: Lucide reicht testID nicht an den
                gerenderten Knoten durch. */}
            <View testID="name-bearbeiten-stift">
              <Pencil size={20} color={colors['text-2']} strokeWidth={1.75} />
            </View>
          </Card>
        </PressScale>
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
        <Card style={styles.zeile}>
          <View style={styles.zeileText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Benachrichtigungen</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>
              Sagt dir Bescheid, wenn in deinen Reisen etwas passiert.
            </Text>
          </View>
          <Switch
            value={benachrichtigungen}
            onValueChange={(wert) => void benachrichtigungenUmschalten(wert)}
            trackColor={{ false: colors['bg-1'], true: colors.accent }}
            thumbColor={colors['bg-0']}
            accessibilityLabel="Benachrichtigungen"
          />
        </Card>
        {pushHinweis && (
          <Text style={[type.secondary, { color: colors.danger }]}>{pushHinweis}</Text>
        )}
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
      <Sheet visible={bildSheetSichtbar} title="Profilbild" onClose={() => setBildSheetSichtbar(false)}>
        <AvatarSheetContent
          avatarKey={profile?.avatar_key ?? null}
          onSelected={(uri, breite, hoehe) => setZuschnitt({ uri, breite, hoehe })}
          onRemove={() => void bildEntfernen()}
          onClose={() => setBildSheetSichtbar(false)}
        />
      </Sheet>

      {/* «Anzeigename ändern» als Vollbild-Overlay (Begründung am State oben):
          dasselbe Muster wie der AvatarZuschnitt darunter, nur hell statt
          Kino, weil hier ein Formular steht und kein Foto (§1). Das Feld
          steht oben, die Tastatur hat den Rest des Screens für sich. */}
      {nameEditorSichtbar && (
        <Animated.View
          testID="name-editor"
          style={[styles.nameEditor, { backgroundColor: colors['bg-0'], opacity: editorDeckkraft }]}
        >
          <View style={[styles.nameEditorInhalt, { paddingTop: oben }]}>
            <Text style={[type.h1, { color: colors['text-1'] }]}>Anzeigename ändern</Text>
            {/* Live-Vorschau statt Dekoration: die Zeile, wie Freunde einen
                sehen (Kreis, Name, Handle, dieselbe Form wie die Mitglieder-
                zeile), mit dem GETIPPTEN Stand statt dem gespeicherten. ÜBER
                dem Feld (Wunsch vom 2026-08-13): erst sehen, was man ändert,
                dann ändern — und das Feld bleibt trotzdem hoch genug, um
                nicht unter die Tastatur zu geraten. */}
            <View style={styles.vorschauZone}>
              <Text style={[type.secondary, { color: colors['text-2'] }]}>
                So sehen dich deine Freunde.
              </Text>
              {/* Der Pop des Speicher-Moments: 1 → 1.05 → 1 über den halben
                  Fortschritt, Interpolation statt zweier verketteter Springs
                  (dasselbe Muster wie siegelScale in SealAnimation.tsx). */}
              <Animated.View
                style={{
                  transform: [{
                    scale: momentPop.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [1, 1.05, 1],
                    }),
                  }],
                }}
              >
                <Card testID="name-vorschau" style={styles.zeile}>
                  <Avatar name={nameEntwurf} avatarKey={profile?.avatar_key ?? null} size={44} />
                  <View style={styles.zeileText}>
                    <Text style={[type.h1, { color: colors['text-1'] }]}>
                      {nameEntwurf.trim() || '…'}
                    </Text>
                    <Text style={[type.secondary, { color: colors['text-2'] }]}>
                      {profile ? `@${profile.username}` : ''}
                    </Text>
                  </View>
                </Card>
              </Animated.View>
            </View>
            <Input
              label="Anzeigename"
              value={nameEntwurf}
              onChangeText={setNameEntwurf}
              error={nameAnzeigeFehler}
            />
            {nameFormFehler && (
              <Text style={[type.body, { color: colors.danger }]}>{nameFormFehler}</Text>
            )}
            <Button
              variant="primary"
              label="Speichern"
              onPress={() => void nameSpeichern()}
              loading={nameLaeuft}
              success={nameGespeichert}
            />
            <Button
              variant="secondary"
              label="Abbrechen"
              onPress={() => setNameEditorSichtbar(false)}
              disabled={nameLaeuft || nameGespeichert}
            />
          </View>
        </Animated.View>
      )}

      {/* Der Zuschnitt liegt über allem und ist deshalb der letzte Knoten:
          `allowsEditing` musste aus dem Bildwähler raus (es liess grosse
          Bilder scheitern), also wählt man den Ausschnitt hier. */}
      {zuschnitt && (
        <AvatarCropper
          uri={zuschnitt.uri}
          width={zuschnitt.breite}
          height={zuschnitt.hoehe}
          onCancel={() => setZuschnitt(null)}
          onDone={(bereich) => {
            const gewaehlt = zuschnitt;
            setZuschnitt(null);
            void bildSetzen(gewaehlt.uri, bereich);
          }}
        />
      )}

      <Sheet visible={loeschSheetSichtbar} title="Konto löschen?" onClose={kontoLoeschenSchliessen}>
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
            <Text style={[type.body, { color: colors['text-2'] }]}>{deletionSummaryText(zahlen)}</Text>
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
  // `absoluteFill` gespreadet wie in AvatarZuschnitt.flaeche (dort steht auch,
  // warum nicht absoluteFillObject). Die Fläche selbst kommt inline aus dem
  // Theme.
  nameEditor: { ...StyleSheet.absoluteFill },
  nameEditorInhalt: { padding: spacing.screen, gap: spacing.l },
  // Zwischen Hinweis und Feld reicht der Container-Abstand, die Zone braucht
  // nur den engen Binnenabstand zwischen Label und Karte.
  vorschauZone: { gap: spacing.s },
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
