import type { TripStatus } from './types';

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MS_PRO_TAG = 86_400_000;

// Datumsangaben sind reine Kalendertage ohne Zeitzone. Deshalb überall UTC
// rechnen: Date.UTC vermeidet, dass eine Sommerzeit-Umstellung einen Tag
// verschluckt oder doppelt zählt.
function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function parseGermanDate(input: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const [, d, m, y] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rollover erkennen: der 32.01. wird sonst still zum 01.02.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function validateDateRange(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return 'Trag Beginn und Ende ein, z.B. 01.08.2026.';
  if (toUtc(endIso) < toUtc(startIso)) return 'Das Ende darf nicht vor dem Beginn liegen.';
  return null;
}

// Der heutige Kalendertag am Ort des Geraets, als 'YYYY-MM-DD'.
//
// `new Date().toISOString().slice(0, 10)` liefert den Kalendertag in UTC und
// war damit in Mitteleuropa jede Nacht zwischen 00:00 und 02:00 einen Tag zu
// frueh: der Reisetag zaehlte zu niedrig und «Reise abschliessen» rueckte
// einen Tag zu spaet nach oben. Die uebrigen Funktionen dieser Datei rechnen
// bewusst in UTC, weil sie reine Kalendertage OHNE Zeitzone vergleichen,
// dieser Wert dagegen ist die Frage «welchen Tag hat der Nutzer gerade», und
// die beantwortet nur die lokale Uhr.
export function heutigerKalendertag(jetzt: Date = new Date()): string {
  const monat = String(jetzt.getMonth() + 1).padStart(2, '0');
  const tag = String(jetzt.getDate()).padStart(2, '0');
  return `${jetzt.getFullYear()}-${monat}-${tag}`;
}

export function tripDay(startIso: string, todayIso: string): number {
  const diff = Math.round((toUtc(todayIso) - toUtc(startIso)) / MS_PRO_TAG);
  return diff < 0 ? 0 : diff + 1;
}

export function tripLength(startIso: string, endIso: string): number {
  return Math.round((toUtc(endIso) - toUtc(startIso)) / MS_PRO_TAG) + 1;
}

export function formatRange(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (sy !== ey) return `${sd}. ${MONATE[sm - 1]} ${sy} – ${ed}. ${MONATE[em - 1]} ${ey}`;
  if (sm !== em) return `${sd}. ${MONATE[sm - 1]} – ${ed}. ${MONATE[em - 1]} ${ey}`;
  return `${sd}.–${ed}. ${MONATE[sm - 1]} ${sy}`;
}

export function groupTrips<T extends { status: TripStatus }>(trips: T[]): { laufend: T[]; recaps: T[] } {
  return {
    laufend: trips.filter((t) => t.status === 'active'),
    recaps: trips.filter((t) => t.status !== 'active'),
  };
}
