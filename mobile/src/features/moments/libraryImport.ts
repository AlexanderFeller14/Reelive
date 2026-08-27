import { formatRange, todaysCalendarDay } from '@/features/trips/tripDay';

// One element as the picker hands it over, normalized so the rules below
// need to know nothing about expo-image-picker or expo-media-library.
export type PickedMedia = {
  uri: string;
  kind: 'photo' | 'video';
  // Length in milliseconds; null for photos and for videos without a known
  // length.
  durationMs: number | null;
  // EXIF tags as flat key/value pairs. expo-image-picker flattens the {GPS}
  // dictionary into GPS* keys (ImageUtils.swift, readExifFrom).
  exif: Record<string, unknown> | null;
  // Creation time from the photo library in ms since epoch; null without
  // library access or without an asset id.
  creationTime: number | null;
  location: { latitude: number; longitude: number } | null;
};

export type ImportPeriod = { start_date: string; end_date: string };

export type RefusalReason =
  | 'outside_period'
  | 'too_long'
  | 'unknown_length'
  | 'unknown_date'
  | 'failed';

export type AcceptedMedia = {
  accepted: true;
  media: PickedMedia;
  captured_at: string;
  captured_tz: string;
  duration_s: number | null;
  lat: number | null;
  lng: number | null;
};

export type RefusedMedia = { accepted: false; media: PickedMedia; reason: RefusalReason };

export type Assessed = AcceptedMedia | RefusedMedia;

// EXIF writes 'YYYY:MM:DD HH:MM:SS' (colons in the date, no zone), the zone
// arrives separately as OffsetTimeOriginal '+02:00' on iOS 13+ cameras.
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function exifCaptureTime(exif: Record<string, unknown> | null): Date | null {
  const raw = exif?.DateTimeOriginal;
  if (typeof raw !== 'string') return null;
  const match = EXIF_DATE.exec(raw);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  const rawOffset = exif?.OffsetTimeOriginal;
  const offset = typeof rawOffset === 'string' ? EXIF_OFFSET.exec(rawOffset) : null;
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1;
    const offsetMinutes = sign * (Number(offset[2]) * 60 + Number(offset[3]));
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60_000);
  }
  // Without an offset the EXIF clock is read as the device's local time, the
  // same assumption the live capture makes with placeAndTime.now().
  const local = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(local.getTime()) ? null : local;
}

// The capture instant, first choice EXIF (the camera's own clock), second
// choice the library's creation time (which for app-saved media is the save
// time). captured_tz is always the device zone: an EXIF offset alone does not
// name an IANA zone.
export function resolveCaptureTime(
  media: Pick<PickedMedia, 'exif' | 'creationTime'>,
  deviceTz: string
): { captured_at: string; captured_tz: string } | null {
  const fromExif = exifCaptureTime(media.exif);
  if (fromExif) return { captured_at: fromExif.toISOString(), captured_tz: deviceTz };
  if (media.creationTime != null && Number.isFinite(media.creationTime)) {
    return { captured_at: new Date(media.creationTime).toISOString(), captured_tz: deviceTz };
  }
  return null;
}

// iOS hands GPS degrees as positive numbers, the hemisphere sits in the
// *Ref tag ('N'/'S', 'E'/'W').
function gpsDegrees(value: unknown, ref: unknown, negativeRef: 'S' | 'W'): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  return ref === negativeRef ? -magnitude : magnitude;
}

export function resolveLocation(
  media: Pick<PickedMedia, 'exif' | 'location'>
): { lat: number; lng: number } | null {
  if (media.location) return { lat: media.location.latitude, lng: media.location.longitude };
  const exif = media.exif;
  if (!exif) return null;
  const lat = gpsDegrees(exif.GPSLatitude, exif.GPSLatitudeRef, 'S');
  const lng = gpsDegrees(exif.GPSLongitude, exif.GPSLongitudeRef, 'W');
  return lat != null && lng != null ? { lat, lng } : null;
}

// The import rules, in the order the refusal is reported: no date, then
// outside the trip period, then video length (unknown, then too long). The
// posts table requires duration_s for type = 'video'
// (20260803090600_role_hardening.sql:56-58); a video whose length the
// picker could not determine must be refused here, or the queue job it
// would become retries forever without ever satisfying that constraint. The
// calendar day is formed in the device zone, like everything else about
// captured_at on this device.
export function assess(
  media: PickedMedia,
  period: ImportPeriod,
  maxVideoSeconds: number,
  deviceTz: string
): Assessed {
  const time = resolveCaptureTime(media, deviceTz);
  if (!time) return { accepted: false, media, reason: 'unknown_date' };
  const day = todaysCalendarDay(new Date(time.captured_at));
  if (day < period.start_date || day > period.end_date) {
    return { accepted: false, media, reason: 'outside_period' };
  }
  if (media.kind === 'video') {
    if (media.durationMs == null) return { accepted: false, media, reason: 'unknown_length' };
    if (media.durationMs > maxVideoSeconds * 1000) return { accepted: false, media, reason: 'too_long' };
  }
  const location = resolveLocation(media);
  return {
    accepted: true,
    media,
    captured_at: time.captured_at,
    captured_tz: time.captured_tz,
    duration_s:
      media.kind === 'video' && media.durationMs != null ? Math.round(media.durationMs / 1000) : null,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
  };
}

const REASON_ORDER: RefusalReason[] = [
  'outside_period',
  'too_long',
  'unknown_length',
  'unknown_date',
  'failed',
];
const DATE_HINT = 'Mit Zugriff auf deine Fotos kommt das Aufnahmedatum meist mit.';

function reasonText(
  reason: RefusalReason,
  count: number,
  period: ImportPeriod,
  maxVideoSeconds: number
): string {
  switch (reason) {
    case 'outside_period':
      return `ausserhalb des Reisezeitraums (${formatRange(period.start_date, period.end_date)})`;
    case 'too_long':
      return count === 1
        ? `Video länger als ${maxVideoSeconds} Sekunden`
        : `Videos länger als ${maxVideoSeconds} Sekunden`;
    case 'unknown_length':
      return 'Videolänge unbekannt';
    case 'unknown_date':
      return 'Aufnahmedatum unbekannt';
    case 'failed':
      return 'beim Sichern gescheitert';
  }
}

// One sentence for the error pill: how many of the batch stayed out and why.
// With mixed reasons each one carries its count; a single reason stands
// alone. null when nothing was refused.
export function refusalSummary(
  reasons: RefusalReason[],
  total: number,
  period: ImportPeriod,
  maxVideoSeconds: number
): string | null {
  const refused = reasons.length;
  if (refused === 0) return null;
  const counts = new Map<RefusalReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const mixed = counts.size > 1;
  const parts = REASON_ORDER.filter((reason) => counts.has(reason)).map((reason) => {
    const count = counts.get(reason) ?? 0;
    const text = reasonText(reason, count, period, maxVideoSeconds);
    return mixed ? `${count} ${text}` : text;
  });
  const lead =
    total === 1
      ? 'Der Moment wurde nicht eingesendet'
      : refused === total
        ? `Keiner der ${total} Momente wurde eingesendet`
        : `${refused} von ${total} Momenten wurden nicht eingesendet`;
  const hint = counts.has('unknown_date') ? ` ${DATE_HINT}` : '';
  return `${lead}: ${parts.join(', ')}.${hint}`;
}
