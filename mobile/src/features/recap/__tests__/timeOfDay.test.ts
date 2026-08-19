import { timeInZone } from '../timeOfDay';

const capturedAt = '2026-01-01T12:00:00.000Z';

test('formats the time in the moment\'s own zone (captured_tz), not the device\'s local zone', () => {
  expect(timeInZone(capturedAt, 'Asia/Tokyo')).toBe('21:00');
  expect(timeInZone(capturedAt, 'America/Los_Angeles')).toBe('04:00');
});

// captured_tz has no CHECK constraint (just `text not null`, see days.ts,
// same defensive principle), an unrecognised zone name makes
// Intl.DateTimeFormat throw a RangeError. Showing a best-effort device time
// beats crashing or leaving a blank spot.
test('falls back to the device\'s local time instead of throwing when the zone name is invalid', () => {
  const d = new Date(capturedAt);
  const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  expect(timeInZone(capturedAt, 'Invalid/Zone')).toBe(expected);
});
