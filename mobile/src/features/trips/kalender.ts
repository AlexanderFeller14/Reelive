import { heutigerKalendertag } from './tripDay';

// Ausgeschriebene Monatsnamen. `tripDay.ts` führt daneben eine Kurzliste für
// `formatRange`; beide bleiben getrennt, weil sie verschiedene Zwecke haben:
// die Kurzform steht am Feld, die Langform wird vorgelesen.
const MONATE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export const MONATE_ZURUECK = 12;
export const MONATE_VORWAERTS = 24;

// Masse des Rasters. Sie stehen hier und nicht in der Komponente, weil
// `getItemLayout` die Monatshöhe kennen muss, BEVOR gerendert wird.
export const ZEILE_HOEHE = 48;
export const MONAT_KOPF_HOEHE = 44;
export const MONAT_ABSTAND = 24;

export type Auswahl = { start: string | null; end: string | null };

export type Zellrolle = 'frei' | 'beginn' | 'ende' | 'dazwischen' | 'einzeln' | 'gesperrt';

export type Monat = {
  jahr: number;
  monat: number; // 1 bis 12
  titel: string;
  // Sieben Einträge je Woche, `null` für die Leerzellen vor dem Ersten und
  // nach dem Letzten.
  wochen: (string | null)[][];
};

function alsIso(jahr: number, monat: number, tag: number): string {
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

// Tag 0 des Folgemonats ist der letzte Tag dieses Monats, das erspart eine
// eigene Schaltjahr-Regel.
function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

// getUTCDay() zählt ab Sonntag, das Raster beginnt am Montag.
function versatzDesErsten(jahr: number, monat: number): number {
  return (new Date(Date.UTC(jahr, monat - 1, 1)).getUTCDay() + 6) % 7;
}

export function monatRaster(jahr: number, monat: number): Monat {
  const zellen: (string | null)[] = Array(versatzDesErsten(jahr, monat)).fill(null);
  for (let tag = 1; tag <= tageImMonat(jahr, monat); tag++) {
    zellen.push(alsIso(jahr, monat, tag));
  }
  // Auf volle Wochen auffüllen, damit jede Zeile sieben Zellen hat und die
  // Spalten über alle Monate hinweg fluchten.
  while (zellen.length % 7 !== 0) zellen.push(null);

  const wochen: (string | null)[][] = [];
  for (let i = 0; i < zellen.length; i += 7) wochen.push(zellen.slice(i, i + 7));
  return { jahr, monat, titel: `${MONATE[monat - 1]} ${jahr}`, wochen };
}

export function monateImBereich(heute: string): Monat[] {
  const [jahr, monat] = heute.split('-').map(Number);
  // In fortlaufenden Monaten rechnen statt mit Date: so gibt es keinen
  // Sonderfall an der Jahresgrenze.
  const ersterLauf = jahr * 12 + (monat - 1) - MONATE_ZURUECK;
  const anzahl = MONATE_ZURUECK + MONATE_VORWAERTS + 1;
  return Array.from({ length: anzahl }, (_, i) => {
    const lauf = ersterLauf + i;
    return monatRaster(Math.floor(lauf / 12), (lauf % 12) + 1);
  });
}

// Die vier Regeln aus der Spec: Regel 1 (kein Beginn) und Regel 4 (fertiger
// Zeitraum) fallen zusammen, beide fangen mit dem getippten Tag neu an.
export function naechsteAuswahl(aktuell: Auswahl, getippt: string): Auswahl {
  if (!aktuell.start || aktuell.end) return { start: getippt, end: null };
  if (getippt < aktuell.start) return { start: getippt, end: null };
  return { start: aktuell.start, end: getippt };
}

export function zellrolle(
  tag: string,
  auswahl: Auswahl,
  ersterTag: string,
  letzterTag: string
): Zellrolle {
  if (tag < ersterTag || tag > letzterTag) return 'gesperrt';
  const { start, end } = auswahl;
  // Die Tagesreise zuerst: sie ist Beginn UND Ende, bekommt aber keine
  // halbseitige Fläche, sonst ragte der Balken ins Leere.
  if (start && start === end && tag === start) return 'einzeln';
  if (tag === start) return 'beginn';
  if (tag === end) return 'ende';
  if (start && end && tag > start && tag < end) return 'dazwischen';
  return 'frei';
}

export function monatHoehe(monat: Monat): number {
  return MONAT_KOPF_HOEHE + monat.wochen.length * ZEILE_HOEHE + MONAT_ABSTAND;
}

export function monatVersatz(monate: Monat[], index: number): number {
  let summe = 0;
  for (let i = 0; i < index; i++) summe += monatHoehe(monate[i]);
  return summe;
}

export function monatIndexFuer(monate: Monat[], tag: string | null): number {
  if (!tag) return 0;
  const [jahr, monat] = tag.split('-').map(Number);
  const index = monate.findIndex((m) => m.jahr === jahr && m.monat === monat);
  return index < 0 ? 0 : index;
}

export function tagLabel(tag: string): string {
  const [jahr, monat, tagZahl] = tag.split('-').map(Number);
  return `${tagZahl}. ${MONATE[monat - 1]} ${jahr}`;
}

// Vorlese-Beschriftung des Feldes. Beide Monate ausgeschrieben und «bis» als
// Wort: die Kurzform «Aug» kommt vorgelesen nicht verlässlich als «August» an,
// und DESIGN-LANGUAGE §6 erlaubt den Bis-Strich, verlangt ihn aber nicht.
export function zeitraumLabel(auswahl: Auswahl): string {
  if (!auswahl.start || !auswahl.end) return 'Zeitraum, noch nichts gewählt';
  return `Zeitraum, ${tagLabel(auswahl.start)} bis ${tagLabel(auswahl.end)}`;
}

// Erlaubt Tests, den Kalender auf einen festen Tag zu setzen. Ohne diesen
// Einstieg hinge jeder Test am echten Systemdatum und bräche im Folgemonat
// (gleiches Muster wie heutigerKalendertag(jetzt = new Date())).
export function heuteOderDefault(heute?: string): string {
  return heute ?? heutigerKalendertag();
}
