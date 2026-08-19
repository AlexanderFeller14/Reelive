// Four pending moments were lost this way on 2026-08-17 — the worker
// couldn't find the files after a container rebuild.
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///container-NEU/Documents/' } },
}));

import { forStorage, forReading } from '../queuePaths';

test('forStorage only stores the part below Documents', () => {
  expect(forStorage('file:///container-ALT/Documents/momente/p1/medium.mov')).toBe(
    'momente/p1/medium.mov'
  );
});

test('forStorage leaves paths outside of Documents untouched', () => {
  expect(forStorage('file:///tmp/reelive-x.mov')).toBe('file:///tmp/reelive-x.mov');
});

test('forReading attaches the relative form to the current Documents location', () => {
  expect(forReading('momente/p1/medium.mov')).toBe(
    'file:///container-NEU/Documents/momente/p1/medium.mov'
  );
});

test('forReading re-anchors absolute legacy rows at the current Documents location', () => {
  expect(forReading('file:///container-ALT/Documents/momente/p1/medium.mov')).toBe(
    'file:///container-NEU/Documents/momente/p1/medium.mov'
  );
});

test('forReading leaves absolute paths outside of Documents untouched', () => {
  // The worker handles them as before (and then reports a missing file),
  // instead of inventing a Documents path here.
  expect(forReading('file:///tmp/reelive-x.mov')).toBe('file:///tmp/reelive-x.mov');
});
