import type { FontVariant } from 'react-native';

// Design Language v2, values see DESIGN-LANGUAGE.md §1-§5.
// Light palette for all everyday screens (light-only).
export const palette = {
  'bg-0': '#FFFFFF', 'bg-1': '#F7F7F7',
  line: '#EBEBEB', 'line-strong': '#B0B0B0',
  'text-1': '#222222', 'text-2': '#6A6A6A', 'text-3': '#B0B0B0',
  accent: '#FF385C', 'accent-pressed': '#E31C5F', 'accent-text': '#C4103C',
  seal: '#B8752F', danger: '#C13515', 'on-accent': '#FFFFFF',
} as const;

// Cinema palette: ONLY media screens (camera, preview, recap player).
// Fixed, no theme, imported directly rather than through useTheme().
export const cinema = {
  'bg-0': '#131110', 'bg-1': '#1C1917',
  'text-1': '#F2EEE8', 'text-2': '#A79F96',
  'seal-glow': '#E8A13C', 'overlay-pill': 'rgba(19,17,16,0.55)',
} as const;

export type ColorTokens = typeof palette;

// Modal backdrop behind a sheet (phase 5 final review, point 6): neither a
// photo scrim (§1, tied to photo content) nor the pill color `overlay-pill`
// (tied to text/icons on photos), just a plain dimmer behind a panel coming up
// from the bottom. Applies UNCHANGED to the light AND the cinema sheet
// (Sheet.tsx sets it independently of `cinemaMode`), hence not part of
// `palette`/`cinema`. The value matches
// docs/superpowers/specs/2026-08-06-design-language-v2-airbnb-design.md
// (section Sheet: "Scrim rgba(0,0,0,0.4) faded 250 ms").
export const backdrop = 'rgba(0,0,0,0.4)' as const;

export const radius = { control: 12, card: 24, pill: 999 } as const;

// `screen` (screen margin) and `l` (layout gap) are semantically separate keys
// whose values happen to both be 24 in v2, do not deduplicate them.
export const spacing = { xs: 4, s: 8, m: 12, base: 16, screen: 24, l: 24, xl: 32, xxl: 48 } as const;

// DESIGN-LANGUAGE §2, below the typography table: "numbers always
// `tabular-nums`". Covered by theme/__tests__/tokens.test.ts, describe
// "§2: numbers always tabular-nums".
//
// `fontVariant` is typed explicitly as FontVariant[]: the outer `as const`
// would otherwise turn the array into a readonly tuple, which RN's TextStyle
// (it expects a mutable FontVariant[]) rejects (TS2769). And one array per
// style, never a shared one: React Native is allowed to freeze style objects,
// and a shared array would be a link between styles that have nothing to do
// with each other.
const DIGITS = (): FontVariant[] => ['tabular-nums'];

export const type = {
  display: {
    fontFamily: 'Figtree_300Light', fontSize: 84, letterSpacing: -1.7,
    fontVariant: DIGITS(),
  },
  h1: { fontFamily: 'Figtree_700Bold', fontSize: 30, lineHeight: 36, fontVariant: DIGITS() },
  h2: { fontFamily: 'Figtree_600SemiBold', fontSize: 22, lineHeight: 28, fontVariant: DIGITS() },
  h3: { fontFamily: 'Figtree_600SemiBold', fontSize: 18, lineHeight: 23, fontVariant: DIGITS() },
  body: { fontFamily: 'Figtree_400Regular', fontSize: 16, lineHeight: 24, fontVariant: DIGITS() },
  bodyMedium: {
    fontFamily: 'Figtree_500Medium', fontSize: 16, lineHeight: 24, fontVariant: DIGITS(),
  },
  secondary: {
    fontFamily: 'Figtree_400Regular', fontSize: 14, lineHeight: 20, fontVariant: DIGITS(),
  },
  label: {
    fontFamily: 'Figtree_500Medium', fontSize: 12, letterSpacing: 0.24, fontVariant: DIGITS(),
  },
  tab: { fontFamily: 'Figtree_500Medium', fontSize: 11, fontVariant: DIGITS() },
} as const;

// Three shadow levels (DESIGN-LANGUAGE v2 §3), iOS shadow* + Android elevation.
export const shadow = {
  s1: { shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2 },
  s2: { shadowColor: '#000000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 },
  s3: { shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 28, elevation: 12 },
} as const;

// Motion tokens (DESIGN-LANGUAGE v2 §5).
export const motion = {
  duration: { fast: 150, base: 250, gentle: 400, feature: 800 },
  easeSmooth: [0.22, 1, 0.36, 1] as [number, number, number, number],
  spring: { damping: 18, stiffness: 180, mass: 1 },
} as const;
