import * as warmup from '../warmup';

afterEach(() => warmup.set(false));

test('it starts cold', () => {
  expect(warmup.get()).toBe(false);
});

test('a subscriber learns about the change', () => {
  const listener = jest.fn();
  const unsubscribe = warmup.subscribe(listener);
  warmup.set(true);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(warmup.get()).toBe(true);
  unsubscribe();
});

// The pager writes on every frame of the drag. Without this the camera screen
// would re-render sixty times a second for an answer that did not move.
test('the same value again notifies nobody', () => {
  warmup.set(true);
  const listener = jest.fn();
  const unsubscribe = warmup.subscribe(listener);
  warmup.set(true);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

test('unsubscribing stops the notifications', () => {
  const listener = jest.fn();
  const unsubscribe = warmup.subscribe(listener);
  unsubscribe();
  warmup.set(true);
  expect(listener).not.toHaveBeenCalled();
});

// Measured in tab widths: the session needs a moment to build up, so the
// flag has to fire early in the gesture, and it has to hold on almost to the
// end of the way out, so a swipe turned back halfway does not kill a running
// session.
test('the threshold lies within the first tenth of the way', () => {
  expect(warmup.NEAR_ENOUGH).toBeGreaterThan(0.5);
  expect(warmup.NEAR_ENOUGH).toBeLessThan(1);
});
