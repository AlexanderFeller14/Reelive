// Reine Kernlogik des Recaps: sortieren, nach Ortstagen gruppieren, den Ort
// eines Tages bestimmen. Kein Netz, kein React — deshalb ohne laufenden
// Stack vollständig testbar (Task-5-Brief).
//
// Zeitzonen-Entscheidung (Brief lässt sie bewusst offen, hier begründet):
// Die Tagesgrenze richtet sich strikt nach captured_tz DES MOMENTS, nie nach
// der Zeitzone des Geräts, das den Recap gerade anschaut — es gibt deshalb
// unten auch gar keinen Parameter für eine "Betrachter-Zeitzone". Für zwei
// Momente, die am selben Ortstag in verschiedenen Zeitzonen entstanden sind
// (Gruppe überquert eine Zeitzonengrenze), ist die TagesNUMMER die einzige
// Klammer, die zählt: jeder Moment bekommt seine Nummer unabhängig aus dem
// eigenen lokalen Kalendertag berechnet, und `RecapTag.datum` wird NICHT vom
// captured_tz irgendeines Moments abgeleitet, sondern rein arithmetisch aus
// start_date + (nummer - 1) Tagen. Zwei Momente mit unterschiedlichem
// captured_tz landen deshalb automatisch im selben RecapTag, sobald ihre
// jeweils eigenen Ortstage auf dieselbe Tagesnummer fallen — es gibt keinen
// zusätzlichen Gruppierungsschlüssel (etwa "captured_tz + Datum"), der sie
// künstlich auseinanderreissen könnte. Ein ECHTER Ortstag-Wechsel (z.B. ein
// Nachtflug, der Kalendertag am Zielort ist lokal ein anderer) bleibt davon
// unberührt ein Tageswechsel — das ist keine Willkür, sondern die reale
// Ortszeit am jeweiligen Ort.

import type { RecapMoment, RecapTag } from './types';

const MS_PRO_TAG = 86_400_000;

// Sortierung IMMER nach captured_at aufsteigend (CLAUDE.md-Eckpfeiler), nie
// nach created_at (das RecapMoment gar nicht trägt) — bei exakt gleichem
// Zeitpunkt entscheidet id als zweites, stabiles Kriterium, damit ein
// wiederholtes Sortieren immer dasselbe Ergebnis liefert. Der Vergleich läuft
// über die Zeitstempel-Millisekunden statt über einen Text-Vergleich der
// ISO-Strings: captured_at kann mit unterschiedlichem Offset-Format aus der
// Datenbank kommen, ein reiner String-Vergleich wäre dafür nicht verlässlich.
export function sortiereMomente(momente: RecapMoment[]): RecapMoment[] {
  return [...momente].sort((a, b) => {
    const diff = Date.parse(a.captured_at) - Date.parse(b.captured_at);
    if (diff !== 0) return diff;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function toUtcTag(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

function parseIsoDatum(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

// Lokales Kalenderdatum (YYYY-MM-DD) eines Zeitpunkts in EINER bestimmten
// Zeitzone — 'en-CA' liefert exakt dieses Format, ohne manuelles Zusammen-
// setzen aus einzelnen Formatter-Teilen.
function lokalesDatum(capturedAt: string, capturedTz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: capturedTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(capturedAt));
}

// Tagesnummer eines einzelnen Moments, gezählt ab start_date als Tag 1.
// Ein Moment vor dem Startdatum (Anreise) wird auf Tag 1 geklemmt, statt eine
// 0 oder negative Zahl zu liefern und dadurch verworfen zu werden.
function tagesnummer(moment: RecapMoment, startDate: string): number {
  const [ly, lm, ld] = parseIsoDatum(lokalesDatum(moment.captured_at, moment.captured_tz));
  const [sy, sm, sd] = parseIsoDatum(startDate);
  const diffTage = Math.round((toUtcTag(ly, lm, ld) - toUtcTag(sy, sm, sd)) / MS_PRO_TAG);
  return diffTage < 0 ? 1 : diffTage + 1;
}

// Kanonisches Datum für eine Tagesnummer: start_date + (nummer - 1) Tage.
// Bewusst NICHT aus dem lokalen Datum irgendeines Moments dieses Tages
// abgeleitet (siehe Zeitzonen-Begründung oben) — sonst müsste willkürlich
// gewählt werden, wessen captured_tz dafür massgeblich ist, sobald ein Tag
// mehrere Zeitzonen enthält.
function datumFuerTag(startDate: string, nummer: number): string {
  const [sy, sm, sd] = parseIsoDatum(startDate);
  const datum = new Date(toUtcTag(sy, sm, sd) + (nummer - 1) * MS_PRO_TAG);
  const y = datum.getUTCFullYear();
  const m = String(datum.getUTCMonth() + 1).padStart(2, '0');
  const d = String(datum.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function gruppiereNachTagen(momente: RecapMoment[], startDate: string): RecapTag[] {
  const sortiert = sortiereMomente(momente);
  const gruppen = new Map<number, RecapMoment[]>();
  for (const moment of sortiert) {
    const nummer = tagesnummer(moment, startDate);
    const bisherige = gruppen.get(nummer);
    if (bisherige) {
      bisherige.push(moment);
    } else {
      gruppen.set(nummer, [moment]);
    }
  }
  return [...gruppen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([nummer, momenteDesTages]) => ({
      nummer,
      datum: datumFuerTag(startDate, nummer),
      ort: ortDesTages(momenteDesTages),
      momente: momenteDesTages,
    }));
}

// Häufigster place_name; bei Gleichstand gewinnt der Ort des chronologisch
// frühesten Moments (nicht einfach der erste Treffer in der Eingabereihen-
// folge — die Funktion sortiert deshalb selbst, statt sich auf die
// Aufrufreihenfolge zu verlassen).
export function ortDesTages(momente: RecapMoment[]): string | null {
  const orte = momente.map((m) => m.place_name).filter((ort): ort is string => !!ort);
  if (orte.length === 0) return null;

  const haeufigkeit = new Map<string, number>();
  for (const ort of orte) {
    haeufigkeit.set(ort, (haeufigkeit.get(ort) ?? 0) + 1);
  }
  const maxHaeufigkeit = Math.max(...haeufigkeit.values());
  const kandidaten = new Set(
    [...haeufigkeit.entries()].filter(([, anzahl]) => anzahl === maxHaeufigkeit).map(([ort]) => ort)
  );

  for (const moment of sortiereMomente(momente)) {
    if (moment.place_name && kandidaten.has(moment.place_name)) {
      return moment.place_name;
    }
  }
  // Unerreichbar: orte.length > 0 garantiert oben mindestens einen Treffer.
  return null;
}
