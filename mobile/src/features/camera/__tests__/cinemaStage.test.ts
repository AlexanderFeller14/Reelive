import * as cinemaStage from '../cinemaStage';

// Back to the base state after every test, the module holds its state
// process-wide (same holder pattern as captureLock).
afterEach(() => {
  cinemaStage.set(false);
});

test('the state starts at false and follows set()', () => {
  expect(cinemaStage.get()).toBe(false);
  cinemaStage.set(true);
  expect(cinemaStage.get()).toBe(true);
});

test('a subscription is notified on every change', () => {
  const listener = jest.fn();
  const unsubscribe = cinemaStage.subscribe(listener);
  cinemaStage.set(true);
  cinemaStage.set(false);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

// useSyncExternalStore re-renders on every notification: an unchanged state
// must therefore stay quiet, or the tab bar would re-render for no reason on
// every focus effect of the camera screen.
test('set with an unchanged state notifies nothing', () => {
  const listener = jest.fn();
  const unsubscribe = cinemaStage.subscribe(listener);
  cinemaStage.set(false);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

test('an unsubscribed subscription is no longer notified', () => {
  const listener = jest.fn();
  const unsubscribe = cinemaStage.subscribe(listener);
  unsubscribe();
  cinemaStage.set(true);
  expect(listener).not.toHaveBeenCalled();
});

// The picture's frame. The numbers are the measured device (iPhone 17 Pro
// Max, 440x956 pt, bottom inset 34): the capture is 9:16, so it stands
// 782,2 pt tall, well inside the 865 pt that remain above the bar.
test('on a tall screen the picture stands as tall as the capture is', () => {
  expect(cinemaStage.pictureHeight(440, 956, 34)).toBeCloseTo(782.2, 1);
});

// A short screen cannot carry the full height. There the picture takes what
// is left above the bar and gets cropped, as it always did; without the cap
// it would stick out beyond the top edge.
test('on a short screen the picture stops at the bar instead of sticking out', () => {
  expect(cinemaStage.pictureHeight(375, 667, 0)).toBe(667 - cinemaStage.barHeight(0));
});

// Nothing black between picture and bar: the two together fill the screen
// from the picture's top edge downwards, so whatever is left over stands
// ABOVE the picture, never between it and the bar.
test('picture and bar together reach the bottom edge of the screen', () => {
  const height = cinemaStage.pictureHeight(440, 956, 34) + cinemaStage.barHeight(34);
  expect(height).toBeLessThanOrEqual(956);
  expect(956 - height).toBeCloseTo(82.8, 1);
});
