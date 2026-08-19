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
