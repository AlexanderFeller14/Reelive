import { render, act } from '@testing-library/react-native';
import * as React from 'react';

// RootLayout verdrahtet native/IO-Abhängigkeiten, die in Tests nie laufen
// dürfen (Schriftladen, Splash-Screen, Router). Alle werden auf ein Minimum
// reduziert, damit hier ausschliesslich die Worker-Verdrahtung (Task 13)
// unter Test steht, stabile Referenzen (Modul-Konstanten statt neuer
// Objekte pro Aufruf), damit Router/Segmente nicht selbst Rerenders auslösen.
const mockRouter = { replace: jest.fn() };
const mockSegments: string[] = ['(tabs)'];
// Task 5: die Web-Hartsperre braucht einen ECHTEN Nachweis, dass <Stack/>
// NICHT gemountet wird, nicht nur, dass irgendwo Text erscheint, deshalb
// ein Spion statt `() => null` (gleiches Prinzip wie mockRouter/mockInvoke
// in anderen Testdateien: Aufruf UND Nicht-Aufruf müssen prüfbar sein).
const mockStackRender = jest.fn((_props?: unknown) => null);
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
  Stack: (props: unknown) => mockStackRender(props),
}));

// Platform.OS umschalten (Task 5): react-native wird NICHT gemockt, Platform
// ist bei react-native ein normales, beschreibbares Datenfeld (kein Getter,
// gleiches Muster/gleiche Begründung wie pushApi.test.ts, dortiges
// "Android: Notification-Channel..."-describe), lässt sich also direkt
// umschalten und danach wiederherstellen. Ein jest.mock('react-native', …)
// wäre hier zusätzlich riskant: expo-modules-core liest Platform.OS schon
// beim Laden (jest-expo-Setup), bevor irgendein modul-lokaler `const` dieser
// Datei initialisiert ist, ein Mock-Factory-Closure darauf träfe auf eine
// TDZ/Initialisierungsreihenfolge, die nicht zuverlässig ist.
import { Platform } from 'react-native';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// Steuerbar, weil der interessante Fall NICHT «geladen» ist, sondern
// «fehlgeschlagen»: useFonts liefert ein Tupel [geladen, fehler], und solange
// der Fehler ignoriert wurde, blieb die App bei einem Ladefehler fuer immer
// im Splash stehen (am Geraet gesehen, 2026-08-11).
const mockSchriften: { ergebnis: [boolean, Error | null] } = { ergebnis: [true, null] };
jest.mock('@expo-google-fonts/figtree', () => ({
  useFonts: () => mockSchriften.ergebnis,
  Figtree_300Light: 0,
  Figtree_400Regular: 0,
  Figtree_500Medium: 0,
  Figtree_600SemiBold: 0,
  Figtree_700Bold: 0,
}));

const mockAuth: { status: string; userId: string | null } = { status: 'loading', userId: null };
jest.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockAuth,
}));

jest.mock('@/features/trips/inviteLink', () => ({
  peekRememberedInvite: jest.fn(async () => null),
  discardRememberedInvite: jest.fn(async () => {}),
}));
jest.mock('@/features/trips/tripsApi', () => ({ redeemInvite: jest.fn() }));

jest.mock('@/features/moments/uploadWorker', () => ({
  starte: jest.fn(),
  stoppe: jest.fn(),
}));

// pushApi.ts importiert @/lib/supabase (Task 4), das wiederum echtes
// AsyncStorage lädt, unter Jest genau wie uploadWorker oben nie ungemockt.
jest.mock('@/features/push/pushApi', () => ({
  registrierePushToken: jest.fn(async () => 'ok'),
}));

// Der Benachrichtigungs-Schalter (Profil-Tab): das Layout registriert nur,
// wenn die Einstellung AN ist. Default AN wie in push/einstellungen.ts.
const mockBenachrichtigungenAktiv = jest.fn(async () => true);
jest.mock('@/features/push/einstellungen', () => ({
  benachrichtigungenAktiv: () => mockBenachrichtigungenAktiv(),
}));

import RootLayout from '../_layout';
import * as uploadWorker from '@/features/moments/uploadWorker';
import * as pushApi from '@/features/push/pushApi';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.status = 'loading';
  mockAuth.userId = null;
  mockSegments[0] = '(tabs)';
  mockBenachrichtigungenAktiv.mockResolvedValue(true);
  Platform.OS = 'ios';
});

// Task 13: der Worker legt posts-Zeilen an, braucht dafür Sitzung UND Profil,
// vor signedIn (loading/signedOut/needsProfile) darf er nicht anlaufen.
test('vor signedIn läuft der Worker nicht an', async () => {
  const { unmount } = await render(<RootLayout />);
  expect(uploadWorker.starte).not.toHaveBeenCalled();
  expect(uploadWorker.stoppe).not.toHaveBeenCalled();
  await unmount();
});

test('sobald Sitzung und Profil stehen (signedIn), startet der Worker', async () => {
  const { rerender, unmount } = await render(<RootLayout />);
  expect(uploadWorker.starte).not.toHaveBeenCalled();

  mockAuth.status = 'signedIn';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(uploadWorker.starte).toHaveBeenCalledTimes(1);
  await unmount();
});

// Ein weiterlaufender Worker, der mit fremder oder fehlender Sitzung
// posts-Zeilen anzulegen versucht, wäre falsch, er muss beim Abmelden sofort
// stehen, nicht erst beim nächsten Intervall-Tick.
test('beim Abmelden (signedIn -> signedOut) stoppt der Worker sofort', async () => {
  mockAuth.status = 'signedIn';
  const { rerender, unmount } = await render(<RootLayout />);
  expect(uploadWorker.starte).toHaveBeenCalledTimes(1);
  expect(uploadWorker.stoppe).not.toHaveBeenCalled();

  mockAuth.status = 'signedOut';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(uploadWorker.stoppe).toHaveBeenCalledTimes(1);
  expect(uploadWorker.starte).toHaveBeenCalledTimes(1); // kein erneuter Start
  await unmount();
});

// Verlust des Profils (z.B. eine erneute hasProfile()-Auswertung) ist für den
// Worker dieselbe Bedingung wie ein Abmelden: nicht signedIn ⇒ stehen.
test('bei needsProfile (Profil verloren/entfernt) stoppt der Worker ebenfalls', async () => {
  mockAuth.status = 'signedIn';
  const { rerender, unmount } = await render(<RootLayout />);
  expect(uploadWorker.starte).toHaveBeenCalledTimes(1);

  mockAuth.status = 'needsProfile';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(uploadWorker.stoppe).toHaveBeenCalledTimes(1);
  await unmount();
});

test('beim Unmount (z.B. App-Beenden) stoppt ein laufender Worker', async () => {
  mockAuth.status = 'signedIn';
  const { unmount } = await render(<RootLayout />);
  expect(uploadWorker.starte).toHaveBeenCalledTimes(1);

  await unmount();

  expect(uploadWorker.stoppe).toHaveBeenCalledTimes(1);
});

// Task 4: Push-Registrierung wird wie der Upload-Worker erst bei signedIn
// angestossen, vorher gibt es weder eine gültige Sitzung noch eine userId.
test('vor signedIn wird keine Push-Registrierung angestossen', async () => {
  const { unmount } = await render(<RootLayout />);
  expect(pushApi.registrierePushToken).not.toHaveBeenCalled();
  await unmount();
});

test('sobald Sitzung und Profil stehen (signedIn), wird die Push-Registrierung mit der userId angestossen', async () => {
  const { rerender, unmount } = await render(<RootLayout />);

  mockAuth.status = 'signedIn';
  mockAuth.userId = 'u1';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(pushApi.registrierePushToken).toHaveBeenCalledWith('u1');
  await unmount();
});

// Wer den Schalter im Profil-Tab ausgeschaltet hat, dessen Gerät darf sich
// beim nächsten Start nicht klammheimlich wieder registrieren — sonst wäre
// der Schalter nur Deko bis zum nächsten App-Start.
test('mit ausgeschalteten Benachrichtigungen registriert das Layout NICHT', async () => {
  mockBenachrichtigungenAktiv.mockResolvedValue(false);
  const { rerender, unmount } = await render(<RootLayout />);

  mockAuth.status = 'signedIn';
  mockAuth.userId = 'u1';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(pushApi.registrierePushToken).not.toHaveBeenCalled();
  await unmount();
});

// Task 5, Koordinator-Entscheid nach einem Fund aus Task 4: der Web-Export
// bündelt die GANZE App, isPublicArea() allein sperrt keine Route. Auf Web
// bleibt jetzt bis auf 'teilen' alles gesperrt, kein <Stack/>, keine
// Redirect-Logik, nur die freundliche «Reelive gibt es als App»-Seite.
describe('Web-Hartsperre (istWebGesperrt)', () => {
  test('auf Web ausserhalb von "teilen" wird <Stack/> NICHT gerendert, die Sperr-Seite steht stattdessen', async () => {
    Platform.OS = 'web';
    mockSegments[0] = '(tabs)';
    const { getByText, unmount } = await render(<RootLayout />);
    expect(mockStackRender).not.toHaveBeenCalled();
    expect(getByText('Reelive gibt es als App.')).toBeTruthy();
    await unmount();
  });

  // Bewusst KEIN Sonderfall wie bei isPublicArea: 'join' bleibt auf Web
  // ebenfalls gesperrt (siehe Begründung in guard.ts), der Beitritts-Screen
  // verzweigt ohne Session selbst in den Login-Flow.
  test('auf Web bleibt auch "join" gesperrt', async () => {
    Platform.OS = 'web';
    mockSegments[0] = 'join';
    const { unmount } = await render(<RootLayout />);
    expect(mockStackRender).not.toHaveBeenCalled();
    await unmount();
  });

  test('auf Web bleibt "teilen" erreichbar, <Stack/> wird gerendert, keine Sperr-Seite', async () => {
    Platform.OS = 'web';
    mockSegments[0] = 'teilen';
    const { queryByText, unmount } = await render(<RootLayout />);
    expect(mockStackRender).toHaveBeenCalledTimes(1);
    expect(queryByText('Reelive gibt es als App.')).toBeNull();
    await unmount();
  });

  test('auf nativen Plattformen ist die Sperre nie aktiv, <Stack/> wird wie zuvor immer gerendert', async () => {
    Platform.OS = 'ios';
    mockSegments[0] = '(tabs)';
    const { unmount } = await render(<RootLayout />);
    expect(mockStackRender).toHaveBeenCalledTimes(1);
    await unmount();
  });

  // Der schärfere Test (siehe Bericht): nicht nur behaupten, dass nichts
  // läuft, sondern eine Situation herstellen, in der es OHNE die Sperre
  // etwas TÄTE (status künstlich auf signedIn gesetzt), und belegen, dass
  // trotzdem nichts passiert. In der echten App ist `status === 'signedIn'`
  // auf Web praktisch unerreichbar (secureSessionStorage.web liefert nie
  // eine Session), genau deshalb testet dieser Fall die Absicherung selbst,
  // nicht nur den heutigen Erreichbarkeits-Zufall.
  test('selbst wenn status künstlich signedIn ist, laufen unter der Web-Sperre weder Redirect noch Worker noch Push-Registrierung an', async () => {
    Platform.OS = 'web';
    mockSegments[0] = '(tabs)';
    mockAuth.status = 'signedIn';
    mockAuth.userId = 'u1';
    const { unmount } = await render(<RootLayout />);

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(uploadWorker.starte).not.toHaveBeenCalled();
    expect(pushApi.registrierePushToken).not.toHaveBeenCalled();
    expect(mockStackRender).not.toHaveBeenCalled();

    await unmount();
    expect(uploadWorker.stoppe).not.toHaveBeenCalled(); // war nie gestartet
  });
});

// Die Schriften sind verbindlich (DESIGN-LANGUAGE §2), aber sie duerfen den
// Start nicht verhindern. Bis zum 2026-08-11 wertete RootLayout nur den
// ersten Rueckgabewert von useFonts aus und rendert bei `false` null: ein
// Ladefehler liess die App damit dauerhaft im Splash stehen, ohne Meldung,
// ohne Ausweg. Am echten Geraet gefunden, von keiner Suite bemerkt.
describe('Schriften', () => {
  afterEach(() => {
    mockSchriften.ergebnis = [true, null];
  });

  test('solange die Schriften laden, bleibt der Splash stehen', async () => {
    mockSchriften.ergebnis = [false, null];
    const { unmount } = await render(<RootLayout />);

    expect(mockStackRender).not.toHaveBeenCalled();
    await unmount();
  });

  test('ein Ladefehler haelt die App nicht auf, sie startet mit Systemschrift', async () => {
    const warnung = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSchriften.ergebnis = [false, new Error('Figtree liess sich nicht laden')];
    const { unmount } = await render(<RootLayout />);

    expect(mockStackRender).toHaveBeenCalled();
    // Und es verschwindet nicht stillschweigend: der Grund steht in der Konsole.
    expect(warnung).toHaveBeenCalled();

    await unmount();
    warnung.mockRestore();
  });
});
