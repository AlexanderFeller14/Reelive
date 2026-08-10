import type { FontVariant } from 'react-native';

// Design Language v2, Werte siehe DESIGN-LANGUAGE.md §1–§5.
// Licht-Palette für alle Alltags-Screens (light-only).
export const palette = {
  'bg-0': '#FFFFFF', 'bg-1': '#F7F7F7',
  line: '#EBEBEB', 'line-strong': '#B0B0B0',
  'text-1': '#222222', 'text-2': '#6A6A6A', 'text-3': '#B0B0B0',
  accent: '#FF385C', 'accent-pressed': '#E31C5F', 'accent-text': '#C4103C',
  seal: '#B8752F', danger: '#C13515', 'on-accent': '#FFFFFF',
} as const;

// Kino-Palette: NUR Medien-Screens (Kamera, Preview, Versiegeln, Recap-Player).
// Fix, kein Theme, wird direkt importiert, nicht über useTheme().
export const cinema = {
  'bg-0': '#131110', 'bg-1': '#1C1917',
  'text-1': '#F2EEE8', 'text-2': '#A79F96',
  'seal-glow': '#E8A13C', 'overlay-pill': 'rgba(19,17,16,0.55)',
} as const;

export type ColorTokens = typeof palette;

// Modal-Backdrop hinter einem Sheet (Phase-5-Final-Review, Punkt 6): weder
// ein Foto-Scrim (§1, an Fotoinhalt gebunden) noch die Pillen-Farbe
// `overlay-pill` (an Text/Icons auf Fotos gebunden), ein reiner Abdunkler
// hinter einem von unten kommenden Panel. Gilt UNVERÄNDERT für den hellen
// UND den Kino-Sheet (Sheet.tsx setzt ihn unabhängig von `kino`), darum kein
// Teil von `palette`/`cinema`. Wert deckt sich mit
// docs/superpowers/specs/2026-08-06-design-language-v2-airbnb-design.md
// (Abschnitt Sheet: „Scrim rgba(0,0,0,0.4) faded 250 ms").
export const backdrop = 'rgba(0,0,0,0.4)' as const;

export const radius = { control: 12, card: 24, pill: 999 } as const;

// `screen` (Screen-Rand) und `l` (Layout-Abstand) sind semantisch getrennte
// Keys, deren Werte in v2 zufällig beide 24 sind, nicht deduplizieren.
export const spacing = { xs: 4, s: 8, m: 12, base: 16, screen: 24, l: 24, xl: 32, xxl: 48 } as const;

// DESIGN-LANGUAGE §2, unter der Typo-Tabelle: «Zahlen immer `tabular-nums`».
// Nicht nur im Zähler-Display, wo die Tabelle es eigens erwähnt, die Regel
// steht bei den allgemeinen Regeln und gilt für jeden Text.
//
// Sie stand bis hierher nur an `display`. Zahlen laufen aber überall: der
// Tagesfilter der Karte («Tag 3»), die Zähler-Pille an einer Nadel, die
// Uhrzeit unter jedem Moment, «2 von 15 gesichert». Ohne tabular-nums sind
// Ziffern unterschiedlich breit, und ein Text, in dem sich nur die Zahl
// ändert, wackelt bei jedem Schritt seitlich, weil eine «1» schmaler ist als
// eine «4». Genau das soll die Regel verhindern.
//
// `fontVariant` explizit als FontVariant[] typisiert: die äussere `as const`
// würde das Array sonst zu einem readonly-Tupel machen, das RNs TextStyle
// (erwartet ein mutable FontVariant[]) ablehnt (TS2769). Und je ein eigenes
// Array pro Stil, kein gemeinsames: React Native darf Style-Objekte einfrieren,
// und ein geteiltes Array wäre eine Verbindung zwischen Stilen, die nichts
// miteinander zu tun haben.
const ZIFFERN = (): FontVariant[] => ['tabular-nums'];

export const type = {
  display: {
    fontFamily: 'Figtree_300Light', fontSize: 84, letterSpacing: -1.7,
    fontVariant: ZIFFERN(),
  },
  h1: { fontFamily: 'Figtree_700Bold', fontSize: 30, lineHeight: 36, fontVariant: ZIFFERN() },
  h2: { fontFamily: 'Figtree_600SemiBold', fontSize: 22, lineHeight: 28, fontVariant: ZIFFERN() },
  h3: { fontFamily: 'Figtree_600SemiBold', fontSize: 18, lineHeight: 23, fontVariant: ZIFFERN() },
  body: { fontFamily: 'Figtree_400Regular', fontSize: 16, lineHeight: 24, fontVariant: ZIFFERN() },
  bodyMedium: {
    fontFamily: 'Figtree_500Medium', fontSize: 16, lineHeight: 24, fontVariant: ZIFFERN(),
  },
  secondary: {
    fontFamily: 'Figtree_400Regular', fontSize: 14, lineHeight: 20, fontVariant: ZIFFERN(),
  },
  label: {
    fontFamily: 'Figtree_500Medium', fontSize: 12, letterSpacing: 0.24, fontVariant: ZIFFERN(),
  },
  tab: { fontFamily: 'Figtree_500Medium', fontSize: 11, fontVariant: ZIFFERN() },
} as const;

// Drei Schatten-Stufen (DESIGN-LANGUAGE v2 §3), iOS shadow* + Android elevation.
export const shadow = {
  s1: { shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2 },
  s2: { shadowColor: '#000000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 },
  s3: { shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 28, elevation: 12 },
} as const;

// Motion-Tokens (DESIGN-LANGUAGE v2 §5).
export const motion = {
  duration: { fast: 150, base: 250, gentle: 400, feature: 800 },
  easeSmooth: [0.22, 1, 0.36, 1] as [number, number, number, number],
  spring: { damping: 18, stiffness: 180, mass: 1 },
} as const;
