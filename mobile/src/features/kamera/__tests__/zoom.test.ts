import {
  aktiveStufe,
  begrenzen,
  beschriftung,
  fingerAbstand,
  multiCamZiel,
  nativerFaktor,
  zoomGeraet,
  zugFaktor,
  type Linse,
} from '../zoom';

const linse = (over: Partial<Linse> = {}): Linse => ({
  name: 'Rückkamera',
  typ: 'wide',
  bestandteile: [],
  umschaltpunkte: [],
  ...over,
});

// Das virtuelle Gerät eines iPhone 17 Pro Max: Ultraweitwinkel, Haupt und Tele
// in einem. Die Umschaltpunkte sind die Faktoren, bei denen iOS die Linse
// wechselt, und zugleich die Stufen, die Apple in der Kamera-App anbietet.
const dreifach = (): Linse =>
  linse({
    name: 'Rückseitige Dreifach-Kamera',
    typ: 'triple',
    bestandteile: ['ultraWide', 'wide', 'telephoto'],
    umschaltpunkte: [2, 8],
  });

test('von mehreren Kameras gewinnt die, die die meisten Linsen vereint', () => {
  const gewaehlt = zoomGeraet([linse(), dreifach(), linse({ typ: 'ultraWide' })]);
  expect(gewaehlt?.name).toBe('Rückseitige Dreifach-Kamera');
});

test('die Stufen sind die Umschaltpunkte des Geräts, bezogen auf die weiteste Linse', () => {
  expect(zoomGeraet([dreifach()])?.stufen).toEqual([0.5, 1, 4]);
});

test('ohne Ultraweitwinkel beginnt die Reihe bei 1', () => {
  // Weitwinkel plus Tele (iPhone X bis 11 Pro): dort IST der native Faktor 1,0
  // schon die Anzeige «1x», die Reihe verschiebt sich also nicht.
  const zweifach = linse({ typ: 'dual', bestandteile: ['wide', 'telephoto'], umschaltpunkte: [2] });
  expect(zoomGeraet([zweifach])?.stufen).toEqual([1, 2]);
});

test('ein Gerät mit nur einer Linse hat nichts zu wählen', () => {
  expect(zoomGeraet([linse()])).toBeNull();
});

test('ohne Linsen — Android, Simulator — gibt es keine Reihe', () => {
  expect(zoomGeraet([])).toBeNull();
});

// Was der Nutzer liest, und was das Gerät versteht, sind zwei Zahlen: auf
// einem Gerät mit Ultraweitwinkel liegt zwischen ihnen der Faktor 2.
test('die angezeigten 4× sind für das Gerät der Faktor 8', () => {
  expect(nativerFaktor(4, 0.5)).toBe(8);
});

test('ohne Ultraweitwinkel sind Anzeige und Gerätefaktor dasselbe', () => {
  expect(nativerFaktor(2, 1)).toBe(2);
});

// Die Grenzen kommen nativ vom Gerät (minAvailableVideoZoomFactor /
// maxAvailableVideoZoomFactor) und gelten deshalb in dessen Zählung.
test('weiter als die weiteste Linse geht es nicht', () => {
  expect(begrenzen(0.2, { min: 1, max: 120 }, 0.5)).toBe(0.5);
});

test('näher als das Gerät kann, geht es auch nicht', () => {
  expect(begrenzen(999, { min: 1, max: 120 }, 0.5)).toBe(60);
});

test('innerhalb der Grenzen bleibt der Faktor unangetastet', () => {
  expect(begrenzen(2.3, { min: 1, max: 120 }, 0.5)).toBe(2.3);
});

test.each([
  [0.5, '0,5×'],
  [1, '1×'],
  [4, '4×'],
  [12, '12×'],
  [2.34, '2,3×'],
  [1.96, '2×'],
  // Ab zweistellig ohne Nachkommastelle, wie in der Kamera-App: «12,5×» wäre
  // fünf Zeichen und liefe aus der schmalen Stufe heraus.
  [12.4, '12×'],
  [12.5, '13×'],
  [27.8, '28×'],
])('%p steht als %p auf der Stufe', (faktor, erwartet) => {
  expect(beschriftung(faktor)).toBe(erwartet);
});

test('zwischen zwei Stufen bleibt die kleinere die aktive', () => {
  // Wie in der Kamera-App: die Stufe «1×» trägt dann den laufenden Wert.
  expect(aktiveStufe(2.3, [0.5, 1, 4])).toBe(1);
});

test('genau auf einer Stufe ist diese die aktive', () => {
  expect(aktiveStufe(4, [0.5, 1, 4])).toBe(4);
});

test('unterhalb der ersten Stufe bleibt die erste die aktive', () => {
  expect(aktiveStufe(0.4, [0.5, 1, 4])).toBe(0.5);
});

// Der Pinch misst den Abstand der beiden Finger; sein Verhältnis zum Abstand
// beim Aufsetzen ist der Faktor, um den gezoomt wird.
test('der Abstand zweier Finger ist die Strecke zwischen ihnen', () => {
  expect(
    fingerAbstand([
      { pageX: 0, pageY: 0 },
      { pageX: 3, pageY: 4 },
    ])
  ).toBe(5);
});

test('mit einem Finger allein gibt es keinen Abstand', () => {
  expect(fingerAbstand([{ pageX: 0, pageY: 0 }])).toBeNull();
});

test('liegen mehr als zwei Finger auf, zählen die ersten beiden', () => {
  expect(
    fingerAbstand([
      { pageX: 0, pageY: 0 },
      { pageX: 0, pageY: 8 },
      { pageX: 300, pageY: 300 },
    ])
  ).toBe(8);
});

// ——— Zug-Zoom (Spec 2026-08-13-aufnahme-tempo-design.md §7) ———
//
// Der Hub ist die vertikale Fingerbewegung seit dem Aufsetzen, nach oben
// positiv. Das Mapping ist exponentiell (Zoom ist multiplikativ, ein
// linearer Weg fühlt sich am oberen Ende träge an) und die Referenz ist der
// Faktor beim Aufnahmestart, nicht 1×.
describe('zugFaktor', () => {
  const GRENZEN = { min: 1, max: 120 }; // Geräte-Zählung, wie zoomGrenzen liefert
  const BASIS = 0.5; // Ultraweitwinkel-Gerät: Anzeige-Grenzen sind 0,5× bis 60×
  const WEGE = { hoch: 500, runter: 100 };

  test('Hub 0 gibt den Startfaktor zurück', () => {
    expect(zugFaktor(0, 1, GRENZEN, BASIS, WEGE)).toBe(1);
  });

  test('der volle Weg nach oben erreicht das Maximum', () => {
    expect(zugFaktor(500, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
  });

  test('über den Weg hinaus bleibt es beim Maximum', () => {
    expect(zugFaktor(1600, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
  });

  test('exponentiell: der halbe Weg steht beim geometrischen Mittel', () => {
    // Von 1× nach 60× ist die Hälfte des Weges √60, nicht 30,5.
    expect(zugFaktor(250, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(Math.sqrt(60));
  });

  test('der volle Weg nach unten erreicht das Minimum', () => {
    expect(zugFaktor(-100, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(0.5);
  });

  test('unter dem Weg nach unten bleibt es beim Minimum', () => {
    expect(zugFaktor(-400, 1, GRENZEN, BASIS, WEGE)).toBeCloseTo(0.5);
  });

  test('ein Start am Maximum bleibt beim Hochziehen dort', () => {
    expect(zugFaktor(300, 60, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
  });

  test('die Referenz ist der Startfaktor, nicht 1×', () => {
    // Wer bei 4× startet und den vollen Weg zieht, landet ebenfalls beim
    // Maximum — der Weg deckt immer die Strecke Startfaktor → Grenze ab.
    expect(zugFaktor(500, 4, GRENZEN, BASIS, WEGE)).toBeCloseTo(60);
    expect(zugFaktor(-100, 4, GRENZEN, BASIS, WEGE)).toBeCloseTo(0.5);
  });
});

describe('multiCamZiel: die MultiCam-Zuordnung Anzeige zu Kamera und Faktor', () => {
  it('Front bleibt Front, unter 1× klemmt der Faktor auf 1', () => {
    expect(multiCamZiel(0.5, 'front', true)).toEqual({ kamera: 'front', faktor: 1 });
    expect(multiCamZiel(2, 'front', true)).toEqual({ kamera: 'front', faktor: 2 });
  });
  it('0,5× auf der Rückseite ist der Ultraweitwinkel bei Faktor 1', () => {
    expect(multiCamZiel(0.5, 'back', true)).toEqual({ kamera: 'ultraweit', faktor: 1 });
  });
  it('0,9× liegt noch im Ultraweitwinkel, skaliert mit 2', () => {
    expect(multiCamZiel(0.9, 'back', true)).toEqual({ kamera: 'ultraweit', faktor: 1.8 });
  });
  it('ab 1× übernimmt der Weitwinkel mit dem Anzeige-Faktor', () => {
    expect(multiCamZiel(1, 'back', true)).toEqual({ kamera: 'weit', faktor: 1 });
    expect(multiCamZiel(3.5, 'back', true)).toEqual({ kamera: 'weit', faktor: 3.5 });
  });
  it('ohne Ultraweitwinkel klemmt unter 1× auf dem Weitwinkel bei 1', () => {
    expect(multiCamZiel(0.5, 'back', false)).toEqual({ kamera: 'weit', faktor: 1 });
  });
});
