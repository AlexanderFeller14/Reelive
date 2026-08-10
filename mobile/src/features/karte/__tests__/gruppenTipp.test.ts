import { kameraBewegt, zoomAussichtslos, zoomZiel } from '@/features/karte/gruppenTipp';
import type { Ausschnitt, Gruppe, KartenPunkt } from '@/features/karte/typen';
import type { RecapMoment } from '@/features/recap/types';

function moment(id: string): RecapMoment {
  return {
    id,
    trip_id: 't1',
    author_id: 'a1',
    type: 'photo',
    duration_s: null,
    caption: null,
    captured_at: '2026-08-10T09:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    place_name: 'Alfama',
    lat: 38.7139,
    lng: -9.1301,
    upload_status: 'uploaded',
    autor_name: 'Lea',
  };
}

function punkt(id: string, lat: number, lng: number, index = 0): KartenPunkt {
  return { moment: { ...moment(id), lat, lng }, lat, lng, index };
}

function gruppe(punkte: KartenPunkt[]): Gruppe {
  return { anker: punkte[0], punkte };
}

const SICHTBAR: Ausschnitt = {
  latitude: 38.72,
  longitude: -9.14,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

describe('kameraBewegt', () => {
  test('derselbe Ausschnitt gilt nicht als Bewegung', () => {
    expect(kameraBewegt(SICHTBAR, { ...SICHTBAR })).toBe(false);
  });

  test('eine halbierte Spanne ist eine Bewegung', () => {
    expect(kameraBewegt(SICHTBAR, { ...SICHTBAR, latitudeDelta: 0.02 })).toBe(true);
    expect(kameraBewegt(SICHTBAR, { ...SICHTBAR, longitudeDelta: 0.02 })).toBe(true);
  });

  test('eine verschobene Mitte ist eine Bewegung', () => {
    expect(kameraBewegt(SICHTBAR, { ...SICHTBAR, latitude: 38.73 })).toBe(true);
    expect(kameraBewegt(SICHTBAR, { ...SICHTBAR, longitude: -9.13 })).toBe(true);
  });

  // Die Schwelle hängt an der SPANNE, nicht an einer festen Gradzahl: derselbe
  // absolute Versatz ist auf einem Kontinent-Ausschnitt nichts und auf einem
  // Häuserblock eine halbe Karte.
  test('ein Zittern unterhalb eines Prozents der Spanne zählt nicht', () => {
    // 0.04 × 1 % = 0.0004, die Hälfte davon liegt darunter.
    expect(kameraBewegt(SICHTBAR, { ...SICHTBAR, latitude: 38.7202 })).toBe(false);
    const eng = { ...SICHTBAR, latitudeDelta: 0.0004, longitudeDelta: 0.0004 };
    // Derselbe Versatz auf einem hundertmal engeren Ausschnitt ist sehr wohl
    // eine Bewegung.
    expect(kameraBewegt(eng, { ...eng, latitude: 38.7202 })).toBe(true);
  });

  // Ohne den kürzeren Weg um die Erde gälte jede Karte über der Datumsgrenze
  // als dauerhaft in Bewegung, und die Sackgasse ginge dort wieder auf.
  test('über den 180. Längengrad hinweg wird der kürzere Weg gemessen', () => {
    const anDerGrenze: Ausschnitt = {
      latitude: 0,
      longitude: 179.999,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
    // 0.002 Grad auseinander, aber numerisch 359.998, das sind 5 % der Spanne
    // und damit eine Bewegung, aber keine von 360 Grad.
    expect(kameraBewegt(anDerGrenze, { ...anDerGrenze, longitude: -179.999 })).toBe(true);
    // Und exakt derselbe Punkt, einmal als 180 und einmal als -180 geschrieben,
    // ist keine.
    expect(
      kameraBewegt({ ...anDerGrenze, longitude: 180 }, { ...anDerGrenze, longitude: -180 })
    ).toBe(false);
  });
});

describe('zoomZiel', () => {
  const nah = gruppe([punkt('p1', 38.7139, -9.1301), punkt('p2', 38.71408, -9.1301, 1)]);

  test('zielt auf die Mitte der Gruppe', () => {
    const ziel = zoomZiel(nah, SICHTBAR);
    expect(ziel).not.toBeNull();
    expect(ziel!.latitude).toBeCloseTo((38.7139 + 38.71408) / 2, 6);
    expect(ziel!.longitude).toBeCloseTo(-9.1301, 6);
  });

  test('fährt nie hinaus, höchstens auf die halbe sichtbare Spanne', () => {
    const ziel = zoomZiel(nah, SICHTBAR)!;
    expect(ziel.latitudeDelta).toBeLessThanOrEqual(SICHTBAR.latitudeDelta / 2);
    expect(ziel.longitudeDelta).toBeLessThanOrEqual(SICHTBAR.longitudeDelta / 2);
  });

  test('eine enge Gruppe wird enger gezeigt als die halbe Spanne', () => {
    // Aus einem bereits sehr nahen Ausschnitt heraus gewinnt die Ausdehnung
    // der Gruppe, nicht die Halbierung.
    const engSichtbar = { ...SICHTBAR, latitudeDelta: 4, longitudeDelta: 4 };
    const ziel = zoomZiel(nah, engSichtbar)!;
    expect(ziel.latitudeDelta).toBeLessThan(engSichtbar.latitudeDelta / 2);
  });
});

describe('zoomAussichtslos', () => {
  const aufEinemFleck = gruppe([punkt('p1', 38.7139, -9.1301), punkt('p2', 38.7139, -9.1301, 1)]);
  // Rund 20 Meter auseinander: auf DIESEM Ausschnitt eine Gruppe, aber nicht
  // auf derselben Koordinate.
  const trennbar = gruppe([punkt('p1', 38.7139, -9.1301), punkt('p2', 38.71408, -9.1301, 1)]);

  test('bitgleiche Koordinaten: sofort das Sheet, ohne einen Versuch', () => {
    expect(zoomAussichtslos(aufEinemFleck, SICHTBAR, null)).toBe(true);
  });

  test('eine trennbare Gruppe bekommt beim ersten Tipp kein Sheet', () => {
    expect(zoomAussichtslos(trennbar, SICHTBAR, null)).toBe(false);
  });

  // Der Kern der Fixrunde: bei MAX_ZOOM steht die Kamera, und die Gruppe fiele
  // durch keine weitere Stufe auseinander, obwohl ihre Punkte verschieden
  // sind.
  test('hat der letzte Tipp auf DIESE Gruppe nichts bewegt, öffnet der nächste das Sheet', () => {
    const letzter = { ankerId: 'p1', vorher: SICHTBAR };
    expect(zoomAussichtslos(trennbar, SICHTBAR, letzter)).toBe(true);
  });

  test('hat er die Kamera bewegt, wird weiter hineingezoomt', () => {
    const letzter = { ankerId: 'p1', vorher: { ...SICHTBAR, latitudeDelta: 0.08, longitudeDelta: 0.08 } };
    expect(zoomAussichtslos(trennbar, SICHTBAR, letzter)).toBe(false);
  });

  // Eine andere Gruppe liegt woanders: dorthin kann die Kamera fahren, auch
  // wenn die Zoomstufe längst am Anschlag ist, die MITTE bewegt sich.
  test('der stehen gebliebene Versuch einer ANDEREN Gruppe blockiert nicht', () => {
    const andere = gruppe([punkt('q1', 38.75, -9.16), punkt('q2', 38.75018, -9.16, 1)]);
    const letzter = { ankerId: 'p1', vorher: SICHTBAR };
    expect(zoomAussichtslos(andere, SICHTBAR, letzter)).toBe(false);
  });
});
