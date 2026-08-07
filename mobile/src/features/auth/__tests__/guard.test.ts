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
  ['(auth)', false],
  ['(tabs)', false],
  [undefined, false],
])('isPublicArea(%s) → %s', (area, expected) => {
  expect(isPublicArea(area)).toBe(expected);
});
