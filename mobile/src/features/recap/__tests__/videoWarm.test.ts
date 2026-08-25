import { holdWarmVideo, adoptWarmVideo, releaseWarmVideo } from '../videoWarm';
import type { VideoPlayer } from 'expo-video';

const fakePlayer = () => ({ release: jest.fn() }) as unknown as VideoPlayer;

afterEach(() => releaseWarmVideo());

test('adopting hands the held player over exactly once', () => {
  const player = fakePlayer();
  holdWarmVideo('https://cdn/v1.mp4', player);
  expect(adoptWarmVideo('https://cdn/v1.mp4')).toBe(player);
  // The slot is empty now: ownership moved with the adoption.
  expect(adoptWarmVideo('https://cdn/v1.mp4')).toBeNull();
});

test('a different url adopts nothing, the held player stays for its own moment', () => {
  const player = fakePlayer();
  holdWarmVideo('https://cdn/v1.mp4', player);
  expect(adoptWarmVideo('https://cdn/v2.mp4')).toBeNull();
  expect(adoptWarmVideo('https://cdn/v1.mp4')).toBe(player);
});

test('holding a new url releases the previously held player, nothing leaks', () => {
  const first = fakePlayer();
  const second = fakePlayer();
  holdWarmVideo('https://cdn/v1.mp4', first);
  holdWarmVideo('https://cdn/v2.mp4', second);
  expect(first.release).toHaveBeenCalled();
  expect(adoptWarmVideo('https://cdn/v2.mp4')).toBe(second);
});

test('holding the same url twice keeps the first player and releases the duplicate', () => {
  const first = fakePlayer();
  const duplicate = fakePlayer();
  holdWarmVideo('https://cdn/v1.mp4', first);
  holdWarmVideo('https://cdn/v1.mp4', duplicate);
  expect(duplicate.release).toHaveBeenCalled();
  expect(adoptWarmVideo('https://cdn/v1.mp4')).toBe(first);
});

test('releasing empties the slot and frees the player', () => {
  const player = fakePlayer();
  holdWarmVideo('https://cdn/v1.mp4', player);
  releaseWarmVideo();
  expect(player.release).toHaveBeenCalled();
  expect(adoptWarmVideo('https://cdn/v1.mp4')).toBeNull();
});
