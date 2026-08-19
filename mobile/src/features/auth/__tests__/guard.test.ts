import { resolveRoute } from '../guard';

test.each([
  ['loading', null],
  ['signedOut', '/welcome'],
  ['needsProfile', '/profile-setup'],
  ['signedIn', '/aufnehmen'],
] as const)('Status %s → Route %s', (status, route) => {
  expect(resolveRoute(status)).toBe(route);
});

import { isPublicArea } from '../guard';

test.each([
  ['join', true],
  ['teilen', true],
  ['(auth)', false],
  ['(tabs)', false],
  [undefined, false],
])('isPublicArea(%s) → %s', (area, expected) => {
  expect(isPublicArea(area)).toBe(expected);
});

import { isWebLocked } from '../guard';

test.each([
  // platformOS, area, expected locked
  ['web', 'teilen', false],
  ['web', 'join', true], // deliberately locked despite isPublicArea('join') === true, see comment in guard.ts
  ['web', '(auth)', true],
  ['web', '(tabs)', true],
  ['web', undefined, true],
  ['ios', 'teilen', false],
  ['ios', 'join', false],
  ['ios', '(auth)', false],
  ['ios', '(tabs)', false],
  ['android', '(tabs)', false],
] as const)('isWebLocked(%s, %s) → %s', (platformOS, area, expected) => {
  expect(isWebLocked(platformOS, area)).toBe(expected);
});

import { isAreaForSignedIn } from '../guard';

// The capture preview deliberately sits NEXT TO the tab navigator instead of
// inside it (see app/vorschau.tsx): only that way does it cover the tab bar
// immediately, instead of letting it disappear one blink later. That makes
// it the first area for signed-in people outside of '(tabs)', and the guard
// would have sent it straight back to /aufnehmen without this exception.
test.each([
  ['(tabs)', true],
  ['vorschau', true],
  ['(auth)', false],
  ['join', false],
  ['teilen', false],
  [undefined, false],
])('isAreaForSignedIn(%s) → %s', (area, expected) => {
  expect(isAreaForSignedIn(area)).toBe(expected);
});
