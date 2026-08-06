# Design Language v2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die bestehende Reelive-App (Auth-Flow + Tab-Gerüst) vollständig auf Design Language v2 migrieren: heller Airbnb-Look, Figtree, Rausch-Akzent, Motion-Foundation.

**Architecture:** Token-first — zuerst werden `tokens.ts` und `ThemeProvider` auf v2 umgestellt (Licht-Palette, Kino-Konstanten, Motion-/Schatten-Tokens), alle Verbraucher mechanisch nachgezogen. Danach werden die drei Basis-Komponenten (Button, Input, Card) und die Tab-Bar auf v2-Optik gebracht, zuletzt die Screens. Die `useTheme()`-API bleibt stabil.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript strict, expo-router, `@expo-google-fonts/figtree`, RN `Animated` (Spring/Timing, UI-Thread via `useNativeDriver` wo möglich), jest-expo + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-08-06-design-language-v2-airbnb-design.md` · Kurzreferenz: `DESIGN-LANGUAGE.md`

## Global Constraints

- Arbeitsverzeichnis für alle npm/jest/tsc-Befehle: `mobile/`
- Expo SDK 57: bei API-Unsicherheit ZUERST https://docs.expo.dev/versions/v57.0.0/ lesen (Vorgabe aus `mobile/AGENTS.md`)
- Keine festen Hex-Werte in Komponenten/Screens — ausschliesslich Tokens aus `@/theme/tokens`
- Radius nur `radius.control` (12) / `radius.card` (24) / `radius.pill` (999)
- Copy: Deutsch, Du-Form, sentence case, Vokabular gemäss `DESIGN-LANGUAGE.md` §6
- Press-Feedback: Scale per Spring (`motion.spring`), NIE Opacity-Dimmen
- Jeder Commit endet mit `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Nach jedem Task: `npx tsc --noEmit` und `npm test` müssen grün sein

**Nicht-Ziele dieses Plans:** Digit-Roll, Stagger-Entrance, Kinosaal-Fade, Shared-Element und die zwei Inszenierungen betreffen Screens, die erst in Phase 3–5 entstehen (Home-Karten, Kamera, Recap). Dieser Plan legt nur die Motion-Tokens dafür an. Ebenfalls nicht enthalten: neue Brand-Assets (Wortzug-SVG, Icons, Splash-Bild).

---

### Task 1: Token-Foundation v2 (tokens, ThemeProvider, Figtree, Verbraucher-Remap)

**Files:**
- Modify: `mobile/src/theme/tokens.ts`
- Modify: `mobile/src/theme/__tests__/tokens.test.ts`
- Modify: `mobile/src/theme/ThemeProvider.tsx`
- Create: `mobile/src/theme/__tests__/ThemeProvider.test.tsx`
- Modify: `mobile/src/app/_layout.tsx` (Font-Imports)
- Modify: `mobile/src/components/Button.tsx:17` (nur Key-Remap `bg-2`→`bg-1`)
- Modify: `mobile/src/components/Input.tsx:18` (nur Key-Remap `bg-2`→`bg-1`)
- Modify: `mobile/package.json` (Figtree rein, Manrope raus)

**Interfaces:**
- Consumes: —
- Produces (spätere Tasks verlassen sich exakt hierauf):
  - `palette` (flaches Objekt, Keys: `'bg-0' | 'bg-1' | 'line' | 'line-strong' | 'text-1' | 'text-2' | 'text-3' | 'accent' | 'accent-pressed' | 'accent-text' | 'seal' | 'danger' | 'on-accent'`)
  - `cinema` (Keys: `'bg-0' | 'bg-1' | 'text-1' | 'text-2' | 'seal-glow' | 'overlay-pill'`)
  - `type` mit Rollen `display | h1 | h2 | h3 | body | bodyMedium | secondary | label | tab`
  - `shadow.s1 | shadow.s2 | shadow.s3` (RN-ViewStyle-Objekte)
  - `motion.duration.{fast|base|gentle|feature}`, `motion.easeSmooth` (Bezier-Tupel), `motion.spring` (`{ damping: 18, stiffness: 180, mass: 1 }`)
  - `useTheme(): { colors: ColorTokens; scheme: 'light' }` — `colors` ist immer `palette`
  - `radius`/`spacing` behalten ihre Keys; `spacing.screen` ist neu `24`

- [ ] **Step 1: Figtree installieren, Manrope entfernen**

```bash
cd mobile
npm uninstall @expo-google-fonts/manrope
npm install @expo-google-fonts/figtree
```

Verify: `ls node_modules/@expo-google-fonts/figtree | head` zeigt u.a. `Figtree_300Light.ttf`, `Figtree_700Bold.ttf`. Falls die Export-Namen abweichen: `grep "export" node_modules/@expo-google-fonts/figtree/index.js | head -20` und die tatsächlichen Namen in allen folgenden Schritten verwenden.

- [ ] **Step 2: Token-Test auf v2 umschreiben (failing)**

`mobile/src/theme/__tests__/tokens.test.ts` komplett ersetzen:

```ts
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
```

- [ ] **Step 3: Test laufen lassen — er muss fehlschlagen**

Run: `cd mobile && npm test -- tokens`
Expected: FAIL — `palette`, `cinema`, `shadow`, `motion` existieren noch nicht.

- [ ] **Step 4: tokens.ts auf v2 umschreiben**

`mobile/src/theme/tokens.ts` komplett ersetzen:

```ts
// Design Language v2 — Werte siehe DESIGN-LANGUAGE.md §1–§5.
// Licht-Palette für alle Alltags-Screens (light-only).
export const palette = {
  'bg-0': '#FFFFFF', 'bg-1': '#F7F7F7',
  line: '#EBEBEB', 'line-strong': '#B0B0B0',
  'text-1': '#222222', 'text-2': '#6A6A6A', 'text-3': '#B0B0B0',
  accent: '#FF385C', 'accent-pressed': '#E31C5F', 'accent-text': '#C4103C',
  seal: '#B8752F', danger: '#C13515', 'on-accent': '#FFFFFF',
} as const;

// Kino-Palette: NUR Medien-Screens (Kamera, Preview, Versiegeln, Recap-Player).
// Fix, kein Theme — wird direkt importiert, nicht über useTheme().
export const cinema = {
  'bg-0': '#131110', 'bg-1': '#1C1917',
  'text-1': '#F2EEE8', 'text-2': '#A79F96',
  'seal-glow': '#E8A13C', 'overlay-pill': 'rgba(19,17,16,0.55)',
} as const;

export type ColorTokens = typeof palette;

export const radius = { control: 12, card: 24, pill: 999 } as const;

export const spacing = { xs: 4, s: 8, m: 12, base: 16, screen: 24, l: 24, xl: 32, xxl: 48 } as const;

export const type = {
  display: { fontFamily: 'Figtree_300Light', fontSize: 84, letterSpacing: -1.7, fontVariant: ['tabular-nums'] },
  h1: { fontFamily: 'Figtree_700Bold', fontSize: 30, lineHeight: 36 },
  h2: { fontFamily: 'Figtree_600SemiBold', fontSize: 22, lineHeight: 28 },
  h3: { fontFamily: 'Figtree_600SemiBold', fontSize: 18, lineHeight: 23 },
  body: { fontFamily: 'Figtree_400Regular', fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: 'Figtree_500Medium', fontSize: 16, lineHeight: 24 },
  secondary: { fontFamily: 'Figtree_400Regular', fontSize: 14, lineHeight: 20 },
  label: { fontFamily: 'Figtree_500Medium', fontSize: 12, letterSpacing: 0.24 },
  tab: { fontFamily: 'Figtree_500Medium', fontSize: 11 },
} as const;

// Drei Schatten-Stufen (DESIGN-LANGUAGE v2 §3) — iOS shadow* + Android elevation.
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
```

- [ ] **Step 5: Token-Test laufen lassen**

Run: `cd mobile && npm test -- tokens`
Expected: PASS (7 Tests).

- [ ] **Step 6: ThemeProvider-Test schreiben (failing)**

Create `mobile/src/theme/__tests__/ThemeProvider.test.tsx`:

```tsx
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../ThemeProvider';

function Probe() {
  const { colors, scheme } = useTheme();
  return <Text>{`${scheme}:${colors['bg-0']}`}</Text>;
}

test('ThemeProvider ist light-only und liefert die v2-Palette', async () => {
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
  expect(screen.getByText('light:#FFFFFF')).toBeTruthy();
});
```

- [ ] **Step 7: Test laufen lassen — er muss fehlschlagen**

Run: `cd mobile && npm test -- ThemeProvider`
Expected: FAIL — der alte Provider importiert `colors` (existiert nicht mehr), TypeScript-/Import-Fehler.

- [ ] **Step 8: ThemeProvider auf light-only umschreiben**

`mobile/src/theme/ThemeProvider.tsx` komplett ersetzen:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { palette, type ColorTokens } from './tokens';

// Light-only (DESIGN-LANGUAGE v2 §1). `scheme` bleibt in der API, damit
// Verbraucher stabil bleiben — es ist immer 'light'. Medien-Screens
// importieren `cinema` direkt aus den Tokens.
type Theme = { colors: ColorTokens; scheme: 'light' };
const theme: Theme = { colors: palette, scheme: 'light' };
const ThemeContext = createContext<Theme>(theme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
```

- [ ] **Step 9: Verbraucher-Remaps (nur Kompilierbarkeit, noch keine Optik)**

In `mobile/src/components/Button.tsx` Zeile 17: `colors['bg-2']` → `colors['bg-1']`.
In `mobile/src/components/Input.tsx` Zeile 18: `backgroundColor: colors['bg-2']` → `backgroundColor: colors['bg-1']`.

In `mobile/src/app/_layout.tsx` den Manrope-Import und `useFonts`-Aufruf ersetzen:

```tsx
import {
  useFonts,
  Figtree_300Light,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
```

und im `RootLayout`:

```tsx
  const [fontsLoaded] = useFonts({
    Figtree_300Light,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
```

Zusätzlich in `mobile/src/app/(auth)/welcome.tsx:16-17` den Platzhalter-Kommentar anpassen: «Bis es existiert: schlichter Manrope-Schriftzug.» → «Bis es existiert: schlichter Figtree-Schriftzug.»

Danach prüfen, dass nirgends Reste hängen:

Run: `grep -rn "Manrope\|bg-2\|colors\.dark\|colors\.light\|glow" mobile/src --include="*.ts" --include="*.tsx"`
Expected: keine Treffer.

- [ ] **Step 10: Typecheck + kompletter Testlauf**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: tsc ohne Fehler; alle Suiten PASS.

- [ ] **Step 11: Commit**

```bash
git add mobile/src/theme mobile/src/app/_layout.tsx mobile/src/components/Button.tsx mobile/src/components/Input.tsx "mobile/src/app/(auth)/welcome.tsx" mobile/package.json mobile/package-lock.json
git commit -m "feat(design): Token-Foundation v2 — Licht-Palette, Kino-Konstanten, Figtree, Motion-Tokens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PressScale-Wrapper + Button v2

**Files:**
- Create: `mobile/src/components/PressScale.tsx`
- Modify: `mobile/src/components/Button.tsx`
- Test: `mobile/src/components/__tests__/Button.test.tsx`

**Interfaces:**
- Consumes: `motion.spring`, `palette`-Keys (`accent`, `accent-pressed`, `on-accent`, `bg-0`, `bg-1`, `text-1`, `text-3`), `type.bodyMedium`, `radius.control` aus Task 1
- Produces: `PressScale`-Komponente: `(props: PressableProps & { scaleTo?: number }) => JSX` — Pressable, dessen Kinder in einer per Spring skalierten `Animated.View` liegen; Kinder dürfen eine Funktion `({ pressed }) => ReactNode` sein. `Button`-API bleibt unverändert: `{ variant: 'primary' | 'secondary' | 'text'; label: string; onPress: () => void; disabled?: boolean; loading?: boolean }`.

- [ ] **Step 1: Button-Test um v2-Verhalten erweitern (failing)**

In `mobile/src/components/__tests__/Button.test.tsx` ergänzen (bestehende Tests unverändert lassen):

```tsx
test('text-Variante rendert Label unterstrichen und feuert', async () => {
  const onPress = jest.fn();
  await wrap(<Button variant="text" label="Code erneut senden" onPress={onPress} />);
  const label = screen.getByText('Code erneut senden');
  expect(label.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ textDecorationLine: 'underline' })])
  );
  fireEvent.press(label);
  expect(onPress).toHaveBeenCalledTimes(1);
});
```

Hinweis: `label.props.style` ist beim v2-Button ein Array `[type.bodyMedium, { color }, styles.underline]` — das `arrayContaining` matcht das flache Array. Falls RNTL Styles flacht: stattdessen `expect(StyleSheet.flatten(label.props.style)).toMatchObject({ textDecorationLine: 'underline' })` mit `import { StyleSheet } from 'react-native'`.

- [ ] **Step 2: Test laufen lassen — er muss fehlschlagen**

Run: `cd mobile && npm test -- Button`
Expected: FAIL — der v1-Button hat keine Unterstreichung.

- [ ] **Step 3: PressScale implementieren**

Create `mobile/src/components/PressScale.tsx`:

```tsx
import { useRef } from 'react';
import { Animated, Pressable, type PressableProps } from 'react-native';
import { motion } from '@/theme/tokens';

type Props = PressableProps & { scaleTo?: number };

// Press-Feedback gemäss DESIGN-LANGUAGE v2 §5: Scale per Spring (spring-ui),
// nie Opacity-Dimmen. Buttons/Tabs 0.97, randlose Karten 0.98, FAB 0.94.
export function PressScale({ scaleTo = 0.97, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const springTo = (toValue: number) =>
    Animated.spring(scale, { toValue, useNativeDriver: true, ...motion.spring }).start();

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        springTo(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        springTo(1);
        onPressOut?.(e);
      }}
    >
      {(state) => (
        <Animated.View style={{ transform: [{ scale }] }}>
          {typeof children === 'function' ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}
```

- [ ] **Step 4: Button auf v2 umschreiben**

`mobile/src/components/Button.tsx` komplett ersetzen:

```tsx
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

type Props = {
  variant: 'primary' | 'secondary' | 'text';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

// DESIGN-LANGUAGE v2 §4: primär = accent-Fläche, sekundär = Outline auf Weiss,
// text = unterstrichener Link in text-1. Genau ein Primär-Button pro Screen.
export function Button({ variant, label, onPress, disabled, loading }: Props) {
  const { colors } = useTheme();
  const blocked = disabled || loading;

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!blocked }}
      onPress={() => {
        if (!blocked) onPress();
      }}
    >
      {({ pressed }) => {
        const bg =
          variant === 'primary'
            ? blocked
              ? colors['bg-1']
              : pressed
                ? colors['accent-pressed']
                : colors.accent
            : variant === 'secondary'
              ? pressed
                ? colors['bg-1']
                : colors['bg-0']
              : 'transparent';
        const fg =
          variant === 'primary'
            ? blocked
              ? colors['text-3']
              : colors['on-accent']
            : blocked
              ? colors['text-3']
              : colors['text-1'];
        return (
          <View
            style={[
              styles.base,
              variant !== 'text' && { backgroundColor: bg, height: 52 },
              variant === 'secondary' && { borderWidth: 1, borderColor: fg },
            ]}
          >
            {loading ? (
              <ActivityIndicator testID="button-loading" color={fg} />
            ) : (
              <Text style={[type.bodyMedium, { color: fg }, variant === 'text' && styles.underline]}>
                {label}
              </Text>
            )}
          </View>
        );
      }}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
  underline: { textDecorationLine: 'underline' },
});
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npm test -- Button`
Expected: PASS (4 Tests: onPress, disabled, loading, text-Variante). Falls ein act()-Warning wegen `Animated.spring` auftaucht, ist das ein Warning, kein Fehler — nur bei echtem FAIL: `jest.useFakeTimers()` am Testdatei-Anfang und `jest.runAllTimers()` nach `fireEvent.press` ergänzen.

- [ ] **Step 6: Kompletter Testlauf + Typecheck, dann Commit**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: alles PASS (auch screens.test.tsx — die Screens nutzen den Button nur über Label-Texte).

```bash
git add mobile/src/components/PressScale.tsx mobile/src/components/Button.tsx mobile/src/components/__tests__/Button.test.tsx
git commit -m "feat(design): Button v2 mit Outline-Sekundär, Link-Unterstreichung und Press-Spring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Input v2 mit Floating Label

**Files:**
- Modify: `mobile/src/components/Input.tsx`
- Test: `mobile/src/components/__tests__/Input.test.tsx`

**Interfaces:**
- Consumes: `motion.duration.fast`, `motion.easeSmooth`, `palette`-Keys (`bg-0`, `line-strong`, `text-1`, `text-2`, `text-3`, `danger`), `radius.control` aus Task 1
- Produces: `Input`-API unverändert: `TextInputProps & { label: string; error?: string }`. Neu: `placeholder` wird erst bei Fokus/Inhalt gerendert (Label liegt sonst an dessen Stelle). `accessibilityLabel={label}` bleibt — die Screen-Tests hängen daran.

- [ ] **Step 1: Test für Floating-Label-Verhalten ergänzen (failing)**

In `mobile/src/components/__tests__/Input.test.tsx` ergänzen:

```tsx
test('placeholder erscheint erst mit Fokus (Floating Label)', async () => {
  await wrap(
    <Input label="Handynummer" value="" onChangeText={() => {}} placeholder="+41 79 123 45 67" />
  );
  expect(screen.queryByPlaceholderText('+41 79 123 45 67')).toBeNull();
  fireEvent(screen.getByLabelText('Handynummer'), 'focus');
  expect(screen.getByPlaceholderText('+41 79 123 45 67')).toBeTruthy();
});
```

- [ ] **Step 2: Test laufen lassen — er muss fehlschlagen**

Run: `cd mobile && npm test -- Input`
Expected: FAIL — der v1-Input rendert den Placeholder immer.

- [ ] **Step 3: Input auf v2 umschreiben**

`mobile/src/components/Input.tsx` komplett ersetzen:

```tsx
import { useRef, useState } from 'react';
import { Animated, Easing, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';

type Props = TextInputProps & { label: string; error?: string };

// Floating-Label-Input (DESIGN-LANGUAGE v2 §4): Label liegt mittig und
// schrumpft bei Fokus/Inhalt nach oben (150 ms ease-smooth). Fokus-Rand
// 2 px text-1 (bewusst nicht accent), Fehler in danger.
// Abweichung zur Spec: das Label bleibt konstant in Figtree_400Regular,
// weil fontFamily nicht animierbar ist.
export function Input({ label, error, value, placeholder, style, onFocus, onBlur, ...rest }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const lifted = focused || !!value;
  const anim = useRef(new Animated.Value(lifted ? 1 : 0)).current;

  const animate = (to: number) =>
    Animated.timing(anim, {
      toValue: to,
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: false, // top/fontSize sind keine Transform-Properties
    }).start();

  const borderColor = error ? colors.danger : focused ? colors['text-1'] : colors['line-strong'];
  // Fokus-Rand wird 2 px — Padding kompensiert, damit nichts springt.
  const pad = focused ? spacing.base - 1 : spacing.base;

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{
          height: 56,
          borderWidth: focused ? 2 : 1,
          borderColor,
          borderRadius: radius.control,
          backgroundColor: colors['bg-0'],
          justifyContent: 'flex-end',
          paddingHorizontal: pad,
        }}
      >
        <Animated.Text
          style={{
            position: 'absolute',
            left: pad,
            top: anim.interpolate({ inputRange: [0, 1], outputRange: [17, 8] }),
            fontSize: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 12] }),
            fontFamily: 'Figtree_400Regular',
            color: focused ? colors['text-2'] : colors['text-3'],
          }}
        >
          {label}
        </Animated.Text>
        <TextInput
          accessibilityLabel={label}
          value={value}
          placeholder={lifted ? placeholder : undefined}
          placeholderTextColor={colors['text-3']}
          onFocus={(e) => {
            setFocused(true);
            animate(1);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            if (!value) animate(0);
            onBlur?.(e);
          }}
          style={[
            type.body,
            { color: colors['text-1'], paddingTop: 0, paddingBottom: 8, paddingHorizontal: 0 },
            style,
          ]}
          {...rest}
        />
      </View>
      {error ? <Text style={[type.secondary, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npm test -- Input`
Expected: PASS (2 Tests). Danach `npm test -- screens` — die Auth-Screen-Tests müssen weiterhin grün sein (sie nutzen `getByLabelText`).

- [ ] **Step 5: Typecheck + Commit**

Run: `cd mobile && npx tsc --noEmit && npm test`

```bash
git add mobile/src/components/Input.tsx mobile/src/components/__tests__/Input.test.tsx
git commit -m "feat(design): Input v2 mit Floating Label, Fokus-Rand und danger-Zustand

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Card v2 (weisse Karte mit shadow-1)

**Files:**
- Modify: `mobile/src/components/Card.tsx`

**Interfaces:**
- Consumes: `shadow.s1`, `palette['bg-0']`, `radius.card`, `spacing.base` aus Task 1
- Produces: `Card`-API unverändert (`ViewProps`). Optik neu: `bg-0` + `shadow.s1`, kein Rand mehr, kein `scheme`-Check.

- [ ] **Step 1: Card umschreiben**

`mobile/src/components/Card.tsx` komplett ersetzen:

```tsx
import { View, StyleSheet, type ViewProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, spacing } from '@/theme/tokens';

// Karte mit Chrome (DESIGN-LANGUAGE v2 §3): weisse Fläche mit shadow-1.
// Randlose Reise-Karten (Phase 3) sind KEINE Card — sie bestehen aus Bild + Text.
export function Card({ style, children, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View {...rest} style={[styles.base, { backgroundColor: colors['bg-0'] }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.card, padding: spacing.base, ...shadow.s1 },
});
```

- [ ] **Step 2: Typecheck + Tests + Commit**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS — `profilTab.test.tsx` rendert die Card und prüft nur Inhalte.

```bash
git add mobile/src/components/Card.tsx
git commit -m "feat(design): Card v2 — weisse Fläche mit shadow-1 statt bg-1 und Rand

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Tab-Bar v2 (volle Breite, Hairline oben)

**Files:**
- Modify: `mobile/src/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `palette`-Keys (`bg-0`, `line`, `accent`, `text-2`), `type.tab` aus Task 1
- Produces: Tab-Namen und Icons unverändert (`aufnehmen | reise | recap | profil`)

- [ ] **Step 1: Tabs-Layout umschreiben**

`mobile/src/app/(tabs)/_layout.tsx` komplett ersetzen:

```tsx
import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Camera, Map, Play, User } from 'lucide-react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §4: Tab-Bar volle Breite, bg-0, 1 px Hairline oben,
// keine Rundung (die schwebende v1-Pille entfällt). Aktiv accent, inaktiv text-2.
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors['bg-0'] },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors['text-2'],
        tabBarLabelStyle: type.tab,
        tabBarStyle: {
          backgroundColor: colors['bg-0'],
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.line,
        },
      }}
    >
      <Tabs.Screen name="aufnehmen" options={{ title: 'Aufnehmen', tabBarIcon: ({ color }) => <Camera color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="reise" options={{ title: 'Reise', tabBarIcon: ({ color }) => <Map color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="recap" options={{ title: 'Recap', tabBarIcon: ({ color }) => <Play color={color} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil', tabBarIcon: ({ color }) => <User color={color} strokeWidth={1.75} /> }} />
    </Tabs>
  );
}
```

- [ ] **Step 2: Typecheck + Tests + Commit**

Run: `cd mobile && npx tsc --noEmit && npm test`

```bash
git add "mobile/src/app/(tabs)/_layout.tsx"
git commit -m "feat(design): Tab-Bar v2 — volle Breite mit Hairline statt schwebender Pille

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: App-Chrome — app.json light-only, StatusBar, Splash

**Files:**
- Modify: `mobile/app.json`
- Modify: `mobile/src/app/_layout.tsx`

**Interfaces:**
- Consumes: `useTheme()` aus Task 1
- Produces: App erzwingt Light-Erscheinung systemweit; Statusbar-Text dunkel auf hellen Screens

- [ ] **Step 1: app.json anpassen**

In `mobile/app.json`:
- `"userInterfaceStyle": "automatic"` → `"userInterfaceStyle": "light"`
- Im `expo-splash-screen`-Plugin-Block: `"backgroundColor": "#131110"` → `"backgroundColor": "#FFFFFF"`
- `android.adaptiveIcon.backgroundColor` bleibt `#131110` (Brand-Asset, nicht Teil dieses Plans)

- [ ] **Step 2: StatusBar in den Root-Layout einbauen**

In `mobile/src/app/_layout.tsx`: `import { StatusBar } from 'expo-status-bar';` ergänzen und in `Guarded` das `Stack`-Element in ein Fragment packen:

```tsx
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
    </>
  );
```

Hinweis: Medien-Screens (Phase 4/5) stellen die StatusBar lokal auf `light` um — hier nur der App-Default.

- [ ] **Step 3: Typecheck + Tests + Commit**

Run: `cd mobile && npx tsc --noEmit && npm test`

```bash
git add mobile/app.json mobile/src/app/_layout.tsx
git commit -m "feat(design): App-Chrome light-only — userInterfaceStyle, Splash weiss, StatusBar dunkel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Auth-Screens v2 (Welcome, Phone, OTP, Profil-Setup)

**Files:**
- Modify: `mobile/src/app/(auth)/welcome.tsx`
- Modify: `mobile/src/app/(auth)/phone.tsx`
- Modify: `mobile/src/app/(auth)/otp.tsx`
- Modify: `mobile/src/app/(auth)/profile-setup.tsx`
- Test (bestehend, muss grün bleiben): `mobile/src/features/auth/__tests__/screens.test.tsx`

**Interfaces:**
- Consumes: `Button`/`Input` v2 (Tasks 2–3), `type`-Rollen inkl. `h3`/`label` (Task 1)
- Produces: Copy-Anker der Tests bleiben exakt erhalten: `Handynummer` (Label), `Code senden`, `Code` (Label), `Bestätigen`, `Code erneut senden`, `keine gültige Handynummer` (Fehlertext), `Username`, `Anzeigename`, `Los geht's`

- [ ] **Step 1: welcome.tsx umschreiben**

Komplett ersetzen:

```tsx
import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { signInWith } from '@/features/auth/authApi';

const APPLE_ENABLED = process.env.EXPO_PUBLIC_AUTH_APPLE === 'true';
const GOOGLE_ENABLED = process.env.EXPO_PUBLIC_AUTH_GOOGLE === 'true';

export default function WelcomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      {/* Platzhalter: Der Reelive-Wortzug wird ein SVG-Asset (DESIGN-LANGUAGE §2).
          Bis es existiert: schlichter Figtree-Schriftzug. */}
      <Text style={[type.h3, { color: colors['text-1'] }]}>Reelive</Text>
      <Text style={[type.h1, { color: colors['text-1'] }]}>
        Eure Reise. Alle Perspektiven. Ein Recap.
      </Text>
      <View style={{ gap: spacing.m, marginTop: spacing.xl }}>
        {APPLE_ENABLED && (
          <Button variant="secondary" label="Mit Apple fortfahren" onPress={() => void signInWith('apple')} />
        )}
        {GOOGLE_ENABLED && (
          <Button variant="secondary" label="Mit Google fortfahren" onPress={() => void signInWith('google')} />
        )}
        <Button variant="primary" label="Mit Handynummer fortfahren" onPress={() => router.push('/phone')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end', padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.s },
});
```

- [ ] **Step 2: phone.tsx umschreiben (Airbnb-Form: oben ausgerichtet, H1, Schritt-Anzeige)**

Den JSX-Teil und die Styles ersetzen (Logik `submit`/State unverändert lassen):

```tsx
  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.label, { color: colors['text-2'] }]}>Schritt 1 von 2</Text>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Deine Handynummer</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        Wir schicken dir einen Code per SMS.
      </Text>
      <View style={{ gap: spacing.l, marginTop: spacing.base }}>
        <Input
          label="Handynummer"
          value={input}
          onChangeText={setInput}
          error={error}
          keyboardType="phone-pad"
          autoFocus
          placeholder="+41 79 123 45 67"
        />
        <Button variant="primary" label="Code senden" onPress={submit} loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.s },
});
```

Zusätzlich die Imports erweitern: `import { View, StyleSheet } from 'react-native';` → `import { Text, View, StyleSheet } from 'react-native';` und `import { spacing } from '@/theme/tokens';` → `import { spacing, type } from '@/theme/tokens';`.

- [ ] **Step 3: otp.tsx umschreiben**

Analog (Logik unverändert):

```tsx
  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.label, { color: colors['text-2'] }]}>Schritt 2 von 2</Text>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Dein Code</Text>
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        {`Wir haben dir einen Code an ${phone} geschickt.`}
      </Text>
      <View style={{ gap: spacing.l, marginTop: spacing.base }}>
        <Input
          label="Code"
          value={code}
          onChangeText={setCode}
          error={error}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          placeholder="123456"
        />
        <Button variant="primary" label="Bestätigen" onPress={submit} loading={loading} disabled={code.length !== 6} />
        <Button variant="text" label="Code erneut senden" onPress={() => void requestOtp(phone)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.s },
});
```

Imports ergänzen: `Text` aus react-native, `type` aus `@/theme/tokens`.

- [ ] **Step 4: profile-setup.tsx oben ausrichten**

Nur Styles und Kopfbereich anpassen (Logik unverändert): über dem H1 «Fast geschafft» ergänzen:

```tsx
      <Text style={[type.secondary, { color: colors['text-2'] }]}>
        So sehen dich deine Freunde im Recap.
      </Text>
```

direkt NACH dem H1 einfügen, und die Styles ersetzen:

```tsx
const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
});
```

- [ ] **Step 5: Screen-Tests + alles laufen lassen**

Run: `cd mobile && npm test -- screens && npx tsc --noEmit && npm test`
Expected: alle PASS — die Test-Anker (Labels/Button-Texte) sind unverändert.

- [ ] **Step 6: Commit**

```bash
git add "mobile/src/app/(auth)"
git commit -m "feat(design): Auth-Screens v2 — H1-Kopf, Schritt-Anzeige, Airbnb-Formlayout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Aufnehmen-Platzhalter als Kino-Screen

**Files:**
- Modify: `mobile/src/app/(tabs)/aufnehmen.tsx`

**Interfaces:**
- Consumes: `cinema`-Konstanten aus Task 1 (direkter Import, NICHT über `useTheme()`)
- Produces: erster Medien-Screen im Kino-Look — Muster für Phase 4/5

- [ ] **Step 1: aufnehmen.tsx umschreiben**

Komplett ersetzen:

```tsx
import { Text, View, StyleSheet } from 'react-native';
import { cinema, spacing, type } from '@/theme/tokens';

// Medien-Screen: immer Kino-Palette (DESIGN-LANGUAGE v2 §1), kein Theme.
export default function AufnehmenScreen() {
  return (
    <View style={[styles.screen, { backgroundColor: cinema['bg-0'] }]}>
      <Text style={[type.h2, { color: cinema['text-1'] }]}>Hier fängst du bald Momente ein</Text>
      <Text style={[type.body, { color: cinema['text-2'] }]}>
        Die Kamera kommt in Phase 4. Deine Filmrolle wartet auf dich.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.s },
});
```

- [ ] **Step 2: Typecheck + Tests + Commit**

Run: `cd mobile && npx tsc --noEmit && npm test`

```bash
git add "mobile/src/app/(tabs)/aufnehmen.tsx"
git commit -m "feat(design): Aufnehmen-Platzhalter nutzt die Kino-Palette

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Gesamt-Verifikation

**Files:** keine neuen Änderungen — nur Prüfung, ggf. Nachbesserung.

- [ ] **Step 1: Statische Checks**

```bash
cd mobile
npx tsc --noEmit
npm test
npx expo lint
```

Expected: alles grün / keine Fehler.

- [ ] **Step 2: Design-Language-Verbote grep-prüfen**

```bash
grep -rn "ED5B3D\|Manrope\|bg-2\|colors\.dark\|useColorScheme" mobile/src --include="*.ts" --include="*.tsx"
grep -rn "#[0-9A-Fa-f]\{6\}" mobile/src/app mobile/src/components --include="*.tsx"
```

Expected: erstes grep leer. Zweites grep: KEINE Treffer (alle Farben kommen aus Tokens; die Hex-Werte leben nur in `tokens.ts`).

- [ ] **Step 3: Manueller Smoke-Test in der App**

`cd mobile && npx expo start` — auf dem Simulator/Gerät prüfen (Review-Checkliste `DESIGN-LANGUAGE.md` §9):
1. Welcome/Phone/OTP/Profil-Setup: weisser Grund, Figtree lädt (Headline deutlich fett, 700), Rausch-Primär-Button, Outline-Sekundär, unterstrichener Text-Link
2. Input: Label schwebt beim Fokus nach oben, Fokus-Rand dunkel (nicht pink), Placeholder erst bei Fokus
3. Button/Karten: Press fühlt sich federnd an (Scale, kein Dimmen)
4. Tab-Bar: volle Breite, Hairline oben, aktiver Tab pink
5. Aufnehmen-Tab: dunkler Kino-Screen; alle anderen Tabs hell
6. Statusbar: dunkle Icons auf hellen Screens; Splash weiss

- [ ] **Step 4: Abschluss**

Offene Nachbesserungen aus Step 1–3 fixen und committen. Danach die Superpowers-Skills `superpowers:requesting-code-review` bzw. `superpowers:finishing-a-development-branch` verwenden.
