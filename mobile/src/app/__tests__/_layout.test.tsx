import { render, act } from '@testing-library/react-native';
import * as React from 'react';

// RootLayout wires up native/IO dependencies that must never run in tests
// (font loading, splash screen, router). All of them are cut down to a
// minimum so that only the worker wiring (Task 13) is under test here, with
// stable references (module constants instead of fresh objects per call) so
// that router/segments do not trigger rerenders of their own.
const mockRouter = { replace: jest.fn() };
const mockSegments: string[] = ['(tabs)'];
// Task 5: the web hard lock needs REAL proof that <Stack/> is NOT mounted,
// not just that some text appears, hence a spy instead of `() => null` (same
// principle as mockRouter/mockInvoke in other test files: both the call and
// the absence of a call have to be checkable).
const mockStackRender = jest.fn((_props?: unknown) => null);
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
  Stack: (props: unknown) => mockStackRender(props),
}));

// Switching Platform.OS (Task 5): react-native is NOT mocked, Platform is a
// plain writable data field on react-native (no getter, same pattern and
// reasoning as pushApi.test.ts and its "Android: Notification-Channel..."
// describe), so it can be flipped directly and restored afterwards. A
// jest.mock('react-native', …) would be risky on top of that:
// expo-modules-core reads Platform.OS while loading (jest-expo setup),
// before any module-local `const` of this file is initialised, so a mock
// factory closure over it would run into a TDZ/initialisation order that is
// not reliable.
import { Platform } from 'react-native';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// Controllable, because the interesting case is not "loaded" but "failed":
// useFonts returns a tuple [loaded, error], and as long as the error was
// ignored a load failure left the app stuck in the splash forever (seen on
// the device, 2026-08-11).
const mockFonts: { result: [boolean, Error | null] } = { result: [true, null] };
jest.mock('@expo-google-fonts/figtree', () => ({
  useFonts: () => mockFonts.result,
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
  start: jest.fn(),
  stop: jest.fn(),
}));

// pushApi.ts imports @/lib/supabase (Task 4), which in turn loads the real
// AsyncStorage, never left unmocked under Jest, just like uploadWorker above.
jest.mock('@/features/push/pushApi', () => ({
  registerPushToken: jest.fn(async () => 'ok'),
}));

// The notification switch (profile tab): the layout only registers when the
// setting is ON. Default ON as in push/settings.ts.
const mockNotificationsEnabled = jest.fn(async () => true);
jest.mock('@/features/push/settings', () => ({
  notificationsActive: () => mockNotificationsEnabled(),
}));

import RootLayout from '../_layout';
import * as uploadWorker from '@/features/moments/uploadWorker';
import * as pushApi from '@/features/push/pushApi';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.status = 'loading';
  mockAuth.userId = null;
  mockSegments[0] = '(tabs)';
  mockNotificationsEnabled.mockResolvedValue(true);
  Platform.OS = 'ios';
});

// Task 13: the worker creates posts rows, which needs session AND profile,
// so before signedIn (loading/signedOut/needsProfile) it must not start.
test('before signedIn the upload worker stays put', async () => {
  const { unmount } = await render(<RootLayout />);
  expect(uploadWorker.start).not.toHaveBeenCalled();
  expect(uploadWorker.stop).not.toHaveBeenCalled();
  await unmount();
});

test('as soon as session and profile stand (signedIn), the upload worker starts', async () => {
  const { rerender, unmount } = await render(<RootLayout />);
  expect(uploadWorker.start).not.toHaveBeenCalled();

  mockAuth.status = 'signedIn';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(uploadWorker.start).toHaveBeenCalledTimes(1);
  await unmount();
});

// A worker that keeps running and tries to create posts rows with a foreign
// or missing session would be wrong: it has to stop the moment someone signs
// out, not at the next interval tick.
test('signing out (signedIn -> signedOut) stops the worker right away', async () => {
  mockAuth.status = 'signedIn';
  const { rerender, unmount } = await render(<RootLayout />);
  expect(uploadWorker.start).toHaveBeenCalledTimes(1);
  expect(uploadWorker.stop).not.toHaveBeenCalled();

  mockAuth.status = 'signedOut';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(uploadWorker.stop).toHaveBeenCalledTimes(1);
  expect(uploadWorker.start).toHaveBeenCalledTimes(1); // no second start
  await unmount();
});

// Losing the profile (a repeated hasProfile() evaluation, say) is the same
// condition for the worker as signing out: not signedIn means stop.
test('losing the profile (needsProfile) stops the worker just as signing out does', async () => {
  mockAuth.status = 'signedIn';
  const { rerender, unmount } = await render(<RootLayout />);
  expect(uploadWorker.start).toHaveBeenCalledTimes(1);

  mockAuth.status = 'needsProfile';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(uploadWorker.stop).toHaveBeenCalledTimes(1);
  await unmount();
});

test('on unmount (closing the app, say) a running worker is stopped', async () => {
  mockAuth.status = 'signedIn';
  const { unmount } = await render(<RootLayout />);
  expect(uploadWorker.start).toHaveBeenCalledTimes(1);

  await unmount();

  expect(uploadWorker.stop).toHaveBeenCalledTimes(1);
});

// Task 4: like the upload worker, push registration is only triggered at
// signedIn, before that there is neither a valid session nor a userId.
test('before signedIn no push registration is triggered', async () => {
  const { unmount } = await render(<RootLayout />);
  expect(pushApi.registerPushToken).not.toHaveBeenCalled();
  await unmount();
});

test('as soon as session and profile stand (signedIn), push registration is triggered with the userId', async () => {
  const { rerender, unmount } = await render(<RootLayout />);

  mockAuth.status = 'signedIn';
  mockAuth.userId = 'u1';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(pushApi.registerPushToken).toHaveBeenCalledWith('u1');
  await unmount();
});

// Whoever turned the switch off in the profile tab must not have their
// device quietly register itself again at the next start, otherwise the
// switch would be decoration until the app restarts.
test('with notifications switched off the layout does NOT register the device', async () => {
  mockNotificationsEnabled.mockResolvedValue(false);
  const { rerender, unmount } = await render(<RootLayout />);

  mockAuth.status = 'signedIn';
  mockAuth.userId = 'u1';
  await act(async () => {
    rerender(<RootLayout />);
  });

  expect(pushApi.registerPushToken).not.toHaveBeenCalled();
  await unmount();
});

// Task 5, coordinator decision after a finding from Task 4: the web export
// bundles the WHOLE app, isPublicArea() alone locks no route. On web
// everything but 'share' now stays locked: no <Stack/>, no redirect logic,
// only the friendly "Reelive gibt es als App" page.
describe('web hard lock (isWebLocked)', () => {
  test('on web outside "share" no <Stack/> is rendered, the lock page stands instead', async () => {
    Platform.OS = 'web';
    mockSegments[0] = '(tabs)';
    const { getByText, unmount } = await render(<RootLayout />);
    expect(mockStackRender).not.toHaveBeenCalled();
    expect(getByText('Reelive gibt es als App.')).toBeTruthy();
    await unmount();
  });

  // Deliberately NO special case as with isPublicArea: 'join' stays locked
  // on web too (see the reasoning in guard.ts), because the join screen
  // branches into the login flow itself when there is no session.
  test('on web even "join" stays locked', async () => {
    Platform.OS = 'web';
    mockSegments[0] = 'join';
    const { unmount } = await render(<RootLayout />);
    expect(mockStackRender).not.toHaveBeenCalled();
    await unmount();
  });

  test('on web "share" remains reachable, <Stack/> is rendered and no lock page appears', async () => {
    Platform.OS = 'web';
    mockSegments[0] = 'share';
    const { queryByText, unmount } = await render(<RootLayout />);
    expect(mockStackRender).toHaveBeenCalledTimes(1);
    expect(queryByText('Reelive gibt es als App.')).toBeNull();
    await unmount();
  });

  test('on native platforms the lock is never active, <Stack/> is rendered as before', async () => {
    Platform.OS = 'ios';
    mockSegments[0] = '(tabs)';
    const { unmount } = await render(<RootLayout />);
    expect(mockStackRender).toHaveBeenCalledTimes(1);
    await unmount();
  });

  // The sharper test (see report): do not just claim that nothing runs, but
  // build a situation in which something WOULD run without the lock (status
  // artificially set to signedIn) and show that nothing happens anyway. In
  // the real app `status === 'signedIn'` is practically unreachable on web
  // (secureSessionStorage.web never yields a session), which is exactly why
  // this case tests the safeguard itself and not today's accident of
  // reachability.
  test('even with status artificially signedIn, the web lock lets neither redirect nor worker nor push registration run', async () => {
    Platform.OS = 'web';
    mockSegments[0] = '(tabs)';
    mockAuth.status = 'signedIn';
    mockAuth.userId = 'u1';
    const { unmount } = await render(<RootLayout />);

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(uploadWorker.start).not.toHaveBeenCalled();
    expect(pushApi.registerPushToken).not.toHaveBeenCalled();
    expect(mockStackRender).not.toHaveBeenCalled();

    await unmount();
    expect(uploadWorker.stop).not.toHaveBeenCalled(); // was never started
  });
});

// The fonts are binding (DESIGN-LANGUAGE §2), but they must not prevent the
// start. Until 2026-08-11 RootLayout only evaluated the first return value of
// useFonts and rendered null on `false`: a load failure left the app stuck in
// the splash for good, with no message and no way out. Found on the real
// device, noticed by no suite.
describe('fonts', () => {
  afterEach(() => {
    mockFonts.result = [true, null];
  });

  test('while the fonts are still loading, the splash stays up', async () => {
    mockFonts.result = [false, null];
    const { unmount } = await render(<RootLayout />);

    expect(mockStackRender).not.toHaveBeenCalled();
    await unmount();
  });

  test('a load failure does not hold up the app, it starts with the system font', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFonts.result = [false, new Error('Figtree liess sich nicht laden')];
    const { unmount } = await render(<RootLayout />);

    expect(mockStackRender).toHaveBeenCalled();
    // And it does not vanish silently: the reason is in the console.
    expect(warning).toHaveBeenCalled();

    await unmount();
    warning.mockRestore();
  });
});
