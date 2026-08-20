import { palette, cinema, radius, spacing, type, shadow, motion } from '../tokens';

test('light palette carries the v2 values (Airbnb look)', () => {
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

test('cinema palette stays warm-dark and separate from the light palette', () => {
  expect(cinema['bg-0']).toBe('#131110');
  expect(cinema['bg-1']).toBe('#1C1917');
  expect(cinema['text-1']).toBe('#F2EEE8');
  expect(cinema['seal-glow']).toBe('#E8A13C');
  expect(cinema['overlay-pill']).toBe('rgba(19,17,16,0.55)');
});

test('radius knows exactly 12, 24, 999', () => {
  expect(radius).toEqual({ control: 12, card: 24, pill: 999 });
});

test('spacing follows the 4-unit grid with a 24 screen margin', () => {
  expect(spacing).toEqual({ xs: 4, s: 8, m: 12, base: 16, screen: 24, l: 24, xl: 32, xxl: 48 });
});

test('type roles carry Figtree (v2 scale)', () => {
  expect(type.display).toMatchObject({ fontFamily: 'Figtree_300Light', fontSize: 84 });
  expect(type.h1).toMatchObject({ fontFamily: 'Figtree_700Bold', fontSize: 30 });
  expect(type.h2).toMatchObject({ fontFamily: 'Figtree_600SemiBold', fontSize: 22 });
  expect(type.h3).toMatchObject({ fontFamily: 'Figtree_600SemiBold', fontSize: 18 });
  expect(type.body).toMatchObject({ fontFamily: 'Figtree_400Regular', fontSize: 16 });
  expect(type.bodyMedium).toMatchObject({ fontFamily: 'Figtree_500Medium', fontSize: 16 });
  expect(type.tab.fontSize).toBe(11);
});

test('motion tokens: durations, ease-smooth, spring-ui', () => {
  expect(motion.duration).toEqual({ fast: 150, base: 250, gentle: 400, feature: 800 });
  expect(motion.easeSmooth).toEqual([0.22, 1, 0.36, 1]);
  expect(motion.spring).toEqual({ damping: 18, stiffness: 180, mass: 1 });
});

test('shadow: exactly three levels, neutral black', () => {
  expect(Object.keys(shadow)).toEqual(['s1', 's2', 's3']);
  expect(shadow.s1.shadowColor).toBe('#000000');
  expect(shadow.s2.elevation).toBeGreaterThan(shadow.s1.elevation);
  expect(shadow.s3.shadowOpacity).toBeCloseTo(0.28);
});

// DESIGN-LANGUAGE §2, under the type table: «numbers always `tabular-nums`».
// The rule sits with the general rules, not in the counter display's row,
// and therefore applies to every text. Until this cleanup it only sat on
// `display`.
describe('§2: numbers always tabular-nums', () => {
  test('EVERY text style carries it, not just the counter display', () => {
    const without = Object.entries(type)
      .filter(([, style]) => !(style as { fontVariant?: string[] }).fontVariant?.includes('tabular-nums'))
      .map(([name]) => name);
    expect(without).toEqual([]);
  });

  // And the counter-check to the test setup: that styles get checked at
  // all. Without it the assertion above would also be green for an empty
  // `type`.
  test('test setup: there are nine styles', () => {
    expect(Object.keys(type)).toEqual([
      'display', 'h1', 'h2', 'h3', 'body', 'bodyMedium', 'secondary', 'label', 'tab',
    ]);
  });

  // One OWN array per style: React Native may freeze style objects, and a
  // shared array would be a connection between styles that have nothing to
  // do with each other.
  test('no style shares its array with another', () => {
    const arrays = Object.values(type).map((style) => (style as { fontVariant?: unknown }).fontVariant);
    expect(new Set(arrays).size).toBe(arrays.length);
  });
});
