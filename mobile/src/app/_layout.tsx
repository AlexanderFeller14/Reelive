import { useEffect } from 'react';
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
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { resolveRoute, isPublicArea } from '@/features/auth/guard';
import { peekRememberedInvite, discardRememberedInvite } from '@/features/trips/inviteLink';
import { redeemInvite } from '@/features/trips/tripsApi';
import { redeemPendingInvite } from '@/features/trips/joinFlow';
import * as uploadWorker from '@/features/moments/uploadWorker';
import { registrierePushToken } from '@/features/push/pushApi';

void SplashScreen.preventAutoHideAsync();

function Guarded() {
  const { status, userId } = useAuth();
  // Cast: mit experiments.typedRoutes engt useSegments() den Rückgabetyp auf die
  // aktuell existierenden Routen ein — segments[1] wäre sonst ein
  // Tuple-Out-of-Bounds-Fehler. Laufzeitverhalten unverändert.
  const segments = useSegments() as string[];
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    const target = resolveRoute(status);
    if (!target) return;
    void SplashScreen.hideAsync();
    const area = segments[0]; // '(auth)' | '(tabs)' | 'join' | undefined
    // Der Beitritts-Screen bleibt in jedem Status stehen.
    if (isPublicArea(area)) return;
    if (status === 'signedIn' && area !== '(tabs)') router.replace(target);
    if (status !== 'signedIn' && area !== '(auth)') router.replace(target);
    if (status === 'needsProfile' && segments[1] !== 'profile-setup') router.replace(target);
  }, [status, segments, router]);

  // Ein vor dem Login angetippter Einladungslink wird eingelöst, sobald Session
  // UND Profil stehen — vorher gäbe es keine profiles-Zeile für trip_members.
  // Die eigentliche Logik steckt in redeemPendingInvite() (joinFlow.ts): dort
  // getestet, hier nur noch mit den echten IO-Abhängigkeiten aufgerufen.
  useEffect(() => {
    if (status !== 'signedIn') return;
    let aktiv = true;
    void redeemPendingInvite({
      peekRememberedInvite,
      redeemInvite,
      discardRememberedInvite,
      istAktiv: () => aktiv,
    }).then((zielPfad) => {
      if (zielPfad) router.replace(zielPfad);
    });
    return () => {
      aktiv = false;
    };
  }, [status, router]);

  // Der Worker legt posts-Zeilen an — dafür braucht er Sitzung UND Profil,
  // also dieselbe Bedingung wie beim Einlösen der Einladung oben: vor
  // signedIn gibt es nichts zu tun. Verlässt der Status signedIn (Abmelden,
  // Sitzungsverlust), MUSS er sofort stehen — ein weiterlaufender Worker
  // würde sonst versuchen, mit fremder oder fehlender Sitzung Zeilen
  // anzulegen. starte()/stoppe() sind idempotent (siehe uploadWorker.test.ts),
  // ein Effect mit [status] als einziger Abhängigkeit reicht deshalb aus,
  // ganz ohne eigene Zähler — die Cleanup-Funktion übernimmt sowohl den
  // Wechsel weg von signedIn als auch das Unmounten (App-Beenden).
  useEffect(() => {
    if (status !== 'signedIn') return;
    uploadWorker.starte();
    return () => uploadWorker.stoppe();
  }, [status]);

  // Push-Registrierung: einmal pro signedIn-Wechsel anstossen, ohne auf das
  // Ergebnis zu warten und ohne das Rendern zu blockieren (Vorbild: der
  // Upload-Worker-Start oben). Anders als der Worker braucht es kein
  // Cleanup — registrierePushToken() wirft nie (Task-4-Brief) und schreibt
  // höchstens eine Zeile per upsert auf token; ein doppelter Aufruf bei
  // erneutem signedIn (z.B. nach kurzem Session-Verlust) ist harmlos.
  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    void registrierePushToken(userId);
  }, [status, userId]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Figtree_300Light,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
  if (!fontsLoaded) return null;
  return (
    <ThemeProvider>
      <AuthProvider>
        <Guarded />
      </AuthProvider>
    </ThemeProvider>
  );
}
