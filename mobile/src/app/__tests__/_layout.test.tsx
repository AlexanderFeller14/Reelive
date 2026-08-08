import { render, act } from '@testing-library/react-native';
import * as React from 'react';

// RootLayout verdrahtet native/IO-Abhängigkeiten, die in Tests nie laufen
// dürfen (Schriftladen, Splash-Screen, Router). Alle werden auf ein Minimum
// reduziert, damit hier ausschliesslich die Worker-Verdrahtung (Task 13)
// unter Test steht — stabile Referenzen (Modul-Konstanten statt neuer
// Objekte pro Aufruf), damit Router/Segmente nicht selbst Rerenders auslösen.
const mockRouter = { replace: jest.fn() };
const mockSegments: string[] = ['(tabs)'];
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
  Stack: () => null,
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('@expo-google-fonts/figtree', () => ({
  useFonts: () => [true],
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
// AsyncStorage lädt — unter Jest genau wie uploadWorker oben nie ungemockt.
jest.mock('@/features/push/pushApi', () => ({
  registrierePushToken: jest.fn(async () => 'ok'),
}));

import RootLayout from '../_layout';
import * as uploadWorker from '@/features/moments/uploadWorker';
import * as pushApi from '@/features/push/pushApi';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.status = 'loading';
  mockAuth.userId = null;
});

// Task 13: der Worker legt posts-Zeilen an, braucht dafür Sitzung UND Profil
// — vor signedIn (loading/signedOut/needsProfile) darf er nicht anlaufen.
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
// posts-Zeilen anzulegen versucht, wäre falsch — er muss beim Abmelden sofort
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
// angestossen — vorher gibt es weder eine gültige Sitzung noch eine userId.
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
