import { normalizePhone } from '../phone';

test.each([
  ['+41791234567', '+41791234567'],
  ['079 123 45 67', '+41791234567'],
  ['0791234567', '+41791234567'],
  ['0041 79 123 45 67', '+41791234567'],
  ['+49 170 1234567', '+491701234567'],
])('normalisiert %s zu %s', (input, expected) => {
  expect(normalizePhone(input)).toBe(expected);
});

test.each([['', null], ['abc', null], ['123', null], ['+1', null]])(
  'lehnt %s ab',
  (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  }
);
