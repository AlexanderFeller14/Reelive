import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Figtree_300Light,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import {
  resolveRoute,
  isPublicArea,
  isWebLocked,
  isAreaForSignedIn,
} from '@/features/auth/guard';
import { spacing, type } from '@/theme/tokens';
import { peekRememberedInvite, discardRememberedInvite } from '@/features/trips/inviteLink';
import { redeemInvite } from '@/features/trips/tripsApi';
import { redeemPendingInvite } from '@/features/trips/joinFlow';
import * as uploadWorker from '@/features/moments/uploadWorker';
import { registerPushToken } from '@/features/push/pushApi';
import { notificationsActive } from '@/features/push/settings';
import { initErrorReporter } from '@/lib/errorReporter';

void SplashScreen.preventAutoHideAsync();

// Task 10, Phase 6: so früh wie möglich, auf Modulebene wie
// preventAutoHideAsync() oben, nicht in einem Effect, der erst nach dem
// ersten Render liefe. Blockiert den Start nicht: initFehlermelder() ist
// synchron und ohne DSN (Alltag, siehe fehlermelder.ts) ein reiner
// No-Op-Return, kein I/O.
initErrorReporter();

// Web-Hartsperre (siehe istWebGesperrt in guard.ts für die volle Begründung):
// «Reelive gibt es als App», freundlich, mit dem Wortzug-Platzhalter
// (gleiches Muster wie (auth)/welcome.tsx, echtes SVG-Asset existiert noch
// nicht), OHNE jede Login-Möglichkeit. Bewusst hier lokal statt in einer
// eigenen Datei unter components/: einziger Aufrufer, eng an das Layout
// gekoppelt (dieselbe Begründung wie KinoButton/TextLink in player.tsx).
function WebNurAppSeite() {
  const { colors } = useTheme();
  return (
    <View testID="web-nur-app-seite" style={[styles.webSperreScreen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h3, { color: colors['text-1'] }]}>Reelive</Text>
      <Text style={[type.h1, styles.webSperreText, { color: colors['text-1'] }]}>
        Reelive gibt es als App.
      </Text>
      <Text style={[type.body, styles.webSperreText, { color: colors['text-2'] }]}>
        Diese Seite lässt sich nur in der Reelive-App öffnen. Hast du einen geteilten
        Recap-Link bekommen, öffne genau den. Der funktioniert auch hier im Browser.
      </Text>
    </View>
  );
}

function Guarded() {
  const { status, userId } = useAuth();
  // Cast: mit experiments.typedRoutes engt useSegments() den Rückgabetyp auf die
  // aktuell existierenden Routen ein, segments[1] wäre sonst ein
  // Tuple-Out-of-Bounds-Fehler. Laufzeitverhalten unverändert.
  const segments = useSegments() as string[];
  const router = useRouter();
  const { colors } = useTheme();
  const area = segments[0]; // '(auth)' | '(tabs)' | 'vorschau' | 'join' | 'teilen' | undefined
  const webGesperrt = isWebLocked(Platform.OS, area);

  useEffect(() => {
    // Auf Web ausserhalb von 'teilen': kein <Stack/> (siehe Return unten),
    // also auch keine Redirect-Entscheidung nötig, der Ziel-Screen wäre
    // seinerseits ebenfalls gesperrt.
    if (webGesperrt) return;
    const target = resolveRoute(status);
    if (!target) return;
    void SplashScreen.hideAsync();
    // Der Beitritts-Screen bleibt in jedem Status stehen.
    if (isPublicArea(area)) return;
    if (status === 'signedIn' && !isAreaForSignedIn(area)) router.replace(target);
    if (status !== 'signedIn' && area !== '(auth)') router.replace(target);
    if (status === 'needsProfile' && segments[1] !== 'profile-setup') router.replace(target);
  }, [status, segments, router, webGesperrt, area]);

  // Ein vor dem Login angetippter Einladungslink wird eingelöst, sobald Session
  // UND Profil stehen, vorher gäbe es keine profiles-Zeile für trip_members.
  // Die eigentliche Logik steckt in redeemPendingInvite() (joinFlow.ts): dort
  // getestet, hier nur noch mit den echten IO-Abhängigkeiten aufgerufen.
  // `webGesperrt` zusätzlich in JEDEM der drei folgenden Effekte (nicht nur
  // im Redirect-Effekt oben): solange die Web-Hartsperre steht, soll dieser
  // Baum NICHTS tun ausser die Sperr-Seite zu zeigen, auch nicht scheinbar
  // Harmloses wie den (auf Web ohnehin leeren) Upload-Worker starten. Das ist
  // in der Praxis heute nicht erreichbar (secureSessionStorage.web.ts liefert
  // nie eine Session, `status` wird auf Web also realistisch nie 'signedIn'),
  // aber die Garantie soll nicht an dieser fremden Datei hängen, sie gilt
  // hier, unabhängig davon, WARUM `status` gerade ist, was er ist.
  useEffect(() => {
    if (webGesperrt || status !== 'signedIn') return;
    let aktiv = true;
    void redeemPendingInvite({
      peekRememberedInvite,
      redeemInvite,
      discardRememberedInvite,
      isActive: () => aktiv,
    }).then((zielPfad) => {
      if (zielPfad) router.replace(zielPfad);
    });
    return () => {
      aktiv = false;
    };
  }, [status, router, webGesperrt]);

  // Der Worker legt posts-Zeilen an, dafür braucht er Sitzung UND Profil,
  // also dieselbe Bedingung wie beim Einlösen der Einladung oben: vor
  // signedIn gibt es nichts zu tun. Verlässt der Status signedIn (Abmelden,
  // Sitzungsverlust), MUSS er sofort stehen, ein weiterlaufender Worker
  // würde sonst versuchen, mit fremder oder fehlender Sitzung Zeilen
  // anzulegen. starte()/stoppe() sind idempotent (siehe uploadWorker.test.ts),
  // ein Effect mit [status] als einziger Abhängigkeit reicht deshalb aus,
  // ganz ohne eigene Zähler, die Cleanup-Funktion übernimmt sowohl den
  // Wechsel weg von signedIn als auch das Unmounten (App-Beenden).
  useEffect(() => {
    if (webGesperrt || status !== 'signedIn') return;
    uploadWorker.start();
    return () => uploadWorker.stop();
  }, [status, webGesperrt]);

  // Push-Registrierung: einmal pro signedIn-Wechsel anstossen, ohne auf das
  // Ergebnis zu warten und ohne das Rendern zu blockieren (Vorbild: der
  // Upload-Worker-Start oben). Anders als der Worker braucht es kein
  // Cleanup, registrierePushToken() wirft nie (Task-4-Brief) und schreibt
  // höchstens eine Zeile per upsert auf token; ein doppelter Aufruf bei
  // erneutem signedIn (z.B. nach kurzem Session-Verlust) ist harmlos.
  //
  // Seit dem Schalter im Profil-Tab hinter der gespeicherten Einstellung:
  // wer Benachrichtigungen ausgeschaltet hat, dessen Gerät darf sich beim
  // nächsten Start nicht klammheimlich wieder registrieren. Das AUSSCHALTEN
  // selbst löscht den Token sofort (profil.tsx), hier wird nur noch das
  // Wieder-Anlegen verhindert.
  useEffect(() => {
    if (webGesperrt || status !== 'signedIn' || !userId) return;
    void notificationsActive().then((aktiv) => {
      if (aktiv) void registerPushToken(userId);
    });
  }, [status, userId, webGesperrt]);

  // Web-Hartsperre: KEIN <Stack/>, nicht nur ein Redirect. Ohne <Stack/>
  // mountet keiner der eigentlichen Routen-Screens überhaupt (inkl. aller
  // (auth)- und (tabs)-Screens sowie 'join'), ihre Effekte laufen also nie
  // an. Ein Redirect allein hätte den Zielscreen für einen Frame lang
  // trotzdem gemountet (und potenziell dessen Effekte ausgelöst), genau die
  // Lücke aus dem Task-4-Fund.
  if (webGesperrt) {
    return (
      <>
        <StatusBar style="dark" />
        <WebNurAppSeite />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
    </>
  );
}

const styles = StyleSheet.create({
  webSperreScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: spacing.screen,
    gap: spacing.s,
  },
  webSperreText: { marginTop: spacing.s },
});

export default function RootLayout() {
  // Der zweite Rueckgabewert ist nicht optional: ohne ihn bleibt die App bei
  // einem Ladefehler FUER IMMER im Splash stehen, weil sie null rendert und
  // damit weder AuthProvider noch hideAsync() je erreicht. Die SDK-57-Doku
  // nennt genau dieses Muster («continue with the app if the font fails to
  // load»). Figtree ist verbindlich (DESIGN-LANGUAGE §2), aber eine Reise, die
  // sich nicht oeffnen laesst, ist teurer als eine Systemschrift.
  const [fontsLoaded, fontFehler] = useFonts({
    Figtree_300Light,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
  if (fontFehler) {
    console.warn('[start] Schriften nicht geladen, weiter mit Systemschrift:', fontFehler);
  }
  if (!fontsLoaded && !fontFehler) return null;
  return (
    // SafeAreaProvider, weil keiner der drei Stacks einen Navigations-Header
    // zeigt: jeder Screen beginnt bei y = 0 und muss selbst wissen, was das
    // Geraet oben belegt (useOberkante). `initialWindowMetrics` liefert die
    // Werte schon beim ersten Frame, ohne das springt der Inhalt beim Start
    // sichtbar nach unten, sobald die echten Insets eintreffen.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>
        <AuthProvider>
          <Guarded />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
