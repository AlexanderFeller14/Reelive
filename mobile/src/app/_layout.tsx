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

// As early as possible, at module level like preventAutoHideAsync() above,
// not in an effect that would only run after the first render. It does not
// block the start: initErrorReporter() is synchronous and without a DSN
// (the everyday case, see errorReporter.ts) a plain no-op return, no I/O.
initErrorReporter();

// The web hard lock (see isWebLocked in guard.ts for the full reasoning):
// "Reelive gibt es als App", friendly, with the wordmark placeholder (same
// pattern as (auth)/welcome.tsx, the real SVG asset does not exist yet), and
// WITHOUT any way to sign in. Deliberately local here instead of in its own
// file under components/: single caller, tightly coupled to this layout
// (same reasoning as CinemaButton/TextLink in player.tsx).
function WebAppOnlyPage() {
  const { colors } = useTheme();
  return (
    <View testID="web-nur-app-seite" style={[styles.webLockScreen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h3, { color: colors['text-1'] }]}>Reelive</Text>
      <Text style={[type.h1, styles.webLockText, { color: colors['text-1'] }]}>
        Reelive gibt es als App.
      </Text>
      <Text style={[type.body, styles.webLockText, { color: colors['text-2'] }]}>
        Diese Seite lässt sich nur in der Reelive-App öffnen. Hast du einen geteilten
        Recap-Link bekommen, öffne genau den. Der funktioniert auch hier im Browser.
      </Text>
    </View>
  );
}

function Guarded() {
  const { status, userId } = useAuth();
  // Cast: with experiments.typedRoutes, useSegments() narrows its return type
  // to the routes that exist today, so segments[1] would be a tuple
  // out-of-bounds error. Runtime behaviour unchanged.
  const segments = useSegments() as string[];
  const router = useRouter();
  const { colors } = useTheme();
  const area = segments[0]; // '(auth)' | '(tabs)' | 'preview' | 'join' | 'share' | undefined
  const webLocked = isWebLocked(Platform.OS, area);

  useEffect(() => {
    if (webLocked) return;
    const target = resolveRoute(status);
    if (!target) return;
    void SplashScreen.hideAsync();
    // The join screen stays put in every status.
    if (isPublicArea(area)) return;
    if (status === 'signedIn' && !isAreaForSignedIn(area)) router.replace(target);
    if (status !== 'signedIn' && area !== '(auth)') router.replace(target);
    if (status === 'needsProfile' && segments[1] !== 'profile-setup') router.replace(target);
  }, [status, segments, router, webLocked, area]);

  // An invite link tapped before signing in is redeemed as soon as session
  // AND profile stand: before that there is no profiles row for trip_members
  // to point at. The actual logic lives in redeemPendingInvite()
  // (joinFlow.ts): tested there, here it is only wired to the real IO
  // dependencies.
  //
  // `webLocked` is checked in EACH of the three effects below (not only in
  // the redirect effect above): as long as the web hard lock stands, this
  // tree must do NOTHING but show the lock page, not even seemingly harmless
  // things like starting the (on web anyway empty) upload worker. In
  // practice that is unreachable today (secureSessionStorage.web.ts never
  // yields a session, so `status` realistically never becomes 'signedIn' on
  // web), but the guarantee should not hang on that foreign file, it holds
  // here regardless of WHY `status` is what it is.
  useEffect(() => {
    if (webLocked || status !== 'signedIn') return;
    let active = true;
    void redeemPendingInvite({
      peekRememberedInvite,
      redeemInvite,
      discardRememberedInvite,
      isActive: () => active,
    }).then((targetPath) => {
      if (targetPath) router.replace(targetPath);
    });
    return () => {
      active = false;
    };
  }, [status, router, webLocked]);

  useEffect(() => {
    if (webLocked || status !== 'signedIn') return;
    uploadWorker.start();
    return () => uploadWorker.stop();
  }, [status, webLocked]);

  // Unlike the worker this needs no cleanup: registerPushToken() never
  // throws and writes at most one row via upsert on token, so a second call
  // on a repeated signedIn (after a brief session loss, say) is harmless.
  useEffect(() => {
    if (webLocked || status !== 'signedIn' || !userId) return;
    void notificationsActive().then((active) => {
      if (active) void registerPushToken(userId);
    });
  }, [status, userId, webLocked]);

  if (webLocked) {
    return (
      <>
        <StatusBar style="dark" />
        <WebAppOnlyPage />
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
  webLockScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: spacing.screen,
    gap: spacing.s,
  },
  webLockText: { marginTop: spacing.s },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Figtree_300Light,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
  if (fontError) {
    console.warn('[start] Schriften nicht geladen, weiter mit Systemschrift:', fontError);
  }
  if (!fontsLoaded && !fontError) return null;
  return (
    // SafeAreaProvider, because none of the three stacks shows a navigation
    // header: every screen starts at y = 0 and has to know for itself what
    // the device occupies at the top (useTopInset). `initialWindowMetrics`
    // delivers the values on the very first frame; without it the content
    // visibly jumps down at startup once the real insets arrive.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>
        <AuthProvider>
          <Guarded />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
