import { render, screen, fireEvent, act } from '@testing-library/react-native';
import * as React from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { cinema, palette, spacing } from '@/theme/tokens';
import * as cinemaStage from '@/features/camera/cinemaStage';
import type { Trip } from '@/features/trips/types';

const mockPush = jest.fn();

// useFocusEffect as a real effect instead of a call on every render.
// A callback fired on every render loops forever as soon as the load path
// builds a fresh list; an effect with dependencies is also closer to the
// real behaviour, once on focus instead of on every render.
// mockFocusListeners make a refocus triggerable (see refocusScreen).
const mockFocusListeners = new Set<(state: number) => void>();
let mockFocusState = 0;

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const [focusState, setFocusState] = ReactActual.useState(mockFocusState);
      ReactActual.useEffect(() => {
        mockFocusListeners.add(setFocusState);
        return () => {
          mockFocusListeners.delete(setFocusState);
        };
      }, []);
      // A negative state means "not focused" (see blurScreen): the running effect
      // cleans up on the dependency change and does not start again, exactly what
      // the real useFocusEffect does on blur.
      ReactActual.useEffect(() => {
        if (focusState < 0) return;
        return cb();
      }, [cb, focusState]);
    },
  };
});

async function refocusScreen() {
  mockFocusState = Math.abs(mockFocusState) + 1;
  await act(async () => {
    mockFocusListeners.forEach((notify) => notify(mockFocusState));
  });
}

async function blurScreen() {
  mockFocusState = -Math.abs(mockFocusState) - 1;
  await act(async () => {
    mockFocusListeners.forEach((notify) => notify(mockFocusState));
  });
}

// expo-image is a native view, a placeholder that passes all props through is
// enough here. Without the mock even the import fails, expo-image/src/observe.ts
// expects a native environment.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

// Mocked synchronously instead of through AccessibilityInfo (pattern from
// Sheet.test.tsx): the real hook delivers its value asynchronously, the screen
// would briefly run with motion before taking it back.
const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/theme/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

jest.mock('@/features/trips/tripsApi', () => ({ fetchTrips: jest.fn() }));

// The picker derives «running» from the real clock via todaysCalendarDay()
// (groupTrips, the same split as the trip tab); pinned so the fixtures below
// never age out of their group. Everything else in the module stays real,
// including the same function WITH an argument: libraryImport turns a
// capture timestamp into its calendar day that way, and a pinned answer
// there would put every import inside the trip period.
jest.mock('@/features/trips/tripDay', () => {
  const actual = jest.requireActual('@/features/trips/tripDay');
  return {
    ...actual,
    todaysCalendarDay: (now?: Date) => (now ? actual.todaysCalendarDay(now) : '2026-08-10'),
  };
});

// The local trip cache is NOT mocked here but really used, only AsyncStorage
// underneath is a double. That way the offline test really walks the path "a
// successful fetch writes the cache, a failed fetch falls back on it".
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockStore.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockStore.set(key, value);
  },
}));

const mockAuth: { userId: string | null } = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

const mockOwnCounter = jest.fn(async (_tripId: string) => 0);
jest.mock('@/features/moments/counter', () => ({
  ownMomentCount: (tripId: string) => mockOwnCounter(tripId),
}));

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({
  setStatusBarStyle: (...args: unknown[]) => mockSetStatusBarStyle(...args),
}));

const mockOpenSettings = jest.fn();
jest.mock('expo-linking', () => ({ openSettings: () => mockOpenSettings() }));

// jest.setup.ts hands every suite insets of 0, a device without a Dynamic
// Island. For the viewfinder the other case is the interesting one, so this
// controllable replacement overrides the global mock for this file.
let mockInsets = { top: 0, left: 0, right: 0, bottom: 0 };
jest.mock('react-native-safe-area-context', () => ({
  ...require('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => mockInsets,
}));

const mockTakePictureAsync = jest.fn();
const mockRecordAsync = jest.fn();
const mockStopRecording = jest.fn();
const mockPausePreview = jest.fn();
const mockResumePreview = jest.fn();
const mockSavePictureAsync = jest.fn();

type PermissionMock = { status: string; granted: boolean; canAskAgain: boolean; expires: 'never' };
const GRANTED: PermissionMock = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
let mockCameraPermission: PermissionMock = GRANTED;
let mockMicPermission: PermissionMock = GRANTED;
const mockRequestCameraPermission = jest.fn();
const mockRequestMicPermission = jest.fn();

const mockCameraProps = jest.fn();
jest.mock('expo-camera', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    CameraView: ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockCameraProps(props);
      ReactActual.useImperativeHandle(ref, () => ({
        takePictureAsync: mockTakePictureAsync,
        recordAsync: mockRecordAsync,
        stopRecording: mockStopRecording,
        pausePreview: mockPausePreview,
        resumePreview: mockResumePreview,
      }));
      return ReactActual.createElement(View, { testID: 'kameraview-attrappe' });
    }),
    useCameraPermissions: () => [mockCameraPermission, mockRequestCameraPermission, jest.fn()],
    useMicrophonePermissions: () => [mockMicPermission, mockRequestMicPermission, jest.fn()],
  };
});

// There is no native module in the test and no camera on the simulator, so
// these fixtures rebuild an iPhone 17 Pro Max: ultra wide, wide and telephoto
// in one virtual device that changes lens at the factors 2 and 8.
const TRIPLE_CAMERA = {
  name: 'Rückseitige Dreifach-Kamera',
  type: 'triple',
  components: ['ultraWide', 'wide', 'telephoto'],
  switchPoints: [2, 8],
};
const SINGLE_CAMERA = { name: 'Frontkamera', type: 'wide', components: [], switchPoints: [] };

const mockLenses = jest.fn((position: string) => (position === 'back' ? [TRIPLE_CAMERA] : [SINGLE_CAMERA]));
const mockSetZoom = jest.fn();
// Typed with the nullable return of the real nativeZoom.zoomLimits: a device
// that stays silent about its bounds is a case the screen has to survive.
const mockZoomLimits = jest.fn(
  (_name: string): { min: number; max: number } | null => ({ min: 1, max: 120 })
);
const mockFocus = jest.fn();
// The pre-warmed video player (device finding 2026-08-14). The default status
// is readyToPlay so the remaining stop tests need no timer control; the
// pre-warm tests switch it to 'loading' explicitly.
const mockCreatedPlayer = {
  loop: false,
  muted: false,
  audioMixingMode: 'auto',
  status: 'readyToPlay' as string,
  play: jest.fn(),
  release: jest.fn(),
  addListener: jest.fn(
    (_event: string, _listener: (e: { status: string }) => void) => ({ remove: jest.fn() })
  ),
};
const mockCreateVideoPlayer = jest.fn((_source: unknown) => mockCreatedPlayer);
jest.mock('expo-video', () => ({
  createVideoPlayer: (source: unknown) => mockCreateVideoPlayer(source),
}));

// The poster (frame 0) bridges the ~0,8 s the VideoView needs for its first
// draw in the preview (device finding 2026-08-14).
const mockGetThumbnail = jest.fn(async (_uri: string, _options: unknown) => ({
  uri: 'file://poster.jpg',
}));
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (uri: string, options: unknown) => mockGetThumbnail(uri, options),
}));

function statusChangeListener(): ((e: { status: string }) => void) | undefined {
  const call = mockCreatedPlayer.addListener.mock.calls.find(
    ([event]) => event === 'statusChange'
  );
  return call?.[1];
}

jest.mock('@/features/camera/nativeZoom', () => ({
  lenses: (position: string) => mockLenses(position),
  setZoom: (name: string, factor: number, smooth: boolean) => mockSetZoom(name, factor, smooth),
  zoomLimits: (name: string) => mockZoomLimits(name),
  focus: (x: number, y: number) => mockFocus(x, y),
}));

// The native capture pipeline. The factory passes the calls on through a shell
// of its own instead of returning `mockNativeCapture` itself: jest.mock() runs
// while `../index` is hoisted, before the `const mockNativeCapture` line below
// has run, so a directly returned object would not be initialised yet. The
// shell reads the variable only on the ACTUAL call.
const mockNativeCapture = {
  startCapture: jest.fn(async (_s: number) => true),
  stopCapture: jest.fn(async () => ({ uri: 'file://nativ.mov', durationS: 3.4 })),
  fileReady: jest.fn(() => Promise.resolve()),
  discard: jest.fn(),
  available: jest.fn(() => true),
  InstantPreview: () => null,
};
jest.mock('@/features/camera/nativeCapture', () => ({
  startCapture: (s: number) => mockNativeCapture.startCapture(s),
  stopCapture: () => mockNativeCapture.stopCapture(),
  fileReady: () => mockNativeCapture.fileReady(),
  discard: () => mockNativeCapture.discard(),
  available: () => mockNativeCapture.available(),
  InstantPreview: () => mockNativeCapture.InstantPreview(),
}));

// The own MultiCam session. The factory passes calls on through a shell as
// well (the same hoisting trap as the nativeCapture mock, see there).
type PressureLevel = 'nominal' | 'ernst' | 'kritisch';
type MultiCamTargetMock = { camera: string; factor: number };
const mockMultiCamera = {
  available: jest.fn(() => false),
  start: jest.fn(async () => true),
  stop: jest.fn(),
  switchCamera: jest.fn(async () => 'front' as 'front' | 'back' | null),
  setZoom: jest.fn((_target: MultiCamTargetMock, _smooth: boolean) => {}),
  focus: jest.fn((_x: number, _y: number) => {}),
  onPressureChange: jest.fn((_listener: (level: PressureLevel) => void) => () => {}),
  startCapture: jest.fn(async (_maxSeconds: number) => true),
  stopCapture: jest.fn(
    async () => ({ uri: 'file://multicam.mov', durationS: 5.6 }) as { uri: string; durationS: number } | null
  ),
  takePhoto: jest.fn(
    async (_flash: boolean) =>
      ({ uri: 'file:///tmp/reelive-foto-1.jpg', width: 1080, height: 1920 }) as {
        uri: string;
        width: number;
        height: number;
      } | null
  ),
  setFlash: jest.fn((_on: boolean) => {}),
  setStabilization: jest.fn((_on: boolean) => {}),
};
jest.mock('@/features/camera/multiCamera', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    available: () => mockMultiCamera.available(),
    start: () => mockMultiCamera.start(),
    stop: () => mockMultiCamera.stop(),
    switchCamera: () => mockMultiCamera.switchCamera(),
    setZoom: (target: MultiCamTargetMock, smooth: boolean) => mockMultiCamera.setZoom(target, smooth),
    focus: (x: number, y: number) => mockMultiCamera.focus(x, y),
    onPressureChange: (listener: (level: PressureLevel) => void) =>
      mockMultiCamera.onPressureChange(listener),
    startCapture: (maxSeconds: number) => mockMultiCamera.startCapture(maxSeconds),
    stopCapture: () => mockMultiCamera.stopCapture(),
    takePhoto: (flash: boolean) => mockMultiCamera.takePhoto(flash),
    setFlash: (on: boolean) => mockMultiCamera.setFlash(on),
    setStabilization: (on: boolean) => mockMultiCamera.setStabilization(on),
    MultiCameraViewfinder: (props: object) => ReactActual.createElement(View, props),
  };
});

// The library import (spec 2026-08-27): picker and batch submission are
// native I/O with their own tests; here only the orchestration counts.
const mockPickFromLibrary = jest.fn();
jest.mock('@/features/moments/libraryPicker', () => ({
  pickFromLibrary: () => mockPickFromLibrary(),
  SELECTION_LIMIT: 20,
}));

const mockSubmitImports = jest.fn();
const mockDiscardRefused = jest.fn();
jest.mock('@/features/moments/libraryImportSubmit', () => ({
  submitImports: (...args: unknown[]) => mockSubmitImports(...args),
  discardRefused: (refused: unknown[]) => mockDiscardRefused(refused),
}));

// The success cover is a Reanimated choreography with its own test; the
// screen only hands it props and waits for "finished", which the tests
// trigger by hand through mockFinishAnimation.
const mockAnimationProps = jest.fn();
let mockFinishAnimation: (() => void) | null = null;
jest.mock('@/components/MomentSubmissionAnimation', () => ({
  MomentSubmissionAnimation: (props: {
    visible: boolean;
    onFinished: () => void;
    counter?: number | null;
    added?: number;
  }) => {
    mockAnimationProps(props);
    mockFinishAnimation = props.visible ? props.onFinished : null;
    return null;
  },
}));

import CaptureScreen from '../index';
import { fetchTrips } from '@/features/trips/tripsApi';
import * as handoff from '@/features/camera/handoff';
import * as captureLock from '@/features/camera/captureLock';
import * as warmup from '@/features/camera/warmup';

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 't1',
  name: 'Norwegen mit dem Camper',
  start_date: '2026-08-01',
  end_date: '2026-08-14',
  status: 'active',
  owner_id: 'u1',
  members: [{ name: 'Lea', avatarKey: null }],
  member_count: 1,
  my_post_count: 4,
  ...over,
});

const loaded = (data: Trip[]) => ({ data, error: null, countsError: null });

const pickedPhoto = (uri: string, creationTime: number) => ({
  uri,
  kind: 'photo' as const,
  durationMs: null,
  exif: null,
  creationTime,
  location: null,
});

// Walks through the intro sheet: tap the header button, then "Fotos
// auswählen". Every import path starts this way now.
async function openLibrary() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Fotos auswählen'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockAuth.userId = 'u1';
  // jest.clearAllMocks() only resets the call history, NOT an implementation set
  // with mockResolvedValue, which would otherwise seep into every following test
  // (same trap as in uploadWorker.test.ts).
  mockOwnCounter.mockImplementation(async () => 0);
  mockZoomLimits.mockImplementation(() => ({ min: 1, max: 120 }));
  mockUseReducedMotion.mockReturnValue(false);
  mockCameraPermission = GRANTED;
  mockMicPermission = GRANTED;
  mockInsets = { top: 0, left: 0, right: 0, bottom: 0 };
  mockSavePictureAsync.mockResolvedValue({ uri: 'file://gespeichert.jpg', width: 1920, height: 1080 });
  mockTakePictureAsync.mockResolvedValue({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  handoff.takePhoto();
  handoff.takeVideo();
  mockCreatedPlayer.status = 'readyToPlay';
  // Module state, survives tests: always start unlocked.
  captureLock.lock(false);
  // Same for the warm-up: a swipe from an earlier test must not keep the
  // session wanted in the next one.
  warmup.set(false);
  // A blurScreen() from an earlier test must not linger: every test starts
  // focused (a negative state would mean unfocused, the focus effects would
  // never run and no screen would load).
  mockFocusState = 0;
  // The default is the FALLBACK, so all existing recordAsync tests stay as they
  // are. Only the native tests ask for the native pipeline explicitly.
  mockNativeCapture.startCapture.mockResolvedValue(false);
  // Same rule for the MultiCam session: the default is the expo-camera branch,
  // only the MultiCam group switches it to available.
  mockMultiCamera.available.mockReturnValue(false);
  mockMultiCamera.start.mockResolvedValue(true);
  mockMultiCamera.switchCamera.mockResolvedValue('front');
  mockMultiCamera.onPressureChange.mockImplementation(() => () => {});
  mockPickFromLibrary.mockResolvedValue({ canceled: true });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 0 });
  mockFinishAnimation = null;
  // Unlike the native capture above, SUCCESS is the default here: the MultiCam
  // branch has no way back over recordAsync (there is no CameraView), so a
  // permanently refusing start would be a permanent error, not a starting state.
  mockMultiCamera.startCapture.mockResolvedValue(true);
  mockMultiCamera.stopCapture.mockResolvedValue({ uri: 'file://multicam.mov', durationS: 5.6 });
  mockMultiCamera.takePhoto.mockResolvedValue({
    uri: 'file:///tmp/reelive-foto-1.jpg',
    width: 1080,
    height: 1920,
  });
  mockMultiCamera.setFlash.mockImplementation(() => {});
  mockMultiCamera.setStabilization.mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
});

test('without a running trip the screen shows the way to creating one', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  expect(await screen.findByText('Keine laufende Reise')).toBeTruthy();
  await fireEvent.press(screen.getByText('Neue Reise anlegen'));
  expect(mockPush).toHaveBeenCalledWith('/trip/new');
});

test('trips that are all revealed already count as no running trip either', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip({ status: 'revealed' })]));
  await render(<CaptureScreen />);
  expect(await screen.findByText('Keine laufende Reise')).toBeTruthy();
});

test('without a cache ever loaded a load error names the cause and offers a retry', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', countsError: 'Offline' });
  await render(<CaptureScreen />);
  expect(await screen.findByText('Offline, ohne Netz keine aktuellen Daten.')).toBeTruthy();

  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await fireEvent.press(screen.getByText('Nochmal versuchen'));
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});

test('in airplane mode the viewfinder comes from the cached trips instead of an error page', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  const firstSession = await render(<CaptureScreen />);
  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
  await firstSession.unmount();

  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', countsError: 'Offline' });
  await render(<CaptureScreen />);

  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.queryByText('Das hat nicht geklappt')).toBeNull();
  expect(screen.queryByText('Offline, ohne Netz keine aktuellen Daten.')).toBeNull();
});

test('the cached trips of another person are never shown', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  const firstSession = await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await firstSession.unmount();

  mockAuth.userId = 'person-b';
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', countsError: 'Offline' });
  await render(<CaptureScreen />);

  expect(await screen.findByText('Offline, ohne Netz keine aktuellen Daten.')).toBeTruthy();
  expect(screen.queryByText('Norwegen mit dem Camper')).toBeNull();
});

test('an empty cache leads offline to the no running trip screen, not to the error page', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  const firstSession = await render(<CaptureScreen />);
  await screen.findByText('Keine laufende Reise');
  await firstSession.unmount();

  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', countsError: 'Offline' });
  await render(<CaptureScreen />);

  expect(await screen.findByText('Keine laufende Reise')).toBeTruthy();
  expect(screen.queryByText('Das hat nicht geklappt')).toBeNull();
});

test('with several running trips you pick one first', async () => {
  const a = trip({ id: 'a', name: 'Norwegen' });
  const b = trip({ id: 'b', name: 'Lissabon', my_post_count: 2 });
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([a, b]));
  // Congruent with b.my_post_count, so the display is right whether or not the
  // counter fetch has resolved by the time the assertion runs.
  mockOwnCounter.mockResolvedValueOnce(2);
  await render(<CaptureScreen />);
  expect(await screen.findByText('Für welche Reise?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Lissabon'));
  expect(await screen.findByText('2 Momente')).toBeTruthy();
  expect(screen.queryByText('Für welche Reise?')).toBeNull();
});

test('without camera or microphone permission the screen shows the way into the settings', async () => {
  mockCameraPermission = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  expect(await screen.findByText('Kamera-Zugriff fehlt')).toBeTruthy();
  await fireEvent.press(screen.getByText('Einstellungen öffnen'));
  expect(mockOpenSettings).toHaveBeenCalledTimes(1);
});

test('with exactly one running trip the camera appears directly, with trip name and counter', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip({ name: 'Norwegen mit dem Camper', my_post_count: 4 })]));
  mockOwnCounter.mockResolvedValueOnce(4);
  await render(<CaptureScreen />);
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('4 Momente')).toBeTruthy();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
});

test('after an offline capture the counter moves forward instead of standing still', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip({ my_post_count: 4 })]));
  mockOwnCounter.mockResolvedValueOnce(5);
  await render(<CaptureScreen />);
  expect(await screen.findByText('5 Momente')).toBeTruthy();
  expect(screen.queryByText('4 Momente')).toBeNull();
  expect(mockOwnCounter).toHaveBeenCalledWith('t1');
});

test('returning from the preview lets the counter catch up without the screen being built anew', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip({ my_post_count: 4 })]));
  mockOwnCounter.mockResolvedValueOnce(4);
  await render(<CaptureScreen />);
  expect(await screen.findByText('4 Momente')).toBeTruthy();

  mockOwnCounter.mockResolvedValueOnce(5);
  await refocusScreen();

  expect(await screen.findByText('5 Momente')).toBeTruthy();
  expect(mockOwnCounter).toHaveBeenCalledTimes(2);
});

test('a failing own moment count still leaves the pill on the server count, without a crash', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip({ my_post_count: 4 })]));
  mockOwnCounter.mockRejectedValueOnce(new Error('kaputt'));
  await render(<CaptureScreen />);
  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByText('4 Momente')).toBeTruthy();
});

test('a tap freezes the viewfinder, hands the photo over in memory and navigates at once', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // `mirror: true` acts ONLY on the front camera (expo-camera checks the facing
  // itself) and saves there what the viewfinder showed; without the flag a selfie
  // came out mirrored after the capture (device finding 2026-08-18).
  expect(mockTakePictureAsync).toHaveBeenCalledWith({
    pictureRef: true,
    shutterSound: false,
    mirror: true,
  });
  expect(mockPausePreview).toHaveBeenCalledTimes(1);

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/preview',
    params: { type: 'photo', duration: '0', tripId: 't1' },
  });
  const takenPhoto = handoff.takePhoto();
  expect(takenPhoto).not.toBeNull();
  await expect(takenPhoto!.file).resolves.toEqual(
    expect.objectContaining({ uri: 'file://gespeichert.jpg' })
  );
});

// Device finding 2026-08-14: the native iOS side of savePictureAsync delivers
// the field `url`, not the `uri` promised by the TS type (Android delivers
// `uri`). The handoff has to straighten both shapes to `uri`, otherwise the
// preview pulls undefined out of it and breaks without a word.
test('the handoff straightens the iOS shape (url) of savePictureAsync to uri', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockSavePictureAsync.mockResolvedValue({ url: 'file://ios-form.jpg', width: 1920, height: 1080 });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  const takenPhoto = handoff.takePhoto();
  expect(takenPhoto).not.toBeNull();
  await expect(takenPhoto!.file).resolves.toEqual({ uri: 'file://ios-form.jpg' });
});

// With flash the picture is NOT there within a few dozen ms: iOS first runs the
// metering sequence (pre-flash, exposure convergence, main flash), 1-2 s. A
// viewfinder frozen at once would stand there as a dark freeze for all of it
// (device test 2026-08-13).
test('with flash the viewfinder stays live until the picture is done and only freezes then', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePhoto: (v: { width: number; height: number; savePictureAsync: typeof mockSavePictureAsync }) => void =
    () => {};
  mockTakePictureAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePhoto = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(mockPausePreview).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();

  await act(async () => {
    resolvePhoto({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  });

  expect(mockPausePreview).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/preview',
    params: { type: 'photo', duration: '0', tripId: 't1' },
  });
});

test('a failed photo lets the viewfinder run on and the screen says so', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockTakePictureAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(await screen.findByText('Das Foto hat nicht geklappt. Versuch es nochmal.')).toBeTruthy();
  expect(mockResumePreview).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('a second, quick tap during the first capture triggers no second photo', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePhoto: (v: { width: number; height: number; savePictureAsync: typeof mockSavePictureAsync }) => void =
    () => {};
  mockTakePictureAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePhoto = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await act(async () => {
    resolvePhoto({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  });

  expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

// The screen sets the capture lock; that the tab navigator reads it in tabPress
// is checked by __tests__/_layout.test.tsx.
test('during the photo cycle the tab bar is locked and free again once the picture is done', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePhoto: (v: { width: number; height: number; savePictureAsync: typeof mockSavePictureAsync }) => void =
    () => {};
  mockTakePictureAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePhoto = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(captureLock.isLocked()).toBe(true);

  await act(async () => {
    resolvePhoto({ width: 1920, height: 1080, savePictureAsync: mockSavePictureAsync });
  });
  expect(captureLock.isLocked()).toBe(false);
});

test('a failed photo leaves the tab bar free again afterwards', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockTakePictureAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await screen.findByText('Das Foto hat nicht geklappt. Versuch es nochmal.');
  expect(captureLock.isLocked()).toBe(false);
});

test('during the video capture the tab bar is locked and free again after the stop', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  expect(captureLock.isLocked()).toBe(true);

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });
  expect(captureLock.isLocked()).toBe(false);
});

test('an unmount during a running capture releases the lock', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  const rendered = await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  expect(captureLock.isLocked()).toBe(true);

  // Wrapped in act: React does not flush the unmount (and with it the effect
  // cleanup) synchronously inside the call itself.
  await act(async () => {
    rendered.unmount();
  });
  expect(captureLock.isLocked()).toBe(false);
});

// Device finding 2026-08-14: the freeze on the video stop was the stutter you
// felt on the release (~0,1-0,3 s of file finalisation). Since the preview
// cross-fades, the viewfinder runs live up to the fade.
test('on the video stop the viewfinder keeps running live instead of freezing', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });

  expect(mockPausePreview).not.toHaveBeenCalled();
});

async function recordAndStopVideo(resolveRecord: (v: { uri: string }) => void) {
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });
}

test('the video stop warms the player up and navigates only once it is ready to play', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  mockCreatedPlayer.status = 'loading';
  await recordAndStopVideo((v) => resolveRecord(v));

  expect(mockCreateVideoPlayer).toHaveBeenCalledWith('file://video.mp4');
  expect(mockCreatedPlayer.loop).toBe(true);
  expect(mockCreatedPlayer.muted).toBe(true);
  expect(mockCreatedPlayer.audioMixingMode).toBe('mixWithOthers');
  expect(mockCreatedPlayer.play).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();

  const listener = statusChangeListener();
  expect(listener).toBeDefined();
  await act(async () => {
    mockCreatedPlayer.status = 'readyToPlay';
    listener?.({ status: 'readyToPlay' });
  });

  const takenVideo = handoff.takeVideo();
  expect(takenVideo?.kind).toBe('player');
  expect(takenVideo && takenVideo.kind === 'player' ? takenVideo.player : null).toBe(mockCreatedPlayer);
  expect(mockGetThumbnail).toHaveBeenCalledWith('file://video.mp4', expect.objectContaining({ time: 0 }));
  expect(takenVideo && takenVideo.kind === 'player' ? takenVideo.poster : null).toBe('file://poster.jpg');
  expect(mockPush).toHaveBeenCalled();
});

test('a failed poster still navigates, just without a poster', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  mockGetThumbnail.mockRejectedValueOnce(new Error('Mini-Video ohne Standbild'));
  await recordAndStopVideo((v) => resolveRecord(v));

  expect(mockPush).toHaveBeenCalled();
  const takenVideo = handoff.takeVideo();
  expect(takenVideo?.kind).toBe('player');
  expect(takenVideo && takenVideo.kind === 'player' ? takenVideo.player : null).toBe(mockCreatedPlayer);
  expect(takenVideo && takenVideo.kind === 'player' ? takenVideo.poster : undefined).toBeNull();
});

test('a player that loads too slowly still lets the stop navigate after the deadline', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  mockCreatedPlayer.status = 'loading';
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  jest.useFakeTimers();
  try {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
    await act(async () => {
      resolveRecord({ uri: 'file://video.mp4' });
    });
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(450);
    });
  } finally {
    jest.useRealTimers();
  }

  expect(mockPush).toHaveBeenCalled();
  const takenVideo = handoff.takeVideo();
  expect(takenVideo && takenVideo.kind === 'player' ? takenVideo.player : null).toBe(mockCreatedPlayer);
});

test('a failed pre-warmed player is released and the preview loads for itself', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  mockCreatedPlayer.status = 'loading';
  await recordAndStopVideo((v) => resolveRecord(v));

  const listener = statusChangeListener();
  expect(listener).toBeDefined();
  await act(async () => {
    mockCreatedPlayer.status = 'error';
    listener?.({ status: 'error' });
  });

  expect(mockPush).toHaveBeenCalled();
  expect(mockCreatedPlayer.release).toHaveBeenCalled();
  expect(handoff.takeVideo()).toBeNull();
});

// === Native capture pipeline: the switch inside the screen ===
test('with the native pipeline the stop navigates at once, without recordAsync and without pre-warming', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockNativeCapture.startCapture.mockResolvedValue(true);
  await recordAndStopVideo(() => {});
  expect(mockNativeCapture.startCapture).toHaveBeenCalledWith(90);
  expect(mockRecordAsync).not.toHaveBeenCalled();
  expect(mockCreateVideoPlayer).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalled();
  const takenVideo = handoff.takeVideo();
  expect(takenVideo?.kind).toBe('native');
  expect(mockPush.mock.calls[0][0]).toMatchObject({ params: expect.objectContaining({ duration: '3', uri: 'file://nativ.mov' }) });
});

test('if the native capture does not start, everything runs over the previous path', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockNativeCapture.startCapture.mockResolvedValueOnce(false);
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(() => new Promise((r) => { resolveRecord = r; }));
  await recordAndStopVideo((v) => resolveRecord(v));
  expect(mockRecordAsync).toHaveBeenCalled();
  expect(handoff.takeVideo()?.kind).toBe('player');
});

test('holding the shutter records a video and navigates to the preview after the release', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );

  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // 90 instead of 30: user decision 2026-08-14, the Snapchat length was too
  // tight for everyday travel.
  expect(mockRecordAsync).toHaveBeenCalledWith({ maxDuration: 90 });

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockStopRecording).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();

  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/preview',
    params: { uri: 'file://video.mp4', type: 'video', duration: expect.any(String), tripId: 't1' },
  });
});

test('before the first permission answer the screen claims no missing permission', async () => {
  mockCameraPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
  mockMicPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  const { rerender } = await render(<CaptureScreen />);
  // Rendering again (instead of a plain findByText, which would run into nothing
  // here, the screen stays blank on purpose) drives all microtasks pending so far
  // through the same act(), the resolved fetchTrips() among them. That makes sure
  // the trip is really loaded and we check the permission branch, not the
  // visually identical loading state.
  await rerender(<CaptureScreen />);

  expect(screen.queryByText('Kamera-Zugriff fehlt')).toBeNull();
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
  expect(mockRequestCameraPermission).toHaveBeenCalled();
  expect(mockRequestMicPermission).toHaveBeenCalled();

  mockCameraPermission = GRANTED;
  mockMicPermission = GRANTED;
  await rerender(<CaptureScreen />);
  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
});

const lastCameraProps = () =>
  mockCameraProps.mock.calls.at(-1)![0] as Record<string, unknown>;

test('the camera switch toggles between back and front camera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(lastCameraProps().facing).toBe('back');

  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));
  expect(lastCameraProps().facing).toBe('front');

  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));
  expect(lastCameraProps().facing).toBe('back');
});

test('the flash toggles on and off and names what the next press does', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(lastCameraProps().flash).toBe('off');

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  expect(lastCameraProps().flash).toBe('on');

  await fireEvent.press(screen.getByLabelText('Blitz ausschalten'));
  expect(lastCameraProps().flash).toBe('off');
});

test('with the flash switched on the video mode runs the torch', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  expect(lastCameraProps().enableTorch).toBe(false);

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(lastCameraProps().enableTorch).toBe(true);
});

// The controls sit at the top right, at the same height as the head pill. A
// long trip name ran under them; the pill is limited, the controls are not
// moved.
test('a long trip name is truncated instead of running under the controls', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ name: 'Sommerreise quer durch Skandinavien mit dem alten Camper' })])
  );
  await render(<CaptureScreen />);

  const name = await screen.findByText('Sommerreise quer durch Skandinavien mit dem alten Camper');
  expect(name.props.numberOfLines).toBe(1);
});

test('when only the counter fetch fails, the last known count applies instead of a 0', async () => {
  const a = trip({ id: 'a', name: 'Norwegen', my_post_count: 40 });
  const b = trip({ id: 'b', name: 'Lissabon', my_post_count: 7 });
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([a, b]));
  const firstSession = await render(<CaptureScreen />);
  await screen.findByText('Für welche Reise?');
  expect(screen.getByText('Noch 4 Tage · 40 Momente')).toBeTruthy();
  await firstSession.unmount();

  (fetchTrips as jest.Mock).mockResolvedValue({
    data: [
      { ...a, my_post_count: 0 },
      { ...b, my_post_count: 0 },
    ],
    error: null,
    countsError: 'Du bist offline. Verbinde dich und probier es nochmal.',
  });
  await render(<CaptureScreen />);

  expect(await screen.findByText('Für welche Reise?')).toBeTruthy();
  expect(screen.getByText('Noch 4 Tage · 40 Momente')).toBeTruthy();
  expect(screen.getByText('Noch 4 Tage · 7 Momente')).toBeTruthy();
  expect(screen.queryByText(/Noch kein Moment/)).toBeNull();
});

// "Bright travel journal, dark cinema" (DESIGN-LANGUAGE, guiding idea): the
// cinema palette belongs to the media screens, in this tab that is ONLY the
// viewfinder.
//
// Checked through the surfaces actually set instead of through a testID: what
// is measured is what the user sees. Both cinema tones, otherwise a `bg-1`
// surface (the picker rows) would slip through unnoticed.
const CINEMA_SURFACES: readonly string[] = [cinema['bg-0'], cinema['bg-1']];

// Read from the finished rendered tree (screen.toJSON), not from the component
// tree: there stands exactly what would go to the native side.
type RenderedNode = { props?: { style?: StyleProp<ViewStyle> }; children?: unknown[] | null };

function surfaceColors(): (string | undefined)[] {
  const colors: (string | undefined)[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const { props, children } = node as RenderedNode;
    const style = StyleSheet.flatten(props?.style) as ViewStyle | undefined;
    if (style?.backgroundColor) colors.push(style.backgroundColor as string);
    (children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return colors;
}

const inCinema = () => surfaceColors().some((color) => color !== undefined && CINEMA_SURFACES.includes(color));
const onLightSurface = () => surfaceColors().includes(palette['bg-0']);

test('the no running trip screen stands on a light surface, not in the cinema', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  await screen.findByText('Keine laufende Reise');

  expect(onLightSurface()).toBe(true);
  expect(inCinema()).toBe(false);
});

// One test each instead of one run through all three: the load error only shows
// while there is NOTHING cached, and a predecessor inside the same test would
// long have filled the cache. Separated, every case starts with the fresh
// storage from beforeEach.
test('the permission hint lies light as well', async () => {
  mockCameraPermission = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByText('Kamera-Zugriff fehlt');

  expect(onLightSurface()).toBe(true);
  expect(inCinema()).toBe(false);
});

test('the load error lies light as well', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', countsError: 'Offline' });
  await render(<CaptureScreen />);
  await screen.findByText('Das hat nicht geklappt');

  expect(onLightSurface()).toBe(true);
  expect(inCinema()).toBe(false);
});

test('the trip picker lies light as well', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ id: 'a', name: 'Norwegen' }), trip({ id: 'b', name: 'Lissabon' })])
  );
  await render(<CaptureScreen />);
  await screen.findByText('Für welche Reise?');

  expect(onLightSurface()).toBe(true);
  expect(inCinema()).toBe(false);
});

// The capture scene owns the full height (the viewfinder leans its picture on
// the bar, _layout.tsx), so the bar lies over the LIGHT states as an opaque
// overlay as well. Unlike the other tabs, whose scenes are padded from
// outside, these screens pad themselves; without it their content would
// centre across the strip the bar covers. One test each, same reason as the
// light-surface run above. barHeight(34): a device with a home indicator.
const lightStageClearance = () =>
  (StyleSheet.flatten(screen.getByTestId('light-stage').props.style) as ViewStyle).paddingBottom;

test('the no running trip screen keeps its distance from the overlaid bar', async () => {
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  await screen.findByText('Keine laufende Reise');

  expect(lightStageClearance()).toBe(cinemaStage.barHeight(34));
});

test('the permission hint keeps its distance as well', async () => {
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  mockCameraPermission = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByText('Kamera-Zugriff fehlt');

  expect(lightStageClearance()).toBe(cinemaStage.barHeight(34));
});

test('the load error keeps its distance as well', async () => {
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  (fetchTrips as jest.Mock).mockResolvedValue({ data: [], error: 'Offline, ohne Netz keine aktuellen Daten.', countsError: 'Offline' });
  await render(<CaptureScreen />);
  await screen.findByText('Das hat nicht geklappt');

  expect(lightStageClearance()).toBe(cinemaStage.barHeight(34));
});

test('the trip picker scrolls its rows clear of the bar', async () => {
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ id: 'a', name: 'Norwegen' }), trip({ id: 'b', name: 'Lissabon' })])
  );
  await render(<CaptureScreen />);
  await screen.findByText('Für welche Reise?');

  const content = StyleSheet.flatten(
    screen.getByTestId('trip-picker-list').props.contentContainerStyle
  ) as ViewStyle;
  expect(content.paddingBottom).toBe(spacing.screen + cinemaStage.barHeight(34));
});

// The picker is the one scrolling list in this otherwise cinema-shaped file,
// so it needs the same opaque strip as the other light screens. The global
// mock reports insets of 0, hence the spy for a device measurement.
test('the cover stands on the trip picker', async () => {
  const safeAreaModule = require('react-native-safe-area-context');
  const insetSpy = jest
    .spyOn(safeAreaModule, 'useSafeAreaInsets')
    .mockReturnValue({ top: 59, bottom: 0, left: 0, right: 0 });
  try {
    (fetchTrips as jest.Mock).mockResolvedValue(
      loaded([trip({ id: 'a', name: 'Norwegen' }), trip({ id: 'b', name: 'Lissabon' })])
    );
    await render(<CaptureScreen />);
    await screen.findByText('Für welche Reise?');

    expect(screen.getByTestId('status-bar-cover')).toBeTruthy();
  } finally {
    insetSpy.mockRestore();
  }
});

test('the viewfinder itself is the one place that stays the dark cinema', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(surfaceColors()).toContain(cinema['bg-0']);
});

test('the status bar follows the surface it lies on', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  const emptyRun = await render(<CaptureScreen />);
  await screen.findByText('Keine laufende Reise');
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('dark');
  expect(mockSetStatusBarStyle).not.toHaveBeenCalledWith('light');
  await emptyRun.unmount();

  mockSetStatusBarStyle.mockClear();
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('light');
});

test('the no running trip screen shows the flight ticket', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  await screen.findByText('Keine laufende Reise');

  expect(screen.getByTestId('empty-state-flight-ticket')).toBeTruthy();
});

test('over the viewfinder no flight ticket stands', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(screen.queryByTestId('empty-state-flight-ticket')).toBeNull();
});

test('the flight ticket stays out of the accessibility tree, so VoiceOver announces no useless image', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  const image = await screen.findByTestId('empty-state-flight-ticket');

  expect(image.props.accessible).toBe(false);
});

test('the flight ticket floats', async () => {
  const loopSpy = jest.spyOn(Animated, 'loop');
  const timingSpy = jest.spyOn(Animated, 'timing');
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  await screen.findByTestId('empty-state-flight-ticket');

  expect(loopSpy).toHaveBeenCalled();
  expect(timingSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ duration: 2400, useNativeDriver: true })
  );
  loopSpy.mockRestore();
  timingSpy.mockRestore();
});

test('the floating does not run linear', async () => {
  const timingSpy = jest.spyOn(Animated, 'timing');
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  await screen.findByTestId('empty-state-flight-ticket');

  const configs = timingSpy.mock.calls.map(([, c]) => c);
  expect(configs.length).toBeGreaterThan(0);
  configs.forEach((c) => {
    expect(c.easing).toBeDefined();
    expect(c.easing).not.toBe(Easing.linear);
  });
  timingSpy.mockRestore();
});

test('with reduced motion the flight ticket does not float', async () => {
  mockUseReducedMotion.mockReturnValue(true);
  const loopSpy = jest.spyOn(Animated, 'loop');
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([]));
  await render(<CaptureScreen />);
  await screen.findByTestId('empty-state-flight-ticket');

  expect(loopSpy).not.toHaveBeenCalled();
  expect(screen.getByTestId('empty-state-flight-ticket')).toBeTruthy();
  loopSpy.mockRestore();
});

// === The top edge of the viewfinder ===
//
// The camera image is edge to edge, what LIES on it is not. The header row used
// to stand on a fixed 32, so on a device with a Dynamic Island the trip pill
// stuck to the clock.
test('the header row gets out of the way of the Dynamic Island', async () => {
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  const style = StyleSheet.flatten(screen.getByTestId('viewfinder-header').props.style) as ViewStyle;
  expect(style.top).toBe(59 + spacing.base);
});

test('without an inset the header row keeps the distance it was designed with', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  const style = StyleSheet.flatten(screen.getByTestId('viewfinder-header').props.style) as ViewStyle;
  expect(style.top).toBe(spacing.xl);
});

// === Trip switcher ===
test('the trip name in the head pill leads back into the picker', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ id: 'a', name: 'Norwegen' }), trip({ id: 'b', name: 'Lissabon' })])
  );
  await render(<CaptureScreen />);
  await screen.findByText('Für welche Reise?');
  await fireEvent.press(screen.getByText('Lissabon'));
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByLabelText('Reise wechseln, Lissabon'));
  expect(await screen.findByText('Für welche Reise?')).toBeTruthy();

  await fireEvent.press(screen.getByText('Norwegen'));
  expect(await screen.findByLabelText('Reise wechseln, Norwegen')).toBeTruthy();
});

// Product concept: "switchable when several trips are running". With one
// trip there is nothing to switch to, so the name is a label, not a button.
test('with one running trip the head pill is no switcher', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(screen.queryByLabelText('Reise wechseln, Norwegen mit dem Camper')).toBeNull();
  await fireEvent.press(screen.getByText('Norwegen mit dem Camper'));
  expect(screen.queryByText('Für welche Reise?')).toBeNull();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
});

test('the picker opened from the head pill marks the current trip and can be closed', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ id: 'a', name: 'Norwegen' }), trip({ id: 'b', name: 'Lissabon' })])
  );
  await render(<CaptureScreen />);
  await screen.findByText('Für welche Reise?');
  // Opened automatically there is nothing to go back to: no close button.
  expect(screen.queryByLabelText('Schliessen')).toBeNull();
  await fireEvent.press(screen.getByText('Lissabon'));
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByLabelText('Reise wechseln, Lissabon'));
  await screen.findByText('Für welche Reise?');
  expect(screen.getByRole('button', { name: /^Lissabon/, selected: true })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Norwegen/, selected: true })).toBeNull();

  await fireEvent.press(screen.getByLabelText('Schliessen'));
  expect(await screen.findByLabelText('Reise wechseln, Lissabon')).toBeTruthy();
  expect(screen.queryByText('Für welche Reise?')).toBeNull();
});

test('the picker shows date range, remaining days and count per trip', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ id: 'a', name: 'Norwegen' }), trip({ id: 'b', name: 'Lissabon', my_post_count: 2 })])
  );
  await render(<CaptureScreen />);
  await screen.findByText('Für welche Reise?');

  expect(screen.getAllByText('1.–14. Aug 2026')).toHaveLength(2);
  expect(screen.getByText('Noch 4 Tage · 4 Momente')).toBeTruthy();
  expect(screen.getByText('Noch 4 Tage · 2 Momente')).toBeTruthy();
});

test('the picker offers creating a trip for a moment that fits none', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ id: 'a', name: 'Norwegen' }), trip({ id: 'b', name: 'Lissabon' })])
  );
  await render(<CaptureScreen />);
  await screen.findByText('Für welche Reise?');

  await fireEvent.press(screen.getByText('Neue Reise anlegen'));
  expect(mockPush).toHaveBeenCalledWith('/trip/new');
});

// === Planned trips ===
// `active` is the lifecycle status and also covers trips that have not
// started yet (groupTrips). Those are no place for a moment: the camera
// only knows running trips.
test('a planned trip does not count: the running one is chosen without a picker', async () => {
  const running = trip({ id: 'a', name: 'Norwegen' });
  const planned = trip({ id: 'b', name: 'Lissabon', start_date: '2026-09-01', end_date: '2026-09-10' });
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([running, planned]));
  await render(<CaptureScreen />);

  expect(await screen.findByLabelText('Auslöser')).toBeTruthy();
  expect(screen.getByText('Norwegen')).toBeTruthy();
  expect(screen.queryByText('Für welche Reise?')).toBeNull();
  expect(screen.queryByText('Lissabon')).toBeNull();
});

test('with only a planned trip the screen names its start instead of the camera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(
    loaded([trip({ start_date: '2026-09-01', end_date: '2026-09-10' })])
  );
  await render(<CaptureScreen />);

  expect(await screen.findByText('Keine laufende Reise')).toBeTruthy();
  expect(screen.getByText(/beginnt am 1\. Sep 2026/)).toBeTruthy();
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
});

// === The header row during a capture ===
test('during a running capture the controls in the head disappear', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.getByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByLabelText('Kamera wechseln')).toBeTruthy();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(screen.queryByText('Norwegen mit dem Camper')).toBeNull();
  expect(screen.queryByLabelText('Kamera wechseln')).toBeNull();
  expect(screen.queryByLabelText('Blitz einschalten')).toBeNull();
  expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
});

test('after the capture the header row stands again', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });

  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
  expect(screen.getByLabelText('Kamera wechseln')).toBeTruthy();
});

// === Failed capture ===
//
// On the simulator recordAsync rejects with "SimulatorNotSupported" (device log,
// ExpoCamera/CameraViewModule.swift:290), on a device a phone call can come in
// or the storage can be full.
test('a failed capture brings the header row back instead of leaving it gone', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await runStartAttempts();
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(await screen.findByText('Norwegen mit dem Camper')).toBeTruthy();
});

test('after a failed capture the next attempt starts a capture again', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await runStartAttempts();
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await screen.findByText('Norwegen mit dem Camper');
  const afterTheFailure = mockRecordAsync.mock.calls.length;
  expect(afterTheFailure).toBeGreaterThan(0);

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(mockRecordAsync.mock.calls.length).toBeGreaterThan(afterTheFailure);
});

// === Feedback on a failed capture ===
const ERROR_TEXT = 'Das Video hat nicht geklappt. Versuch es nochmal.';

// Lets the start loop of the video run to its end (the screen retries the
// start). A single advanceTimersByTime is not enough: between two rounds lies a
// promise resolution, and the next wait only comes into being after it.
// Generous beyond the number of rounds, so the test is not nailed to it.
async function runStartAttempts() {
  for (let round = 0; round < 15; round++) {
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
  }
}
// Generous over the dwell time inside the screen, so the test is not nailed to
// that number: what is checked is THAT the message goes away by itself.
const ERROR_MS_TEST = 10_000;

test('a failed capture makes the screen say so instead of staying mute', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await runStartAttempts();
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(await screen.findByText(ERROR_TEXT)).toBeTruthy();
});

test('a successful capture leaves no error message standing', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });

  expect(screen.queryByText(ERROR_TEXT)).toBeNull();
});

test('the error message disappears by itself', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockRejectedValue(new Error('SimulatorNotSupported'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  // The clock stays the same over the whole run: switching to fake timers only
  // after the failure would leave the fade-out timer a real one, and
  // advanceTimersByTime would never reach it.
  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  // Lets the promise chain of the stop run through. The start loop gives up in
  // its next round after the release, and its wait has to expire first.
  await runStartAttempts();
  expect(screen.getByText(ERROR_TEXT)).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(ERROR_MS_TEST);
  });

  expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  jest.useRealTimers();
});

// === The race for a busy session ===
//
// The session can be busy exactly when the start attempt hits it (a tab switch,
// a phone call) and then rejects with "Camera is not ready yet"
// (CameraView.swift:303). There is no event for "free again", onCameraReady
// only fires when the session starts. So the start is repeated.
test('a session hit busy at the start makes the start repeat instead of giving up', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolveRecord: (v: { uri: string }) => void = () => {};
  mockRecordAsync
    .mockRejectedValueOnce(new Error('Camera is not ready yet. Wait for onCameraReady callback'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecord = resolve;
        })
    );

  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(mockRecordAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  jest.useRealTimers();
  expect(mockRecordAsync).toHaveBeenCalledTimes(2);

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {
    resolveRecord({ uri: 'file://video.mp4' });
  });

  expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/preview',
    params: { uri: 'file://video.mp4', type: 'video', duration: expect.any(String), tripId: 't1' },
  });
});

// A start behind the release would run on to maxDuration, because the
// stopRecording() of the release has long fizzled out by then.
test('after the release no further start attempt is made', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockRejectedValue(new Error('Camera is not ready yet'));

  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  await act(async () => {});
  const afterTheRelease = mockRecordAsync.mock.calls.length;

  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  jest.useRealTimers();

  expect(mockRecordAsync).toHaveBeenCalledTimes(afterTheRelease);
});

// === Zoom steps (spec 2026-08-12-kamera-zoom-design.md) ===

// The steps are real lenses, not a magnified crop. They are only reachable
// through the virtual device in which iOS switches between the lenses itself,
// the single wide angle camera would never go below 1x.
test('the camera is told the multi lens', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(lastCameraProps().selectedLens).toBe('Rückseitige Dreifach-Kamera');
});

test('the zoom row shows the steps the device offers', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(screen.getByText('0,5×')).toBeTruthy();
  expect(screen.getByText('1×')).toBeTruthy();
  expect(screen.getByText('4×')).toBeTruthy();
});

test('the viewfinder starts at 1x, not at the widest lens', async () => {
  // The pitfall of this function: on the virtual device the native factor 1,0 IS
  // the ultra wide lens, and expo-camera sets exactly that 1,0 on every device
  // change (addDevice, updateZoom, zoom prop 0). Without setting it again the
  // viewfinder would start on 0,5x.
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(mockSetZoom).toHaveBeenCalledWith('Rückseitige Dreifach-Kamera', 2, false);
});

test('a tap on 4x puts the device on the factor 8', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent.press(screen.getByText('4×'));

  expect(mockSetZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 8, true);
});

test('after a device change the viewfinder sets the zoom again', async () => {
  // expo-camera reports the change through onAvailableLensesChanged, and it does
  // so AFTER its own updateZoom (addDevice, defer block). Only that signal proves
  // the zoom was just reset.
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('4×'));
  mockSetZoom.mockClear();

  await act(async () => {
    (lastCameraProps().onAvailableLensesChanged as (e: { lenses: string[] }) => void)({ lenses: [] });
  });

  expect(mockSetZoom).toHaveBeenCalledWith('Rückseitige Dreifach-Kamera', 8, false);
});

// The handlers are called through the props directly instead of through
// fireEvent. The reason lies in the matter itself: the surface refuses single
// touches explicitly (`onStartShouldSetResponder: false`, they belong to the
// shutter), and fireEvent takes an element that does so for not operable and
// passes the event on to the parents. These props ARE the interface to React
// Native's responder system.
async function pinch(distanceBefore: number, distanceAfter: number) {
  const surface = screen.getByTestId('viewfinder-zoom-area') as unknown as {
    props: {
      onResponderGrant: (e: object) => void;
      onResponderMove: (e: object) => void;
    };
  };
  const finger = (distance: number) => ({
    nativeEvent: {
      touches: [
        { pageX: 0, pageY: 0 },
        { pageX: 0, pageY: distance },
      ],
    },
  });
  await act(async () => {
    surface.props.onResponderGrant(finger(distanceBefore));
  });
  await act(async () => {
    surface.props.onResponderMove(finger(distanceAfter));
  });
}

test('two fingers zoom continuously', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await pinch(100, 150);

  // The fingers stand one and a half times as far apart: 1x becomes 1,5x, for the
  // device the factor 3. Set hard, so it follows the finger.
  expect(mockSetZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 3, false);
  expect(screen.getByText('1,5×')).toBeTruthy();
});

// Device finding 2026-08-14: the pinch only took "partly" during a locked
// capture. On the device two fingers almost never land in the same event, and
// the anchor was only set on the grant. The anchor is therefore moved up as
// soon as the second finger joins.
test('the pinch takes hold even when the fingers land one after the other (locked capture)', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160, identifier: 1 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut', { nativeEvent: { identifier: 1 } });

  const surface = viewfinderSurface();
  await act(async () => {
    surface.props.onResponderGrant({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }], pageX: 0, pageY: 0 } });
  });
  await act(async () => {
    (surface.props as unknown as { onResponderMove: (e: object) => void }).onResponderMove({
      nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: 0, pageY: 100 }] },
    });
  });
  await act(async () => {
    (surface.props as unknown as { onResponderMove: (e: object) => void }).onResponderMove({
      nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: 0, pageY: 150 }] },
    });
  });

  expect(mockSetZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 3, false);
});

test('the pinch ends at the limit of the device', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await pinch(100, 1);

  expect(mockSetZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 1, false);
});

test('without a multi camera no zoom row stands in the picture', async () => {
  mockLenses.mockImplementation(() => [SINGLE_CAMERA]);
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(screen.queryByTestId('zoom-selector')).toBeNull();
  mockLenses.mockImplementation((position: string) =>
    position === 'back' ? [TRIPLE_CAMERA] : [SINGLE_CAMERA]
  );
});

test('the front camera has no zoom row', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.getByTestId('zoom-selector')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));

  expect(screen.queryByTestId('zoom-selector')).toBeNull();
});

test('during a held capture the zoom row disappears', async () => {
  // React Native knows exactly one responder: a second finger on the row would
  // take the touch away from the holding press, the release would arrive and the
  // capture would end in the middle of zooming.
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(screen.queryByTestId('zoom-selector')).toBeNull();
});

test('once the capture is locked the hand is free and the zoom row is back', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  // Swipe past the lock threshold and release: the capture runs on.
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  jest.useRealTimers();

  expect(screen.getByTestId('zoom-selector')).toBeTruthy();
});

// === Cinema bar over the viewfinder (device finding 2026-08-18) ===
//
// The tab bar lies as a translucent overlay OVER the camera image, so that
// viewfinder and preview show the same surface (before, the preview showed
// ~10 % less image width). The screen announces the state through cinemaStage.
test('showing the viewfinder announces the cinema stage, leaving takes the announcement back', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  const view = await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(cinemaStage.get()).toBe(true);
  await act(async () => {
    view.unmount();
  });
  expect(cinemaStage.get()).toBe(false);
});

// Because the bar no longer takes space from the screen, the controls anchored
// at the bottom lift by its height (shared formula cinemaStage.barHeight),
// otherwise they would lie behind it.
test('the controls lift by the height of the overlaid bar', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockInsets = { top: 59, left: 0, right: 0, bottom: 34 };
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  const style = StyleSheet.flatten(
    screen.getByTestId('shutter-stage').props.style
  ) as { bottom: number };
  expect(style.bottom).toBe(spacing.base + cinemaStage.barHeight(34));
});

// === Switch fade (user finding 2026-08-18) ===
//
// The camera switch is a hardware rebuild (~350-650 ms on the device): the
// viewfinder inevitably freezes on the last frame. Instead of leaving that
// still frame bare, a blur fade lies over it during the rebuild (FaceTime
// pattern) and goes once the new camera delivers.
test('the double tap switch lays a blur fade over the viewfinder until the new camera delivers', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.queryByTestId('switch-blur')).toBeNull();

  await tap();
  await tap();
  expect(screen.getByTestId('switch-blur')).toBeTruthy();

  await act(async () => {
    (lastCameraProps().onAvailableLensesChanged as (e: { lenses: string[] }) => void)({
      lenses: [],
    });
  });
  expect(screen.queryByTestId('switch-blur')).toBeNull();
});

// Two animation attempts (3D rotation, scale dip) flew out again on the device
// ("just looks even weirder", findings 2026-08-18): the camera image stays
// UNMOVED during the switch, there is only the blur fade. This test holds that
// removal in place.
test('during the switch the camera image stands on no animation stage', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.queryByTestId('sucher-wechselbuehne')).toBeNull();
  expect(screen.queryByTestId('sucher-drehbuehne')).toBeNull();
});

test('the switch fade clears itself away if no device event arrives', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  // Fake timers BEFORE the double tap: the deadline is scheduled on the switch
  // and has to lie on the faked clock, otherwise it never expires here.
  jest.useFakeTimers();
  await tap();
  await tap();
  expect(screen.getByTestId('switch-blur')).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  jest.useRealTimers();
  expect(screen.queryByTestId('switch-blur')).toBeNull();
});

// === Instant way back from the preview (user finding 2026-08-18) ===
//
// "Discarding shows a short still frame": the blur when the preview opens
// detached the microphone (mute), and that session rebuild froze the viewfinder
// at the very moment of the return. With the PREVIEW lying over the tab the
// microphone therefore stays attached; only a real tab switch detaches it, the
// orange dot should not glow app wide.

test('with the preview lying over the tab the microphone stays attached', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockNativeCapture.startCapture.mockResolvedValue(true);
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });
  expect(mockPush).toHaveBeenCalled();

  await blurScreen();

  expect(lastCameraProps().mute).toBe(false);
});

test('on another tab the microphone is off', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await blurScreen();

  expect(lastCameraProps().mute).toBe(true);
});

test('as the preview covers it the frozen viewfinder is already running again', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockPausePreview).toHaveBeenCalledTimes(1);
  mockResumePreview.mockClear();

  await blurScreen();

  expect(mockResumePreview).toHaveBeenCalled();
});

// === Double tap switches the camera (Snapchat pattern) ===

// Same way as with the pinch: the props ARE the interface to the responder
// system (see the reasoning at pinch() above).
function viewfinderSurface() {
  return screen.getByTestId('viewfinder-zoom-area') as unknown as {
    props: {
      onStartShouldSetResponder: () => boolean;
      onResponderGrant: (e: object) => void;
      onResponderRelease: (e: object) => void;
      onTouchStart: (e: object) => void;
      onTouchEnd: (e: object) => void;
    };
  };
}

async function tap(x = 100, y = 300, to = { x: 100, y: 300 }) {
  const surface = viewfinderSurface();
  await act(async () => {
    surface.props.onResponderGrant({ nativeEvent: { touches: [{ pageX: x, pageY: y }], pageX: x, pageY: y } });
  });
  await act(async () => {
    surface.props.onResponderRelease({ nativeEvent: { touches: [], pageX: to.x, pageY: to.y } });
  });
}

test('a double tap on the viewfinder switches the camera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(lastCameraProps().facing).toBe('back');

  await tap();
  await tap();

  expect(lastCameraProps().facing).toBe('front');
});

test('a single tap switches nothing', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await tap();

  expect(lastCameraProps().facing).toBe('back');
});

test('two taps with a pause in between are no double tap', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await tap();
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  await tap();
  jest.useRealTimers();

  expect(lastCameraProps().facing).toBe('back');
});

test('two taps in different corners are no double tap', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await tap(40, 120, { x: 40, y: 120 });
  await tap(300, 600, { x: 300, y: 600 });

  expect(lastCameraProps().facing).toBe('back');
});

test('a swipe over the viewfinder is no tap', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await tap(100, 300, { x: 100, y: 500 });
  await tap(100, 300, { x: 100, y: 500 });

  expect(lastCameraProps().facing).toBe('back');
});

test('the double tap starts on the new camera at 1x again', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('4×'));

  await tap();
  await tap();
  await fireEvent.press(screen.getByLabelText('Kamera wechseln'));

  expect(screen.getByLabelText('Zoom 1×').props.accessibilityState.selected).toBe(true);
});

test('entering the screen snaps a zoomed in state back to 1x', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('4×'));
  expect(screen.getByLabelText('Zoom 4×').props.accessibilityState.selected).toBe(true);

  await refocusScreen();

  expect(screen.getByLabelText('Zoom 1×').props.accessibilityState.selected).toBe(true);
});

test('the wide angle (0,5x) stays put when the screen is entered', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await fireEvent.press(screen.getByText('0,5×'));
  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState.selected).toBe(true);

  await refocusScreen();

  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState.selected).toBe(true);
});

test('during a running fallback capture the double tap does not switch the camera', async () => {
  // While recordAsync runs (fallback, the native start refused, the mock
  // default), the session rebuild of the facing switch would abort the capture.
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(viewfinderSurface().props.onStartShouldSetResponder()).toBe(false);
  await tap();
  await tap();

  expect(lastCameraProps().facing).toBe('back');
});

// === Tap to focus (wish from 2026-08-13) ===
//
// expo-camera only knows the global autoFocus mode, no focus point, so focus()
// lives in the own native module. Here only the arrival of the tap is checked,
// the device coordinates are converted natively by the preview layer.
test('a tap on the viewfinder focuses at exactly that point', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await tap(140, 420, { x: 140, y: 420 });

  expect(mockFocus).toHaveBeenCalledWith(140, 420);
});

test('a swipe over the viewfinder does not focus', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await tap(100, 300, { x: 100, y: 520 });

  expect(mockFocus).not.toHaveBeenCalled();
});

test('during a locked capture the tap focuses as well', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  // Swipe over the lock and release: the capture runs on locked.
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(viewfinderSurface().props.onStartShouldSetResponder()).toBe(true);
  await tap(200, 350, { x: 200, y: 350 });

  expect(mockFocus).toHaveBeenCalledWith(200, 350);
});

// During a HELD capture the responder belongs to the shutter, the surface gets
// no responder events. The RAW touch events do arrive though (they follow the
// touch target, not the responder), and over them the tap of a second finger
// focuses even in the middle of filming (device finding 2026-08-14). Tab bar
// and shutter never hit the surface, their taps aim at their own views.
test('during a held capture the tap of a second finger focuses', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  const surface = viewfinderSurface();
  await act(async () => {
    surface.props.onTouchStart({ nativeEvent: { identifier: 7, pageX: 210, pageY: 380 } });
  });
  await act(async () => {
    surface.props.onTouchEnd({ nativeEvent: { identifier: 7, pageX: 212, pageY: 382 } });
  });

  expect(mockFocus).toHaveBeenCalledWith(212, 382);
});

test('a swipe of the second finger during the capture does not focus', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  const surface = viewfinderSurface();
  await act(async () => {
    surface.props.onTouchStart({ nativeEvent: { identifier: 7, pageX: 210, pageY: 380 } });
  });
  await act(async () => {
    surface.props.onTouchEnd({ nativeEvent: { identifier: 7, pageX: 210, pageY: 500 } });
  });

  expect(mockFocus).not.toHaveBeenCalled();
});

test('during a locked fallback capture the double tap still does not switch the camera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await tap();
  await tap();

  expect(lastCameraProps().facing).toBe('back');
});

// === Double tap switch DURING the native capture (wish 2026-08-17) ===
//
// With the own pipeline the capture survives the facing switch: expo-camera
// only swaps the device input of the same running session
// (CameraSessionManager.addDevice), the own data outputs stay attached and keep
// delivering after the rebuild.

test('during a held native capture the double tap of the second finger switches the camera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockNativeCapture.startCapture.mockResolvedValue(true);
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100, identifier: 1 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // The shutter owns the responder: the second finger arrives through the raw
  // touch events (same way as the focus tap above).
  const surface = viewfinderSurface();
  for (const id of [7, 8]) {
    await act(async () => {
      surface.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      surface.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  expect(lastCameraProps().facing).toBe('front');
  expect(mockNativeCapture.stopCapture).not.toHaveBeenCalled();
});

test('during a locked native capture the double tap switches the camera', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockNativeCapture.startCapture.mockResolvedValue(true);
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', { nativeEvent: { pageX: 160 } });
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await tap();
  await tap();

  expect(lastCameraProps().facing).toBe('front');
  expect(mockNativeCapture.stopCapture).not.toHaveBeenCalled();
});

test('the focus ring stands at the tap point and clears itself away', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await tap(140, 420, { x: 140, y: 420 });

  const ring = screen.getByTestId('focus-ring');
  const style = StyleSheet.flatten(ring.props.style) as { left: number; top: number };
  // Centred over the point, not with its corner on it.
  expect(style.left).toBeLessThan(140);
  expect(style.top).toBeLessThan(420);

  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  jest.useRealTimers();
  expect(screen.queryByTestId('focus-ring')).toBeNull();
});

// === Permanent video mode (spec 2026-08-13-aufnahme-tempo-design.md §3) ===
//
// The mode change photo/video rebuilt the native session and cost the video
// start up to ~1 s. The camera now runs fixed in video mode; the microphone
// stays attached to the session (orange dot in the viewfinder, decided on
// purpose) and is detached through `mute` on tab blur, otherwise the dot would
// glow app wide, tab screens do stay mounted.
test('the camera runs permanently in video mode and the microphone is on while focused', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(lastCameraProps().mode).toBe('video');
  expect(lastCameraProps().mute).toBe(false);
});

// === Drag zoom (spec 2026-08-13-aufnahme-tempo-design.md §7) ===
//
// The two ends are checked deterministically: far beyond the full way stands
// the device maximum, back at the landing point the start factor, both
// independent of the window height of the test device.
test('dragging up during the capture zooms to the maximum, dragging back restores the start', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, pageY: 600 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  mockSetZoom.mockClear();
  // Travel of 1600 pt: beyond every 40 % way, so clamped to the maximum of the
  // device (zoom limits mock: native max 120).
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: -1000 },
  });
  expect(mockSetZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 120, false);

  // Back at the landing point: start factor 1x, on the ultra wide device that is
  // native 2,0 (base 0,5).
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: 600 },
  });
  expect(mockSetZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 2, false);
});

// === MultiCam path (spec 2026-08-18-multikamera-instant-wechsel §8/§9) ===
//
// When the own MultiCam session carries the viewfinder, the CameraView is gone:
// the camera switch only swaps the inputs of the same running session (no fade,
// no waiting), zoom and focus go to the own module. Everything above it stays
// the same for both branches, so the tests above keep running unchanged on the
// expo-camera branch.
async function multiCamViewfinder() {
  mockMultiCamera.available.mockReturnValue(true);
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
}

async function holdCapture() {
  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();
}

test('the viewfinder is the multi camera view, not a CameraView', async () => {
  await multiCamViewfinder();

  expect(screen.getByTestId('multicam-viewfinder')).toBeTruthy();
  expect(screen.queryByTestId('kameraview-attrappe')).toBeNull();
  // The CameraView is not merely hidden, it never comes into being: two camera
  // sessions on the same devices would exclude each other anyway.
  expect(mockCameraProps).not.toHaveBeenCalled();
});

test('the focus starts the session, and a failed start falls back to expo-camera', async () => {
  mockMultiCamera.available.mockReturnValue(true);
  mockMultiCamera.start.mockResolvedValue(false);
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  expect(mockMultiCamera.start).toHaveBeenCalled();
  expect(await screen.findByTestId('kameraview-attrappe')).toBeTruthy();
  expect(screen.queryByTestId('multicam-viewfinder')).toBeNull();
});

test('the double tap calls switchCamera and shows no switch fade', async () => {
  await multiCamViewfinder();
  expect(screen.getByTestId('zoom-selector')).toBeTruthy();

  await tap();
  await tap();

  expect(mockMultiCamera.switchCamera).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('switch-blur')).toBeNull();
  // The front has only one lens: the row disappearing proves the facing switched
  // at once (there is no CameraView prop here).
  expect(screen.queryByTestId('zoom-selector')).toBeNull();
});

test('the double tap switches during a held capture as well', async () => {
  await multiCamViewfinder();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, identifier: 1 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // The shutter owns the responder, the second finger arrives through the raw
  // touch events (same way as the focus tap).
  const surface = viewfinderSurface();
  for (const id of [7, 8]) {
    await act(async () => {
      surface.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      surface.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  expect(mockMultiCamera.switchCamera).toHaveBeenCalledTimes(1);
});

// The switch has two jobs, not one: swap the camera AND move the native zoom
// over to the new direction. The factor keeps applying PER DIRECTION (user
// finding 2026-08-19); the module remembers only the CAMERA per direction, not
// the display.
test('after the switch the remembered factor of the new direction applies', async () => {
  await multiCamViewfinder();
  await fireEvent.press(screen.getByText('0,5×'));
  mockMultiCamera.setZoom.mockClear();

  // Over to the front camera: the start value 1x applied there last.
  mockMultiCamera.switchCamera.mockResolvedValue('front');
  await tap();
  await tap();
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'front', factor: 1 }, false);

  // And back: the back side stands on its remembered 0,5x again, as a native lens
  // (ultra wide on its 1,0) AND in the row.
  mockMultiCamera.switchCamera.mockResolvedValue('back');
  mockMultiCamera.setZoom.mockClear();
  await tap();
  await tap();
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'ultrawide', factor: 1 }, false);
  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState.selected).toBe(true);

  mockMultiCamera.switchCamera.mockResolvedValue(null);
  mockMultiCamera.setZoom.mockClear();
  await tap();
  await tap();
  expect(mockMultiCamera.setZoom).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Zoom 0,5×').props.accessibilityState.selected).toBe(true);
});

// The same memory above 1x: the entering effect (a zoomed in state snaps back
// to 1x when the SCREEN is entered) must not hang on the identity of the zoom
// setter, otherwise it runs again on every camera switch and throws the just
// restored factor away (the drag zoom jumped back to 1x on every switch back in
// the middle of a capture).
test('a remembered zoomed in factor survives the round trip too', async () => {
  await multiCamViewfinder();
  await fireEvent.press(screen.getByText('4×'));

  mockMultiCamera.switchCamera.mockResolvedValue('front');
  await tap();
  await tap();

  mockMultiCamera.switchCamera.mockResolvedValue('back');
  mockMultiCamera.setZoom.mockClear();
  await tap();
  await tap();

  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'wide', factor: 4 }, false);
  expect(screen.getByLabelText('Zoom 4×').props.accessibilityState.selected).toBe(true);
});

test('an outdated switch answer is discarded', async () => {
  await multiCamViewfinder();

  let firstAnswer: (r: 'front' | 'back' | null) => void = () => {};
  mockMultiCamera.switchCamera
    .mockImplementationOnce(
      () => new Promise<'front' | 'back' | null>((r) => { firstAnswer = r; })
    )
    .mockResolvedValueOnce('back');

  await tap();
  await tap();
  await tap();
  await tap();

  mockMultiCamera.setZoom.mockClear();
  await act(async () => {
    firstAnswer('front');
  });
  expect(mockMultiCamera.setZoom).not.toHaveBeenCalled();
  expect(screen.getByTestId('zoom-selector')).toBeTruthy();
});

// The viewfinder takes gestures at once, the first session setup needs 300-400
// ms: a double tap in that window is refused natively (null in the adapter),
// nobody switched. The screen switches the direction optimistically and has to
// roll it back on that answer, otherwise it would stand permanently the wrong
// way round to the session.
test('a double tap in the setup window rolls the view back to the session', async () => {
  await multiCamViewfinder();
  mockMultiCamera.switchCamera.mockResolvedValue(null);
  mockMultiCamera.setZoom.mockClear();

  await tap();
  await tap();

  // The back side stayed active: its step row stands in the picture again (the
  // front would have none), and there was nothing to move.
  expect(screen.getByTestId('zoom-selector')).toBeTruthy();
  expect(mockMultiCamera.setZoom).not.toHaveBeenCalled();
});

// The front has a single lens, so no step row. The MultiCam session can zoom it
// all the same, digitally through videoZoomFactor (user finding 2026-08-19). In
// the expo-camera branch the front deliberately stays without zoom, the way
// there leads only over the virtual multi device.
test('the front camera zooms digitally through the pinch', async () => {
  await multiCamViewfinder();
  mockMultiCamera.switchCamera.mockResolvedValue('front');
  await tap();
  await tap();
  mockMultiCamera.setZoom.mockClear();

  const surface = viewfinderSurface() as unknown as {
    props: { onMoveShouldSetResponder: (e: object) => boolean };
  };
  expect(
    surface.props.onMoveShouldSetResponder({
      nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: 0, pageY: 100 }] },
    })
  ).toBe(true);

  // The fingers stand twice as far apart: 1x becomes 2x.
  await pinch(100, 200);
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'front', factor: 2 }, false);
});

// The drag zoom in the middle of a capture, across the switch (user finding
// 2026-08-19: after the double tap it was impossible to zoom at all). The
// anchor is rewritten to the NEW direction on the switch: factor from the
// direction memory, limits of the new camera.
test('the drag zoom keeps working after a switch in the middle of the capture', async () => {
  await multiCamViewfinder();
  // Front and back side get DIFFERENT limits: only then does the clamped end
  // value prove that the device of the new direction was really asked.
  mockZoomLimits.mockImplementation((name: string) =>
    name === 'Frontkamera' ? { min: 1, max: 40 } : { min: 1, max: 120 }
  );

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, pageY: 600, identifier: 1 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  mockMultiCamera.switchCamera.mockResolvedValue('front');
  const surface = viewfinderSurface();
  for (const id of [7, 8]) {
    await act(async () => {
      surface.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      surface.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  // The drag now zooms the FRONT: full way up, clamped to ITS device maximum 40
  // (the base of the front is 1). The identifier is the HOLDING finger from the
  // pressIn, the shutter listens only to it.
  mockMultiCamera.setZoom.mockClear();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: -1000, identifier: 1 },
  });
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'front', factor: 40 }, false);

  // Back to the back side: the anchor stands on its remembered 1x, and the way
  // counts from where the finger is standing NOW (page Y -1000, the top of the
  // front's pull). Another full way up from there ends at the back's display
  // maximum (native 120 x base 0,5 = 60x).
  mockMultiCamera.switchCamera.mockResolvedValue('back');
  for (const id of [9, 10]) {
    await act(async () => {
      surface.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      surface.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }
  mockMultiCamera.setZoom.mockClear();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: -2600, identifier: 1 },
  });
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'wide', factor: 60 }, false);
});

test('a switch in the middle of the drag leaves the new direction at 1x', async () => {
  await multiCamViewfinder();
  mockZoomLimits.mockImplementation((name: string) =>
    name === 'Frontkamera' ? { min: 1, max: 40 } : { min: 1, max: 120 }
  );

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, pageY: 600, identifier: 1 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  // Part of the way up: the back side now stands zoomed in.
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: 400, identifier: 1 },
  });
  const zoomedIn = mockMultiCamera.setZoom.mock.lastCall?.[0] as MultiCamTargetMock;
  expect(zoomedIn.camera).toBe('wide');
  expect(zoomedIn.factor).toBeGreaterThan(2);

  // The second finger switches to the front, which has never been zoomed.
  mockMultiCamera.switchCamera.mockResolvedValue('front');
  const surface = viewfinderSurface();
  for (const id of [7, 8]) {
    await act(async () => {
      surface.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      surface.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  // The holding finger has not moved since the switch: the front therefore
  // stays at its remembered 1x instead of inheriting the travel of the back.
  mockMultiCamera.setZoom.mockClear();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: 400, identifier: 1 },
  });
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'front', factor: 1 }, false);
});

test('setting the zoom goes to the module as a MultiCam target', async () => {
  await multiCamViewfinder();

  await fireEvent.press(screen.getByText('0,5×'));

  // 0,5x is not a slider position but a lens of its own: the session changes to
  // the ultra wide and stands there on its 1,0.
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith(
    { camera: 'ultrawide', factor: 1 },
    true
  );
  // The virtual device is still ENUMERATED (hence steps and limits) but does not
  // run in the session: nothing goes through nativeZoom any more.
  expect(mockSetZoom).not.toHaveBeenCalled();
});

test('the pressure level ernst at 0,5x puts the zoom back on 1x', async () => {
  await multiCamViewfinder();
  await fireEvent.press(screen.getByText('0,5×'));
  mockMultiCamera.setZoom.mockClear();

  const reportPressure = mockMultiCamera.onPressureChange.mock.calls.at(-1)![0];
  // 'nominal' is no reason to step in: the user zooms back out themselves.
  await act(async () => {
    reportPressure('nominal');
  });
  expect(mockMultiCamera.setZoom).not.toHaveBeenCalled();

  // 'ernst' means: two cameras at once are too much for the device. The ultra
  // wide lens is the expensive part, 1x runs on a single one.
  await act(async () => {
    reportPressure('ernst');
  });
  expect(mockMultiCamera.setZoom).toHaveBeenCalledWith({ camera: 'wide', factor: 1 }, false);
  expect(screen.getByLabelText('Zoom 1×').props.accessibilityState.selected).toBe(true);
});

test('a tap focuses through the multi camera module', async () => {
  await multiCamViewfinder();

  await tap(140, 420, { x: 140, y: 420 });

  expect(mockMultiCamera.focus).toHaveBeenCalledWith(140, 420);
  expect(mockFocus).not.toHaveBeenCalled();
  expect(screen.getByTestId('focus-ring')).toBeTruthy();
});

test('a blur without a preview stops the session', async () => {
  await multiCamViewfinder();
  expect(mockMultiCamera.stop).not.toHaveBeenCalled();

  await blurScreen();

  expect(mockMultiCamera.stop).toHaveBeenCalledTimes(1);
});

// === The warm-up during a swipe (features/camera/warmup.ts) ===
//
// Since the tabs can be swiped, the screen arrives gradually instead of at
// once. The session needs a moment to build up, so it starts WITH the
// gesture: waiting for focus would drag a black surface through the whole
// swipe.
test('the session builds up while the swipe is still under way, before focus', async () => {
  await multiCamViewfinder();
  await blurScreen();
  mockMultiCamera.start.mockClear();

  await act(async () => warmup.set(true));

  expect(mockMultiCamera.start).toHaveBeenCalled();
});

test('a swipe taken back lets the session go again', async () => {
  await multiCamViewfinder();
  await blurScreen();
  await act(async () => warmup.set(true));
  mockMultiCamera.stop.mockClear();

  await act(async () => warmup.set(false));

  expect(mockMultiCamera.stop).toHaveBeenCalledTimes(1);
});

// The finger swipes AWAY from the camera and turns back: the flag drops for
// a moment while focus stays. Tearing the session down and building it right
// back up would be the most expensive moment of all.
test('the warm-up falling away does not stop a session the focus is holding', async () => {
  await multiCamViewfinder();
  await act(async () => warmup.set(true));
  mockMultiCamera.stop.mockClear();

  await act(async () => warmup.set(false));

  expect(mockMultiCamera.stop).not.toHaveBeenCalled();
});

test('a blur during a running capture does not stop the session', async () => {
  await multiCamViewfinder();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', { nativeEvent: { pageX: 100 } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  await blurScreen();

  expect(mockMultiCamera.stop).not.toHaveBeenCalled();
});

test('with the preview lying over the tab the session keeps running', async () => {
  await multiCamViewfinder();

  await holdCapture();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });
  expect(mockPush).toHaveBeenCalled();

  await blurScreen();

  expect(mockMultiCamera.stop).not.toHaveBeenCalled();
});

// === Video capture in the MultiCam path ===
//
// The capture comes into being natively in the OWN session: the same writer as
// in the native capture pipeline, only fed by the distributor of the MultiCam
// session. That is why only the start and stop call change here; everything
// downstream still hangs on nativeCapture, because it reaches the same running
// capture natively.
test('in the MultiCam branch the video start goes to the multi camera module', async () => {
  await multiCamViewfinder();

  await holdCapture();

  expect(mockMultiCamera.startCapture).toHaveBeenCalledWith(90);
  expect(mockNativeCapture.startCapture).not.toHaveBeenCalled();
  expect(mockRecordAsync).not.toHaveBeenCalled();
});

test('the stop takes file and duration from the multi camera module', async () => {
  await multiCamViewfinder();

  await holdCapture();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });

  expect(mockMultiCamera.stopCapture).toHaveBeenCalledTimes(1);
  expect(mockNativeCapture.stopCapture).not.toHaveBeenCalled();
  expect(mockCreateVideoPlayer).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/preview',
    params: { uri: 'file://multicam.mov', type: 'video', duration: '6', tripId: 't1' },
  });
  expect(handoff.takeVideo()?.kind).toBe('native');
  expect(mockNativeCapture.fileReady).toHaveBeenCalled();
});

test('a failed start in the MultiCam branch brings the error pill instead of recordAsync', async () => {
  await multiCamViewfinder();
  mockMultiCamera.startCapture.mockResolvedValue(false);

  await holdCapture();
  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });

  expect(mockMultiCamera.startCapture).toHaveBeenCalledWith(90);
  expect(await screen.findByText(ERROR_TEXT)).toBeTruthy();
  expect(mockRecordAsync).not.toHaveBeenCalled();
  expect(mockMultiCamera.stopCapture).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  expect(captureLock.isLocked()).toBe(false);
});

// === The stabilization pill (MultiCam branch only) ===
test('the stabilization toggle carries the wish to the module', async () => {
  mockMultiCamera.available.mockReturnValue(true);
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  // The mount effect reports the default (on) once.
  expect(mockMultiCamera.setStabilization).toHaveBeenCalledTimes(1);
  expect(mockMultiCamera.setStabilization).toHaveBeenLastCalledWith(true);

  await fireEvent.press(screen.getByLabelText('Stabilisierung ausschalten'));
  expect(mockMultiCamera.setStabilization).toHaveBeenLastCalledWith(false);

  await fireEvent.press(screen.getByLabelText('Stabilisierung einschalten'));
  expect(mockMultiCamera.setStabilization).toHaveBeenLastCalledWith(true);
});

test('the expo-camera fallback shows no stabilization pill', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.queryByLabelText('Stabilisierung ausschalten')).toBeNull();
  expect(screen.queryByLabelText('Stabilisierung einschalten')).toBeNull();
  expect(mockMultiCamera.setStabilization).not.toHaveBeenCalled();
});

test('during a running capture the stabilization pill disappears too', async () => {
  mockMultiCamera.available.mockReturnValue(true);
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockMultiCamera.startCapture.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  expect(screen.getByLabelText('Stabilisierung ausschalten')).toBeTruthy();

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  expect(screen.queryByLabelText('Stabilisierung ausschalten')).toBeNull();
});

test('in the MultiCam branch the flash lights during the capture and goes out on the release', async () => {
  await multiCamViewfinder();

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  expect(mockMultiCamera.setFlash).toHaveBeenLastCalledWith(false);

  await holdCapture();
  expect(mockMultiCamera.setFlash).toHaveBeenLastCalledWith(true);

  await act(async () => {
    await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  });
  expect(mockMultiCamera.setFlash).toHaveBeenLastCalledWith(false);
});

// Nails the dependency array of the flash effect: the lamp hangs on a device,
// so a switch in the middle of a capture has to set it again. (Natively the
// module follows the wanted state on the switch itself, because this call here
// can lose the race against the main queue; the effect stays the duplication
// that brings the wish there in the first place.)
test('a camera switch during the capture sets the flash again', async () => {
  await multiCamViewfinder();
  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  await holdCapture();
  expect(mockMultiCamera.setFlash).toHaveBeenLastCalledWith(true);
  mockMultiCamera.setFlash.mockClear();

  // The double tap of the second finger switches during a held capture too (the
  // responder belongs to the shutter, see above).
  const surface = viewfinderSurface();
  for (const id of [7, 8]) {
    await act(async () => {
      surface.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      surface.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  expect(mockMultiCamera.switchCamera).toHaveBeenCalledTimes(1);
  expect(mockMultiCamera.setFlash).toHaveBeenCalled();
  expect(mockMultiCamera.setFlash).toHaveBeenLastCalledWith(true);
});

// === Photo in the MultiCam path ===
test('the shutter takes the photo from the multi camera module and goes to the preview', async () => {
  await multiCamViewfinder();

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(mockMultiCamera.takePhoto).toHaveBeenCalledTimes(1);
  expect(mockTakePictureAsync).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/preview',
    params: { type: 'photo', duration: '0', tripId: 't1' },
  });
  const takenPhoto = handoff.takePhoto();
  expect(takenPhoto).not.toBeNull();
  await expect(takenPhoto!.file).resolves.toEqual({ uri: 'file:///tmp/reelive-foto-1.jpg' });
  expect(takenPhoto!.ref).toEqual({ uri: 'file:///tmp/reelive-foto-1.jpg' });
});

test('in the MultiCam path the viewfinder is never paused', async () => {
  await multiCamViewfinder();

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  // The grab has run (otherwise the rest would check the absence of nothing), and
  // still nobody froze or thawed anything.
  expect(mockMultiCamera.takePhoto).toHaveBeenCalledTimes(1);
  expect(mockPausePreview).not.toHaveBeenCalled();
  expect(mockResumePreview).not.toHaveBeenCalled();
});

test('the flash setting travels into the photo grab', async () => {
  await multiCamViewfinder();

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockMultiCamera.takePhoto).toHaveBeenLastCalledWith(false);

  await fireEvent.press(screen.getByLabelText('Blitz einschalten'));
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(mockMultiCamera.takePhoto).toHaveBeenLastCalledWith(true);
});

test('a failed photo in the MultiCam branch is told by the pill and leaves the tab bar free', async () => {
  await multiCamViewfinder();
  mockMultiCamera.takePhoto.mockResolvedValue(null);

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  expect(mockMultiCamera.takePhoto).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Das Foto hat nicht geklappt. Versuch es nochmal.')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
  expect(captureLock.isLocked()).toBe(false);
});

test('a second, quick tap in the MultiCam branch triggers no second photo', async () => {
  await multiCamViewfinder();
  let resolvePhoto: (v: { uri: string; width: number; height: number }) => void = () => {};
  mockMultiCamera.takePhoto.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePhoto = resolve;
      })
  );

  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');
  expect(captureLock.isLocked()).toBe(true);
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn');
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressOut');

  await act(async () => {
    resolvePhoto({ uri: 'file:///tmp/reelive-foto-1.jpg', width: 1080, height: 1920 });
  });

  expect(mockMultiCamera.takePhoto).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(captureLock.isLocked()).toBe(false);
});

// Both overlays are pure answers of the picture to something the finger has
// already done. They must not swallow the next touch, and they have nothing
// to add for VoiceOver.
test('focus ring and switch fade take no touch and say nothing to VoiceOver', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  jest.useFakeTimers();
  await tap(140, 420, { x: 140, y: 420 });
  const ring = screen.getByTestId('focus-ring');
  expect(ring.props.pointerEvents).toBe('none');
  expect(ring.props.accessible).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  jest.useRealTimers();

  await tap();
  await tap();
  const fade = screen.getByTestId('switch-blur').parent;
  expect(fade?.props.pointerEvents).toBe('none');
  expect(fade?.props.accessible).toBe(false);
});

// Both fallbacks of zoomLimitsFor: the device is silent about its bounds
// (nativeZoom.zoomLimits returns null). Without them the drag zoom would have
// no anchor at all and stop working.
test('a silent device falls back to the factor of its own last switch point', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockZoomLimits.mockImplementation(() => null);
  mockRecordAsync.mockImplementation(() => new Promise(() => {}));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await holdCapture();

  mockSetZoom.mockClear();
  // Triple camera: switch points 2 and 8, base 0,5, so the last step is 4x
  // displayed, which is native 8. That derived maximum replaces the missing
  // answer of the device (without the fallback the drag would not zoom at all).
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: -1000 },
  });
  expect(mockSetZoom).toHaveBeenLastCalledWith('Rückseitige Dreifach-Kamera', 8, false);
});

test('a silent multicam lens without switch points falls back to a maximum of 8x', async () => {
  await multiCamViewfinder();
  // The front is a single lens: no switch points, so zoomDevice() gives up and
  // the second fallback takes over. It stays silent about its bounds too.
  mockZoomLimits.mockImplementation(() => null);

  jest.useFakeTimers();
  await fireEvent(screen.getByLabelText('Auslöser'), 'pressIn', {
    nativeEvent: { pageX: 100, pageY: 600, identifier: 1 },
  });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  jest.useRealTimers();

  mockMultiCamera.switchCamera.mockResolvedValue('front');
  const surface = viewfinderSurface();
  for (const id of [7, 8]) {
    await act(async () => {
      surface.props.onTouchStart({ nativeEvent: { identifier: id, pageX: 210, pageY: 380 } });
    });
    await act(async () => {
      surface.props.onTouchEnd({ nativeEvent: { identifier: id, pageX: 211, pageY: 381 } });
    });
  }

  mockMultiCamera.setZoom.mockClear();
  await fireEvent(screen.getByLabelText('Auslöser'), 'touchMove', {
    nativeEvent: { pageX: 100, pageY: -1000, identifier: 1 },
  });
  expect(mockMultiCamera.setZoom).toHaveBeenLastCalledWith({ camera: 'front', factor: 8 }, false);
});

// === Library import (spec 2026-08-27, confirmation 2026-08-27) ===

test('the import button opens the intro sheet; Abbrechen closes it without touching the library', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(screen.getByText('Momente aus Fotos')).toBeTruthy();
  expect(screen.getByText('Nur Momente aus dem Reisezeitraum (1.–14. Aug 2026)')).toBeTruthy();
  expect(screen.getByText('Videos bis 90 Sekunden')).toBeTruthy();
  expect(screen.getByText('Ohne Caption, bis zum Recap versiegelt, höchstens 20 auf einmal')).toBeTruthy();
  expect(mockPickFromLibrary).not.toHaveBeenCalled();

  // Final-Review Critical 1: the sheet's panel clears the cinema tab bar
  // (barHeight(0) here, insets are 0 in this test) so its actions never sit
  // underneath the bar.
  const panel = screen.getByTestId('sheet-panel');
  const flattenedPanel = Object.assign({}, ...[panel.props.style].flat(Infinity).filter(Boolean));
  expect(flattenedPanel.paddingBottom).toBe(spacing.xl + cinemaStage.barHeight(0));

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });

  expect(screen.queryByText('Momente aus Fotos')).toBeNull();
  expect(mockPickFromLibrary).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(false);
});

test('"Fotos auswählen" opens the picker, and a canceled picker leaves the viewfinder untouched', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(mockPickFromLibrary).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Momente aus Fotos')).toBeNull();
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockDiscardRefused).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(screen.queryByTestId('import-progress')).toBeNull();
  expect(captureLock.isLocked()).toBe(false);
});

test('elements outside the trip period end in "Nichts zum Einsenden", nothing is submitted', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///old.jpg', Date.UTC(2026, 6, 20, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(screen.getByText('Nichts zum Einsenden')).toBeTruthy();
  expect(
    screen.getByText('Der Moment kommt nicht mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).')
  ).toBeTruthy();
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///old.jpg' })]);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Verstanden'));
  });

  expect(screen.queryByText('Nichts zum Einsenden')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();
});

test('the confirmation previews the accepted elements and names the refusals; Abbrechen releases every copy', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      {
        uri: 'file:///long.mov',
        kind: 'video' as const,
        durationMs: 120_000,
        exif: null,
        creationTime: Date.UTC(2026, 7, 5, 12),
        location: null,
      },
      pickedPhoto('file:///c.jpg', Date.UTC(2026, 7, 5, 12)),
    ],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(screen.getByText('Einsenden?')).toBeTruthy();
  expect(screen.getAllByTestId('import-thumb-photo')).toHaveLength(2);
  expect(screen.getByText('2 Momente passen in den Reisezeitraum.')).toBeTruthy();
  expect(screen.getByText('1 von 3 Momenten kommt nicht mit: Video länger als 90 Sekunden.')).toBeTruthy();
  // The refused copy leaves tmp as soon as it is assessed.
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///long.mov' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });

  // Cancelling releases the accepted copies too: nothing of this batch
  // ever entered the queue.
  expect(mockDiscardRefused).toHaveBeenLastCalledWith([
    expect.objectContaining({ uri: 'file:///a.jpg' }),
    expect.objectContaining({ uri: 'file:///c.jpg' }),
  ]);
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(false);
});

test('confirming runs the batch: the shutter yields to the progress pill, the lock holds through the cover, the counter refetches', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockOwnCounter.mockImplementation(async () => 4);
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      pickedPhoto('file:///b.jpg', Date.UTC(2026, 7, 6, 12)),
    ],
  });
  let finishSubmit: (outcome: { submitted: number; failed: number }) => void = () => {};
  mockSubmitImports.mockImplementation(
    (_accepted: unknown, _target: unknown, onProgress: (done: number, total: number) => void) =>
      new Promise<{ submitted: number; failed: number }>((resolve) => {
        onProgress(1, 2);
        finishSubmit = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await screen.findByText('4 Momente');

  await openLibrary();
  expect(screen.getByText('2 Momente passen in den Reisezeitraum.')).toBeTruthy();
  expect(mockSubmitImports).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('2 Momente einsenden'));
  });

  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).toHaveBeenCalledWith(
    [
      expect.objectContaining({ accepted: true, captured_at: '2026-08-05T12:00:00.000Z' }),
      expect.objectContaining({ accepted: true, captured_at: '2026-08-06T12:00:00.000Z' }),
    ],
    { tripId: 't1', authorId: 'u1' },
    expect.any(Function)
  );
  // During the batch: no shutter, no header, no tab switch, a progress pill.
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
  expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();
  expect(screen.queryByText('Norwegen mit dem Camper')).toBeNull();
  expect(screen.getByTestId('import-progress')).toBeTruthy();
  expect(screen.getByText('1 von 2 Momenten eingesendet')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(true);

  await act(async () => {
    finishSubmit({ submitted: 2, failed: 0 });
  });

  // The lock stays until the cover is gone.
  expect(captureLock.isLocked()).toBe(true);
  expect(screen.queryByTestId('import-progress')).toBeNull();
  expect(mockAnimationProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ visible: true, counter: 4, added: 2 })
  );

  mockOwnCounter.mockImplementation(async () => 6);
  await act(async () => {
    mockFinishAnimation?.();
  });

  expect(captureLock.isLocked()).toBe(false);
  expect(mockAnimationProps).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(screen.getByLabelText('Momente aus Fotos einsenden')).toBeTruthy();
  await screen.findByText('6 Momente');
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();
});

test('a failure inside the batch is explained after the animation, refusals are not repeated', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      {
        uri: 'file:///long.mov',
        kind: 'video' as const,
        durationMs: 120_000,
        exif: null,
        creationTime: Date.UTC(2026, 7, 5, 12),
        location: null,
      },
      pickedPhoto('file:///c.jpg', Date.UTC(2026, 7, 5, 12)),
    ],
  });
  mockSubmitImports.mockResolvedValue({ submitted: 1, failed: 1 });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('2 Momente einsenden'));
  });

  expect(mockSubmitImports.mock.calls[0][0]).toHaveLength(2);
  expect(mockAnimationProps).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, added: 1 }));
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();
  expect(captureLock.isLocked()).toBe(true);

  await act(async () => {
    mockFinishAnimation?.();
  });

  expect(captureLock.isLocked()).toBe(false);
  // Only the batch failure: the long video was already explained in the
  // confirmation sheet and does not count against the two that were sent.
  expect(
    screen.getByText('1 von 2 Momenten wurden nicht eingesendet: beim Sichern gescheitert.')
  ).toBeTruthy();
});

test('when every confirmed element fails there is no animation, only the summary', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 1 });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });

  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(screen.getByText('Der Moment wurde nicht eingesendet: beim Sichern gescheitert.')).toBeTruthy();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(false);
});

test('a failing picker says so in the pill', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockRejectedValue(new Error('picker broke'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(screen.getByText('Deine Fotos liessen sich nicht öffnen. Probier es nochmal.')).toBeTruthy();
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
});

test('without a session the picked elements are released and the pill says so', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  // The session goes away AFTER the viewfinder stands (a screen without a
  // session would not load its trips); the refocus re-renders the screen so
  // the handler closes over the missing user id.
  mockAuth.userId = null;
  await refocusScreen();
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(screen.getByText('Du bist nicht angemeldet. Melde dich an und probier es nochmal.')).toBeTruthy();
});

// Final-Review Important 2: the confirmation sheet is bound to the trip its
// elements were assessed against. Tabs stay swipeable while a sheet is
// open, so the trip underneath it can swap (here: the trip that was open
// ends or is revealed, and the only other active trip is auto-selected).
test('a trip change under the open confirmation discards the batch instead of submitting it elsewhere', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  expect(screen.getByText('Einsenden?')).toBeTruthy();

  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip({ id: 't2', name: 'Andere Reise' })]));
  await refocusScreen();
  // The header pill shows the new trip, its visible text is the trip name.
  await screen.findByText('Andere Reise');

  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockDiscardRefused).toHaveBeenLastCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
});

// Final-Review Minor 4: the same guard lives a second time inside
// confirmImport, for the render that can land between the trip effect
// above firing and the actual button press, here exercised via the session
// going away instead (the trip stays the same, so the sheet survives the
// refocus and the person can still press the button).
test('a session lost between the sheets releases the copies and says so', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  expect(screen.getByText('Einsenden?')).toBeTruthy();

  mockAuth.userId = null;
  await refocusScreen();
  // The sheet is still there after the refocus since the trip did not change.
  await screen.findByLabelText('1 Moment einsenden');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });

  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockDiscardRefused).toHaveBeenLastCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(screen.getByText('Du bist nicht angemeldet. Melde dich an und probier es nochmal.')).toBeTruthy();
});

test('while the picker is pending the header button opens no second intro, and during the batch it is gone', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePicker: (result: { canceled: true } | { canceled: false; media: unknown[] }) => void =
    () => {};
  mockPickFromLibrary.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  // "Fotos auswählen" closes the intro and starts the picker; the native
  // round trip is still pending (requestReadAccess awaits a permission
  // check before launchImageLibraryAsync even presents), so the header
  // button is back on screen and tappable.
  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });
  expect(screen.queryByText('Momente aus Fotos')).toBeNull();

  await act(async () => {
    resolvePicker({ canceled: true });
  });
  expect(mockPickFromLibrary).toHaveBeenCalledTimes(1);

  // Once a batch runs the header, and with it the button, is removed.
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  let resolveSubmit: (outcome: { submitted: number; failed: number }) => void = () => {};
  mockSubmitImports.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSubmit = resolve;
      })
  );
  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });

  expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();
  expect(mockSubmitImports).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveSubmit({ submitted: 1, failed: 0 });
  });
});

test('a blur during the batch clears the import state so the viewfinder comes back', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  let resolveSubmit: (outcome: { submitted: number; failed: number }) => void = () => {};
  mockSubmitImports.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSubmit = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });
  expect(screen.getByTestId('import-progress')).toBeTruthy();

  await blurScreen();

  await act(async () => {
    resolveSubmit({ submitted: 1, failed: 0 });
  });

  await refocusScreen();
  await screen.findByLabelText('Auslöser');

  expect(screen.queryByTestId('import-progress')).toBeNull();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(captureLock.isLocked()).toBe(false);
});

test('a blur while the picker is open releases the picked copies', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePicker: (result: { canceled: false; media: unknown[] }) => void = () => {};
  mockPickFromLibrary.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  await blurScreen();

  await act(async () => {
    resolvePicker({
      canceled: false,
      media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
    });
  });

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(screen.queryByText('Einsenden?')).toBeNull();
});
