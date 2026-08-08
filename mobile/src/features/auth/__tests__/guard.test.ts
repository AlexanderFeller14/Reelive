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

import { istWebGesperrt } from '../guard';

test.each([
  // platformOS, area, erwartet gesperrt
  ['web', 'teilen', false],
  ['web', 'join', true], // bewusst gesperrt trotz isPublicArea('join') === true, siehe Kommentar in guard.ts
  ['web', '(auth)', true],
  ['web', '(tabs)', true],
  ['web', undefined, true],
  ['ios', 'teilen', false],
  ['ios', 'join', false],
  ['ios', '(auth)', false],
  ['ios', '(tabs)', false],
  ['android', '(tabs)', false],
] as const)('istWebGesperrt(%s, %s) → %s', (platformOS, area, erwartet) => {
  expect(istWebGesperrt(platformOS, area)).toBe(erwartet);
});
