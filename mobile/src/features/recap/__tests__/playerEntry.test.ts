import { playerMode } from '../playerEntry';

test('without a start parameter the player runs as a show', () => {
  expect(playerMode(undefined)).toBe('show');
});

test('start=0 is a jump, not a show: the overview repeats from the first moment', () => {
  expect(playerMode('0')).toBe('jump');
});

test('any other start index is a jump as well', () => {
  expect(playerMode('7')).toBe('jump');
});

test('an empty string counts as missing, the route carries no usable index', () => {
  expect(playerMode('')).toBe('show');
});

test('unusable text falls back to the show, the same way parseStartIndex falls back to 0', () => {
  expect(playerMode('abc')).toBe('show');
  expect(playerMode('-1')).toBe('show');
  expect(playerMode('1.5')).toBe('show');
});
