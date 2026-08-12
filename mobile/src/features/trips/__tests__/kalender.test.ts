import {
  MONATE_VORWAERTS, MONATE_ZURUECK, heuteOderDefault, monatHoehe, monatIndexFuer,
  monatRaster, monatVersatz, monateImBereich, naechsteAuswahl, tagLabel,
  zeitraumLabel, zellrolle, ZEILE_HOEHE, MONAT_KOPF_HOEHE, MONAT_ABSTAND,
} from '../kalender';

const LEER = { start: null, end: null };

test('monatRaster füllt den August 2026 mit Montag als Wochenstart', () => {
  const m = monatRaster(2026, 8);
  expect(m.titel).toBe('August 2026');
  // Der 1.8.2026 ist ein Samstag, also fünf Leerzellen davor.
  expect(m.wochen[0]).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02']);
  expect(m.wochen[1][0]).toBe('2026-08-03');
});

test('monatRaster füllt die letzte Woche bis zum Sonntag auf', () => {
  const m = monatRaster(2026, 8);
  const letzte = m.wochen[m.wochen.length - 1];
  expect(letzte).toHaveLength(7);
  expect(letzte.filter((t) => t === null).length).toBeGreaterThan(0);
});

test('monatRaster kennt den Schaltjahr-Februar', () => {
  const tage = monatRaster(2028, 2).wochen.flat().filter(Boolean);
  expect(tage).toHaveLength(29);
  expect(tage[28]).toBe('2028-02-29');
});

test('monatRaster kennt den gewöhnlichen Februar', () => {
  expect(monatRaster(2027, 2).wochen.flat().filter(Boolean)).toHaveLength(28);
});

test('monateImBereich reicht ein Jahr zurück und zwei Jahre vorwärts', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monate).toHaveLength(MONATE_ZURUECK + MONATE_VORWAERTS + 1);
  expect(monate[0].titel).toBe('August 2025');
  expect(monate[MONATE_ZURUECK].titel).toBe('August 2026');
  expect(monate[monate.length - 1].titel).toBe('August 2028');
});

test('monateImBereich läuft sauber über die Jahresgrenze', () => {
  const monate = monateImBereich('2026-01-15');
  expect(monate[0].titel).toBe('Januar 2025');
  expect(monate[MONATE_ZURUECK].titel).toBe('Januar 2026');
});

test('naechsteAuswahl: der erste Tipp setzt den Beginn', () => {
  expect(naechsteAuswahl(LEER, '2026-08-05')).toEqual({ start: '2026-08-05', end: null });
});

test('naechsteAuswahl: ein späterer Tag wird zum Ende', () => {
  const vorher = { start: '2026-08-05', end: null };
  expect(naechsteAuswahl(vorher, '2026-08-14')).toEqual({ start: '2026-08-05', end: '2026-08-14' });
});

test('naechsteAuswahl: ein früherer Tag setzt den Beginn neu', () => {
  const vorher = { start: '2026-08-05', end: null };
  expect(naechsteAuswahl(vorher, '2026-08-01')).toEqual({ start: '2026-08-01', end: null });
});

test('naechsteAuswahl: derselbe Tag ergibt die Tagesreise', () => {
  const vorher = { start: '2026-08-05', end: null };
  expect(naechsteAuswahl(vorher, '2026-08-05')).toEqual({ start: '2026-08-05', end: '2026-08-05' });
});

test('naechsteAuswahl: ein fertiger Zeitraum beginnt von vorn', () => {
  const vorher = { start: '2026-08-05', end: '2026-08-14' };
  expect(naechsteAuswahl(vorher, '2026-09-02')).toEqual({ start: '2026-09-02', end: null });
});

describe('zellrolle', () => {
  const auswahl = { start: '2026-08-05', end: '2026-08-14' };
  const ersterTag = '2025-08-01';
  const letzterTag = '2028-08-31';
  const rolle = (tag: string, a = auswahl) => zellrolle(tag, a, ersterTag, letzterTag);

  test('erkennt Beginn und Ende', () => {
    expect(rolle('2026-08-05')).toBe('beginn');
    expect(rolle('2026-08-14')).toBe('ende');
  });

  test('erkennt die Tage dazwischen', () => {
    expect(rolle('2026-08-09')).toBe('dazwischen');
  });

  test('lässt Tage ausserhalb der Spanne frei', () => {
    expect(rolle('2026-08-04')).toBe('frei');
    expect(rolle('2026-08-15')).toBe('frei');
  });

  test('sperrt Tage ausserhalb des Bereichs', () => {
    expect(rolle('2025-07-31')).toBe('gesperrt');
    expect(rolle('2028-09-01')).toBe('gesperrt');
  });

  test('nennt die Tagesreise einzeln, nicht Beginn', () => {
    const tagesreise = { start: '2026-08-05', end: '2026-08-05' };
    expect(rolle('2026-08-05', tagesreise)).toBe('einzeln');
  });

  test('markiert bei halber Auswahl nur den Beginn', () => {
    const halb = { start: '2026-08-05', end: null };
    expect(rolle('2026-08-05', halb)).toBe('beginn');
    expect(rolle('2026-08-09', halb)).toBe('frei');
  });
});

test('monatHoehe rechnet Kopf, Wochenzeilen und Abstand zusammen', () => {
  const m = monatRaster(2026, 8);
  expect(monatHoehe(m)).toBe(MONAT_KOPF_HOEHE + m.wochen.length * ZEILE_HOEHE + MONAT_ABSTAND);
});

test('monatVersatz summiert die Höhen der Monate davor', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monatVersatz(monate, 0)).toBe(0);
  expect(monatVersatz(monate, 2)).toBe(monatHoehe(monate[0]) + monatHoehe(monate[1]));
});

test('monatIndexFuer findet den Monat eines Tages', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monatIndexFuer(monate, '2026-08-05')).toBe(MONATE_ZURUECK);
  expect(monatIndexFuer(monate, '2026-09-02')).toBe(MONATE_ZURUECK + 1);
});

test('monatIndexFuer fällt ohne Tag auf den ersten Monat zurück', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monatIndexFuer(monate, null)).toBe(0);
});

test('tagLabel schreibt den Monat aus', () => {
  expect(tagLabel('2026-08-14')).toBe('14. August 2026');
  expect(tagLabel('2026-01-01')).toBe('1. Januar 2026');
});

test('zeitraumLabel schreibt beide Monate aus und nutzt «bis» als Wort', () => {
  expect(zeitraumLabel({ start: '2026-08-01', end: '2026-08-14' }))
    .toBe('Zeitraum, 1. August 2026 bis 14. August 2026');
});

test('zeitraumLabel sagt bei leerer Auswahl, dass nichts gewählt ist', () => {
  expect(zeitraumLabel({ start: null, end: null })).toBe('Zeitraum, noch nichts gewählt');
  expect(zeitraumLabel({ start: '2026-08-01', end: null })).toBe('Zeitraum, noch nichts gewählt');
});

test('heuteOderDefault reicht einen gesetzten Wert durch', () => {
  expect(heuteOderDefault('2026-08-12')).toBe('2026-08-12');
});
