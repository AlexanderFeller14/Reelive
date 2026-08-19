import {
  setPhoto,
  takePhoto,
  savedFile,
  setVideo,
  takeVideo,
  type PhotoHandoff,
} from '../handoff';
import type { PictureRef } from 'expo-camera';
import type { VideoPlayer } from 'expo-video';

// A PictureRef is only a native handle at runtime; all that matters to the
// module is that the same object comes back out.
const fakeRef = (name: string) => ({ name }) as unknown as PictureRef;

const handoff = (ref: PictureRef, uri = 'file://gespeichert.jpg'): PhotoHandoff => ({
  ref,
  file: Promise.resolve({ uri }),
});

test('takePhoto returns the handoff exactly once', async () => {
  const h = handoff(fakeRef('a'));
  setPhoto(h);
  expect(takePhoto()).toBe(h);
  expect(takePhoto()).toBeNull();
});

test('a new handoff replaces one left over', () => {
  setPhoto(handoff(fakeRef('alt')));
  const next = handoff(fakeRef('neu'));
  setPhoto(next);
  expect(takePhoto()).toBe(next);
  expect(takePhoto()).toBeNull();
});

test('a failing file stays available to the taker as a rejection', async () => {
  const error = new Error('kein Speicherplatz');
  setPhoto({ ref: fakeRef('x'), file: Promise.reject(error) });
  // Let the microtasks run: if NO handler hung off the rejection, Jest would
  // fail here with an "unhandled promise rejection".
  await new Promise((resolve) => setTimeout(resolve, 0));
  await expect(takePhoto()!.file).rejects.toBe(error);
});

// The video handoff (device finding 2026-08-14): the pre-warmed player AND a
// poster (frame 0 of the video) travel to the preview together — the
// VideoView needs ~0.8 s on device before it draws a fully loaded player
// itself; until then the poster stands in, and the switch is invisible
// because the loop starts at frame 0. At runtime all that matters is that
// the same pair comes back out — and that a leftover player gets released
// (native object, explicit release required).
const fakePlayer = () => ({ release: jest.fn() }) as unknown as VideoPlayer;

test('takeVideo returns the handoff exactly once', () => {
  const p = fakePlayer();
  setVideo({ kind: 'player', player: p, poster: 'file://poster.jpg' });
  const taken = takeVideo();
  expect(taken?.kind).toBe('player');
  expect(taken && taken.kind === 'player' ? taken.player : null).toBe(p);
  expect(taken && taken.kind === 'player' ? taken.poster : null).toBe('file://poster.jpg');
  expect(takeVideo()).toBeNull();
});

test('a new handoff replaces one left over and releases its player', () => {
  const old = fakePlayer();
  const next = fakePlayer();
  setVideo({ kind: 'player', player: old, poster: null });
  setVideo({ kind: 'player', player: next, poster: null });
  expect((old as unknown as { release: jest.Mock }).release).toHaveBeenCalled();
  const taken = takeVideo();
  expect(taken && taken.kind === 'player' ? taken.player : null).toBe(next);
  expect(takeVideo()).toBeNull();
});

// The native shape (Task 10, VideoHandoff union): no more player display,
// just the promise that shows when the background file is ready. No native
// object, so no release needed either.
test('the native shape carries the fileReady promise and needs no release', () => {
  const ready = Promise.resolve();
  setVideo({ kind: 'native', fileReady: ready });
  const taken = takeVideo();
  expect(taken?.kind).toBe('native');
  expect(taken && taken.kind === 'native' ? taken.fileReady : null).toBe(ready);
});

test('a native handoff replaces a leftover player handoff and releases its player', () => {
  const old = fakePlayer();
  setVideo({ kind: 'player', player: old, poster: null });
  setVideo({ kind: 'native', fileReady: Promise.resolve() });
  expect((old as unknown as { release: jest.Mock }).release).toHaveBeenCalled();
});

// savePictureAsync is inconsistent across platforms (expo-camera SDK 57):
// Android delivers `uri`, iOS delivers `url`, the TS type promises `uri`
// uniformly. Anyone who only reads `.uri` gets undefined on the iPhone, and
// submitting a photo silently failed because of this (device finding
// 2026-08-14). `savedFile` straightens this out at the source.
function refWithResult(result: object): PictureRef {
  return { savePictureAsync: async () => result } as unknown as PictureRef;
}

test('savedFile accepts the iOS shape (url) and returns uri', async () => {
  await expect(savedFile(refWithResult({ url: 'file://ios.jpg' }))).resolves.toEqual({
    uri: 'file://ios.jpg',
  });
});

test('savedFile passes the Android shape (uri) through unchanged', async () => {
  await expect(savedFile(refWithResult({ uri: 'file://android.jpg' }))).resolves.toEqual({
    uri: 'file://android.jpg',
  });
});

test('savedFile rejects when neither uri nor url comes back, instead of quietly returning undefined', async () => {
  await expect(savedFile(refWithResult({ width: 100 }))).rejects.toThrow(
    /weder uri noch url/
  );
});
