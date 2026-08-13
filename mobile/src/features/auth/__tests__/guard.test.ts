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

import { istFlaecheFuerAngemeldete } from '../guard';

// Die Aufnahme-Vorschau liegt bewusst NEBEN dem Tab-Navigator statt darin
// (siehe app/vorschau.tsx): Nur so deckt sie die Tab-Bar sofort ab, statt sie
// einen Wimpernschlag später verschwinden zu lassen. Damit ist sie aber die
// erste Fläche für Angemeldete ausserhalb von '(tabs)', und der Guard hätte
// sie ohne diese Ausnahme sofort zurück nach /aufnehmen geworfen.
test.each([
  ['(tabs)', true],
  ['vorschau', true],
  ['(auth)', false],
  ['join', false],
  ['teilen', false],
  [undefined, false],
])('istFlaecheFuerAngemeldete(%s) → %s', (area, expected) => {
  expect(istFlaecheFuerAngemeldete(area)).toBe(expected);
});
