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
import { takeRememberedInvite } from '@/features/trips/inviteLink';
import { redeemInvite } from '@/features/trips/tripsApi';

void SplashScreen.preventAutoHideAsync();

function Guarded() {
  const { status } = useAuth();
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
  useEffect(() => {
    if (status !== 'signedIn') return;
    let aktiv = true;
    void takeRememberedInvite().then(async (code) => {
      if (!code || !aktiv) return;
      const ergebnis = await redeemInvite(code);
      if (!aktiv) return;
      if (ergebnis.trip_id && (ergebnis.status === 'joined' || ergebnis.status === 'already_member')) {
        router.replace(`/reise/${ergebnis.trip_id}`);
      }
    });
    return () => {
      aktiv = false;
    };
  }, [status, router]);

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
