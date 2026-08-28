import { resolveRoute } from '../guard';

test.each([
  ['loading', null],
  ['signedOut', '/welcome'],
  ['needsProfile', '/profile-setup'],
  ['signedIn', '/capture'],
] as const)('Status %s → Route %s', (status, route) => {
  expect(resolveRoute(status)).toBe(route);
});

import { isPublicArea } from '../guard';

test.each([
  ['join', true],
  ['share', true],
  ['(auth)', false],
  ['(tabs)', false],
  [undefined, false],
])('isPublicArea(%s) → %s', (area, expected) => {
  expect(isPublicArea(area)).toBe(expected);
});

import { isWebLocked } from '../guard';

test.each([
  // platformOS, area, expected locked
  ['web', 'share', false],
  ['web', 'join', true], // deliberately locked despite isPublicArea('join') === true, see comment in guard.ts
  ['web', '(auth)', true],
  ['web', '(tabs)', true],
  ['web', undefined, true],
  ['ios', 'share', false],
  ['ios', 'join', false],
  ['ios', '(auth)', false],
  ['ios', '(tabs)', false],
  ['android', '(tabs)', false],
] as const)('isWebLocked(%s, %s) → %s', (platformOS, area, expected) => {
  expect(isWebLocked(platformOS, area)).toBe(expected);
});

import { isAreaForSignedIn } from '../guard';

// The capture preview deliberately sits NEXT TO the tab navigator instead of
// inside it (see app/preview.tsx): only that way does it cover the tab bar
// immediately, instead of letting it disappear one blink later. That makes
// it the first area for signed-in people outside of '(tabs)', and the guard
// would have sent it straight back to /capture without this exception.
test.each([
  ['(tabs)', true],
  ['preview', true],
  ['import-review', true],
  ['(auth)', false],
  ['join', false],
  ['share', false],
  [undefined, false],
])('isAreaForSignedIn(%s) → %s', (area, expected) => {
  expect(isAreaForSignedIn(area)).toBe(expected);
});
