// The documents folder carries the installation's container UUID in its
// path, and every app rebuild assigns a new one: an absolutely stored path
// points into nothing after the next update, even though iOS carried the
// files along — that's how four pending moments were lost on 2026-08-17.
// The queue therefore only stores the part BELOW Documents and resolves it
// on read against the current location.
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

// Legacy rows from before the fix still carry the absolute path of the
// installation at the time. They get re-anchored at the CURRENT Documents
// location on read — the old container no longer exists, but iOS carried
// the files under it into the new one.
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
