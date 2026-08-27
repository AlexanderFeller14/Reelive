import {
  assess,
  refusalSummary,
  resolveCaptureTime,
  resolveLocation,
  type PickedMedia,
} from '../libraryImport';

const TZ = 'Europe/Zurich';
const PERIOD = { start_date: '2026-08-01', end_date: '2026-08-14' };
const MAX_SECONDS = 90;

const media = (over: Partial<PickedMedia> = {}): PickedMedia => ({
  uri: 'file:///picked.jpg',
  kind: 'photo',
  durationMs: null,
  exif: null,
  creationTime: null,
  location: null,
  ...over,
});

describe('resolveCaptureTime', () => {
  test('reads DateTimeOriginal with its offset as an exact instant', () => {
    const result = resolveCaptureTime(
      {
        exif: { DateTimeOriginal: '2026:08:05 14:32:11', OffsetTimeOriginal: '+02:00' },
        creationTime: null,
      },
      TZ
    );
    expect(result).toEqual({ captured_at: '2026-08-05T12:32:11.000Z', captured_tz: TZ });
  });

  test('a negative offset moves the instant the other way', () => {
    const result = resolveCaptureTime(
      {
        exif: { DateTimeOriginal: '2026:08:05 08:00:00', OffsetTimeOriginal: '-05:30' },
        creationTime: null,
      },
      TZ
    );
    expect(result?.captured_at).toBe('2026-08-05T13:30:00.000Z');
  });

  test('reads DateTimeOriginal without an offset as device-local time', () => {
    const result = resolveCaptureTime(
      { exif: { DateTimeOriginal: '2026:08:05 14:32:11' }, creationTime: null },
      TZ
    );
    expect(result?.captured_at).toBe(new Date(2026, 7, 5, 14, 32, 11).toISOString());
    expect(result?.captured_tz).toBe(TZ);
  });

  test('falls back to the library creation time', () => {
    const result = resolveCaptureTime(
      { exif: null, creationTime: Date.UTC(2026, 7, 5, 9, 0, 0) },
      TZ
    );
    expect(result).toEqual({ captured_at: '2026-08-05T09:00:00.000Z', captured_tz: TZ });
  });

  test('prefers EXIF over the creation time', () => {
    const result = resolveCaptureTime(
      {
        exif: { DateTimeOriginal: '2026:08:05 14:32:11', OffsetTimeOriginal: '+02:00' },
        creationTime: Date.UTC(2026, 7, 9),
      },
      TZ
    );
    expect(result?.captured_at).toBe('2026-08-05T12:32:11.000Z');
  });

  test('ignores a malformed EXIF date and answers null without any source', () => {
    expect(
      resolveCaptureTime({ exif: { DateTimeOriginal: 'gestern' }, creationTime: null }, TZ)
    ).toBeNull();
    expect(resolveCaptureTime({ exif: { DateTimeOriginal: 42 }, creationTime: null }, TZ)).toBeNull();
    expect(resolveCaptureTime({ exif: null, creationTime: null }, TZ)).toBeNull();
  });
});

describe('resolveLocation', () => {
  test('prefers the library location over EXIF', () => {
    expect(
      resolveLocation({
        exif: { GPSLatitude: 1, GPSLongitude: 1 },
        location: { latitude: 47.05, longitude: 8.31 },
      })
    ).toEqual({ lat: 47.05, lng: 8.31 });
  });

  test('reads EXIF GPS with its hemisphere references', () => {
    expect(
      resolveLocation({
        exif: { GPSLatitude: 33.86, GPSLatitudeRef: 'S', GPSLongitude: 151.2, GPSLongitudeRef: 'E' },
        location: null,
      })
    ).toEqual({ lat: -33.86, lng: 151.2 });
    expect(
      resolveLocation({
        exif: { GPSLatitude: 40.7, GPSLatitudeRef: 'N', GPSLongitude: 74.0, GPSLongitudeRef: 'W' },
        location: null,
      })
    ).toEqual({ lat: 40.7, lng: -74.0 });
  });

  test('answers null without a complete coordinate pair', () => {
    expect(resolveLocation({ exif: { GPSLatitude: 47.05 }, location: null })).toBeNull();
    expect(resolveLocation({ exif: { GPSLatitude: 'nord', GPSLongitude: 8 }, location: null })).toBeNull();
    expect(resolveLocation({ exif: null, location: null })).toBeNull();
  });
});

describe('assess', () => {
  test('accepts a photo captured inside the trip period, with its time and place', () => {
    const result = assess(
      media({ creationTime: Date.UTC(2026, 7, 5, 12), location: { latitude: 47.05, longitude: 8.31 } }),
      PERIOD,
      MAX_SECONDS,
      TZ
    );
    expect(result).toEqual({
      accepted: true,
      media: expect.objectContaining({ uri: 'file:///picked.jpg' }),
      captured_at: '2026-08-05T12:00:00.000Z',
      captured_tz: TZ,
      duration_s: null,
      lat: 47.05,
      lng: 8.31,
    });
  });

  test('a photo without coordinates is accepted without a place', () => {
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 5, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: true,
      lat: null,
      lng: null,
    });
  });

  test('refuses a photo from outside the trip period, on either side', () => {
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 20, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: false,
      reason: 'outside_period',
    });
    expect(assess(media({ creationTime: Date.UTC(2026, 6, 31, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: false,
      reason: 'outside_period',
    });
  });

  test('the first and the last day of the trip still count as inside', () => {
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 1, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: true,
    });
    expect(assess(media({ creationTime: Date.UTC(2026, 7, 14, 12) }), PERIOD, MAX_SECONDS, TZ)).toMatchObject({
      accepted: true,
    });
  });

  test('refuses a video longer than the limit and rounds an accepted length to seconds', () => {
    const long = media({
      kind: 'video',
      uri: 'file:///long.mov',
      durationMs: 90_400,
      creationTime: Date.UTC(2026, 7, 5, 12),
    });
    expect(assess(long, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: false, reason: 'too_long' });

    const short = media({
      kind: 'video',
      uri: 'file:///short.mov',
      durationMs: 12_400,
      creationTime: Date.UTC(2026, 7, 5, 12),
    });
    expect(assess(short, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: true, duration_s: 12 });
  });

  test('a video without a known length is accepted without duration', () => {
    const unknown = media({ kind: 'video', uri: 'file:///x.mov', creationTime: Date.UTC(2026, 7, 5, 12) });
    expect(assess(unknown, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: true, duration_s: null });
  });

  test('refuses media without any capture date', () => {
    expect(assess(media(), PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: false, reason: 'unknown_date' });
  });

  test('the period rule wins over the length rule when both fail', () => {
    const both = media({
      kind: 'video',
      uri: 'file:///old-long.mov',
      durationMs: 200_000,
      creationTime: Date.UTC(2026, 6, 1, 12),
    });
    expect(assess(both, PERIOD, MAX_SECONDS, TZ)).toMatchObject({ accepted: false, reason: 'outside_period' });
  });
});

describe('refusalSummary', () => {
  test('nothing refused, no summary', () => {
    expect(refusalSummary([], 3, PERIOD, MAX_SECONDS)).toBeNull();
  });

  test('a single element speaks of "der Moment"', () => {
    expect(refusalSummary(['outside_period'], 1, PERIOD, MAX_SECONDS)).toBe(
      'Der Moment wurde nicht eingesendet: ausserhalb des Reisezeitraums (1.–14. Aug 2026).'
    );
  });

  test('a partial batch counts the refused against the total', () => {
    expect(refusalSummary(['outside_period', 'outside_period'], 5, PERIOD, MAX_SECONDS)).toBe(
      '2 von 5 Momenten wurden nicht eingesendet: ausserhalb des Reisezeitraums (1.–14. Aug 2026).'
    );
  });

  test('a fully refused batch says so, and mixed reasons carry their counts', () => {
    expect(refusalSummary(['too_long', 'unknown_date'], 2, PERIOD, MAX_SECONDS)).toBe(
      'Keiner der 2 Momente wurde eingesendet: 1 Video länger als 90 Sekunden, 1 Aufnahmedatum unbekannt. Mit Zugriff auf deine Fotos kommt das Aufnahmedatum meist mit.'
    );
  });

  test('several long videos use the plural, a single reason carries no count', () => {
    expect(refusalSummary(['too_long', 'too_long'], 4, PERIOD, MAX_SECONDS)).toBe(
      '2 von 4 Momenten wurden nicht eingesendet: Videos länger als 90 Sekunden.'
    );
  });

  test('failed submissions read as "beim Sichern gescheitert"', () => {
    expect(refusalSummary(['failed'], 1, PERIOD, MAX_SECONDS)).toBe(
      'Der Moment wurde nicht eingesendet: beim Sichern gescheitert.'
    );
    expect(refusalSummary(['too_long', 'failed'], 3, PERIOD, MAX_SECONDS)).toBe(
      '2 von 3 Momenten wurden nicht eingesendet: 1 Video länger als 90 Sekunden, 1 beim Sichern gescheitert.'
    );
  });
});
