import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Keyboard, Platform, StyleSheet } from 'react-native';
import * as React from 'react';
import { spacing } from '@/theme/tokens';

const mockReplace = jest.fn();
const mockBack = jest.fn();
// Final-Review, Important 3: the preview is TAKEN OFF the stack instead of
// being replaced by a new camera screen. Only without a way back (deep link)
// does replace remain, hence steerable.
let mockCanGoBack = true;
let mockParams: Record<string, string | undefined> = {
  uri: 'file://foto.jpg',
  type: 'photo',
  duration: '0',
  tripId: 't1',
};
const mockStackScreenOptions = jest.fn();
const mockSetOptions = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
    canGoBack: () => mockCanGoBack,
  }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useLocalSearchParams: () => mockParams,
  Stack: {
    Screen: (props: { options?: object }) => {
      mockStackScreenOptions(props.options);
      return null;
    },
  },
}));

// expo-image is a native view; the stand-in passes the source prop through so
// the tests can check whether a ref or a uri arrives.
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

const mockSetStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({
  setStatusBarStyle: (...args: unknown[]) => mockSetStatusBarStyle(...args),
}));

// expo-video needs a native module that this Jest setup does not have (the
// same limitation as expo-image in Task 8, see its report), hence mocked
// instead of really imported. `useVideoPlayer` returns a tangible fake player
// object so the video follow-up can check that the preview runs muted and in
// a loop.
const mockVideoPlayer = {
  loop: false,
  muted: false,
  playing: false,
  audioMixingMode: 'auto',
  play: jest.fn(),
  addListener: jest.fn(
    (_event: string, _listener: (e: { isPlaying: boolean }) => void) => ({ remove: jest.fn() })
  ),
};
const mockUseVideoPlayer = jest.fn((source: unknown, setup?: (p: typeof mockVideoPlayer) => void) => {
  setup?.(mockVideoPlayer);
  return mockVideoPlayer;
});
jest.mock('expo-video', () => ({
  useVideoPlayer: (source: unknown, setup?: (p: unknown) => void) => mockUseVideoPlayer(source, setup),
  VideoView: (props: Record<string, unknown>) => {
    const ReactActual = require('react');
    const { View } = require('react-native');
    // player and onFirstFrameRender are passed through: the tests check
    // whether the prewarmed player from the handoff plays and whether the
    // poster gives way to the first drawn frame.
    return ReactActual.createElement(View, {
      testID: props.testID,
      player: props.player,
      onFirstFrameRender: props.onFirstFrameRender,
    });
  },
}));

// Native instant preview (Task 12): the module stays a black box for this
// screen, the mock only renders a view with the testID passed through.
// Indirection because of the same hoisting trap as with the other mocks in
// this file (jest.mock is hoisted above the const declaration, an access to a
// variable with the prefix `mock` is exempt from that).
const mockNativeDiscard = jest.fn();
jest.mock('@/features/camera/nativeCapture', () => ({
  discard: () => mockNativeDiscard(),
  InstantPreview: (props: { testID?: string }) => {
    const ReactActual = require('react');
    const { View } = require('react-native');
    return ReactActual.createElement(View, { testID: props.testID });
  },
}));

const mockNewMomentId = jest.fn();
const mockPreparePhoto = jest.fn();
const mockPrepareVideo = jest.fn();
// Final-Review, Critical 2: captures move out of the volatile cache to a
// durable place when enqueued, and both ways of leaving (discarding, failed
// submitting) clean up.
const mockPersistDurably = jest.fn();
const mockRemoveMomentFiles = jest.fn();
const mockDiscardFile = jest.fn();
const mockDiscardIntermediates = jest.fn();
jest.mock('@/features/moments/media', () => ({
  newMomentId: () => mockNewMomentId(),
  preparePhoto: (uri: string) => mockPreparePhoto(uri),
  prepareVideo: (uri: string) => mockPrepareVideo(uri),
  persistDurably: (postId: string, files: unknown) => mockPersistDurably(postId, files),
  removeMomentFiles: (postId: string) => mockRemoveMomentFiles(postId),
  discardFile: (uri: string) => mockDiscardFile(uri),
  discardIntermediates: (raw: string, prepared: unknown) =>
    mockDiscardIntermediates(raw, prepared),
  storageKey: (tripId: string, postId: string, extension: string) =>
    `trips/${tripId}/${postId}.${extension}`,
  // Important 5: the extension comes from the actual capture.
  mediaExtension: (mediaType: string, uri: string) =>
    mediaType === 'video' ? (uri.endsWith('.mov') ? 'mov' : 'mp4') : 'jpg',
  thumbKey: (tripId: string, postId: string) => `trips/${tripId}/${postId}_t.jpg`,
}));

const mockEnqueueJob = jest.fn();
jest.mock('@/features/moments/uploadWorker', () => ({
  enqueueJob: (job: unknown) => mockEnqueueJob(job),
}));

// Task-13-Fix-Runde-2: the author id is read from useAuth() when enqueuing,
// no longer by the worker from the session when writing.
const mockAuth: { userId: string | null } = { userId: 'u1' };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

const mockNow = jest.fn();
const mockDeterminePlace = jest.fn();
jest.mock('@/features/moments/placeAndTime', () => ({
  now: () => mockNow(),
  determinePlace: () => mockDeterminePlace(),
}));

// The real success animation runs ~2.5 s and is tested for itself
// (MomentSubmissionAnimation.test.tsx), here only the contract matters:
// "becomes visible as soon as the job is enqueued, and navigates on via
// onFinished". The mock fires onFinished synchronously as soon as it becomes
// visible so the existing expectations on mockReplace/mockBack get by without
// timer steering.
const mockAnimationVisible = jest.fn();
const mockAnimationProps = jest.fn();
jest.mock('@/components/MomentSubmissionAnimation', () => {
  const react = jest.requireActual('react');
  return {
    MomentSubmissionAnimation: ({
      visible,
      onFinished,
      counter,
    }: {
      visible: boolean;
      onFinished: () => void;
      counter?: number | null;
    }) => {
      mockAnimationVisible(visible);
      mockAnimationProps({ visible, counter });
      react.useEffect(() => {
        if (visible) onFinished();
      }, [visible, onFinished]);
      return null;
    },
  };
});

// The counter before the moment comes from counter.ts (offline proof); the
// animation rolls up by one from there. The fetch may fail, then only the
// number falls away.
const mockOwnCounter = jest.fn();
jest.mock('@/features/moments/counter', () => ({
  ownMomentCount: (tripId: string) => mockOwnCounter(tripId),
}));

import * as handoff from '@/features/camera/handoff';
import type { VideoPlayer } from 'expo-video';
import PreviewScreen from '../preview';

// Not hard wired to "14:34": which local time comes out of the UTC ISO value
// depends on the time zone of the running machine (here by chance
// Europe/Zurich/CEST, on a CI runner with UTC it would be "12:34"). The same
// conversion as in preview.tsx makes the expectation correct independently of
// that.
const CAPTURED_AT = '2026-08-07T12:34:00.000Z';
function expectedTime(iso: string): string {
  const date = new Date(iso);
  const twoDigits = (n: number) => String(n).padStart(2, '0');
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

// At rest only a chip stands where the caption goes; the input field comes
// into being with the tap on it (and fetches the keyboard via autoFocus).
// Whoever wants to write in a test has to open it first.
async function openCaption() {
  await fireEvent.press(screen.getByTestId('caption-chip'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVideoPlayer.playing = false;
  mockAuth.userId = 'u1';
  mockParams = { uri: 'file://foto.jpg', type: 'photo', duration: '0', tripId: 't1' };
  mockNewMomentId.mockReturnValue('post-1');
  mockPreparePhoto.mockResolvedValue({ medium: 'file://medium.jpg', thumb: 'file://thumb.jpg' });
  mockPrepareVideo.mockResolvedValue({ medium: 'file://video.mp4', thumb: 'file://thumb.jpg' });
  // Returns what the real implementation returns: the paths in the durable
  // folder. Exactly those have to land in the job, not the cache paths.
  mockPersistDurably.mockImplementation(async (postId: string) => ({
    medium: `file://dokumente/momente/${postId}/medium.jpg`,
    thumb: `file://dokumente/momente/${postId}/thumb.jpg`,
  }));
  mockEnqueueJob.mockResolvedValue(undefined);
  mockOwnCounter.mockResolvedValue(4);
  mockNow.mockReturnValue({ captured_at: CAPTURED_AT, captured_tz: 'Europe/Zurich' });
  mockCanGoBack = true;
  // Hanging by default (never resolving): every test that needs a particular
  // answer overrides this explicitly. That keeps it visible that the display
  // does not wait for the place before showing the screen.
  mockDeterminePlace.mockImplementation(() => new Promise(() => {}));
  // Empties the holder between the tests: without a test photo every existing
  // photo test runs the old uri way (photo === null), without a test player
  // every video test runs on its own hook player.
  handoff.takePhoto();
  handoff.takeVideo();
});

test('the capture appears at once, without waiting for the place', async () => {
  await render(<PreviewScreen />);
  expect(await screen.findByText('Einsenden')).toBeTruthy();
});

test('a caption beyond 120 characters is cut back to the limit', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  await openCaption();
  const input = screen.getByLabelText('Bildunterschrift');
  await fireEvent.changeText(input, 'a'.repeat(150));
  expect((input.props.value as string).length).toBe(120);
});

test('place and time appear in small type as soon as determinePlace has answered', async () => {
  let resolvePlace: (v: { lat: number; lng: number; place_name: string }) => void = () => {};
  mockDeterminePlace.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePlace = resolve;
      })
  );
  await render(<PreviewScreen />);
  expect(screen.queryByText(/Luzern/)).toBeNull();

  await act(async () => {
    resolvePlace({ lat: 47.05, lng: 8.31, place_name: 'Luzern' });
  });

  expect(await screen.findByText(`Luzern · ${expectedTime(CAPTURED_AT)}`)).toBeTruthy();
});

test('without a place name the pill shows the time alone', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  expect(await screen.findByText(expectedTime(CAPTURED_AT))).toBeTruthy();
});

test('submitting enqueues exactly one job and navigates back to the camera', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: 47.05, lng: 8.31, place_name: 'Luzern' });
  await render(<PreviewScreen />);
  await openCaption();
  await fireEvent.changeText(screen.getByLabelText('Bildunterschrift'), 'Was für ein Abend');

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockPreparePhoto).toHaveBeenCalledWith('file://foto.jpg');
  expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
  const job = mockEnqueueJob.mock.calls[0][0];
  expect(job).toMatchObject({
    id: 'post-1',
    post_id: 'post-1',
    trip_id: 't1',
    author_id: 'u1',
    typ: 'photo',
    // The durable paths, not the ones from the cache (Critical 2).
    medium_uri: 'file://dokumente/momente/post-1/medium.jpg',
    thumb_uri: 'file://dokumente/momente/post-1/thumb.jpg',
    storage_key: 'trips/t1/post-1.jpg',
    thumb_key: 'trips/t1/post-1_t.jpg',
    caption: 'Was für ein Abend',
    captured_at: CAPTURED_AT,
    captured_tz: 'Europe/Zurich',
    lat: 47.05,
    lng: 8.31,
    place_name: 'Luzern',
    duration_s: null,
    zustand: 'wartet',
    versuche: 0,
    zeile_angelegt: false,
    medium_geladen: false,
    thumb_geladen: false,
  });
  // Important 3: the preview is taken off the stack, not replaced by a second
  // camera screen.
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

// Without a way back (straight into the preview by deep link) there is
// nothing to take off the stack, only there does replace remain right.
test('without a way back on the stack the return leads to the camera via replace', async () => {
  mockCanGoBack = false;
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockReplace).toHaveBeenCalledWith('/capture');
  expect(mockBack).not.toHaveBeenCalled();
});

test('the success animation shows only after the job is enqueued and navigates only through its onFinished', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  expect(mockAnimationVisible).toHaveBeenLastCalledWith(false);

  const order: string[] = [];
  mockEnqueueJob.mockImplementation(async () => {
    order.push('enqueued');
  });
  mockBack.mockImplementation(() => {
    order.push('navigated');
  });

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationVisible).toHaveBeenLastCalledWith(true);
  expect(order).toEqual(['enqueued', 'navigated']);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('the success animation gets the trip counter to roll up from', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockOwnCounter.mockResolvedValue(11);
  await render(<PreviewScreen />);
  expect(mockOwnCounter).toHaveBeenCalledWith('t1');

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationProps).toHaveBeenLastCalledWith({ visible: true, counter: 11 });
});

test('when the counter fetch fails the success animation runs without a number', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockOwnCounter.mockRejectedValue(new Error('broken queue'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationProps).toHaveBeenLastCalledWith({ visible: true, counter: null });
});

// Device finding 2026-08-14: a handoff without a usable uri (the iOS shape of
// savePictureAsync before it was straightened out in handoff.ts) let
// submitting break off WITHOUT A WORD: no job, no message, the screen just
// stood there. If the source is missing, that has to fail visibly like every
// other submit error.
test('a handoff without a uri lets submitting fail visibly instead of silently', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  handoff.setPhoto({ ref: {}, file: Promise.resolve({}) } as never);
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockEnqueueJob).not.toHaveBeenCalled();
  expect(screen.getByText(/konnte nicht gesichert werden/)).toBeTruthy();
  expect(mockAnimationVisible).toHaveBeenLastCalledWith(false);
});

test('when enqueuing fails the success animation stays invisible and nothing navigates', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockEnqueueJob.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockAnimationVisible).toHaveBeenLastCalledWith(false);
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test('an empty caption is enqueued as null instead of an empty string', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({ caption: null });
});

test('the capture time freezes when the screen appears instead of moving with every keystroke', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  // From here on the clock would deliver a later value: whoever reads it
  // again while typing writes the wrong moment into the job.
  mockNow.mockReturnValue({ captured_at: '2026-08-07T13:00:00.000Z', captured_tz: 'Europe/Zurich' });
  await openCaption();
  await fireEvent.changeText(screen.getByLabelText('Bildunterschrift'), 'abc');

  await act(async () => {
    await fireEvent.press(screen.getByTestId('submit-button'));
  });

  expect(mockNow).toHaveBeenCalledTimes(1);
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({ captured_at: CAPTURED_AT });
});

test('a video carries its duration in duration_s and goes through prepareVideo', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockPrepareVideo).toHaveBeenCalledWith('file://video.mp4');
  expect(mockPreparePhoto).not.toHaveBeenCalled();
  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({
    typ: 'video',
    duration_s: 12,
    storage_key: 'trips/t1/post-1.mp4',
  });
});

// Final-Review, Important 5: expo-camera records QuickTime on iOS. Until the
// fix wave that landed under ….mp4 with content type video/mp4, permanently
// mislabelled, and because the key is immutable per moment it could not be
// healed afterwards.
test('an iOS capture (.mov) gets a storage key with the actual extension', async () => {
  mockParams = { uri: 'file://video.mov', type: 'video', duration: '12', tripId: 't1' };
  mockPrepareVideo.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockEnqueueJob.mock.calls[0][0]).toMatchObject({
    storage_key: 'trips/t1/post-1.mov',
    // The thumbnail stays JPEG, no matter the container of the medium.
    thumb_key: 'trips/t1/post-1_t.jpg',
  });
});

// Follow-up from Task 8: the last look before sealing shows "the captured
// thing edge to edge" for videos too (Spec) instead of only a symbol with a
// duration: muted, in a loop, without controls (a preview, not a player).
test('a video is shown as a muted, endlessly looping preview without controls', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(mockUseVideoPlayer).toHaveBeenCalledWith('file://video.mp4', expect.any(Function));
  expect(mockVideoPlayer.loop).toBe(true);
  expect(mockVideoPlayer.muted).toBe(true);
  // mixWithOthers: the player does not claim the audio session exclusively,
  // otherwise the microphone rebuild of the camera screen underneath pauses
  // it shortly after opening and the entry stutters (device finding
  // 2026-08-14).
  expect(mockVideoPlayer.audioMixingMode).toBe('mixWithOthers');
  expect(mockVideoPlayer.play).toHaveBeenCalled();
  expect(screen.getByTestId('video-preview')).toBeTruthy();
});

// Device finding 2026-08-14: on leaving, the camera screen under this preview
// releases its microphone and rebuilds its capture session while doing so;
// iOS pauses the muted player up here along with it, once, shortly after
// opening. Without an answer to that every video stood as a still.
function playingChangeListener(): ((e: { isPlaying: boolean }) => void) | undefined {
  const call = mockVideoPlayer.addListener.mock.calls.find(
    ([event]) => event === 'playingChange'
  );
  return call?.[1];
}

test('a foreign pause of the player is answered at once with playing on', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  const listener = playingChangeListener();
  expect(listener).toBeDefined();
  mockVideoPlayer.play.mockClear();
  await act(async () => {
    listener?.({ isPlaying: false });
  });
  expect(mockVideoPlayer.play).toHaveBeenCalled();
});

test('when the session rebuild swallows the immediate resume, a straggler steps in', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  const listener = playingChangeListener();
  expect(listener).toBeDefined();

  jest.useFakeTimers();
  try {
    mockVideoPlayer.play.mockClear();
    mockVideoPlayer.playing = false;
    await act(async () => {
      listener?.({ isPlaying: false });
      jest.advanceTimersByTime(300);
    });
    expect(mockVideoPlayer.play.mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally {
    jest.useRealTimers();
  }
});

// Device finding 2026-08-14: neither slide nor fade. Since the poster
// (frame 0) stands at once there is no dark frame left to bridge, and the
// hard cut from the living viewfinder to the full preview image is the
// Snapchat pattern (§5 exception, Spec 2026-08-13 §6). A fade would only slow
// the switch down artificially.
test('the switch from the camera to here cuts hard, without slide and without fade', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(mockStackScreenOptions).toHaveBeenCalledWith(
    expect.objectContaining({ animation: 'none' })
  );
});

// The prewarmed player from the handoff (device finding 2026-08-14, Snapchat
// as the benchmark): the camera creates and loads it BEFORE the navigation,
// the preview only shows it, and releases it on leaving (createVideoPlayer
// demands an explicit release, otherwise the native player leaks).
function prewarmedPlayer() {
  return {
    playing: true,
    play: jest.fn(),
    release: jest.fn(),
    addListener: jest.fn(
      (_event: string, _listener: (e: { isPlaying: boolean }) => void) => ({ remove: jest.fn() })
    ),
  };
}

test('a prewarmed player from the handoff goes straight to the VideoView', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = prewarmedPlayer();
  handoff.setVideo({ kind: 'player', player: player as unknown as VideoPlayer, poster: null });
  await render(<PreviewScreen />);

  expect(screen.getByTestId('video-preview').props.player).toBe(player);
  // No second load of the same file: the own hook gets no source.
  expect(mockUseVideoPlayer).toHaveBeenCalledWith(null, expect.any(Function));
});

// The poster (frame 0, delivered by the stop) stands over the VideoView at
// once, which needs ~0.8 s on the device for its first draw (measured
// 2026-08-14), and then gives way invisibly because the loop starts at
// frame 0.
test('the poster stands over the video at once and gives way to the first drawn frame', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = prewarmedPlayer();
  handoff.setVideo({
    kind: 'player',
    player: player as unknown as VideoPlayer,
    poster: 'file://poster.jpg',
  });
  await render(<PreviewScreen />);

  expect(screen.getByTestId('video-poster').props.source).toEqual({ uri: 'file://poster.jpg' });

  await act(async () => {
    screen.getByTestId('video-preview').props.onFirstFrameRender();
  });
  expect(screen.queryByTestId('video-poster')).toBeNull();
});

test('the taken over player is released on leaving and the poster cleaned up', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = prewarmedPlayer();
  handoff.setVideo({
    kind: 'player',
    player: player as unknown as VideoPlayer,
    poster: 'file://poster.jpg',
  });
  const { unmount } = await render(<PreviewScreen />);

  expect(player.release).not.toHaveBeenCalled();
  await act(async () => {
    unmount();
  });
  expect(player.release).toHaveBeenCalled();
  expect(mockDiscardFile).toHaveBeenCalledWith('file://poster.jpg');
});

test('the taken over player is played on as well after a foreign pause', async () => {
  mockParams = { uri: 'file://video.mp4', type: 'video', duration: '12', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const player = prewarmedPlayer();
  handoff.setVideo({ kind: 'player', player: player as unknown as VideoPlayer, poster: null });
  await render(<PreviewScreen />);

  const call = player.addListener.mock.calls.find(([event]) => event === 'playingChange');
  const listener = call?.[1];
  expect(listener).toBeDefined();
  player.play.mockClear();
  await act(async () => {
    listener?.({ isPlaying: false });
  });
  expect(player.play).toHaveBeenCalled();
});

// --- Native handoff (Task 12: InstantPreview, submitting waits, discarding
// cleans up natively) ---
test('a native handoff shows the instant preview instead of the VideoView', async () => {
  mockParams = { uri: 'file://nativ.mov', type: 'video', duration: '3', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  handoff.setVideo({ kind: 'native', fileReady: Promise.resolve() });
  await render(<PreviewScreen />);
  expect(screen.getByTestId('instant-preview')).toBeTruthy();
  expect(screen.queryByTestId('video-preview')).toBeNull();
});

test('on a native handoff submitting waits for fileReady', async () => {
  mockParams = { uri: 'file://nativ.mov', type: 'video', duration: '3', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  let resolveReady: () => void = () => {};
  handoff.setVideo({
    kind: 'native',
    fileReady: new Promise((r) => {
      resolveReady = r;
    }),
  });
  await render(<PreviewScreen />);
  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });
  expect(mockEnqueueJob).not.toHaveBeenCalled();
  await act(async () => {
    resolveReady();
  });
  expect(mockEnqueueJob).toHaveBeenCalled();
  expect(mockPrepareVideo).toHaveBeenCalledWith('file://nativ.mov');
});

test('when the background write fails, submitting takes the existing error path', async () => {
  mockParams = { uri: 'file://nativ.mov', type: 'video', duration: '3', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  handoff.setVideo({ kind: 'native', fileReady: Promise.reject(new Error('full')) });
  await render(<PreviewScreen />);
  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });
  expect(mockEnqueueJob).not.toHaveBeenCalled();
  expect(screen.getByText(/konnte nicht gesichert werden/)).toBeTruthy();
});

test('discarding a native handoff cleans up through the module', async () => {
  mockParams = { uri: 'file://nativ.mov', type: 'video', duration: '3', tripId: 't1' };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  handoff.setVideo({ kind: 'native', fileReady: Promise.resolve() });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('discard-button'));
  expect(mockNativeDiscard).toHaveBeenCalled();
  expect(mockDiscardFile).not.toHaveBeenCalled();
});

test('no video player is created for a photo', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(mockUseVideoPlayer).toHaveBeenCalledWith(null, expect.any(Function));
  expect(screen.queryByTestId('video-preview')).toBeNull();
});

test('discarding enqueues nothing, clears the raw capture away and goes back to the camera', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  // Discarding is the X in the header, no longer a text button next to the
  // submit: it is the way back, not an equal alternative.
  await fireEvent.press(screen.getByTestId('discard-button'));

  expect(mockEnqueueJob).not.toHaveBeenCalled();
  expect(mockPreparePhoto).not.toHaveBeenCalled();
  // Critical 2: this way too used to leave a file in the cache.
  expect(mockDiscardFile).toHaveBeenCalledWith('file://foto.jpg');
  expect(mockBack).toHaveBeenCalledTimes(1);
});

// Way there and way back are both instant cuts (user decision 2026-08-18: a
// tried 250 ms fade flew out again). This test holds the decision: discarding
// does NOT switch an exit animation, it simply goes back.
test('discarding goes back instantly, without switching an exit animation', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await fireEvent.press(screen.getByTestId('discard-button'));

  expect(mockSetOptions).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('only after enqueuing are the raw capture and the intermediates released', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockPersistDurably).toHaveBeenCalledWith('post-1', {
    medium: 'file://medium.jpg',
    thumb: 'file://thumb.jpg',
  });
  expect(mockDiscardFile).toHaveBeenCalledWith('file://foto.jpg');
  expect(mockDiscardIntermediates).toHaveBeenCalledWith('file://foto.jpg', {
    medium: 'file://medium.jpg',
    thumb: 'file://thumb.jpg',
  });
  expect(mockRemoveMomentFiles).not.toHaveBeenCalled();
});

// Without a job in the queue nobody would ever come past these files again to
// clean them up, they would lie in the documents directory forever.
test('when enqueuing fails the durable folder is cleared away again', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockEnqueueJob.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockRemoveMomentFiles).toHaveBeenCalledWith('post-1');
  // The raw capture stays: the screen stays standing and a second attempt
  // still needs it.
  expect(mockDiscardFile).not.toHaveBeenCalled();
});

// === Re-Review: the cleanup path destroyed the capture for videos ===
// prepareVideo returns the raw capture ITSELF as the medium. As long as
// persistDurably moved instead of copied, the error path (removeMomentFiles)
// took the only copy with it: a second press on submit already failed at the
// still frame, the moment was gone. The photo test above let the gap through
// because preparePhoto creates new files anyway.
test('for a video the raw capture survives a failed enqueue', async () => {
  mockParams = { uri: 'file://video.mov', type: 'video', duration: '12', tripId: 't1' };
  // Exactly the case: the medium IS the raw capture.
  mockPrepareVideo.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockEnqueueJob.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  // The durable COPY is cleared away, without a job it is ownerless.
  expect(mockRemoveMomentFiles).toHaveBeenCalledWith('post-1');
  // The raw capture under no circumstances: it is the only copy.
  expect(mockDiscardFile).not.toHaveBeenCalledWith('file://video.mov');
  expect(mockDiscardFile).not.toHaveBeenCalled();
  // And not through the detour "intermediates" either: the function is handed
  // the raw capture so it can leave exactly that one out.
  expect(mockDiscardIntermediates).toHaveBeenCalledWith('file://video.mov', {
    medium: 'file://video.mov',
    thumb: 'file://thumb.jpg',
  });
});

// The proof of the pudding: the second attempt really goes through.
test('after a failed submit the second attempt succeeds for a video', async () => {
  mockParams = { uri: 'file://video.mov', type: 'video', duration: '12', tripId: 't1' };
  mockPrepareVideo.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockEnqueueJob.mockRejectedValueOnce(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockPrepareVideo).toHaveBeenCalledTimes(2);
  expect(mockEnqueueJob).toHaveBeenCalledTimes(2);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

// The copying itself fails (no space): even then the capture has to survive,
// that is exactly why it is copied instead of moved.
test('when the durable save already fails, the raw capture stays put', async () => {
  mockParams = { uri: 'file://video.mov', type: 'video', duration: '12', tripId: 't1' };
  mockPrepareVideo.mockResolvedValue({ medium: 'file://video.mov', thumb: 'file://thumb.jpg' });
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockPersistDurably.mockRejectedValue(new Error('ENOSPC'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockDiscardFile).not.toHaveBeenCalled();
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();
});

test('an error while preparing enqueues no job, shows a message and leaves the screen standing', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockPreparePhoto.mockRejectedValue(new Error('ENOSPC: no space left on device'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockEnqueueJob).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();
  // The screen stays standing, submitting is still there and can be tried
  // again.
  expect(screen.getByText('Einsenden')).toBeTruthy();
});

test('an error while enqueuing never passes as success and the screen stays standing', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  mockEnqueueJob.mockRejectedValue(new Error('SQLITE_FULL'));
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/Speicherplatz/)).toBeTruthy();
});

test('without a trip_id (navigation gap from the camera screen) submitting is refused with a clear cause', async () => {
  mockParams = { uri: 'file://foto.jpg', type: 'photo', duration: '0', tripId: undefined };
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockPreparePhoto).not.toHaveBeenCalled();
  expect(mockEnqueueJob).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/keiner Reise zuordnen/)).toBeTruthy();
});

// Task-13-Fix-Runde-2: a job without an author id must never come into being.
// In practice the root layout does not even let this screen appear without a
// session, but the screen deliberately does not guess here, it refuses
// visibly (same principle as without a trip_id above).
test('without a session (userId missing) submitting is refused instead of enqueuing a job without an author id', async () => {
  mockAuth.userId = null;
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  await act(async () => {
    await fireEvent.press(screen.getByText('Einsenden'));
  });

  expect(mockPreparePhoto).not.toHaveBeenCalled();
  expect(mockEnqueueJob).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await screen.findByText(/nicht angemeldet/)).toBeTruthy();
});

test('sets the status bar to light on appearing and back to dark on leaving', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  const { unmount } = await render(<PreviewScreen />);
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('light');
  await unmount();
  expect(mockSetStatusBarStyle).toHaveBeenCalledWith('dark');
});

test('a second tap on submit while sending enqueues no second job', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  let resolvePrepared: (v: { medium: string; thumb: string }) => void = () => {};
  mockPreparePhoto.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePrepared = resolve;
      })
  );
  await render(<PreviewScreen />);
  const button = screen.getByTestId('submit-button');

  await fireEvent.press(button);
  await fireEvent.press(button);

  await act(async () => {
    resolvePrepared({ medium: 'file://medium.jpg', thumb: 'file://thumb.jpg' });
  });
  await waitFor(() => expect(mockBack).toHaveBeenCalled());

  expect(mockPreparePhoto).toHaveBeenCalledTimes(1);
  expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
});

// The caption used to lie behind the standing keyboard, and there was no way
// out of the multiline field: return sets a line break there, iOS offers no
// done key, and all other controls of the screen lay under the keyboard
// themselves. The KeyboardAvoidingView that was supposed to prevent this
// could never work here: with `behavior="padding"` it only sets a
// `paddingBottom` on its own view, and that padding never reaches absolutely
// positioned children. On this screen EVERY layer is absolutely positioned.
// The screen therefore gives way itself, along the reported keyboard height.
describe('standing keyboard', () => {
  const listeners: Record<string, (e: unknown) => void> = {};
  let dismiss: jest.SpyInstance;

  // The name of the event depends on the platform: iOS announces the keyboard
  // before it stands (will), Android only afterwards (did). The test speaks to
  // the same listener the screen ordered on the respective platform.
  const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  const KEYBOARD_HEIGHT = 336;

  beforeEach(() => {
    for (const key of Object.keys(listeners)) delete listeners[key];
    jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation(((event: string, callback: (e: unknown) => void) => {
        listeners[event] = callback;
        return { remove: jest.fn() };
      }) as unknown as typeof Keyboard.addListener);
    dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function showKeyboard(height = KEYBOARD_HEIGHT) {
    await act(async () => {
      listeners[SHOW]?.({
        endCoordinates: { height, screenX: 0, screenY: 812 - height, width: 390 },
        duration: 250,
        easing: 'keyboard',
      });
    });
  }

  async function hideKeyboard() {
    await act(async () => {
      listeners[HIDE]?.({
        endCoordinates: { height: 0, screenX: 0, screenY: 812, width: 390 },
        duration: 250,
        easing: 'keyboard',
      });
    });
  }

  function captionBottom(): number {
    const field = screen.getByTestId('caption-field');
    return StyleSheet.flatten(field.props.style).bottom as number;
  }

  test('the caption moves directly above the standing keyboard', async () => {
    await render(<PreviewScreen />);
    await showKeyboard();

    // On iOS the window stays the same size, the screen has to bridge the full
    // keyboard height itself. On Android the window already shrinks
    // (softwareKeyboardLayoutMode "resize", the Expo default), there only the
    // designed distance to the new bottom edge counts.
    const expected = Platform.OS === 'ios' ? KEYBOARD_HEIGHT + spacing.base : spacing.base;
    expect(captionBottom()).toBe(expected);
  });

  // While typing, iOS swaps the bar above the keys (the "Write with Siri" hint
  // gives way to the word suggestions) and reports a different keyboard height
  // while doing so. If the field followed every report it would jump up and
  // down while writing. It therefore holds the largest reported height: rather
  // stand a few points too high than wobble.
  test('a shrinking keyboard does not drag the field down with it', async () => {
    await render(<PreviewScreen />);
    await openCaption();
    await showKeyboard(KEYBOARD_HEIGHT);
    const bottomBefore = captionBottom();

    await showKeyboard(KEYBOARD_HEIGHT - 45);

    expect(captionBottom()).toBe(bottomBefore);
  });

  // The other way round it has to go along, otherwise the field would vanish
  // behind a keyboard that grows (emoji keyboard, another language).
  test('a growing keyboard pushes the field further up', async () => {
    await render(<PreviewScreen />);
    await openCaption();
    await showKeyboard(KEYBOARD_HEIGHT);
    const bottomBefore = captionBottom();

    await showKeyboard(KEYBOARD_HEIGHT + 60);

    expect(captionBottom()).toBeGreaterThan(bottomBefore);
  });

  test('after closing, the caption stands in its place again', async () => {
    await render(<PreviewScreen />);
    const resting = captionBottom();

    await showKeyboard();
    await hideKeyboard();

    expect(captionBottom()).toBe(resting);
  });

  test('the keyboard going away takes the open field with it and leaves the chip behind', async () => {
    await render(<PreviewScreen />);
    await openCaption();
    await showKeyboard();
    expect(screen.queryByTestId('caption-chip')).toBeNull();

    await hideKeyboard();

    expect(screen.getByTestId('caption-chip')).toBeTruthy();
  });

  // The way out of the field that the keyboard itself offers: on a SINGLE LINE
  // field the return key bottom right reads "Fertig" and closes. With
  // `multiline` the same key sets a line break, there is no done key at all,
  // and that is exactly where people got stuck.
  test('the return key closes the keyboard instead of breaking a line', async () => {
    await render(<PreviewScreen />);
    await openCaption();
    const field = screen.getByLabelText('Bildunterschrift');

    expect(field.props.multiline).toBeFalsy();
    expect(field.props.returnKeyType).toBe('done');

    await fireEvent(field, 'submitEditing');

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('a tap next to the field closes the keyboard', async () => {
    await render(<PreviewScreen />);
    expect(screen.queryByLabelText('Tastatur schliessen')).toBeNull();

    await showKeyboard();
    await fireEvent.press(screen.getByLabelText('Tastatur schliessen'));

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  // The catch area lies over the whole medium. If it lay over the controls,
  // the first tap on submit after writing would be swallowed.
  test('with the keyboard standing the field itself stays operable', async () => {
    await render(<PreviewScreen />);
    await openCaption();
    await showKeyboard();

    await fireEvent.changeText(screen.getByLabelText('Bildunterschrift'), 'Abendlicht');

    expect(screen.getByLabelText('Bildunterschrift').props.value).toBe('Abendlicht');
    expect(dismiss).not.toHaveBeenCalled();
  });
});

// The caption and the submit button belong together: before, it hung on a
// fixed number (168) and left a gap of half a screen between itself and the
// button. Now it hangs on the MEASURED height of the footer so it stands
// directly above it even when an error message makes the footer grow.
test('the caption hangs on the measured height of the footer, not on a fixed number', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  // In the test there is no layout phase, so the height comes by hand.
  await act(async () => {
    fireEvent(screen.getByTestId('footer'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 52 } },
    });
  });

  // Insets are 0 in the test (see jest.setup.ts). Without a home indicator the
  // designed minimum margin spacing.base remains of the footer distance.
  const bottomInset = spacing.base;
  const field = screen.getByTestId('caption-field');
  expect(StyleSheet.flatten(field.props.style).bottom).toBe(bottomInset + 52 + spacing.base);
});

// An empty input field across the full width is a box that shows nothing and
// takes the space from the photo. At rest only a chip stands there therefore,
// as wide as its text; the field comes into being with the tap on it.
test('at rest only a chip stands there, the input field comes with the tap on it', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);

  expect(screen.queryByLabelText('Bildunterschrift')).toBeNull();
  expect(screen.getByText('Schreib etwas dazu')).toBeTruthy();

  await openCaption();

  expect(screen.getByLabelText('Bildunterschrift')).toBeTruthy();
  expect(screen.queryByTestId('caption-chip')).toBeNull();
});

// On iOS a set line height in the input field lays a paragraph style over the
// TYPED text but not over the placeholder: the text jumped down a few points
// with the first character because of it. `type.body` brings one along (24),
// so the field must not take it over.
test('the input field sets no line height', async () => {
  mockDeterminePlace.mockResolvedValue({ lat: null, lng: null, place_name: null });
  await render(<PreviewScreen />);
  await openCaption();

  const style = StyleSheet.flatten(screen.getByLabelText('Bildunterschrift').props.style);
  expect(style.lineHeight).toBeUndefined();
  expect(style.fontSize).toBe(16);
});

// --- Instant photo (Spec 2026-08-13-aufnahme-tempo-design.md §4) ---
//
// The photo comes as a native memory object through the handoff module, no
// longer as a file uri through the params. The file comes into being in the
// background; submitting waits for it, the rest of the pipeline stays
// unchanged.
const fakeRef = { width: 1920 } as never;

test('a handed over photo is shown straight from memory', async () => {
  mockParams = { type: 'photo', duration: '0', tripId: 't1' };
  handoff.setPhoto({ ref: fakeRef, file: Promise.resolve({ uri: 'file://gespeichert.jpg' }) });
  await render(<PreviewScreen />);
  expect(screen.getByTestId('photo-preview').props.source).toBe(fakeRef);
});

test('submitting waits for the file saved in the background', async () => {
  mockParams = { type: 'photo', duration: '0', tripId: 't1' };
  let resolveFile: (v: { uri: string }) => void = () => {};
  handoff.setPhoto({
    ref: fakeRef,
    file: new Promise((resolve) => {
      resolveFile = resolve;
    }),
  });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('submit-button'));

  // Before the file nothing may be prepared.
  expect(mockPreparePhoto).not.toHaveBeenCalled();

  await act(async () => {
    resolveFile({ uri: 'file://gespeichert.jpg' });
  });
  await waitFor(() => expect(mockPreparePhoto).toHaveBeenCalledWith('file://gespeichert.jpg'));
});

test('when the background save fails, the existing error path says so', async () => {
  mockParams = { type: 'photo', duration: '0', tripId: 't1' };
  handoff.setPhoto({ ref: fakeRef, file: Promise.reject(new Error('full')) });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('submit-button'));
  expect(
    await screen.findByText(
      'Der Moment konnte nicht gesichert werden, oft weil kein Speicherplatz mehr frei ist. Räum etwas Platz frei und versuch es nochmal.'
    )
  ).toBeTruthy();
  expect(mockEnqueueJob).not.toHaveBeenCalled();
});

test('discarding also clears away the file created in the background', async () => {
  mockParams = { type: 'photo', duration: '0', tripId: 't1' };
  handoff.setPhoto({ ref: fakeRef, file: Promise.resolve({ uri: 'file://gespeichert.jpg' }) });
  await render(<PreviewScreen />);
  await fireEvent.press(screen.getByTestId('discard-button'));
  await waitFor(() => expect(mockDiscardFile).toHaveBeenCalledWith('file://gespeichert.jpg'));
  expect(mockBack).toHaveBeenCalled();
});

test('without a handoff and without a uri the preview leads back to the camera', async () => {
  mockParams = { type: 'photo', duration: '0', tripId: 't1' };
  await render(<PreviewScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/capture'));
});
