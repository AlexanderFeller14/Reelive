# Phase 2: App-Grundgerüst & Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expo-App (iOS + Android) mit SMS-OTP-Login gegen die lokale Supabase-Instanz, Profil-Onboarding und persistenter Session — plus Design-Token-Fundament für alle späteren Phasen.

**Architecture:** Expo-Projekt in `mobile/` (TypeScript strict, expo-router). Zwei Routen-Gruppen: `(auth)` (Welcome → Handynummer → OTP → Profil-Setup) und `(tabs)` (Aufnehmen · Reise · Recap · Profil, drei davon Platzhalter). `supabase-js` mit verschlüsseltem Session-Storage; Session-Guard im Root-Layout. Läuft in **Expo Go** (keine nativen Module aktiv).

**Tech Stack:** Expo (aktuelles SDK), expo-router, supabase-js v2, expo-secure-store + AsyncStorage + aes-js + expo-crypto (Session-Storage), @expo-google-fonts/manrope, lucide-react-native + react-native-svg, jest-expo + @testing-library/react-native.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-04-phase-2-app-auth-design.md`; Produkt-Spec `docs/superpowers/specs/2026-08-03-reelive-design.md`.
- **DESIGN-LANGUAGE.md ist verbindlich:** Farben NUR über Tokens (nie Hex im Komponenten-Code), Radius ∈ {12, 24, 999}, Abstände aus dem 4er-Raster (Screen-Rand 20), genau EIN Primär-Button pro Screen, keine Schatten/Gradients, nur Manrope, Icons Lucide Outline.
- **Copy:** Deutsch, Du-Form, sentence case. Vokabular: Moment, Reise, Filmrolle, versiegelt, Recap, einsenden (nie Post/Trip/Galerie/posten).
- **TypeScript strict**; keine `any` ohne Begründung.
- **Nur Expo-Go-kompatible Pakete** (kein react-native-vision-camera, keine nativen Auth-Module in dieser Phase).
- Apple/Google-Login existiert nur als Abstraktion hinter Flags `EXPO_PUBLIC_AUTH_APPLE` / `EXPO_PUBLIC_AUTH_GOOGLE` (default aus, Buttons unsichtbar).
- Schema-Änderungen nur über Migrationen in `supabase/migrations/` mit pgTAP-Tests in `supabase/tests/`.
- **Arbeitsverzeichnisse:** `supabase`-Befehle im Repo-Root, `npm`/`npx expo`-Befehle in `mobile/`.

**Voraussetzungen:** Docker läuft, Supabase CLI installiert, Node ≥ 20 (`node --version`), lokale Supabase-Instanz vorhanden (Phase 1).

## File Structure

```
supabase/
  migrations/20260804090000_acl_baseline.sql    # Task 1
  tests/08_acl_baseline_test.sql                # Task 1
  config.toml                                   # Task 1 (project_id), Task 6 (test_otp)
mobile/
  app/
    _layout.tsx                                 # Task 7: Fonts, Theme, AuthProvider, Guard
    (auth)/_layout.tsx                          # Task 8
    (auth)/welcome.tsx                          # Task 8
    (auth)/phone.tsx                            # Task 8
    (auth)/otp.tsx                              # Task 8
    (auth)/profile-setup.tsx                    # Task 9
    (tabs)/_layout.tsx                          # Task 10: Tab-Bar
    (tabs)/aufnehmen.tsx | reise.tsx | recap.tsx# Task 10: Platzhalter
    (tabs)/profil.tsx                           # Task 10
  src/
    theme/tokens.ts                             # Task 3
    theme/ThemeProvider.tsx                     # Task 3
    components/Button.tsx                       # Task 4
    components/Card.tsx                         # Task 4
    components/Input.tsx                        # Task 4
    lib/secureSessionStorage.ts                 # Task 5
    lib/supabase.ts                             # Task 5
    features/auth/phone.ts                      # Task 6
    features/auth/authApi.ts                    # Task 6
    features/auth/guard.ts                      # Task 7
    features/auth/AuthProvider.tsx              # Task 7
    features/auth/profileApi.ts                 # Task 9
  .env.example                                  # Task 2
```

---

### Task 1: ACL-Baseline — Aufräumen aus dem Phase-1-Final-Review

**Files:**
- Create: `supabase/migrations/20260804090000_acl_baseline.sql`
- Test: `supabase/tests/08_acl_baseline_test.sql`
- Modify: `supabase/config.toml` (nur `project_id`)

**Interfaces:**
- Consumes: Phase-1-Schema (8 Tabellen in `public`).
- Produces: saubere Grant-Baseline — künftige Tabellen erben keine Grants mehr an anon/authenticated; MAINTAIN überall entzogen. Kein App-Code hängt davon ab.

- [ ] **Step 1: `project_id` umbenennen**

```bash
supabase stop
```

Dann in `supabase/config.toml` die erste Zeile ändern:

```toml
project_id = "reelive"
```

```bash
supabase start
```

Expected: Container starten unter `supabase_*_reelive` (frisches Volume — Daten sind Dev-Wegwerfware).

- [ ] **Step 2: Failing Test schreiben** — `supabase/tests/08_acl_baseline_test.sql`:

```sql
create extension if not exists pgtap with schema extensions;
begin;
select plan(6);

-- MAINTAIN (PG17) wurde in Migration 090600 nicht miterfasst — jetzt entzogen
select is(has_table_privilege('anon', 'public.posts', 'MAINTAIN'), false,
  'anon hat kein MAINTAIN auf posts');
select is(has_table_privilege('authenticated', 'public.posts', 'MAINTAIN'), false,
  'authenticated hat kein MAINTAIN auf posts');
select is(has_table_privilege('authenticated', 'public.trips', 'MAINTAIN'), false,
  'authenticated hat kein MAINTAIN auf trips');

-- Default-ACL bereinigt: eine NEUE Tabelle erbt keinerlei Grants an Client-Rollen
create table public.acl_probe (x int);
select is(has_table_privilege('anon', 'public.acl_probe', 'TRUNCATE'), false,
  'neue Tabelle: anon erbt kein TRUNCATE');
select is(has_table_privilege('authenticated', 'public.acl_probe', 'TRIGGER'), false,
  'neue Tabelle: authenticated erbt kein TRIGGER');
select is(has_table_privilege('authenticated', 'public.acl_probe', 'MAINTAIN'), false,
  'neue Tabelle: authenticated erbt kein MAINTAIN');

select * from finish();
rollback;
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

```bash
supabase db reset && supabase test db
```

Expected: FAIL (MAINTAIN ist noch vorhanden, Default-ACL vergibt noch `Dxtm`).

- [ ] **Step 4: Migration schreiben** — `supabase/migrations/20260804090000_acl_baseline.sql`:

```sql
-- ----------------------------------------------------------------------------
-- ACL-Baseline (Nachtrag aus dem Phase-1-Final-Review):
-- 1. MAINTAIN (neu in PG17) war vom TRUNCATE/TRIGGER/REFERENCES-Entzug in
--    Migration 090600 nicht erfasst — Clients brauchen es nie (enthält u.a.
--    LOCK TABLE).
-- 2. Die Default-ACL dieses Images vergibt an anon/authenticated für JEDE neue
--    Tabelle TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Einmalig bereinigen, damit
--    spätere Phasen mit einer leeren Baseline starten und Grants immer
--    explizit in der jeweiligen Migration stehen.
-- ----------------------------------------------------------------------------
revoke maintain on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger, maintain
  on tables from anon, authenticated;
```

- [ ] **Step 5: Migration einspielen, alle Tests grün**

```bash
supabase db reset && supabase test db
```

Expected: PASS — 8 Testdateien, 92 Tests (86 + 6 neue).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260804090000_acl_baseline.sql supabase/tests/08_acl_baseline_test.sql supabase/config.toml
git commit -m "chore(db): ACL-Baseline — MAINTAIN entzogen, Default-Privileges bereinigt, project_id=reelive"
```

---

### Task 2: Expo-Projekt-Scaffold in `mobile/`

**Files:**
- Create: `mobile/` (via `create-expo-app`), `mobile/.env.example`, `mobile/src/__tests__/smoke.test.tsx`
- Modify: `mobile/tsconfig.json`, `mobile/package.json`, `README.md` (Abschnitt App-Entwicklung)

**Interfaces:**
- Produces: lauffähiges Expo-Projekt mit expo-router, TypeScript strict, Jest-Runner (`npm test`), Env-Konvention `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`. Alle folgenden Tasks arbeiten in `mobile/`.

- [ ] **Step 1: Projekt erzeugen (Repo-Root)**

```bash
npx create-expo-app@latest mobile
cd mobile && npm run reset-project
```

Beim `reset-project`-Prompt das Beispiel NICHT behalten (Antwort `n` — löscht statt nach `app-example/` zu verschieben). Falls doch entstanden: `rm -rf app-example`.

- [ ] **Step 2: TypeScript strict sicherstellen** — `mobile/tsconfig.json` muss enthalten:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Verify: `npx tsc --noEmit` läuft fehlerfrei.

- [ ] **Step 3: Jest einrichten**

```bash
npx expo install jest-expo jest @types/jest
npm install -D @testing-library/react-native
```

In `mobile/package.json` ergänzen:

```json
"scripts": { "test": "jest" },
"jest": {
  "preset": "jest-expo",
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native)"
  ]
}
```

- [ ] **Step 4: Smoke-Test schreiben** — `mobile/src/__tests__/smoke.test.tsx`:

```tsx
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

test('Jest rendert React-Native-Komponenten', () => {
  render(<Text>Reelive</Text>);
  expect(screen.getByText('Reelive')).toBeTruthy();
});
```

Run: `npm test` — Expected: PASS (1 Test).

- [ ] **Step 5: Env-Konvention anlegen** — `mobile/.env.example`:

```bash
# LAN-IP des Dev-Macs (ifconfig | grep "inet ") — funktioniert für Simulator,
# Android-Emulator UND echte Geräte im gleichen WLAN.
# Nur-Simulator-Alternative: http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.10:54321
# Aus `supabase status` kopieren (Feld ANON_KEY)
EXPO_PUBLIC_SUPABASE_ANON_KEY=ersetzen
# Login-Provider-Flags (Phase 2: aus)
EXPO_PUBLIC_AUTH_APPLE=false
EXPO_PUBLIC_AUTH_GOOGLE=false
```

`.env` in `mobile/.gitignore` eintragen (falls nicht schon durch Template abgedeckt); lokal eine echte `.env` aus dem Beispiel erstellen.

- [ ] **Step 6: README ergänzen** — im Repo-Root-`README.md` nach dem Backend-Abschnitt:

````markdown
## Entwicklung (App)

Voraussetzungen: Node ≥ 20, Expo Go auf dem Gerät (App Store / Play Store)

```bash
cd mobile
cp .env.example .env   # URL + Anon-Key eintragen (siehe supabase status)
npm install
npx expo start         # QR-Code für Expo Go; i = iOS-Simulator, a = Android-Emulator
npm test               # Jest
```
````

- [ ] **Step 7: Verifizieren & committen**

```bash
npx tsc --noEmit && npm test
cd .. && git add mobile README.md && git commit -m "feat(app): Expo-Scaffold mit expo-router, TS strict, Jest und Env-Konvention"
```

---

### Task 3: Design-Tokens & Theme-Provider

**Files:**
- Create: `mobile/src/theme/tokens.ts`, `mobile/src/theme/ThemeProvider.tsx`
- Test: `mobile/src/theme/__tests__/tokens.test.ts`

**Interfaces:**
- Produces: `tokens` (Farben je Theme, `spacing`, `radius`, `type`), `ThemeProvider`, Hook `useTheme(): { colors: ColorTokens; scheme: 'dark' | 'light' }`. Alle Komponenten/Screens stylen ausschliesslich hierüber.

- [ ] **Step 1: Failing Test schreiben** — `mobile/src/theme/__tests__/tokens.test.ts`:

```ts
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
```

Run: `npm test -- tokens` — Expected: FAIL («Cannot find module '../tokens'»).

- [ ] **Step 2: Tokens implementieren** — `mobile/src/theme/tokens.ts` (Werte 1:1 aus DESIGN-LANGUAGE.md §1–3):

```ts
export const colors = {
  dark: {
    'bg-0': '#131110', 'bg-1': '#1C1917', 'bg-2': '#26221F', line: '#2E2A26',
    'text-1': '#F2EEE8', 'text-2': '#A79F96', 'text-3': '#6E675F',
    accent: '#ED5B3D', 'accent-text': '#ED5B3D', glow: '#E0913F',
    danger: '#E5484D', 'on-accent': '#FFF6F2',
  },
  light: {
    'bg-0': '#F6F3EE', 'bg-1': '#FCFAF6', 'bg-2': '#EFEAE2', line: '#E4DED4',
    'text-1': '#26221E', 'text-2': '#6E675F', 'text-3': '#A79F96',
    accent: '#ED5B3D', 'accent-text': '#C9432A', glow: '#B8752F',
    danger: '#D93A3F', 'on-accent': '#FFF6F2',
  },
} as const;

export type ColorTokens = typeof colors.dark;

export const radius = { control: 12, card: 24, pill: 999 } as const;

export const spacing = { xs: 4, s: 8, m: 12, base: 16, screen: 20, l: 24, xl: 32, xxl: 48 } as const;

export const type = {
  display: { fontFamily: 'Manrope_200ExtraLight', fontSize: 88, fontVariant: ['tabular-nums'] },
  h1: { fontFamily: 'Manrope_600SemiBold', fontSize: 28 },
  h2: { fontFamily: 'Manrope_600SemiBold', fontSize: 22 },
  body: { fontFamily: 'Manrope_400Regular', fontSize: 16, lineHeight: 23 },
  secondary: { fontFamily: 'Manrope_400Regular', fontSize: 14 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 12, letterSpacing: 0.24 },
  tab: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
} as const;
```

- [ ] **Step 3: ThemeProvider implementieren** — `mobile/src/theme/ThemeProvider.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { colors, type ColorTokens } from './tokens';

type Theme = { colors: ColorTokens; scheme: 'dark' | 'light' };
const ThemeContext = createContext<Theme>({ colors: colors.dark, scheme: 'dark' });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  return (
    <ThemeContext.Provider value={{ colors: colors[scheme], scheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
```

- [ ] **Step 4: Manrope-Fonts installieren**

```bash
npx expo install @expo-google-fonts/manrope expo-font expo-splash-screen
```

(Das Laden passiert im Root-Layout, Task 7 — hier nur die Abhängigkeit.)

- [ ] **Step 5: Tests grün, committen**

```bash
npm test -- tokens && npx tsc --noEmit
cd .. && git add mobile && git commit -m "feat(app): Design-Tokens und ThemeProvider gemäss Design-Language"
```

---

### Task 4: Basis-Komponenten — Button, Card, Input

**Files:**
- Create: `mobile/src/components/Button.tsx`, `mobile/src/components/Card.tsx`, `mobile/src/components/Input.tsx`
- Test: `mobile/src/components/__tests__/Button.test.tsx`, `mobile/src/components/__tests__/Input.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, Tokens (Task 3).
- Produces: `<Button variant="primary" | "secondary" | "text" label onPress disabled? loading? />`, `<Card>{children}</Card>`, `<Input label value onChangeText error? …TextInputProps />`. Screens (Tasks 8–10) verwenden ausschliesslich diese.

- [ ] **Step 1: Failing Tests schreiben** — `mobile/src/components/__tests__/Button.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Button } from '../Button';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('feuert onPress', () => {
  const onPress = jest.fn();
  wrap(<Button variant="primary" label="Einsenden" onPress={onPress} />);
  fireEvent.press(screen.getByText('Einsenden'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('disabled feuert nicht', () => {
  const onPress = jest.fn();
  wrap(<Button variant="primary" label="Weiter" onPress={onPress} disabled />);
  fireEvent.press(screen.getByText('Weiter'));
  expect(onPress).not.toHaveBeenCalled();
});

test('loading zeigt Spinner statt Label-Interaktion', () => {
  const onPress = jest.fn();
  wrap(<Button variant="primary" label="Weiter" onPress={onPress} loading />);
  expect(screen.getByTestId('button-loading')).toBeTruthy();
  fireEvent.press(screen.getByTestId('button-loading'));
  expect(onPress).not.toHaveBeenCalled();
});
```

`mobile/src/components/__tests__/Input.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Input } from '../Input';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('reicht Eingaben durch und zeigt Fehler', () => {
  const onChangeText = jest.fn();
  wrap(<Input label="Username" value="" onChangeText={onChangeText} error="Dieser Username ist vergeben — probier einen anderen." />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'lea');
  expect(onChangeText).toHaveBeenCalledWith('lea');
  expect(screen.getByText(/vergeben/)).toBeTruthy();
});
```

Run: `npm test -- components` — Expected: FAIL (Module existieren nicht).

- [ ] **Step 2: Button implementieren** — `mobile/src/components/Button.tsx`:

```tsx
import { ActivityIndicator, Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

type Props = {
  variant: 'primary' | 'secondary' | 'text';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ variant, label, onPress, disabled, loading }: Props) {
  const { colors } = useTheme();
  const blocked = disabled || loading;
  const bg =
    variant === 'primary' ? colors.accent : variant === 'secondary' ? colors['bg-2'] : 'transparent';
  const fg =
    variant === 'primary' ? colors['on-accent'] : variant === 'secondary' ? colors['text-1'] : colors['accent-text'];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={blocked ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        variant !== 'text' && { backgroundColor: bg, height: 52 },
        { opacity: blocked ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator testID="button-loading" color={fg} />
      ) : (
        <Text style={[type.body, { fontFamily: 'Manrope_600SemiBold', color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
});
```

- [ ] **Step 3: Card und Input implementieren** — `mobile/src/components/Card.tsx`:

```tsx
import { View, StyleSheet, type ViewProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function Card({ style, children, ...rest }: ViewProps) {
  const { colors, scheme } = useTheme();
  return (
    <View
      {...rest}
      style={[
        styles.base,
        { backgroundColor: colors['bg-1'] },
        scheme === 'light' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ base: { borderRadius: radius.card, padding: spacing.base } });
```

`mobile/src/components/Input.tsx`:

```tsx
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

type Props = TextInputProps & { label: string; error?: string };

export function Input({ label, error, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.label, { color: colors['text-2'] }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors['text-3']}
        style={[
          type.body,
          {
            backgroundColor: colors['bg-2'],
            color: colors['text-1'],
            borderRadius: radius.control,
            paddingHorizontal: spacing.base,
            height: 52,
          },
          style,
        ]}
        {...rest}
      />
      {error ? <Text style={[type.secondary, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}
```

- [ ] **Step 4: Tests grün, committen**

```bash
npm test -- components && npx tsc --noEmit
cd .. && git add mobile && git commit -m "feat(app): Basis-Komponenten Button, Card, Input"
```

---

### Task 5: Supabase-Client mit verschlüsseltem Session-Storage

**Files:**
- Create: `mobile/src/lib/secureSessionStorage.ts`, `mobile/src/lib/supabase.ts`
- Test: `mobile/src/lib/__tests__/secureSessionStorage.test.ts`

**Interfaces:**
- Produces: `secureSessionStorage` (Objekt mit `getItem/setItem/removeItem: (key[, value]) => Promise`), `supabase` (konfigurierter Client). Tasks 6–9 importieren NUR `supabase` aus `@/lib/supabase`.

- [ ] **Step 1: Abhängigkeiten installieren**

```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-secure-store expo-crypto
npm install aes-js && npm install -D @types/aes-js
```

- [ ] **Step 2: Failing Test schreiben** — `mobile/src/lib/__tests__/secureSessionStorage.test.ts`:

```ts
// Jest-Hoisting: Variablen in jest.mock-Factories MÜSSEN mit "mock" beginnen
const mockSecureStore = new Map<string, string>();
const mockAsyncStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecureStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockSecureStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockSecureStore.delete(k)),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockAsyncStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockAsyncStore.set(k, v)),
  removeItem: jest.fn(async (k: string) => void mockAsyncStore.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomValues: (arr: Uint8Array) => { arr.forEach((_, i) => (arr[i] = (i * 7 + 13) % 256)); return arr; },
}));

import { secureSessionStorage } from '../secureSessionStorage';

beforeEach(() => { mockSecureStore.clear(); mockAsyncStore.clear(); });

test('Roundtrip: setItem → getItem liefert den Wert', async () => {
  await secureSessionStorage.setItem('sb-session', '{"access_token":"abc"}');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBe('{"access_token":"abc"}');
});

test('Payload liegt NICHT im Klartext in AsyncStorage', async () => {
  await secureSessionStorage.setItem('sb-session', 'geheimer-inhalt');
  expect([...mockAsyncStore.values()].join()).not.toContain('geheimer-inhalt');
});

test('Neustart-Simulation: Wert übersteht Modul-Reset', async () => {
  await secureSessionStorage.setItem('sb-session', 'bleibt');
  jest.resetModules();
  const fresh = require('../secureSessionStorage').secureSessionStorage;
  await expect(fresh.getItem('sb-session')).resolves.toBe('bleibt');
});

test('removeItem und fehlender Key → null', async () => {
  await secureSessionStorage.setItem('sb-session', 'x');
  await secureSessionStorage.removeItem('sb-session');
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull();
});
```

Run: `npm test -- secureSessionStorage` — Expected: FAIL (Modul fehlt).

> **Amendment (2026-08-06):** `getItem` fängt Entschlüsselungsfehler ab und liefert
> `null` statt zu werfen — Details siehe Amendment-Hinweis bei Task 7.

- [ ] **Step 3: Storage implementieren** — `mobile/src/lib/secureSessionStorage.ts` (Supabase-offizielles Muster: AES-Key in SecureStore, Ciphertext in AsyncStorage):

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import aesjs from 'aes-js';

// SecureStore fasst nur ~2 KB — Sessions sind grösser. Darum: 256-bit-AES-Key
// pro Eintrag in SecureStore, der verschlüsselte Payload in AsyncStorage.
async function encrypt(key: string, value: string): Promise<string> {
  const encryptionKey = Crypto.getRandomValues(new Uint8Array(32));
  const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
  const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
  await SecureStore.setItemAsync(sanitize(key), aesjs.utils.hex.fromBytes(encryptionKey));
  return aesjs.utils.hex.fromBytes(encrypted);
}

async function decrypt(key: string, hexValue: string): Promise<string | null> {
  const keyHex = await SecureStore.getItemAsync(sanitize(key));
  if (!keyHex) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(hexValue)));
}

// SecureStore erlaubt nur [A-Za-z0-9._-]
const sanitize = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    return decrypt(key, stored);
  },
  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(sanitize(key));
  },
};
```

- [ ] **Step 4: Supabase-Client** — `mobile/src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { secureSessionStorage } from './secureSessionStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase-Konfiguration fehlt: EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env setzen (Vorlage: .env.example, Werte aus `supabase status`).'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 5: Tests grün, committen**

```bash
npm test -- secureSessionStorage && npx tsc --noEmit
cd .. && git add mobile && git commit -m "feat(app): Supabase-Client mit verschlüsseltem Session-Storage"
```

---

### Task 6: Telefon-Normalisierung, Test-OTP-Config & Auth-API

**Files:**
- Create: `mobile/src/features/auth/phone.ts`, `mobile/src/features/auth/authApi.ts`
- Test: `mobile/src/features/auth/__tests__/phone.test.ts`
- Modify: `supabase/config.toml` (SMS-Test-OTP), `README.md` (Testnummern)

**Interfaces:**
- Consumes: `supabase` (Task 5).
- Produces: `normalizePhone(input: string): string | null` (E.164 oder null), `requestOtp(phone: string): Promise<{ error: string | null }>`, `verifyOtp(phone: string, code: string): Promise<{ error: string | null }>`, `signOut(): Promise<void>`, `signInWith(provider: 'apple' | 'google'): Promise<{ error: string | null }>` (vorbereiteter Stub). Screens (Task 8) rufen NUR diese Funktionen, nie `supabase.auth` direkt.

- [ ] **Step 1: Failing Test schreiben** — `mobile/src/features/auth/__tests__/phone.test.ts`:

```ts
import { normalizePhone } from '../phone';

test.each([
  ['+41791234567', '+41791234567'],
  ['079 123 45 67', '+41791234567'],
  ['0791234567', '+41791234567'],
  ['0041 79 123 45 67', '+41791234567'],
  ['+49 170 1234567', '+491701234567'],
])('normalisiert %s zu %s', (input, expected) => {
  expect(normalizePhone(input)).toBe(expected);
});

test.each([['', null], ['abc', null], ['123', null], ['+1', null]])(
  'lehnt %s ab',
  (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  }
);
```

Run: `npm test -- phone` — Expected: FAIL.

- [ ] **Step 2: Implementieren** — `mobile/src/features/auth/phone.ts`:

```ts
// Normalisiert Eingaben zu E.164. Schweizer Konvention als Default:
// 07x… und 0041… werden zu +41…; alles mit + bleibt wie eingegeben.
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s\-()./]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  else if (/^0[1-9]\d+$/.test(digits)) digits = `+41${digits.slice(1)}`;
  return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : null;
}
```

`mobile/src/features/auth/authApi.ts`:

```ts
import { supabase } from '@/lib/supabase';

const OFFLINE_HINT = 'Du bist offline. Verbinde dich und probier es nochmal.';

export async function requestOtp(phone: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (!error) return { error: null };
  if (error.message.includes('fetch')) return { error: OFFLINE_HINT };
  if (error.status === 429) return { error: 'Zu viele Versuche. Warte kurz und fordere dann einen neuen Code an.' };
  return { error: 'Der Code konnte nicht gesendet werden. Prüf die Nummer und probier es nochmal.' };
}

export async function verifyOtp(phone: string, code: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
  if (!error) return { error: null };
  if (error.message.includes('fetch')) return { error: OFFLINE_HINT };
  return { error: 'Der Code stimmt nicht oder ist abgelaufen. Fordere einen neuen an.' };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export type OAuthProvider = 'apple' | 'google';

// Vorbereitete Abstraktion (Spec §4): wird erst mit Dev-Build + Credentials
// aktiviert. Die Flags EXPO_PUBLIC_AUTH_* halten die Buttons bis dahin
// unsichtbar — dieser Fallback greift nur, falls ein Flag versehentlich an ist.
export async function signInWith(provider: OAuthProvider): Promise<{ error: string | null }> {
  return {
    error: `Anmeldung mit ${provider === 'apple' ? 'Apple' : 'Google'} ist noch nicht verfügbar. Nutze deine Handynummer.`,
  };
}
```

- [ ] **Step 3: Test-OTP lokal konfigurieren** — in `supabase/config.toml` den `[auth.sms]`-Abschnitt so setzen:

```toml
[auth.sms]
enable_signup = true
enable_confirmations = false

# Lokale Testnummern — kein SMS-Provider, keine Kosten. Jeder dieser Nummern
# gilt der feste Code. NIE in ein hosted Projekt übernehmen.
[auth.sms.test_otp]
41790000001 = "123456"
41790000002 = "123456"
```

```bash
supabase stop && supabase start && supabase db reset && supabase test db
```

Expected: Alles grün (Config-Änderung, kein Schema-Effekt — 8 Dateien, 92 Tests).

- [ ] **Step 4: Testnummern im README dokumentieren** — im App-Abschnitt ergänzen:

```markdown
Login lokal: Testnummern `+41 79 000 00 01` / `…02`, Code jeweils `123456`
(supabase/config.toml → [auth.sms.test_otp]).
```

- [ ] **Step 5: Tests grün, committen**

```bash
npm test -- phone && npx tsc --noEmit
cd .. && git add mobile supabase/config.toml README.md
git commit -m "feat(app): Telefon-Normalisierung, Auth-API und lokale Test-OTP-Codes"
```

---

### Task 7: AuthProvider, Session-Guard & Root-Layout

> **Amendment (2026-08-06, nach Final-Review):** Der AuthProvider-Code unten wurde
> bewusst gehärtet umgesetzt: hasProfile unterscheidet Query-Fehler von "kein Profil"
> (Fehler ⇒ nie needsProfile, Fallback signedIn), evaluate fängt Rejections (nie
> dauerhaft loading), secureSessionStorage.getItem liefert bei Entschlüsselungsfehlern
> null. Freigegeben vom Auftraggeber.

**Files:**
- Create: `mobile/src/features/auth/guard.ts`, `mobile/src/features/auth/AuthProvider.tsx`, `mobile/app/index.tsx`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/src/features/auth/__tests__/guard.test.ts`

**Interfaces:**
- Consumes: `supabase` (Task 5), `ThemeProvider` (Task 3).
- Produces: `type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'signedIn'`; `resolveRoute(status: AuthStatus): '/welcome' | '/profile-setup' | '/aufnehmen' | null`; Hook `useAuth(): { status: AuthStatus; userId: string | null; refreshProfile(): Promise<void> }`. Task 9 ruft `refreshProfile()` nach dem Profil-Insert; Task 10 nutzt `useAuth` für Profildaten-Lookup.

- [ ] **Step 1: Failing Test schreiben** — `mobile/src/features/auth/__tests__/guard.test.ts`:

```ts
import { resolveRoute } from '../guard';

test.each([
  ['loading', null],
  ['signedOut', '/welcome'],
  ['needsProfile', '/profile-setup'],
  ['signedIn', '/aufnehmen'],
] as const)('Status %s → Route %s', (status, route) => {
  expect(resolveRoute(status)).toBe(route);
});
```

Run: `npm test -- guard` — Expected: FAIL.

- [ ] **Step 2: Guard implementieren** — `mobile/src/features/auth/guard.ts`:

```ts
export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'signedIn';

// Reine Routing-Entscheidung — getrennt gehalten, damit sie ohne
// React/Supabase testbar ist. null = noch nicht umleiten (Splash steht).
export function resolveRoute(status: AuthStatus): '/welcome' | '/profile-setup' | '/aufnehmen' | null {
  switch (status) {
    case 'loading': return null;
    case 'signedOut': return '/welcome';
    case 'needsProfile': return '/profile-setup';
    case 'signedIn': return '/aufnehmen';
  }
}
```

- [ ] **Step 3: AuthProvider implementieren** — `mobile/src/features/auth/AuthProvider.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AuthStatus } from './guard';

type AuthContextValue = {
  status: AuthStatus;
  userId: string | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  status: 'loading',
  userId: null,
  refreshProfile: async () => {},
});

// Token-Refresh nur im Vordergrund (offizielles Supabase-RN-Muster)
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

async function hasProfile(userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  return data !== null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const evaluate = useCallback(async (s: Session | null) => {
    if (!s) return setStatus('signedOut');
    setStatus((await hasProfile(s.user.id)) ? 'signedIn' : 'needsProfile');
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void evaluate(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void evaluate(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  return (
    <AuthContext.Provider
      value={{
        status,
        userId: session?.user.id ?? null,
        refreshProfile: () => evaluate(session),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 4: Root-Layout verdrahten** — `mobile/app/_layout.tsx`:

```tsx
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Manrope_200ExtraLight,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { resolveRoute } from '@/features/auth/guard';

void SplashScreen.preventAutoHideAsync();

function Guarded() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    const target = resolveRoute(status);
    if (!target) return;
    void SplashScreen.hideAsync();
    const area = segments[0]; // '(auth)' | '(tabs)' | undefined
    if (status === 'signedIn' && area !== '(tabs)') router.replace(target);
    if (status !== 'signedIn' && area !== '(auth)') router.replace(target);
    if (status === 'needsProfile' && segments[1] !== 'profile-setup') router.replace(target);
  }, [status, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors['bg-0'] } }} />
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Manrope_200ExtraLight,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
  });
  if (!fontsLoaded) return null;
  return (
    <ThemeProvider>
      <AuthProvider>
        <Guarded />
      </AuthProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 5: Index-Route anlegen** — `mobile/app/index.tsx` (ohne sie zeigt expo-router beim Kaltstart «Unmatched route», bevor der Guard umleitet):

```tsx
export default function Index() {
  return null; // Splash bleibt sichtbar, bis der Guard im Root-Layout umleitet
}
```

- [ ] **Step 6: Tests grün, committen**

```bash
npm test -- guard && npx tsc --noEmit
cd .. && git add mobile && git commit -m "feat(app): AuthProvider und Session-Guard im Root-Layout"
```

---

### Task 8: Auth-Screens — Welcome, Handynummer, OTP-Code

**Files:**
- Create: `mobile/app/(auth)/_layout.tsx`, `mobile/app/(auth)/welcome.tsx`, `mobile/app/(auth)/phone.tsx`, `mobile/app/(auth)/otp.tsx`
- Test: `mobile/src/features/auth/__tests__/screens.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input` (Task 4), `normalizePhone`, `requestOtp`, `verifyOtp` (Task 6), Tokens (Task 3).
- Produces: navigierbarer Login-Flow; `otp.tsx` erwartet Query-Param `phone` (E.164). Nach erfolgreichem `verifyOtp` übernimmt der Guard (Task 7) das Weiterleiten.

- [ ] **Step 1: Failing Tests schreiben** — `mobile/src/features/auth/__tests__/screens.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useLocalSearchParams: () => ({ phone: '+41790000001' }),
}));
jest.mock('../authApi', () => ({
  requestOtp: jest.fn(async () => ({ error: null })),
  verifyOtp: jest.fn(async () => ({ error: 'Der Code stimmt nicht oder ist abgelaufen. Fordere einen neuen an.' })),
}));

import PhoneScreen from '../../../../app/(auth)/phone';
import OtpScreen from '../../../../app/(auth)/otp';
import { requestOtp } from '../authApi';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('phone: ungültige Nummer zeigt Fehler, ruft kein OTP an', async () => {
  wrap(<PhoneScreen />);
  fireEvent.changeText(screen.getByLabelText('Handynummer'), 'abc');
  fireEvent.press(screen.getByText('Code senden'));
  expect(await screen.findByText(/keine gültige Handynummer/)).toBeTruthy();
  expect(requestOtp).not.toHaveBeenCalled();
});

test('phone: gültige Nummer fordert Code an und navigiert weiter', async () => {
  wrap(<PhoneScreen />);
  fireEvent.changeText(screen.getByLabelText('Handynummer'), '079 000 00 01');
  fireEvent.press(screen.getByText('Code senden'));
  await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('+41790000001'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/otp', params: { phone: '+41790000001' } });
});

test('otp: falscher Code zeigt die Fehlermeldung der API', async () => {
  wrap(<OtpScreen />);
  fireEvent.changeText(screen.getByLabelText('Code'), '000000');
  fireEvent.press(screen.getByText('Bestätigen'));
  expect(await screen.findByText(/stimmt nicht oder ist abgelaufen/)).toBeTruthy();
});
```

Run: `npm test -- screens` — Expected: FAIL (Screens fehlen).

- [ ] **Step 2: Stack-Layout** — `mobile/app/(auth)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 3: Welcome-Screen** — `mobile/app/(auth)/welcome.tsx`:

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
          Bis es existiert: schlichter Manrope-Schriftzug. */}
      <Text style={[type.h1, { color: colors['text-1'] }]}>Reelive</Text>
      <Text style={[type.body, { color: colors['text-2'] }]}>
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

- [ ] **Step 4: Phone- und OTP-Screen** — `mobile/app/(auth)/phone.tsx`:

```tsx
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { normalizePhone } from '@/features/auth/phone';
import { requestOtp } from '@/features/auth/authApi';

export default function PhoneScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const phone = normalizePhone(input);
    if (!phone) {
      setError('Das ist keine gültige Handynummer. Gib sie mit Vorwahl ein, z.B. +41 79 …');
      return;
    }
    setError(undefined);
    setLoading(true);
    const { error: apiError } = await requestOtp(phone);
    setLoading(false);
    if (apiError) return setError(apiError);
    router.push({ pathname: '/otp', params: { phone } });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
```

`mobile/app/(auth)/otp.tsx`:

```tsx
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { requestOtp, verifyOtp } from '@/features/auth/authApi';

export default function OtpScreen() {
  const { colors } = useTheme();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const { error: apiError } = await verifyOtp(phone, code);
    setLoading(false);
    if (apiError) setError(apiError);
    // Erfolg: onAuthStateChange feuert, der Guard (Root-Layout) leitet weiter.
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
```

- [ ] **Step 5: Tests grün, committen**

```bash
npm test -- screens && npx tsc --noEmit
cd .. && git add mobile && git commit -m "feat(app): Auth-Screens Welcome, Handynummer und OTP-Code"
```

---

### Task 9: Profil-Setup — Screen & Profil-API

**Files:**
- Create: `mobile/src/features/auth/profileApi.ts`, `mobile/app/(auth)/profile-setup.tsx`
- Test: `mobile/src/features/auth/__tests__/profileApi.test.ts`

**Interfaces:**
- Consumes: `supabase` (Task 5), `useAuth().refreshProfile` (Task 7), `Button`/`Input` (Task 4).
- Produces: `validateUsername(u: string): string | null` (Fehlertext oder null), `validateDisplayName(d: string): string | null`, `createProfile(userId, username, displayName): Promise<{ error: string | null }>`. Task 10 liest das Profil über `fetchOwnProfile(userId)`.

**Wichtig (RLS-Realität aus Phase 1):** Ein frischer Nutzer kann fremde Profile NICHT lesen (`profiles_select_own_or_shared`) — eine Live-Verfügbarkeitsprüfung des Usernames per SELECT ist unmöglich. Kollisionen werden deshalb beim Insert über den Unique-Fehler (Code `23505`) erkannt und als Inline-Fehler gezeigt.

- [ ] **Step 1: Failing Test schreiben** — `mobile/src/features/auth/__tests__/profileApi.test.ts`:

```ts
const mockInsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ insert: mockInsert, select: jest.fn() }) },
}));

import { validateUsername, validateDisplayName, createProfile } from '../profileApi';

test.each([
  ['lea', null],
  ['lea_2026', null],
  ['ab', 'Mindestens 3 Zeichen — Kleinbuchstaben, Zahlen und _.'],
  ['Lea', 'Mindestens 3 Zeichen — Kleinbuchstaben, Zahlen und _.'],
  ['a'.repeat(21), 'Mindestens 3 Zeichen — Kleinbuchstaben, Zahlen und _.'],
])('validateUsername(%s) → %s', (input, expected) => {
  expect(validateUsername(input)).toBe(expected);
});

test.each([
  ['Lea', null],
  ['', 'Sag uns, wie du heissen willst (1–40 Zeichen).'],
  ['x'.repeat(41), 'Sag uns, wie du heissen willst (1–40 Zeichen).'],
])('validateDisplayName(%s) → %s', (input, expected) => {
  expect(validateDisplayName(input)).toBe(expected);
});

test('createProfile mappt Unique-Verletzung auf Inline-Fehler', async () => {
  mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
  const { error } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBe('Dieser Username ist vergeben — probier einen anderen.');
});

test('createProfile: Erfolg → error null', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  const { error } = await createProfile('uid-1', 'lea', 'Lea');
  expect(error).toBeNull();
  expect(mockInsert).toHaveBeenCalledWith({ id: 'uid-1', username: 'lea', display_name: 'Lea' });
});
```

Run: `npm test -- profileApi` — Expected: FAIL.

- [ ] **Step 2: Profil-API implementieren** — `mobile/src/features/auth/profileApi.ts`:

```ts
import { supabase } from '@/lib/supabase';

export type Profile = { id: string; username: string; display_name: string };

export function validateUsername(username: string): string | null {
  return /^[a-z0-9_]{3,20}$/.test(username)
    ? null
    : 'Mindestens 3 Zeichen — Kleinbuchstaben, Zahlen und _.';
}

export function validateDisplayName(displayName: string): string | null {
  const len = displayName.trim().length;
  return len >= 1 && len <= 40 ? null : 'Sag uns, wie du heissen willst (1–40 Zeichen).';
}

export async function createProfile(
  userId: string,
  username: string,
  displayName: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, username, display_name: displayName.trim() });
  if (!error) return { error: null };
  if (error.code === '23505') return { error: 'Dieser Username ist vergeben — probier einen anderen.' };
  return { error: 'Das Profil konnte nicht gespeichert werden. Probier es gleich nochmal.' };
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', userId)
    .maybeSingle();
  return data;
}
```

- [ ] **Step 3: Screen implementieren** — `mobile/app/(auth)/profile-setup.tsx`:

```tsx
import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { createProfile, validateDisplayName, validateUsername } from '@/features/auth/profileApi';

export default function ProfileSetupScreen() {
  const { colors } = useTheme();
  const { userId, refreshProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [displayNameError, setDisplayNameError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const uErr = validateUsername(username);
    const dErr = validateDisplayName(displayName);
    setUsernameError(uErr ?? undefined);
    setDisplayNameError(dErr ?? undefined);
    if (uErr || dErr || !userId) return;
    setLoading(true);
    const { error } = await createProfile(userId, username, displayName);
    setLoading(false);
    if (error) return setUsernameError(error);
    await refreshProfile(); // Guard leitet zu den Tabs weiter
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h1, { color: colors['text-1'] }]}>Fast geschafft</Text>
      <Input
        label="Username"
        value={username}
        onChangeText={(t) => setUsername(t.toLowerCase())}
        error={usernameError}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="lea_2026"
      />
      <Input
        label="Anzeigename"
        value={displayName}
        onChangeText={setDisplayName}
        error={displayNameError}
        placeholder="Lea"
      />
      <Button variant="primary" label="Los geht's" onPress={submit} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
```

- [ ] **Step 4: Tests grün, committen**

```bash
npm test -- profileApi && npx tsc --noEmit
cd .. && git add mobile && git commit -m "feat(app): Profil-Setup mit Username-Validierung und 23505-Kollisions-Handling"
```

---

### Task 10: Tab-Bar, Platzhalter-Tabs & Profil-Tab

**Files:**
- Create: `mobile/app/(tabs)/_layout.tsx`, `mobile/app/(tabs)/aufnehmen.tsx`, `mobile/app/(tabs)/reise.tsx`, `mobile/app/(tabs)/recap.tsx`, `mobile/app/(tabs)/profil.tsx`
- Test: `mobile/src/features/auth/__tests__/profilTab.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 7), `fetchOwnProfile` (Task 9), `signOut` (Task 6), Tokens/Komponenten (Tasks 3–4).
- Produces: die vier Tabs gemäss Design-Language §4. Spätere Phasen ersetzen die Platzhalter-Screens in place.

- [ ] **Step 1: Failing Test schreiben** — `mobile/src/features/auth/__tests__/profilTab.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('../AuthProvider', () => ({
  useAuth: () => ({ status: 'signedIn', userId: 'uid-1', refreshProfile: jest.fn() }),
}));
jest.mock('../profileApi', () => ({
  fetchOwnProfile: jest.fn(async () => ({ id: 'uid-1', username: 'lea', display_name: 'Lea' })),
}));
const mockSignOut = jest.fn();
jest.mock('../authApi', () => ({ signOut: () => mockSignOut() }));

import ProfilScreen from '../../../../app/(tabs)/profil';

test('zeigt Profildaten und meldet ab', async () => {
  render(<ThemeProvider><ProfilScreen /></ThemeProvider>);
  expect(await screen.findByText('Lea')).toBeTruthy();
  expect(screen.getByText('@lea')).toBeTruthy();
  fireEvent.press(screen.getByText('Abmelden'));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
});
```

Run: `npm test -- profilTab` — Expected: FAIL.

- [ ] **Step 2: Icons installieren & Tab-Layout** —

```bash
npx expo install react-native-svg
npm install lucide-react-native
```

`mobile/app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router';
import { Camera, Map, Play, User } from 'lucide-react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

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
          backgroundColor: colors['bg-1'],
          borderTopWidth: 0,
          borderRadius: radius.card,
          marginHorizontal: spacing.screen,
          marginBottom: spacing.screen,
          position: 'absolute',
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

- [ ] **Step 3: Platzhalter-Screens** — `mobile/app/(tabs)/aufnehmen.tsx` (analog `reise.tsx` mit «Deine Reisen findest du hier — ab Phase 3.» und `recap.tsx` mit «Recaps erscheinen hier nach dem Reveal — ab Phase 5.»):

```tsx
import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';

export default function AufnehmenScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Text style={[type.h2, { color: colors['text-1'] }]}>Hier fängst du bald Momente ein</Text>
      <Text style={[type.body, { color: colors['text-2'] }]}>
        Die Kamera kommt in Phase 4. Deine Filmrolle wartet auf dich.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.s },
});
```

- [ ] **Step 4: Profil-Tab** — `mobile/app/(tabs)/profil.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchOwnProfile, type Profile } from '@/features/auth/profileApi';
import { signOut } from '@/features/auth/authApi';

export default function ProfilScreen() {
  const { colors } = useTheme();
  const { userId } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (userId) void fetchOwnProfile(userId).then(setProfile);
  }, [userId]);

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <Card style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{profile?.display_name ?? '…'}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {profile ? `@${profile.username}` : ''}
        </Text>
      </Card>
      <Button variant="secondary" label="Abmelden" onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
});
```

- [ ] **Step 5: Tests grün, committen**

```bash
npm test -- profilTab && npx tsc --noEmit
cd .. && git add mobile && git commit -m "feat(app): Tab-Bar mit Platzhalter-Tabs und Profil-Tab inkl. Abmelden"
```

---

### Task 11: Gesamtverifikation

**Files:**
- Modify: `README.md` (falls sich beim Testen Setup-Stolpersteine zeigen)

**Interfaces:**
- Consumes: alles.
- Produces: das Phase-2-Deliverable, verifiziert.

- [ ] **Step 1: Automatisierte Suiten komplett**

```bash
supabase db reset && supabase test db          # Repo-Root: 8 Dateien, 92 Tests, PASS
cd mobile && npx tsc --noEmit && npm test      # alle Jest-Suiten PASS
```

- [ ] **Step 2: Manuelle Matrix — iOS-Simulator** (`npx expo start`, dann `i`):
  Welcome → «Mit Handynummer fortfahren» → `+41 79 000 00 01` → Code `123456` →
  Profil-Setup (`lea` / `Lea`) → landet in den Tabs → Profil-Tab zeigt «Lea @lea» →
  App im Simulator beenden und neu öffnen → weiterhin eingeloggt (Session persistiert) →
  Abmelden → zurück auf Welcome.

- [ ] **Step 3: Manuelle Matrix — Android-Emulator** (`a` im Expo-Dev-Server):
  gleicher Durchlauf mit `+41 79 000 00 02`; zusätzlich prüfen, dass die
  Supabase-URL erreichbar ist (LAN-IP in `.env`, nicht `127.0.0.1`).

- [ ] **Step 4: Manuelle Matrix — echte Geräte (iPhone + Android via Expo Go, gleiches WLAN):**
  Login-Zyklus wie oben; zweiter Username-Versuch mit `lea` muss den
  Inline-Fehler «Dieser Username ist vergeben …» zeigen (23505-Pfad real getestet).
  Dark/Light: System-Theme umschalten → App folgt (beide Themes gemäss Design-Language).

- [ ] **Step 5: Design-Language-Checkliste (§9)** für alle neuen Screens durchgehen
  (Tokens, Radius, ein Primär-Button, keine Schatten/Gradients, Copy-Vokabular).

- [ ] **Step 6: Abschluss-Commit (nur falls Doku-Anpassungen anfielen)**

```bash
git add README.md && git commit -m "docs: Dev-Setup-Hinweise aus der Phase-2-Verifikation"
```
