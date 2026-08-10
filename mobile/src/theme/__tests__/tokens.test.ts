import { palette, cinema, radius, spacing, type, shadow, motion } from '../tokens';

test('Licht-Palette trägt die v2-Werte (Airbnb-Look)', () => {
  expect(palette['bg-0']).toBe('#FFFFFF');
  expect(palette['bg-1']).toBe('#F7F7F7');
  expect(palette.line).toBe('#EBEBEB');
  expect(palette['line-strong']).toBe('#B0B0B0');
  expect(palette['text-1']).toBe('#222222');
  expect(palette.accent).toBe('#FF385C');
  expect(palette['accent-pressed']).toBe('#E31C5F');
  expect(palette['accent-text']).toBe('#C4103C');
  expect(palette.seal).toBe('#B8752F');
  expect(palette.danger).toBe('#C13515');
  expect(palette['on-accent']).toBe('#FFFFFF');
});

test('Kino-Palette bleibt warm-dunkel und getrennt von der Licht-Palette', () => {
  expect(cinema['bg-0']).toBe('#131110');
  expect(cinema['bg-1']).toBe('#1C1917');
  expect(cinema['text-1']).toBe('#F2EEE8');
  expect(cinema['seal-glow']).toBe('#E8A13C');
  expect(cinema['overlay-pill']).toBe('rgba(19,17,16,0.55)');
});

test('Radius kennt exakt 12, 24, 999', () => {
  expect(radius).toEqual({ control: 12, card: 24, pill: 999 });
});

test('Spacing folgt dem 4er-Raster mit Screen-Rand 24', () => {
  expect(spacing).toEqual({ xs: 4, s: 8, m: 12, base: 16, screen: 24, l: 24, xl: 32, xxl: 48 });
});

test('Typo-Rollen tragen Figtree (v2-Skala)', () => {
  expect(type.display).toMatchObject({ fontFamily: 'Figtree_300Light', fontSize: 84 });
  expect(type.h1).toMatchObject({ fontFamily: 'Figtree_700Bold', fontSize: 30 });
  expect(type.h2).toMatchObject({ fontFamily: 'Figtree_600SemiBold', fontSize: 22 });
  expect(type.h3).toMatchObject({ fontFamily: 'Figtree_600SemiBold', fontSize: 18 });
  expect(type.body).toMatchObject({ fontFamily: 'Figtree_400Regular', fontSize: 16 });
  expect(type.bodyMedium).toMatchObject({ fontFamily: 'Figtree_500Medium', fontSize: 16 });
  expect(type.tab.fontSize).toBe(11);
});

test('Motion-Tokens: Dauern, ease-smooth, spring-ui', () => {
  expect(motion.duration).toEqual({ fast: 150, base: 250, gentle: 400, feature: 800 });
  expect(motion.easeSmooth).toEqual([0.22, 1, 0.36, 1]);
  expect(motion.spring).toEqual({ damping: 18, stiffness: 180, mass: 1 });
});

test('Schatten: genau drei Stufen, neutral-schwarz', () => {
  expect(Object.keys(shadow)).toEqual(['s1', 's2', 's3']);
  expect(shadow.s1.shadowColor).toBe('#000000');
  expect(shadow.s2.elevation).toBeGreaterThan(shadow.s1.elevation);
  expect(shadow.s3.shadowOpacity).toBeCloseTo(0.28);
});

// DESIGN-LANGUAGE §2, unter der Typo-Tabelle: «Zahlen immer `tabular-nums`».
// Die Regel steht bei den allgemeinen Regeln, nicht in der Zeile des
// Zaehler-Displays, und gilt damit fuer jeden Text. Sie stand bis zu dieser
// Nacharbeit nur an `display`.
describe('§2: Zahlen immer tabular-nums', () => {
  test('JEDER Textstil traegt es, nicht nur das Zaehler-Display', () => {
    const ohne = Object.entries(type)
      .filter(([, stil]) => !(stil as { fontVariant?: string[] }).fontVariant?.includes('tabular-nums'))
      .map(([name]) => name);
    expect(ohne).toEqual([]);
  });

  // Und die Gegenprobe zum Testaufbau: dass ueberhaupt Stile geprueft werden.
  // Ohne sie waere die Zusicherung oben auch bei einem leeren `type` gruen.
  test('Testaufbau: es gibt neun Stile', () => {
    expect(Object.keys(type)).toEqual([
      'display', 'h1', 'h2', 'h3', 'body', 'bodyMedium', 'secondary', 'label', 'tab',
    ]);
  });

  // Je ein EIGENES Array pro Stil: React Native darf Style-Objekte einfrieren,
  // und ein geteiltes Array waere eine Verbindung zwischen Stilen, die nichts
  // miteinander zu tun haben.
  test('kein Stil teilt sein Array mit einem anderen', () => {
    const arrays = Object.values(type).map((stil) => (stil as { fontVariant?: unknown }).fontVariant);
    expect(new Set(arrays).size).toBe(arrays.length);
  });
});
