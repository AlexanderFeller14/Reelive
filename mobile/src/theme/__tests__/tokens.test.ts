import { colors, radius, spacing, type } from '../tokens';

test('Farbtokens existieren in beiden Themes mit identischen Schlüsseln', () => {
  expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  expect(colors.dark['bg-0']).toBe('#131110');
  expect(colors.light['bg-0']).toBe('#F6F3EE');
  expect(colors.dark.accent).toBe('#ED5B3D');
  expect(colors.light['accent-text']).toBe('#C9432A');
});

test('Radius kennt exakt 12, 24, 999', () => {
  expect(radius).toEqual({ control: 12, card: 24, pill: 999 });
});

test('Spacing folgt dem 4er-Raster inkl. Screen-Rand 20', () => {
  expect(spacing).toEqual({ xs: 4, s: 8, m: 12, base: 16, screen: 20, l: 24, xl: 32, xxl: 48 });
});

test('Typo-Rollen tragen Manrope-Weights', () => {
  expect(type.display.fontFamily).toBe('Manrope_200ExtraLight');
  expect(type.h1.fontSize).toBe(28);
  expect(type.body.fontSize).toBe(16);
});
