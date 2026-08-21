import * as captureLock from '../captureLock';

// The lock used to be a bare holder, read synchronously inside the tabPress
// listener. Since the tabs can be swiped, `swipeEnabled` reads it while
// RENDERING, so a change has to reach the navigator: hence the subscription.
afterEach(() => captureLock.lock(false));

test('a subscriber learns about the lock being set', () => {
  const listener = jest.fn();
  const unsubscribe = captureLock.subscribe(listener);
  captureLock.lock(true);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(captureLock.isLocked()).toBe(true);
  unsubscribe();
});

test('setting the same value again notifies nobody', () => {
  captureLock.lock(true);
  const listener = jest.fn();
  const unsubscribe = captureLock.subscribe(listener);
  captureLock.lock(true);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

test('unsubscribing stops the notifications', () => {
  const listener = jest.fn();
  const unsubscribe = captureLock.subscribe(listener);
  unsubscribe();
  captureLock.lock(true);
  expect(listener).not.toHaveBeenCalled();
});

test('releasing the lock reaches the subscribers too', () => {
  captureLock.lock(true);
  const listener = jest.fn();
  const unsubscribe = captureLock.subscribe(listener);
  captureLock.lock(false);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(captureLock.isLocked()).toBe(false);
  unsubscribe();
});
