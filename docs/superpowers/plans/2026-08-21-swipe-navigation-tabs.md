# Swipe-Navigation zwischen den Tabs: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Zwischen den vier Tabs (Aufnehmen, Reise, Recap, Profil) laesst sich horizontal wischen, wobei der Inhalt dem Finger folgt und die Geste abgebrochen werden kann.

**Architektur:** Der Bottom-Tab-Navigator von expo-router weicht dem mitgelieferten `TopTabs`-Navigator mit `tabBarPosition="bottom"`, der ueber `react-native-tab-view` echtes Mitziehen kann. Die heutige Leiste wird als eigene Komponente nachgebaut, weil der Material-Navigator eine andere mitbringt. Die Kamera-Session waermt sich waehrend der Geste vor, gesteuert ueber den Animationswert des Pagers.

**Tech-Stack:** Expo SDK 57, expo-router 57.0.10 (`expo-router/js-top-tabs`), react-native-tab-view 4.x, react-native-pager-view 6.x, React Native 0.86, TypeScript strict, Jest mit jest-expo.

**Design:** Im Chat abgestimmt am 2026-08-21 (kein eigenes Spec-Dokument). Die getroffenen Entscheidungen stehen unten unter "Entschiedene Fragen".

## Globale Rahmenbedingungen

- Quellcode englisch: Bezeichner, Dateinamen, Kommentare, Testbeschreibungen. Nur sichtbare UI-Texte deutsch (Du-Form). Siehe `CLAUDE.md`.
- Keine Gedankenstriche (Em-Dash) in Texten und Kommentaren.
- `DESIGN-LANGUAGE.md` schlaegt Framework-Defaults: Tab-Leiste volle Breite, `bg-0`, 1 px Hairline oben, keine Rundung, aktiv `accent`, inaktiv `text-2`, Label `type.tab`. Ueber dem Sucher translucent (`rgba(19,17,16,0.55)` + Blur 10 via `<Pill>`).
- Die Hoehe der Leiste kommt ausschliesslich aus `cinemaStage.barHeight(bottomInset)`. Kein zweiter Ort mit derselben Zahl.
- Beitraege sortieren weiterhin nach `captured_at`. Von diesem Plan nicht beruehrt.
- Kein `npx expo prebuild`: das loescht die Pods und die Team-Auswahl in Xcode (Projektgedaechtnis). Native Aenderungen laufen ueber `npx pod-install ios` plus neuen Build.

## Entschiedene Fragen

1. **Wisch-Gefuehl:** echter Pager, Inhalt haengt am Finger, Geste abbrechbar.
2. **Kamera-Start:** Die Session startet mit der Geste, sobald die Pager-Position sich dem Kamera-Index um mehr als 10 Prozent naehert. Kein Dauerbetrieb im Hintergrund.
3. **Umfang:** Gewischt wird nur auf den vier Wurzel-Screens. In `trip/[id]`, `recap/[id]` und im Player ist Wischen aus, damit es nicht gegen den iOS-Zurueck-Wisch kaempft. Waehrend einer laufenden Aufnahme (`captureLock`) ist Wischen ebenfalls aus.
4. **Reihenfolge der Tabs:** unveraendert Aufnehmen, Reise, Recap, Profil.

## Dateien

**Neu:**
- `mobile/src/features/navigation/barShape.ts` — reine Funktionen: welche Gestalt hat die Leiste auf welcher Route, und darf dort gewischt werden. Kein React, damit die heutigen Layout-Tests als scharfe Funktionstests weiterleben.
- `mobile/src/features/navigation/TabBar.tsx` — die eigene Leiste (Icons, Labels, Kino-Modus, Safe-Area, Tab-Tap, Vorwaerm-Signal).
- `mobile/src/features/camera/warmup.ts` — Halter plus Abonnement fuer das Vorwaerm-Signal, gleiche Bauart wie `cinemaStage.ts`.
- `mobile/src/features/navigation/__tests__/barShape.test.ts`
- `mobile/src/features/navigation/__tests__/TabBar.test.tsx`
- `mobile/src/features/camera/__tests__/warmup.test.ts`

**Geaendert:**
- `mobile/src/app/(tabs)/_layout.tsx` — `TopTabs` statt `Tabs`, eigene Leiste, `swipeEnabled` aus `barShape`.
- `mobile/src/features/camera/captureLock.ts` — bekommt ein Abonnement, weil `swipeEnabled` beim Rendern gelesen wird und nicht wie `tabPress` erst im Moment des Ereignisses.
- `mobile/src/features/camera/multiCamera.ts` — Wächter gegen Doppelstart.
- `mobile/src/app/(tabs)/capture/index.tsx` — Session haengt an `focused || warm` statt nur am Fokus.
- `mobile/src/app/(tabs)/__tests__/_layout.test.tsx` — auf den neuen Navigator umgeschrieben.
- `mobile/package.json`, `mobile/jest.setup.ts` — Abhaengigkeiten und Test-Mock.

---

### Task 1: Abhaengigkeiten und Test-Umgebung

Der Pager ist ein natives Modul. Ohne diesen Schritt scheitert jeder folgende Test am fehlenden Paket.

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/jest.setup.ts`

**Interfaces:**
- Produces: `react-native-tab-view` und `react-native-pager-view` sind aufloesbar; `expo-router/js-top-tabs` exportiert `TopTabs`.

- [ ] **Step 1: Pakete installieren**

```bash
cd mobile
npx expo install react-native-tab-view react-native-pager-view
```

`npx expo install` statt `npm install`, damit die zum SDK 57 passenden Versionen gewaehlt werden.

- [ ] **Step 2: Pods ziehen**

```bash
cd mobile && npx pod-install ios
```

Kein `expo prebuild`. Das wuerde die Pods und die Team-Auswahl loeschen.

- [ ] **Step 3: Transform-Pfad fuer Jest oeffnen**

In `mobile/package.json` in `jest.transformIgnorePatterns` die beiden Pakete ergaenzen, damit ihr ES-Modul-Code transformiert wird. Das bestehende Muster endet auf `|lucide-react-native)`; daraus wird:

```
|lucide-react-native|react-native-tab-view|react-native-pager-view)
```

- [ ] **Step 4: Pager im Test durch eine schlichte Ansicht ersetzen**

Am Ende von `mobile/jest.setup.ts` ergaenzen:

```ts
// react-native-pager-view is a native module: under Jest it has no view
// manager, and every render inside the tab navigator would fail on it. The
// stand-in keeps the children mounted, which is all the tests here look at;
// whether the pager really slides is a device question (see the plan's
// closing task), never a Jest one.
jest.mock('react-native-pager-view', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View, PagerView: View };
});
```

- [ ] **Step 5: Bestehende Suite laeuft weiter**

Run: `cd mobile && npm test`
Expected: PASS, unveraenderte Anzahl Tests. Schlaegt hier etwas fehl, liegt es an den Transform-Pfaden, nicht am Feature.

- [ ] **Step 6: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/jest.setup.ts mobile/ios
git commit -m "build(nav): add the pager packages behind the swipeable tabs"
```

---

### Task 2: Die Aufnahme-Sperre wird beobachtbar

`swipeEnabled` wird beim Rendern gelesen, nicht erst im Moment eines Ereignisses. Der heutige Halter ohne Abonnement reicht dafuer nicht.

**Files:**
- Modify: `mobile/src/features/camera/captureLock.ts`
- Test: `mobile/src/features/camera/__tests__/captureLock.test.ts` (anlegen, falls nicht vorhanden)

**Interfaces:**
- Produces: `captureLock.subscribe(listener: () => void): () => void`, `captureLock.lock(on: boolean): void`, `captureLock.isLocked(): boolean`.

- [ ] **Step 1: Failing test**

```ts
import * as captureLock from '../captureLock';

afterEach(() => captureLock.lock(false));

test('a subscriber learns about the lock being set', () => {
  const listener = jest.fn();
  captureLock.subscribe(listener);
  captureLock.lock(true);
  expect(listener).toHaveBeenCalledTimes(1);
});

test('setting the same value again notifies nobody', () => {
  captureLock.lock(true);
  const listener = jest.fn();
  captureLock.subscribe(listener);
  captureLock.lock(true);
  expect(listener).not.toHaveBeenCalled();
});

test('unsubscribing stops the notifications', () => {
  const listener = jest.fn();
  const unsubscribe = captureLock.subscribe(listener);
  unsubscribe();
  captureLock.lock(true);
  expect(listener).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Test laeuft rot**

Run: `cd mobile && npx jest src/features/camera/__tests__/captureLock.test.ts`
Expected: FAIL, `captureLock.subscribe is not a function`.

- [ ] **Step 3: Implementieren**

`captureLock.ts` wird zu:

```ts
// While a capture is running (photo cycle or video) the tab bar must not be
// operable: a tab switch fires the focus cleanup in the middle of the
// running session (re-hanging mute would be a session reconfiguration, see
// the comment on the CameraView) and navigates away from a capture that is
// about to go to the preview. Since the tabs can be swiped, the same holds
// for the gesture: `swipeEnabled` is read while RENDERING, so unlike the tap
// listener a holder alone is not enough here, the bar has to re-render on
// the change. Hence the subscription, same shape as cinemaStage.ts.
let locked = false;
const listeners = new Set<() => void>();

export function lock(on: boolean): void {
  if (locked === on) return;
  locked = on;
  listeners.forEach((listener) => listener());
}

export function isLocked(): boolean {
  return locked;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

- [ ] **Step 4: Test laeuft gruen**

Run: `cd mobile && npx jest src/features/camera/__tests__/captureLock.test.ts`
Expected: PASS.

- [ ] **Step 5: Die Kamera-Tests bleiben gruen**

Run: `cd mobile && npx jest src/app/\(tabs\)/capture`
Expected: PASS. Der frueh-Ausstieg bei gleichem Wert ist neu; falls ein Test auf wiederholtes `lock(false)` baut, hier anpassen.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/camera/captureLock.ts mobile/src/features/camera/__tests__/captureLock.test.ts
git commit -m "feat(camera): the capture lock can be watched, not only asked"
```

---

### Task 3: Gestalt der Leiste als reine Funktion

Heute steckt die Entscheidung "versteckt / Kino / normal" in einer verschachtelten Ternaerkette in `screenOptions`. Sie zieht in eine reine Funktion um, damit die dreizehn bestehenden Layout-Tests scharf bleiben, obwohl der Navigator wechselt.

**Files:**
- Create: `mobile/src/features/navigation/barShape.ts`
- Test: `mobile/src/features/navigation/__tests__/barShape.test.ts`

**Interfaces:**
- Produces: `type BarShape = 'hidden' | 'cinema' | 'plain'`, `barShape(segments: string[], selectedTab: string, viewfinderVisible: boolean): BarShape`, `swipeAllowed(segments: string[]): boolean`.

- [ ] **Step 1: Failing test**

```ts
import { barShape, swipeAllowed } from '../barShape';

describe('barShape', () => {
  test('on the player route the bar is gone (spec 8.2: full screen)', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'player'], 'recap', false)).toBe('hidden');
  });

  test('another route in the same tab keeps its bar', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'overview'], 'recap', false)).toBe('plain');
  });

  test('the map keeps its bar, it is a tool, not a full-screen media screen', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'map'], 'recap', false)).toBe('plain');
  });

  test('a "player" segment outside recap/[id]/ does not hide anything', () => {
    expect(barShape(['(tabs)', 'capture', 'player'], 'capture', false)).toBe('plain');
  });

  test('with the viewfinder up the capture tab wears the cinema bar', () => {
    expect(barShape(['(tabs)', 'capture'], 'capture', true)).toBe('cinema');
  });

  test('without the viewfinder the capture tab wears the plain bar', () => {
    expect(barShape(['(tabs)', 'capture'], 'capture', false)).toBe('plain');
  });

  test('the cinema bar survives the preview covering the tab', () => {
    // The preview lives NEXT to the tabs (app/preview.tsx), so the segments
    // leave the navigator entirely. The shape hangs off the CHOSEN tab, not
    // off focus, otherwise the bar jumps on the first frame of the way back
    // (device finding 2026-08-18).
    expect(barShape(['preview'], 'capture', true)).toBe('cinema');
  });

  test('on another chosen tab the viewfinder flag changes nothing', () => {
    expect(barShape(['(tabs)', 'trip'], 'trip', true)).toBe('plain');
  });

  test('the player beats the cinema bar', () => {
    expect(barShape(['(tabs)', 'recap', '[id]', 'player'], 'recap', true)).toBe('hidden');
  });
});

describe('swipeAllowed', () => {
  test('on the root screen of a tab you may swipe', () => {
    expect(swipeAllowed(['(tabs)', 'trip'])).toBe(true);
    expect(swipeAllowed(['(tabs)', 'capture'])).toBe(true);
    expect(swipeAllowed(['(tabs)', 'profile'])).toBe(true);
  });

  test('inside a nested stack you may not: the back swipe owns that gesture', () => {
    expect(swipeAllowed(['(tabs)', 'trip', '[id]'])).toBe(false);
    expect(swipeAllowed(['(tabs)', 'recap', '[id]', 'overview'])).toBe(false);
    expect(swipeAllowed(['(tabs)', 'recap', '[id]', 'player'])).toBe(false);
  });

  test('while a screen outside the tabs covers them, nobody swipes', () => {
    expect(swipeAllowed(['preview'])).toBe(false);
    expect(swipeAllowed(['(auth)', 'sign-in'])).toBe(false);
  });
});
```

- [ ] **Step 2: Test laeuft rot**

Run: `cd mobile && npx jest src/features/navigation/__tests__/barShape.test.ts`
Expected: FAIL, Modul nicht gefunden.

- [ ] **Step 3: Implementieren**

```ts
// Which shape the tab bar wears on which route, and where the tabs may be
// swiped. Deliberately free of React: both answers used to sit as a nested
// ternary inside `screenOptions` (app/(tabs)/_layout.tsx), where every test
// had to render the navigator to reach them. As plain functions they stay
// testable while the navigator underneath changes.

/** 'hidden' = no bar at all, 'cinema' = translucent over the camera image, 'plain' = the light bar. */
export type BarShape = 'hidden' | 'cinema' | 'plain';

// The player is full screen (spec 8.2), and the segments arrive UNNORMALISED,
// as the file path spells them: ['(tabs)', 'recap', '[id]', 'player']. All
// three deeper segments are compared, otherwise every route inside the recap
// tab would lose its bar, or a 'player' segment somewhere else would take it.
function isPlayerRoute(segments: string[]): boolean {
  return segments[1] === 'recap' && segments[2] === '[id]' && segments[3] === 'player';
}

export function barShape(segments: string[], selectedTab: string, viewfinderVisible: boolean): BarShape {
  if (isPlayerRoute(segments)) return 'hidden';
  // The cinema shape hangs off the CHOSEN tab, not off focus: the capture
  // preview covers the tab (app/preview.tsx, outside the navigator), and
  // reading focus here would drop the bar into its light shape invisibly and
  // make it jump on the first frame of the instant way back (device finding
  // 2026-08-18).
  if (selectedTab === 'capture' && viewfinderVisible) return 'cinema';
  return 'plain';
}

// Swiping belongs to the four root screens only. One level deeper the iOS
// back swipe owns the same movement, and two gestures fighting over one
// finger is what makes navigation feel broken. `['(tabs)', <tab>]` is exactly
// the root of a tab: the `index` segment of the nested stacks does not
// appear. Anything outside the navigator (preview, auth) swipes nothing.
export function swipeAllowed(segments: string[]): boolean {
  return segments[0] === '(tabs)' && segments.length === 2;
}
```

- [ ] **Step 4: Test laeuft gruen**

Run: `cd mobile && npx jest src/features/navigation/__tests__/barShape.test.ts`
Expected: PASS, 12 Tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/navigation/barShape.ts mobile/src/features/navigation/__tests__/barShape.test.ts
git commit -m "feat(nav): the bar's shape and the swipe permission become plain functions"
```

---

### Task 4: Das Vorwaerm-Signal der Kamera

**Files:**
- Create: `mobile/src/features/camera/warmup.ts`
- Test: `mobile/src/features/camera/__tests__/warmup.test.ts`

**Interfaces:**
- Produces: `warmup.set(on: boolean): void`, `warmup.get(): boolean`, `warmup.subscribe(listener: () => void): () => void`, `warmup.NEAR_ENOUGH: number`.

- [ ] **Step 1: Failing test**

```ts
import * as warmup from '../warmup';

afterEach(() => warmup.set(false));

test('it starts cold', () => {
  expect(warmup.get()).toBe(false);
});

test('a subscriber learns about the change', () => {
  const listener = jest.fn();
  const unsubscribe = warmup.subscribe(listener);
  warmup.set(true);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(warmup.get()).toBe(true);
  unsubscribe();
});

test('the same value again notifies nobody: the pager writes on every frame', () => {
  warmup.set(true);
  const listener = jest.fn();
  warmup.subscribe(listener);
  warmup.set(true);
  expect(listener).not.toHaveBeenCalled();
});

test('the threshold lies within the first tenth of the way', () => {
  expect(warmup.NEAR_ENOUGH).toBeGreaterThan(0.5);
  expect(warmup.NEAR_ENOUGH).toBeLessThan(1);
});
```

- [ ] **Step 2: Test laeuft rot**

Run: `cd mobile && npx jest src/features/camera/__tests__/warmup.test.ts`
Expected: FAIL, Modul nicht gefunden.

- [ ] **Step 3: Implementieren**

```ts
// Whether the camera session should already be running although the capture
// tab does not hold focus yet. Since the tabs can be swiped, the screen
// arrives gradually instead of at once: the pager reports its position
// continuously, and as soon as the finger drags towards the capture tab the
// session starts, so the viewfinder stands when the screen gets there. Waiting
// for focus would mean dragging a black surface into view for the whole
// gesture.
//
// Same shape as cinemaStage.ts: the tab bar (which is where the pager's
// position is available) sets the flag, the camera screen reads it through
// useSyncExternalStore, so a change re-renders it.
let warm = false;
const listeners = new Set<() => void>();

// How close the pager's position has to come to the capture tab, measured in
// tab widths: 0.9 means the first tenth of the way is enough. The session
// needs a moment to build up (see multiCamera.start), so this fires early on
// purpose. Reaching for it also means: whoever swipes AWAY from the camera
// only lets go of the flag once nine tenths of the way are done, and a
// cancelled swipe therefore does not kill a running session.
export const NEAR_ENOUGH = 0.9;

export function set(on: boolean): void {
  if (warm === on) return;
  warm = on;
  listeners.forEach((listener) => listener());
}

export function get(): boolean {
  return warm;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

- [ ] **Step 4: Test laeuft gruen**

Run: `cd mobile && npx jest src/features/camera/__tests__/warmup.test.ts`
Expected: PASS, 4 Tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/camera/warmup.ts mobile/src/features/camera/__tests__/warmup.test.ts
git commit -m "feat(camera): a warm-up signal for the session that arrives with the swipe"
```

---

### Task 5: Doppelter Start darf die Kamera nicht abschalten

Heute zaehlt jeder Fehlschlag von `start()`, und zwei in Folge schalten den MultiCam-Pfad fuer die restliche App-Sitzung ab (`multiCamera.ts:56-83`). Sobald das Vorwaermen startet und der Fokus kurz darauf noch einmal, trifft ein zweiter `start()` auf eine laufende Session. Wirft der nativ, waere MultiCam nach zwei Wischern tot.

**Files:**
- Modify: `mobile/src/features/camera/multiCamera.ts:70-89`
- Test: `mobile/src/features/camera/__tests__/multiCamera.test.ts` (bestehende Datei erweitern; falls es keine gibt, anlegen)

**Interfaces:**
- Consumes: nichts aus vorherigen Tasks.
- Produces: `start()` bleibt `Promise<boolean>`, ist aber gegen Mehrfachaufrufe abgesichert; `stop()` gibt den Weg fuer einen spaeteren Start wieder frei.

- [ ] **Step 1: Failing test**

Die vorhandene Mock-Bauart der Datei uebernehmen. Falls die Datei neu ist, dieser Rahmen:

```ts
const nativeStart = jest.fn(() => Promise.resolve());
const nativeStop = jest.fn(() => Promise.resolve());
jest.mock('expo', () => ({
  requireOptionalNativeModule: () => ({
    isAvailable: () => true,
    start: nativeStart,
    stop: nativeStop,
  }),
}));

import * as multiCamera from '../multiCamera';

beforeEach(() => {
  nativeStart.mockClear();
  nativeStop.mockClear();
  multiCamera.stop();
  nativeStop.mockClear();
});

test('a second start on a running session does not reach the native side', async () => {
  await multiCamera.start();
  await multiCamera.start();
  expect(nativeStart).toHaveBeenCalledTimes(1);
});

test('two starts at once share a single native build-up', async () => {
  const both = Promise.all([multiCamera.start(), multiCamera.start()]);
  await expect(both).resolves.toEqual([true, true]);
  expect(nativeStart).toHaveBeenCalledTimes(1);
});

test('after a stop the session may be built up again', async () => {
  await multiCamera.start();
  multiCamera.stop();
  await multiCamera.start();
  expect(nativeStart).toHaveBeenCalledTimes(2);
});
```

Wichtig: Wie das native Modul geholt wird, steht oben in `multiCamera.ts` (`getNativeModule`). Den Mock exakt daran ausrichten, statt `expo` blind zu mocken. Zuerst die Datei lesen.

- [ ] **Step 2: Test laeuft rot**

Run: `cd mobile && npx jest src/features/camera/__tests__/multiCamera.test.ts`
Expected: FAIL, `nativeStart` wurde zweimal aufgerufen.

- [ ] **Step 3: Implementieren**

`start` und `stop` in `multiCamera.ts` ersetzen:

```ts
// The session may be asked for from two sides now: the capture screen on
// focus, and the warm-up while a swipe is still under way (warmup.ts). A
// second `start()` on a running session would reach the native side as
// "already running", i.e. as a THROW, and two throws in a row switch the
// MultiCam path off for the rest of the app session (see
// MAX_CONSECUTIVE_FAILURES above). The latch holds the running build-up
// instead: whoever asks second gets the same promise, and the native side is
// asked exactly once.
let startPromise: Promise<boolean> | null = null;

export function start(): Promise<boolean> {
  if (failed) return Promise.resolve(false);
  if (startPromise) return startPromise;
  const m = getNativeModule();
  if (!m) return Promise.resolve(false);
  startPromise = m
    .start()
    .then(() => {
      consecutiveFailures = 0;
      return true;
    })
    .catch(() => {
      // A failed build-up leaves nothing running: release the latch, so the
      // next focus may try again (until `failed` cuts it off).
      startPromise = null;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) failed = true;
      return false;
    });
  return startPromise;
}

export function stop(): void {
  startPromise = null;
  void getNativeModule()
    ?.stop()
    .catch(() => {});
}
```

Die Signatur bleibt `Promise<boolean>`, alle Aufrufstellen (`void multiCamera.start().then(...)`) bleiben unveraendert.

- [ ] **Step 4: Test laeuft gruen**

Run: `cd mobile && npx jest src/features/camera`
Expected: PASS, alle Kamera-Tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/camera/multiCamera.ts mobile/src/features/camera/__tests__/multiCamera.test.ts
git commit -m "fix(camera): a second start no longer counts as a failed one"
```

---

### Task 6: Die eigene Tab-Leiste

Der Material-Navigator bringt eine andere Leiste mit (Indikator-Strich, Ripple, keine Icons). Diese hier haelt die heutige Optik und uebernimmt zusaetzlich das Vorwaerm-Signal, weil nur sie die Pager-Position sieht.

**Files:**
- Create: `mobile/src/features/navigation/TabBar.tsx`
- Test: `mobile/src/features/navigation/__tests__/TabBar.test.tsx`

**Interfaces:**
- Consumes: `barShape(segments, selectedTab, viewfinderVisible)` aus Task 3, `warmup.set` und `warmup.NEAR_ENOUGH` aus Task 4, `captureLock.isLocked` aus Task 2, `cinemaStage.barHeight`.
- Produces: `<TabBar {...materialTopTabBarProps} segments={...} />` als Standardexport `TabBar`.

- [ ] **Step 1: Failing test**

```tsx
import { render, fireEvent } from '@testing-library/react-native';
import { Animated } from 'react-native';
import * as React from 'react';
import { TabBar } from '../TabBar';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';
import * as warmup from '@/features/camera/warmup';

// The navigator hands the bar its state, the descriptors and the pager's
// position. Only what the bar actually reads is rebuilt here; a real
// navigator would drag the whole pager into a test that asks about colours
// and taps.
const ROUTES = ['capture', 'trip', 'recap', 'profile'];
function props(overrides: Partial<Record<string, unknown>> = {}) {
  const routes = ROUTES.map((name) => ({ key: `${name}-key`, name }));
  return {
    state: { index: 0, key: 'tabs', routes, preloadedRouteKeys: [] },
    descriptors: Object.fromEntries(routes.map((r) => [r.key, { options: {} }])),
    navigation: { emit: jest.fn(() => ({ defaultPrevented: false })) },
    position: new Animated.Value(0),
    jumpTo: jest.fn(),
    segments: ['(tabs)', 'capture'],
    ...overrides,
  } as never;
}

beforeEach(() => {
  captureLock.lock(false);
  cinemaStage.set(false);
  warmup.set(false);
});

test('it shows all four tabs with their german labels', () => {
  const { getByText } = render(<TabBar {...props()} />);
  ['Aufnehmen', 'Reise', 'Recap', 'Profil'].forEach((label) => expect(getByText(label)).toBeTruthy());
});

test('a tap jumps to the tab', () => {
  const p = props();
  const { getByText } = render(<TabBar {...p} />);
  fireEvent.press(getByText('Recap'));
  expect(p.jumpTo).toHaveBeenCalledWith('recap-key');
});

test('during a running capture a tap runs into nothing', () => {
  const p = props();
  const { getByText } = render(<TabBar {...p} />);
  captureLock.lock(true);
  fireEvent.press(getByText('Recap'));
  expect(p.jumpTo).not.toHaveBeenCalled();
});

test('a tap that a listener prevents jumps nowhere', () => {
  const p = props({ navigation: { emit: jest.fn(() => ({ defaultPrevented: true })) } });
  const { getByText } = render(<TabBar {...p} />);
  fireEvent.press(getByText('Recap'));
  expect(p.jumpTo).not.toHaveBeenCalled();
});

test('on the player route the bar disappears entirely', () => {
  const { queryByText } = render(<TabBar {...props({ segments: ['(tabs)', 'recap', '[id]', 'player'] })} />);
  expect(queryByText('Recap')).toBeNull();
});

test('over the viewfinder the bar becomes the translucent cinema one', () => {
  cinemaStage.set(true);
  const { getByTestId } = render(<TabBar {...props()} />);
  expect(getByTestId('tab-bar-cinema')).toBeTruthy();
});

test('without the viewfinder there is no translucent surface', () => {
  const { queryByTestId } = render(<TabBar {...props()} />);
  expect(queryByTestId('tab-bar-cinema')).toBeNull();
});

test('the pager position drives the camera warm-up', () => {
  const position = new Animated.Value(1);
  render(<TabBar {...props({ position, segments: ['(tabs)', 'trip'] })} />);
  expect(warmup.get()).toBe(false);
  // The finger drags from the trip tab (1) towards the camera (0).
  position.setValue(0.85);
  expect(warmup.get()).toBe(true);
  // Turning back: the session must not be dropped halfway.
  position.setValue(0.95);
  expect(warmup.get()).toBe(false);
});
```

- [ ] **Step 2: Test laeuft rot**

Run: `cd mobile && npx jest src/features/navigation/__tests__/TabBar.test.tsx`
Expected: FAIL, Modul nicht gefunden.

- [ ] **Step 3: Implementieren**

```tsx
import { useEffect, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Map, Play, User, type LucideProps } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, spacing, type } from '@/theme/tokens';
import * as captureLock from '@/features/camera/captureLock';
import * as cinemaStage from '@/features/camera/cinemaStage';
import * as warmup from '@/features/camera/warmup';
import { barShape } from './barShape';

// The tab bar, hand-built. The swipeable navigator (TopTabs) brings a
// material bar with an indicator stripe, a ripple and no icons; keeping
// DESIGN-LANGUAGE v2 §4 meant rendering it ourselves. The gain beyond the
// looks: the shape of the bar (hidden, cinema, plain) used to be a nested
// ternary inside `tabBarStyle`, it now reads as a component plus a plain
// function (barShape.ts).
type Route = { key: string; name: string };
type Props = {
  state: { index: number; routes: Route[] };
  navigation: { emit: (event: { type: string; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean } };
  /** The pager's live position, in tab widths. Drives the camera warm-up. */
  position: Animated.AnimatedInterpolation<number> | Animated.Value;
  jumpTo: (key: string) => void;
  /** The unnormalised path segments, as `useSegments()` hands them over. */
  segments: string[];
};

// UI language is german (DESIGN-LANGUAGE §6), everything else here english.
const TABS: Record<string, { label: string; Icon: (props: LucideProps) => React.ReactNode }> = {
  capture: { label: 'Aufnehmen', Icon: Camera },
  trip: { label: 'Reise', Icon: Map },
  recap: { label: 'Recap', Icon: Play },
  profile: { label: 'Profil', Icon: User },
};

const CAPTURE_TAB = 'capture';

export function TabBar({ state, navigation, position, jumpTo, segments }: Props) {
  const { colors } = useTheme();
  const { bottom } = useSafeAreaInsets();
  const viewfinderVisible = useSyncExternalStore(cinemaStage.subscribe, cinemaStage.get);
  const locked = useSyncExternalStore(captureLock.subscribe, captureLock.isLocked);
  const selectedTab = state.routes[state.index]?.name ?? '';
  const shape = barShape(segments, selectedTab, viewfinderVisible);

  // The camera session starts WITH the gesture, not when it ends: the pager
  // reports its position continuously, and the bar is the only place that
  // position is available. Without this the whole swipe would drag a black
  // surface into view, since the session only builds up on focus.
  //
  // A listener on an Animated node, deliberately not a re-render: this fires
  // on every frame of the drag. `warmup.set` swallows repeats, so the camera
  // screen only re-renders when the answer actually flips.
  const captureIndex = state.routes.findIndex((route) => route.name === CAPTURE_TAB);
  useEffect(() => {
    if (captureIndex < 0) return;
    const id = position.addListener(({ value }: { value: number }) => {
      warmup.set(Math.abs(value - captureIndex) < warmup.NEAR_ENOUGH);
    });
    return () => {
      position.removeListener(id);
      warmup.set(false);
    };
  }, [position, captureIndex]);

  if (shape === 'hidden') return null;

  const cinemaMode = shape === 'cinema';
  const height = cinemaStage.barHeight(bottom);
  return (
    <View
      style={[
        styles.bar,
        { height, paddingBottom: bottom },
        cinemaMode
          ? styles.cinemaBar
          : { backgroundColor: colors['bg-0'], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
      ]}
    >
      {/* DESIGN-LANGUAGE §1: UI on top of an image only translucent, exactly
          the pill recipe, only without rounding (§4). */}
      {cinemaMode && <Pill testID="tab-bar-cinema" style={StyleSheet.absoluteFill} pointerEvents="none" />}
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = index === state.index;
        const color = focused ? colors.accent : cinemaMode ? cinema['text-2'] : colors['text-2'];
        return (
          <Pressable
            key={route.key}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            onPress={() => {
              // The lock blocks the gesture through `swipeEnabled`; the tap
              // needs its own guard, otherwise the focus cleanup would fire
              // right into a running capture.
              if (captureLock.isLocked()) return;
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!event.defaultPrevented) jumpTo(route.key);
            }}
          >
            <tab.Icon color={color} strokeWidth={1.75} />
            <Text style={[type.tab, styles.label, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // The height comes from cinemaStage.barHeight and from nowhere else: the
  // camera screen lifts its lower controls by exactly this amount while the
  // bar lies over the viewfinder.
  bar: { flexDirection: 'row', paddingTop: cinemaStage.BAR_TOP_PADDING },
  cinemaBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: spacing.xs },
  label: { textAlign: 'center' },
});
```

Anmerkung fuer die Umsetzung: `locked` wird oben abonniert, damit die Leiste bei gesetzter Sperre neu rendert. Das Layout liest es nicht direkt, `swipeEnabled` in Task 7 tut es. Wenn ESLint die ungenutzte Variable bemaengelt, das Abonnement stattdessen in `_layout.tsx` fuehren und die Zeile hier streichen.

- [ ] **Step 4: Test laeuft gruen**

Run: `cd mobile && npx jest src/features/navigation/__tests__/TabBar.test.tsx`
Expected: PASS, 8 Tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/navigation/TabBar.tsx mobile/src/features/navigation/__tests__/TabBar.test.tsx
git commit -m "feat(nav): the tab bar as a component of our own, with the camera warm-up"
```

---

### Task 7: Der Navigator wechselt

**Files:**
- Modify: `mobile/src/app/(tabs)/_layout.tsx` (vollstaendig ersetzen)
- Modify: `mobile/src/app/(tabs)/__tests__/_layout.test.tsx` (vollstaendig ersetzen)

**Interfaces:**
- Consumes: `TabBar` aus Task 6, `swipeAllowed` aus Task 3, `captureLock.subscribe` aus Task 2.
- Produces: der Tab-Navigator der App.

- [ ] **Step 1: Failing test**

Die alte Testdatei prueft `tabBarStyle`, das es nicht mehr gibt. Ihre Aussagen leben in `barShape.test.ts` weiter. Was hier bleibt, ist die Verdrahtung:

```tsx
import { render } from '@testing-library/react-native';
import * as React from 'react';
import * as captureLock from '@/features/camera/captureLock';

// TopTabs is mocked completely: the goal here is solely WHICH options the
// layout hands the navigator. A real render would drag the pager, the scene
// layout and the safe area in, and would only add noise to an assertion
// about one boolean.
let lastProps: { screenOptions?: unknown; tabBar?: unknown; tabBarPosition?: string } | undefined;
const mockUseSegments = jest.fn(() => ['(tabs)', 'capture'] as string[]);
jest.mock('expo-router/js-top-tabs', () => {
  function TopTabs(props: Record<string, unknown>) {
    lastProps = props;
    return null;
  }
  TopTabs.Screen = () => null;
  return { __esModule: true, TopTabs, default: TopTabs };
});
jest.mock('expo-router', () => ({ useSegments: () => mockUseSegments() }));

import TabsLayout from '../_layout';

type Options = { swipeEnabled?: boolean; lazy?: boolean };
function optionsFor(routeName: string): Options {
  const screenOptions = lastProps?.screenOptions;
  if (typeof screenOptions === 'function') {
    return (screenOptions as (ctx: { route: { name: string } }) => Options)({ route: { name: routeName } });
  }
  return (screenOptions ?? {}) as Options;
}

beforeEach(() => {
  lastProps = undefined;
  mockUseSegments.mockReturnValue(['(tabs)', 'capture']);
  captureLock.lock(false);
});

test('the bar sits at the bottom, where it always sat', async () => {
  await render(<TabsLayout />);
  expect(lastProps?.tabBarPosition).toBe('bottom');
});

test('the navigator renders our own bar, not the material one', async () => {
  await render(<TabsLayout />);
  expect(typeof lastProps?.tabBar).toBe('function');
});

test('on a root screen the tabs may be swiped', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'trip']);
  await render(<TabsLayout />);
  expect(optionsFor('trip').swipeEnabled).toBe(true);
});

test('inside a nested stack swiping is off: the back swipe owns the gesture', async () => {
  mockUseSegments.mockReturnValue(['(tabs)', 'trip', '[id]']);
  await render(<TabsLayout />);
  expect(optionsFor('trip').swipeEnabled).toBe(false);
});

test('during a running capture swiping is off', async () => {
  captureLock.lock(true);
  mockUseSegments.mockReturnValue(['(tabs)', 'capture']);
  await render(<TabsLayout />);
  expect(optionsFor('capture').swipeEnabled).toBe(false);
});

test('the screens stay mounted, so the neighbour is there while dragging', async () => {
  await render(<TabsLayout />);
  expect(optionsFor('trip').lazy).not.toBe(true);
});
```

- [ ] **Step 2: Test laeuft rot**

Run: `cd mobile && npx jest src/app/\(tabs\)/__tests__/_layout.test.tsx`
Expected: FAIL, das Layout rendert noch `Tabs`.

- [ ] **Step 3: Implementieren**

`mobile/src/app/(tabs)/_layout.tsx` vollstaendig ersetzen:

```tsx
import { useSyncExternalStore } from 'react';
import { useSegments } from 'expo-router';
import { TopTabs } from 'expo-router/js-top-tabs';
import { useTheme } from '@/theme/ThemeProvider';
import { TabBar } from '@/features/navigation/TabBar';
import { swipeAllowed } from '@/features/navigation/barShape';
import * as captureLock from '@/features/camera/captureLock';

// The tabs can be swiped (like Snapchat): TopTabs is the navigator expo-router
// ships that drags the content along with the finger, over
// react-native-tab-view; the bottom tabs it replaces knew taps only. The bar
// stays at the bottom (tabBarPosition) and is ours (TabBar.tsx): the material
// bar underneath brings an indicator stripe, a ripple and no icons, none of
// which DESIGN-LANGUAGE v2 §4 wants.
export default function TabsLayout() {
  const { colors } = useTheme();
  // `useSegments()` supplies the UNNORMALISED file path segments (cast as in
  // app/_layout.tsx: with `experiments.typedRoutes` the return type would
  // otherwise narrow to a fixed tuple, runtime behaviour unchanged). Both the
  // shape of the bar and the swipe permission hang off them.
  const segments = useSegments() as string[];
  // The lock is read while RENDERING here, unlike the tap listener it
  // replaces, hence the subscription (captureLock.ts): a swipe during a
  // running capture would fire the focus cleanup into the live session.
  const locked = useSyncExternalStore(captureLock.subscribe, captureLock.isLocked);
  const swipeEnabled = swipeAllowed(segments) && !locked;
  return (
    <TopTabs
      tabBarPosition="bottom"
      tabBar={(props) => <TabBar {...props} segments={segments} />}
      screenOptions={{
        // Every screen stays mounted, so the neighbour is already there while
        // the finger drags instead of appearing empty. What that costs is
        // limited: the screens hang their loading on useFocusEffect, which
        // still fires for the focused one only. The camera is the exception
        // and starts with the gesture (features/camera/warmup.ts).
        lazy: false,
        swipeEnabled,
        sceneStyle: { backgroundColor: colors['bg-0'] },
      }}
    >
      <TopTabs.Screen name="capture" />
      <TopTabs.Screen name="trip" />
      <TopTabs.Screen name="recap" />
      <TopTabs.Screen name="profile" />
    </TopTabs>
  );
}
```

Sollte `swipeEnabled` als Objekt-Option nicht durchgreifen (der Navigator liest sie von den Optionen des FOKUSSIERTEN Screens), stattdessen `screenOptions={() => ({...})}` als Funktion schreiben. Der Test in Schritt 1 deckt beide Formen ab.

- [ ] **Step 4: Test laeuft gruen**

Run: `cd mobile && npx jest src/app/\(tabs\)/__tests__/_layout.test.tsx`
Expected: PASS, 6 Tests.

- [ ] **Step 5: Ganze Suite**

Run: `cd mobile && npm test`
Expected: PASS. Tests, die den alten Navigator mockten, hier mitziehen.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/app/\(tabs\)/_layout.tsx mobile/src/app/\(tabs\)/__tests__/_layout.test.tsx
git commit -m "feat(nav): the tabs can be swiped, content follows the finger"
```

---

### Task 8: Die Kamera hoert auf das Vorwaerm-Signal

**Files:**
- Modify: `mobile/src/app/(tabs)/capture/index.tsx:828-838` (der Session-Effekt)
- Test: `mobile/src/app/(tabs)/capture/__tests__/camera.test.tsx`

**Interfaces:**
- Consumes: `warmup.get`, `warmup.subscribe` aus Task 4; der abgesicherte `multiCamera.start` aus Task 5.

- [ ] **Step 1: Failing test**

Zur bestehenden `camera.test.tsx` hinzufuegen (deren Mock-Bauart uebernehmen, sie mockt `multiCamera` bereits):

```tsx
test('the session starts while the swipe is still under way, before focus', async () => {
  warmup.set(true);
  render(<CaptureScreen />);
  await waitFor(() => expect(multiCamera.start).toHaveBeenCalled());
});

test('a cancelled swipe stops the session again', async () => {
  warmup.set(true);
  render(<CaptureScreen />);
  await waitFor(() => expect(multiCamera.start).toHaveBeenCalled());
  warmup.set(false);
  await waitFor(() => expect(multiCamera.stop).toHaveBeenCalled());
});

test('the warm-up falling away does not stop a session the focus is holding', async () => {
  // The finger swipes AWAY from the camera and turns back: the flag drops
  // for a moment while focus stays. Restarting the session there would be
  // the most expensive moment of all.
  warmup.set(true);
  render(<CaptureScreen />);
  await act(async () => mockFocusCycle());
  multiCamera.stop.mockClear();
  warmup.set(false);
  await waitFor(() => expect(multiCamera.stop).not.toHaveBeenCalled());
});
```

Der letzte Test braucht den Fokus-Mock der Datei. Wie dort `useFocusEffect` nachgebildet wird, steht in `camera.test.tsx:22-32`; daran ausrichten.

- [ ] **Step 2: Test laeuft rot**

Run: `cd mobile && npx jest src/app/\(tabs\)/capture/__tests__/camera.test.tsx`
Expected: FAIL, `start` wurde ohne Fokus nicht gerufen.

- [ ] **Step 3: Implementieren**

In `capture/index.tsx` das Vorwaerm-Signal lesen (bei den uebrigen Hooks oben):

```tsx
const warm = useSyncExternalStore(warmup.subscribe, warmup.get);
// The session is wanted as soon as the screen holds focus OR a swipe is
// dragging it into view. Deliberately ONE derived boolean and not two
// dependencies: while the swipe finishes, `warm` and `focused` hand over to
// each other, and a dependency on both would tear the session down and build
// it right back up in that exact moment.
const sessionWanted = focused || warm;
```

Den Session-Effekt (heute `useFocusEffect`, Zeilen 828-838) ersetzen durch:

```tsx
// The lifecycle of the MultiCam session (spec §8/§9). It hangs on
// `sessionWanted` rather than on focus alone, because the tabs can be
// swiped: the screen arrives gradually, and waiting for focus would drag a
// black surface through the whole gesture.
//
// On build-up: if it reports `false` (no module, old build, simulator, or a
// setup that failed twice in a row), the screen falls back to expo-camera for
// the REST of the session. The active ref shields the answer that only
// arrives after leaving the screen.
//
// On tear-down it is stopped ONLY if nothing rests on the session any more,
// following exactly the conditions of the mute prop in the other branch:
// under the CAPTURE PREVIEW it keeps running (a rebuild would be the most
// expensive moment of all on the instant way back), and nobody reaches into
// a running capture anyway.
useEffect(() => {
  if (!multiCam || !sessionWanted) return;
  void multiCamera.start().then((ok) => {
    if (!ok && active.current) setMultiCam(false);
  });
  return () => {
    if (!capturingRef.current && !inPreviewRef.current) multiCamera.stop();
  };
}, [multiCam, sessionWanted]);
```

Import ergaenzen: `import * as warmup from '@/features/camera/warmup';` und `useSyncExternalStore` aus `react`.

Achtung: `focused` ist bereits vorhandener State (gesetzt im grossen `useFocusEffect`, Zeile 720/742). Keinen zweiten Fokus-Zustand einfuehren.

- [ ] **Step 4: Test laeuft gruen**

Run: `cd mobile && npx jest src/app/\(tabs\)/capture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/capture/index.tsx mobile/src/app/\(tabs\)/capture/__tests__/camera.test.tsx
git commit -m "feat(camera): the session builds up while the swipe is still running"
```

---

### Task 9: Abnahme

Jest sieht hier grundsaetzlich nicht, was zaehlt: ob sich die Geste richtig anfuehlt, ob der Sucher rechtzeitig steht, ob die Leiste sitzt.

- [ ] **Step 1: Statische Pruefung**

```bash
cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npm test
```

Erwartet: kein Fehler. ESLint ueber `src` ganz, nicht nur ueber die geaenderten Dateien (Projektgedaechtnis: 29 vorbestehende Fehler sind bekannt, die Zahl darf nicht wachsen).

- [ ] **Step 2: Neuer Build aufs Geraet**

```bash
cd mobile && npx expo run:ios --device
```

Der Pager ist nativ, ein Metro-Neustart allein genuegt nicht.

- [ ] **Step 3: Prueflise am Geraet abarbeiten**

- [ ] Von Reise nach links wischen landet im Recap, der Inhalt haengt am Finger.
- [ ] Ein zu kurzer Wisch faellt zurueck, ohne den Tab zu wechseln.
- [ ] Die Leiste sieht aus wie vorher: Hairline, Farben, Hoehe, Abstand zum Home-Indikator.
- [ ] Ueber dem Sucher ist die Leiste translucent und liegt auf dem Bild, das Bild wirkt genauso gross wie vorher.
- [ ] Von Reise Richtung Kamera wischen zeigt einen stehenden Sucher, keine schwarze Flaeche.
- [ ] Im Sucher funktionieren Tap-to-Focus und der Zwei-Finger-Zoom weiterhin. **Das ist die riskante Stelle:** die Zoom-Flaeche beansprucht Einzelberuehrungen sofort (`capture/index.tsx:1285`). Klemmt der Wisch im Kamera-Tab, `onStartShouldSetResponder` auf reine Tap-Erkennung umstellen und die Bewegung dem Pager lassen.
- [ ] Waehrend einer laufenden Video-Aufnahme laesst sich weder tippen noch wischen.
- [ ] In der Reise-Detailansicht wechselt ein horizontaler Wisch keinen Tab, der Zurueck-Wisch funktioniert.
- [ ] Im Recap-Player ist keine Leiste zu sehen.
- [ ] Ein Tipp auf den bereits aktiven Tab: prueft, ob er wie bisher zur Wurzel des Stacks zurueckkehrt. Der Bottom-Tab-Navigator machte das von sich aus, der Pager tut es womoeglich nicht. Falls das Verhalten fehlt, in `TabBar.tsx` im `onPress` ergaenzen: bei `focused` statt `jumpTo` ein `navigation.dispatch(StackActions.popToTop())` auf den verschachtelten Stack.
- [ ] Nach dem Auslöser: die Vorschau kommt, der Weg zurueck zeigt sofort ein Live-Bild.

- [ ] **Step 4: Commit der Nacharbeiten**

```bash
git add -A mobile/src
git commit -m "fix(nav): what the device run turned up"
```

## Selbstpruefung des Plans

- **Abdeckung:** Wisch-Gefuehl (Task 1, 7), Umfang der Geste (Task 3, 7), Sperre waehrend der Aufnahme (Task 2, 6, 7), Kamera-Vorwaermung (Task 4, 5, 8), Optik der Leiste (Task 6), Abnahme (Task 9).
- **Offene Unsicherheiten, bewusst als Pruefpunkte statt als Behauptung:** ob `position.addListener` unter nativem Treiber feuert (Task 6, faellt sonst sanft auf das heutige Verhalten zurueck), ob `swipeEnabled` als Objekt-Option greift (Task 7), ob der Tipp auf den aktiven Tab den Stack zuruecksetzt (Task 9), und ob die Zoom-Flaeche den Wisch durchlaesst (Task 9).
- **Namen durchgaengig:** `barShape`, `swipeAllowed`, `warmup.set/get/subscribe/NEAR_ENOUGH`, `captureLock.subscribe`, `cinemaStage.barHeight`, `TabBar`.
