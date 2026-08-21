# Recap als Show: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Tap auf die Recap-Karte startet die Vollbild-Show mit dem Siegel als erster Kino-Karte, und die Recap-Übersicht danach zeigt Foto-Hero und Tages-Mosaik statt Popcorn und gleichförmigem Raster.

**Architecture:** Der bestehende Player bekommt zwei aus der Route abgeleitete Betriebsarten (Show mit Siegel, Sprung ohne). Alle Layout- und Modus-Entscheidungen werden als reine Funktionen in `mobile/src/features/recap/` gebaut und dort getestet; die Screens bleiben Darstellung. Für echte Cover kommt eine neue Action `covers` in die bestehende Edge Function `media-urls`, mit derselben Zugriffskette wie `read`. Keine Migration.

**Tech Stack:** Expo/React Native (TypeScript strict), expo-router, expo-image, expo-blur, Skia (nur die bestehende SealPeel), Jest + @testing-library/react-native, Deno-Tests für die Edge Function.

**Spec:** `docs/superpowers/specs/2026-08-21-recap-show-design.md`

## Global Constraints

- **Quellcode englisch:** Bezeichner, Dateinamen, Kommentare, Testbeschreibungen. Nur sichtbare UI-Texte sind deutsch (Du-Form). Persistente Keys, Wire-Felder und Log-Texte zählen zum Code.
- **DESIGN-LANGUAGE.md schlägt Geschmack und Framework-Defaults.** Radius nur 12 / 24 / 999. Abstände nur aus `spacing` (4 · 8 · 12 · 16 · 24 · 32 · 48). Farben nur über Tokens (`palette` / `cinema`), nie als Hex im Code.
- **Keine Gedankenstriche (—) in sichtbarem Text**, auch nicht in Vorlese-Beschriftungen.
- **Foto-Scrims sind der einzige erlaubte Gradient.** UI auf Fotos ausschliesslich als translucente Pille (`Pill`-Komponente).
- **Beiträge sortieren IMMER nach `captured_at`.** Das Mosaik ändert Kachelgrössen, nie die Reihenfolge.
- **Versiegelung serverseitig erzwungen.** Die neue `covers`-Action prüft dieselbe Kette wie `read` und darf kein Orakel für fremde Reise-IDs werden.
- **Kommandos:** Tests `cd mobile && npx jest <pfad>`; Lint `cd mobile && npx eslint src` (immer ganz `src`, nie nur die eigene Datei); Deno `cd supabase/functions/media-urls && deno test --allow-none <datei>`.
- **Vorbestehende ESLint-Fehler:** In `src` stehen noch etwa 29 Fehler aus früheren Phasen. Neue Dateien müssen sauber sein, die Gesamtzahl darf nicht steigen.

---

## Dateien

**Neu:**
- `mobile/src/features/recap/playerEntry.ts`: Ableitung des Betriebsmodus aus dem `start`-Parameter
- `mobile/src/features/recap/__tests__/playerEntry.test.ts`
- `mobile/src/features/recap/mosaic.ts`: Kachelmuster je Tag
- `mobile/src/features/recap/__tests__/mosaic.test.ts`
- `mobile/src/features/recap/coversApi.ts`: Client für die neue `covers`-Action
- `mobile/src/features/recap/__tests__/coversApi.test.ts`
- `mobile/src/components/RecapHero.tsx`: Foto-Hero der Übersicht
- `mobile/src/components/__tests__/RecapHero.test.tsx`
- `supabase/functions/media-urls/covers.ts`: reine Auswahl-Logik der Action
- `supabase/functions/media-urls/covers_test.ts`

**Geändert:**
- `mobile/src/app/(tabs)/recap/[id]/player.tsx`: Siegel-Karte, Zwischenkarten, Ende, Verlassen
- `mobile/src/app/(tabs)/recap/[id]/overview.tsx`: Hero, Mosaik, Siegel und Popcorn raus
- `mobile/src/app/(tabs)/recap/index.tsx`: Tap führt in den Player, Cover werden geladen
- `mobile/src/components/TripCard.tsx`: Scrim und translucente Pille statt hellem Pill
- `mobile/src/components/TripCover.tsx`: nimmt eine Foto-URL entgegen
- `supabase/functions/media-urls/index.ts`: neue Action `covers`
- Die zugehörigen Testdateien in `mobile/src/app/(tabs)/recap/__tests__/`

---

## Task 1: Betriebsmodus des Players

**Files:**
- Create: `mobile/src/features/recap/playerEntry.ts`
- Test: `mobile/src/features/recap/__tests__/playerEntry.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `export type PlayerMode = 'show' | 'jump'` und `export function playerMode(startParam: string | undefined): PlayerMode`

Der Player wird auf zwei Arten betreten. Vom Recap-Tab aus ohne `start`-Parameter: das ist die Show, sie beginnt mit dem Siegel und verlässt sich am Ende per `replace` auf die Übersicht. Aus der Übersicht heraus mit `start`: das ist ein Sprung, ohne Siegel, zurück per `back`.

Die Falle, wegen der das eine eigene Funktion mit eigenen Tests wird: `start=0` ist ein gültiger Sprung (die Pille "Nochmal ansehen" und die erste Kachel setzen ihn). Eine Prüfung auf Wahrheitswert würde die Null als "fehlt" lesen und dem Wiederholen aus der Übersicht ein Siegel vorsetzen.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/features/recap/__tests__/playerEntry.test.ts
import { playerMode } from '../playerEntry';

test('without a start parameter the player runs as a show', () => {
  expect(playerMode(undefined)).toBe('show');
});

test('start=0 is a jump, not a show: the overview repeats from the first moment', () => {
  expect(playerMode('0')).toBe('jump');
});

test('any other start index is a jump as well', () => {
  expect(playerMode('7')).toBe('jump');
});

test('an empty string counts as missing, the route carries no usable index', () => {
  expect(playerMode('')).toBe('show');
});

test('unusable text falls back to the show, the same way parseStartIndex falls back to 0', () => {
  expect(playerMode('abc')).toBe('show');
  expect(playerMode('-1')).toBe('show');
  expect(playerMode('1.5')).toBe('show');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/features/recap/__tests__/playerEntry.test.ts`
Expected: FAIL, `Cannot find module '../playerEntry'`

- [ ] **Step 3: Write minimal implementation**

Die Prüfung muss dieselbe Gültigkeitsregel verwenden wie `parseStartIndex` in `player.tsx` (endliche, nicht negative Ganzzahl), sonst driften die beiden auseinander: ein Wert, den `parseStartIndex` auf 0 zurückfallen lässt, würde hier sonst als Sprung gelten und das Siegel unterschlagen. Die Längenprüfung bleibt bei `parseStartIndex`, die Länge ist hier noch nicht bekannt.

```typescript
// mobile/src/features/recap/playerEntry.ts
export type PlayerMode = 'show' | 'jump';

export function playerMode(startParam: string | undefined): PlayerMode {
  if (startParam === undefined || startParam === '') return 'show';
  const n = Number(startParam);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 'show';
  return 'jump';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/features/recap/__tests__/playerEntry.test.ts`
Expected: PASS, 5 Tests

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/recap/playerEntry.ts mobile/src/features/recap/__tests__/playerEntry.test.ts
git commit -m "feat(recap): player mode derived from the start parameter"
```

---

## Task 2: Das Siegel als erste Karte der Show

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/player.tsx`
- Test: `mobile/src/app/(tabs)/recap/__tests__/player.test.tsx`

**Interfaces:**
- Consumes: `playerMode` aus Task 1, die bestehende `SealPeel`-Komponente (`{ size: number; onPeeled: () => void; testID?: string }`)
- Produces: testID `player-seal` für die Siegel-Bühne im Player

Im Show-Modus steht vor dem ersten Moment das Siegel formatfüllend auf `cinema-0`. Solange es steht, läuft kein Fortschrittsbalken, kein Auto-Advance-Timer und keine Tap-Zone; darunter lädt der Player bereits.

Der einfachste Weg, der die bestehende Zustandsmaschine nicht anfasst: ein eigener `sealed`-Zustand, der VOR der `phase`-Auswertung gerendert wird. Weil er vor allen anderen Rückgaben steht, greift von der Player-Mechanik in dieser Zeit ohnehin nichts.

Zwei Ausnahmen, die im Test festgehalten werden: Bei `phase === 'error'` und `phase === 'empty'` wird das Siegel übersprungen. Ein Siegel, hinter dem nichts steht, wäre ein gebrochenes Versprechen.

- [ ] **Step 1: Write the failing test**

Der Player-Test mockt bereits `expo-router`, `expo-image` und die APIs. Ergänze am Kopf der Datei den SealPeel-Mock (wortgleich zu dem in `overview.test.tsx`, damit beide Dateien dieselbe Attrappe verwenden) und stelle sicher, dass `useLocalSearchParams` pro Test gesetzt werden kann.

```typescript
// mobile/src/app/(tabs)/recap/__tests__/player.test.tsx, am Kopf ergaenzen
let mockSealAutoPeel = true;
jest.mock('@/components/SealPeel', () => {
  const ReactActual = require('react');
  const { Pressable } = require('react-native');
  return {
    SealPeel: ({ size, onPeeled, testID }: { size: number; onPeeled: () => void; testID?: string }) => {
      ReactActual.useEffect(() => {
        if (mockSealAutoPeel) onPeeled();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return ReactActual.createElement(Pressable, {
        testID, accessibilityRole: 'button', accessibilityLabel: 'Siegel abziehen',
        onPress: onPeeled, style: { width: size, height: size },
      });
    },
  };
});
```

```typescript
// eigener describe-Block, mockSealAutoPeel = false, damit das Siegel stehen bleibt
describe('the seal in front of the show', () => {
  beforeEach(() => { mockSealAutoPeel = false; });
  afterEach(() => { mockSealAutoPeel = true; });

  test('entering without a start parameter the seal stands in front of the reel', async () => {
    // Route ohne `start`: Show-Modus
    mockParams = { id: 't1' };
    await wrap();
    expect(await screen.findByTestId('player-seal')).toBeTruthy();
    expect(screen.getByText('Dein Recap ist versiegelt. Tipp aufs Siegel, um ihn zu öffnen.')).toBeTruthy();
    expect(screen.queryByTestId('player-ready')).toBeNull();
  });

  test('peeled off, the reel runs', async () => {
    mockParams = { id: 't1' };
    await wrap();
    fireEvent.press(await screen.findByTestId('player-seal'));
    expect(await screen.findByTestId('player-ready')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('entering with a start parameter no seal stands, the jump comes from the overview', async () => {
    mockParams = { id: 't1', start: '2' };
    await wrap();
    expect(await screen.findByTestId('player-ready')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('start=0 is a jump too, repeating from the overview gets no second seal', async () => {
    mockParams = { id: 't1', start: '0' };
    await wrap();
    expect(await screen.findByTestId('player-ready')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('a load error skips the seal: nothing stands behind it', async () => {
    (fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null });
    (getPool as jest.Mock).mockResolvedValue({ pool: null, error: null, reason: null });
    mockParams = { id: 't1' };
    await wrap();
    expect(await screen.findByTestId('player-error')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });

  test('an empty reel skips the seal as well', async () => {
    (fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null });
    (getPool as jest.Mock).mockResolvedValue({
      pool: { urls: new Map(), validUntil: Date.now() + 999_999, skipped: 0 }, error: null, reason: null,
    });
    mockParams = { id: 't1' };
    await wrap();
    expect(await screen.findByTestId('player-empty')).toBeTruthy();
    expect(screen.queryByTestId('player-seal')).toBeNull();
  });
});
```

Die Datei bringt alles Nötige schon mit: `mockParams` (wird in `beforeEach` auf `{ id: 't1' }` zurückgesetzt), den Helfer `wrap()`, der rendert und die drei parallelen Ladeaufrufe abwarten lässt, sowie `mockPush`, `mockReplace`, `mockBack` und `mockCanGoBack`. Setze `mockParams` VOR `wrap()`, sonst liest der erste Render den alten Wert.

Für den Fehler- und den Leer-Fall gelten dieselben Mocks wie in `describe('loading and edge cases')`: Fehler über `(fetchTrip as jest.Mock).mockResolvedValue({ data: null, error: null })`, leer über `(fetchRecapMoments as jest.Mock).mockResolvedValue({ data: [], error: null })` zusammen mit einem Pool ohne URLs.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/player.test.tsx -t "seal in front of the show"`
Expected: FAIL, `player-seal` wird nicht gefunden

- [ ] **Step 3: Write minimal implementation**

In `player.tsx`:

1. `playerMode` importieren und einmal aus `startParam` ableiten.
2. Einen Zustand `const [sealed, setSealed] = useState(() => playerMode(startParam) === 'show')` anlegen. Als Initialwert einer `useState`, nicht als Effekt: sonst stünde für einen Frame der Player ohne Siegel da.
3. Die Siegel-Bühne VOR `if (phase === 'loading')` zurückgeben, aber NACH den beiden Abbruchfällen:

```tsx
if (sealed && phase !== 'error' && phase !== 'empty') {
  return (
    <View testID="player-seal-stage" style={[styles.screen, styles.center]}>
      <SealPeel testID="player-seal" size={sealStageSize} onPeeled={() => setSealed(false)} />
      <Text style={[type.body, styles.centeredTextSecondary, { marginTop: spacing.l }]}>
        Dein Recap ist versiegelt. Tipp aufs Siegel, um ihn zu öffnen.
      </Text>
    </View>
  );
}
```

Der Test greift `player-seal` (die Bühne heisst anders, damit der Tap wirklich auf dem Siegel landet). `sealStageSize` kommt aus `useWindowDimensions()`, gedeckelt wie in `overview.tsx`: `Math.min(width - 2 * spacing.screen, 416)`. Den Grund für die 416 (Schärfegrenze der Quelle) im Kommentar nennen, nicht den Wert doppelt erklären.

Die Kino-Palette gilt: `styles.screen` trägt bereits `cinema['bg-0']`, der Hinweistext `cinema['text-2']` über den vorhandenen `centeredTextSecondary`-Stil.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/player.test.tsx`
Expected: PASS, die neuen und alle bestehenden Tests der Datei

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/recap/\[id\]/player.tsx mobile/src/app/\(tabs\)/recap/__tests__/player.test.tsx
git commit -m "feat(recap): seal opens the show inside the player"
```

---

## Task 3: Zwischenkarten zweizeilig

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/player.tsx` (die Zwischenkarte im Render, heute ein `type.h1` mit `dayHeading(currentDay)`)
- Test: `mobile/src/app/(tabs)/recap/__tests__/player.test.tsx`

**Interfaces:**
- Consumes: die vorhandenen lokalen Helfer `dayHeading` und `formatDayDate` in `player.tsx`
- Produces: nichts für spätere Tasks

Aus "Tag 3 · Lissabon · 12. August" in einer Zeile wird eine Staffelung: "Tag 3" gross, darunter "Lissabon · 12. August" sekundär. Ohne Ort steht unten nur das Datum. Dauer (1,5 s) und Tap zum Überspringen bleiben.

- [ ] **Step 1: Write the failing test**

```typescript
test('the interstitial card stages day number above place and date', async () => {
  // MOMENTS und POOL_OK der Datei tragen bereits mehrere Tage; die Zwischenkarte
  // steht per Definition vor dem ERSTEN Moment (dayChanges liefert bei index 0 true).
  mockParams = { id: 't1' };
    await wrap();
  expect(await screen.findByTestId('player-interstitial')).toBeTruthy();
  expect(screen.getByText('Tag 1')).toBeTruthy();
  expect(screen.getByText('Lissabon · 1. August')).toBeTruthy();
  // die alte Einzeile darf es nicht mehr geben
  expect(screen.queryByText('Tag 1 · Lissabon · 1. August')).toBeNull();
});

test('without a place the card carries day number and date alone', async () => {
  // derselbe Aufbau, place_name auf null
  mockParams = { id: 't1' };
    await wrap();
  expect(await screen.findByTestId('player-interstitial')).toBeTruthy();
  expect(screen.getByText('Tag 1')).toBeTruthy();
  expect(screen.getByText('1. August')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/player.test.tsx -t "interstitial card stages"`
Expected: FAIL, `Tag 1` allein wird nicht gefunden (heute steht dort die zusammengesetzte Zeile)

- [ ] **Step 3: Write minimal implementation**

Neben `dayHeading` eine zweite lokale Funktion setzen, die den Untertitel liefert, und die Karte zweizeilig rendern:

```tsx
function daySubheading(day: RecapDay): string {
  const date = formatDayDate(day.date);
  return day.place ? `${day.place} · ${date}` : date;
}
```

```tsx
{interstitial && (
  <Pressable testID="player-interstitial" style={styles.interstitial} onPress={skip}>
    <Text style={[type.h1, styles.centeredText]}>
      {currentDay ? `Tag ${currentDay.number}` : 'Ein neuer Tag'}
    </Text>
    {currentDay && (
      <Text style={[type.secondary, styles.centeredTextSecondary, { marginTop: spacing.s }]}>
        {daySubheading(currentDay)}
      </Text>
    )}
  </Pressable>
)}
```

`dayHeading` wird dadurch in `player.tsx` womöglich unbenutzt. Ist das der Fall, entferne es samt seinem Kommentar; ESLint meldet es sonst.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/player.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/recap/\[id\]/player.tsx mobile/src/app/\(tabs\)/recap/__tests__/player.test.tsx
git commit -m "feat(recap): interstitial card stages day number above place and date"
```

---

## Task 4: Das Ende der Show

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/player.tsx` (der `phase === 'ended'`-Block und `close`)
- Test: `mobile/src/app/(tabs)/recap/__tests__/player.test.tsx`

**Interfaces:**
- Consumes: `playerMode` aus Task 1
- Produces: nichts für spätere Tasks

Im Show-Modus verliert die End-Karte ihren Button: Nach 2000 ms fährt der Player selbst auf die Übersicht, per `replace`, damit der Zurück-Weg von dort in den Tab führt und nicht in einen abgespielten Player. Ein Tap auf die Karte geht sofort dorthin. Auch das Verlassen mittendrin (X, Swipe nach unten) nutzt im Show-Modus `replace`.

Im Sprung-Modus bleibt alles wie heute: Button, und zurück per `back`.

- [ ] **Step 1: Write the failing test**

```typescript
test('the show ends by itself on the overview after the end card', async () => {
  jest.useFakeTimers();
  mockParams = { id: 't1' };
    await wrap();
  // Bis ans Ende tappen: die rechte Tap-Zone (`player-right`) so oft druecken,
  // wie POOL_OK Momente traegt. Die Datei hat dafuer bereits einen Ende-Test,
  // dessen Tap-Schleife uebernommen werden kann.
  expect(await screen.findByTestId('player-end')).toBeTruthy();
  expect(screen.queryByText('Zurück zur Übersicht')).toBeNull();
  act(() => { jest.advanceTimersByTime(2000); });
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/recap/[id]/overview', params: { id: 't1' },
  });
  jest.useRealTimers();
});

test('a tap on the end card does not wait for the timer', async () => {
  jest.useFakeTimers();
  mockParams = { id: 't1' };
    await wrap();
  fireEvent.press(await screen.findByTestId('player-end'));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/recap/[id]/overview', params: { id: 't1' },
  });
  jest.useRealTimers();
});

test('leaving the show midway lands on the overview, not back in the tab', async () => {
  mockParams = { id: 't1' };
    await wrap();
  fireEvent.press(await screen.findByTestId('player-close'));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/recap/[id]/overview', params: { id: 't1' },
  });
  expect(mockBack).not.toHaveBeenCalled();
});

test('after a jump from the overview the end card keeps its button and goes back', async () => {
  mockParams = { id: 't1', start: '0' };
    await wrap();
  // bis ans Ende tappen
  expect(await screen.findByTestId('player-end')).toBeTruthy();
  fireEvent.press(screen.getByText('Zurück zur Übersicht'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
```

Der `expo-router`-Mock der Datei muss dafür `replace` als eigenen Spy führen (heute steht dort teils ein anonymes `jest.fn()`), und `mockBack` muss ebenfalls greifbar sein. Den testID `player-close` trägt die bestehende Schliessen-Pille; prüfe ihren tatsächlichen Namen in der Datei und verwende ihn.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/player.test.tsx -t "show ends by itself"`
Expected: FAIL, `replace` wird nicht aufgerufen

- [ ] **Step 3: Write minimal implementation**

```tsx
const mode = playerMode(startParam);

const toOverview = useCallback(() => {
  router.replace({ pathname: '/recap/[id]/overview', params: { id: tripId } });
}, [router, tripId]);

const close = () => {
  if (mode === 'show') { toOverview(); return; }
  if (router.canGoBack()) router.back();
  else router.replace('/recap');
};
```

Den `ended`-Block um einen Timer ergänzen, der nur im Show-Modus läuft, und die Karte tappbar machen:

```tsx
const END_CARD_MS = 2000;

useEffect(() => {
  if (phase !== 'ended' || mode !== 'show') return;
  const t = setTimeout(toOverview, END_CARD_MS);
  return () => clearTimeout(t);
}, [phase, mode, toOverview]);
```

Im Render: Im Show-Modus die `View` durch ein `Pressable` mit `onPress={toOverview}` ersetzen und den `CinemaButton` weglassen; im Sprung-Modus bleibt der Block wie er ist.

Die Wartezeit ist eine Lesezeit, keine Animation: `useReducedMotion()` darf sie nicht verkürzen. Diesen Grund als Kommentar an die Konstante schreiben, sonst "korrigiert" ihn die nächste Session.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/player.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/recap/\[id\]/player.tsx mobile/src/app/\(tabs\)/recap/__tests__/player.test.tsx
git commit -m "feat(recap): the show hands over to the overview by itself"
```

---

## Task 5: Die Recap-Karte lädt zur Show ein

**Files:**
- Modify: `mobile/src/components/TripCard.tsx`
- Modify: `mobile/src/components/TripCover.tsx`
- Modify: `mobile/src/app/(tabs)/recap/index.tsx` (Ziel des Taps)
- Test: `mobile/src/components/__tests__/TripCard.test.tsx` (falls vorhanden, sonst dort anlegen), `mobile/src/app/(tabs)/recap/__tests__/list.test.tsx`

**Interfaces:**
- Consumes: die bestehende `Pill`-Komponente (`{ children, style, testID, accessibilityLabel, pointerEvents }`)
- Produces: `TripCover` nimmt neu `scrim?: boolean`; `TripCard` behält `asRecap`

Der helle Pill oben links weicht einer translucenten Pille unten links auf einem Foto-Scrim. Der Scrim gehört in `TripCover` (er liegt im geclippten Container über dem Bild), die Pille bleibt in `TripCard`, weil nur sie weiss, ob die Karte als Recap auftritt.

Der Tap auf die Karte führt neu in den Player statt in die Übersicht.

- [ ] **Step 1: Write the failing test**

```typescript
// list.test.tsx
test('a tap on the recap card starts the show, without a start index', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  await wrap();
  fireEvent.press(await screen.findByText('Lissabon Städtetrip'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player', params: { id: 't2' },
  });
});

test('the card promises the show with a translucent pill on the cover', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  await wrap();
  expect(await screen.findByTestId('recap-card-play')).toBeTruthy();
  expect(screen.getByTestId('trip-cover-scrim')).toBeTruthy();
});

test('in the trip tab (without asRecap) neither pill nor scrim stands', () => {
  // TripCard direkt rendern, ohne asRecap
  expect(screen.queryByTestId('recap-card-play')).toBeNull();
  expect(screen.queryByTestId('trip-cover-scrim')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/list.test.tsx`
Expected: FAIL, `push` wird mit `/recap/t2/overview` aufgerufen, `recap-card-play` fehlt

- [ ] **Step 3: Write minimal implementation**

In `TripCover.tsx` einen optionalen Scrim ergänzen. Er ist der einzige erlaubte Gradient (DESIGN-LANGUAGE §1) und braucht daher `expo-linear-gradient`; prüfe zuerst, ob das Paket schon in `package.json` steht. Steht es nicht, verwende stattdessen zwei bis drei gestapelte `View`s mit `rgba(0,0,0,…)` fallender Deckkraft und halte im Kommentar fest, warum (kein neues Paket für einen Verlauf über 60 Punkte). Farbwerte gehören in diesem Fall als benannte Konstante in die Datei, nicht als lose Hex-Literale.

```tsx
{scrim && <View testID="trip-cover-scrim" style={styles.scrim} pointerEvents="none" />}
```

In `TripCard.tsx` den bisherigen `revealed`-Block ersetzen:

```tsx
<TripCover position={position} sealed={trip.status === 'active'} scrim={revealed}>
  {revealed && (
    <Pill testID="recap-card-play" style={styles.playPill}>
      <Play size={12} color={palette['bg-0']} strokeWidth={1.75} />
      <Text style={[type.label, { color: palette['bg-0'] }]}>Recap ansehen</Text>
    </Pill>
  )}
</TripCover>
```

`styles.playPill` trägt Form und Platzierung (Radius 999, `paddingHorizontal: spacing.m`, `paddingVertical: spacing.xs`, `flexDirection: 'row'`, `alignItems: 'center'`, `gap: spacing.xs`, `alignSelf: 'flex-start'`), niemals eine Hintergrundfarbe: die gehört der `Pill`. Der Overlay-Container in `TripCover` muss die Pille an den unteren Rand setzen (`justifyContent: 'flex-end'`); prüfe den vorhandenen `styles.overlay` und passe ihn an, ohne den versiegelten Zustand zu verschieben.

Weisser Text auf der dunklen Pille kommt aus `palette['bg-0']`, nicht aus `cinema['text-1']`: Die Karte steht im hellen UI, die Pille ist nur ihr Fenster auf ein Foto.

Die Vorlese-Beschriftung der Karte wird sprechend: `accessibilityLabel={`Recap von ${trip.name} ansehen`}` an der `PressScale`, wenn `asRecap` gilt.

In `recap/index.tsx` das Ziel ändern:

```tsx
onPress={() => router.push({ pathname: '/recap/[id]/player', params: { id: t.id } })}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap src/components/__tests__`
Expected: PASS. Der Trip-Tab-Test (`src/app/(tabs)/trip/__tests__`) muss ebenfalls grün bleiben, dort steht `TripCard` ohne `asRecap`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/TripCard.tsx mobile/src/components/TripCover.tsx mobile/src/app/\(tabs\)/recap/index.tsx mobile/src/components/__tests__ mobile/src/app/\(tabs\)/recap/__tests__/list.test.tsx
git commit -m "feat(recap): the recap card invites into the show"
```

---

## Task 6: Cover-Action auf dem Server

**Files:**
- Create: `supabase/functions/media-urls/covers.ts`
- Create: `supabase/functions/media-urls/covers_test.ts`
- Modify: `supabase/functions/media-urls/index.ts`

**Interfaces:**
- Consumes: `evaluateReadAccess` aus `./readAccess.ts`, `expectedKeys` aus `./keys.ts`
- Produces: HTTP-Action `{ action: 'covers', trip_ids: string[] }` mit der Antwort `{ covers: { trip_id: string; thumb_url: string }[]; valid_until: string }`

Die Liste im Recap-Tab braucht pro Reise ein Cover, nicht den ganzen Pool. Die neue Action liefert genau eine signierte Thumbnail-URL je Reise: die des frühesten hochgeladenen Moments, der ein Thumbnail hat.

Sicherheit: Pro Reise läuft dieselbe Kette wie bei `read`. Reisen, die durchfallen, erscheinen einfach nicht in der Antwort, ohne Fehlermeldung und ohne Unterscheidung des Grundes. Sonst würde die Antwort verraten, ob eine geratene Reise-ID existiert.

- [ ] **Step 1: Write the failing test**

Die reine Logik trennt (wie `readAccess.ts`) die Entscheidung von der Ein- und Ausgabe: Eingabe sind die bereits geladenen Zeilen, Ausgabe ist die Auswahl.

```typescript
// supabase/functions/media-urls/covers_test.ts
import { assertEquals } from 'jsr:@std/assert';
import { normalizeTripIds, pickCoverRow, MAX_TRIP_IDS } from './covers.ts';

Deno.test('covers: a valid list passes through unchanged', () => {
  assertEquals(normalizeTripIds(['a', 'b']), { ok: true, tripIds: ['a', 'b'] });
});

Deno.test('covers: duplicates collapse, the answer carries one entry per trip', () => {
  assertEquals(normalizeTripIds(['a', 'a', 'b']), { ok: true, tripIds: ['a', 'b'] });
});

Deno.test('covers: a missing or non-array field is rejected', () => {
  assertEquals(normalizeTripIds(undefined), { ok: false, message: 'trip_ids fehlt.', status: 400 });
  assertEquals(normalizeTripIds('a'), { ok: false, message: 'trip_ids fehlt.', status: 400 });
});

Deno.test('covers: an empty list is a valid, empty answer, not an error', () => {
  assertEquals(normalizeTripIds([]), { ok: true, tripIds: [] });
});

Deno.test('covers: more than the cap is rejected instead of silently truncated', () => {
  const many = Array.from({ length: MAX_TRIP_IDS + 1 }, (_, i) => `t${i}`);
  assertEquals(normalizeTripIds(many), {
    ok: false, message: 'Zu viele Reisen auf einmal.', status: 400,
  });
});

Deno.test('covers: the earliest moment with a thumbnail becomes the cover', () => {
  const rows = [
    { id: 'p1', type: 'photo' as const, media_ext: 'jpg', storage_key: 'k1', thumb_key: null },
    { id: 'p2', type: 'photo' as const, media_ext: 'jpg', storage_key: 'k2', thumb_key: 't2' },
  ];
  assertEquals(pickCoverRow(rows)?.id, 'p2');
});

Deno.test('covers: without a single thumbnail there is no cover', () => {
  const rows = [
    { id: 'p1', type: 'photo' as const, media_ext: 'jpg', storage_key: 'k1', thumb_key: null },
  ];
  assertEquals(pickCoverRow(rows), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions/media-urls && deno test covers_test.ts`
Expected: FAIL, `Module not found ./covers.ts`

- [ ] **Step 3: Write minimal implementation**

Die Obergrenze wird abgewiesen und nicht stillschweigend gekürzt: Eine gekürzte Antwort sähe für den Client aus wie "diese Reisen haben kein Cover".

```typescript
// supabase/functions/media-urls/covers.ts
export const MAX_TRIP_IDS = 50;

export type CoverRow = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string;
  storage_key: string;
  thumb_key: string | null;
};

export type NormalizedTripIds =
  | { ok: true; tripIds: string[] }
  | { ok: false; message: string; status: number };

export function normalizeTripIds(raw: unknown): NormalizedTripIds {
  if (!Array.isArray(raw)) return { ok: false, message: 'trip_ids fehlt.', status: 400 };
  const tripIds = [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))];
  if (tripIds.length > MAX_TRIP_IDS) {
    return { ok: false, message: 'Zu viele Reisen auf einmal.', status: 400 };
  }
  return { ok: true, tripIds };
}

// `rows` comes in already ordered by captured_at, id (the query does that),
// so the first row carrying a thumbnail is the earliest one. A moment
// without a thumbnail is skipped rather than signed: the path would be
// ".../null", a valid signature for an object that does not exist.
export function pickCoverRow(rows: CoverRow[]): CoverRow | null {
  return rows.find((row) => row.thumb_key !== null) ?? null;
}
```

In `index.ts` den Zweig `if (action === 'covers')` neben `read` setzen, VOR der `post_id`-Prüfung, mit demselben Aufbau:

1. `normalizeTripIds(body.trip_ids)`, bei `ok: false` mit `errorResponse(message, status)` antworten.
2. Pro Reise: `trips`-Zeile holen, bei `revealed`/`archived` die `trip_members`-Zeile, dann `evaluateReadAccess`. Bei `allowed: false` diese Reise überspringen, **ohne** Fehlerantwort.
3. Für die erlaubten Reisen die Momente holen: `select('id, type, media_ext, storage_key, thumb_key')`, `eq('upload_status', 'uploaded')`, `order('captured_at')`, `order('id')`, `limit(20)`. Das Limit ist bewusst klein: Gesucht wird der früheste Moment mit Thumbnail, nicht die ganze Reise. Findet sich in den ersten 20 keiner, gibt es kein Cover, und die Karte zeigt den Platzhalter. Diesen Grund als Kommentar an das Limit schreiben.
4. `pickCoverRow`, dann `expectedKeys(tripId, row.id, row.type, row.media_ext)` und die Abweichungsprüfung `row.storage_key !== derived.storage_key` genau wie in `read` (abweichende Zeile wird übersprungen und geloggt).
5. `presignedGetUrl(aws, derived.thumb_key)` und die Antwort `{ covers, valid_until }` mit `valid_until` wie in `read` VOR dem Signieren gestempelt.

Die Reisen werden nacheinander oder mit `Promise.all` abgearbeitet; bei 50 Einträgen ist `Promise.all` deutlich schneller, und die Abfragen sind unabhängig.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd supabase/functions/media-urls && deno test covers_test.ts readAccess_test.ts keys_test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/media-urls/covers.ts supabase/functions/media-urls/covers_test.ts supabase/functions/media-urls/index.ts
git commit -m "feat(media-urls): covers action returns one signed thumbnail per trip"
```

---

## Task 7: Echte Cover in der Liste

**Files:**
- Create: `mobile/src/features/recap/coversApi.ts`
- Create: `mobile/src/features/recap/__tests__/coversApi.test.ts`
- Modify: `mobile/src/app/(tabs)/recap/index.tsx`
- Modify: `mobile/src/components/TripCard.tsx`, `mobile/src/components/TripCover.tsx` (Foto-URL entgegennehmen)
- Test: `mobile/src/app/(tabs)/recap/__tests__/list.test.tsx`

**Interfaces:**
- Consumes: die `covers`-Action aus Task 6
- Produces: `export async function fetchCovers(tripIds: string[]): Promise<Map<string, string>>`; `TripCover` und `TripCard` nehmen neu `coverUrl?: string | null`

Die Karten zeigen das echte Foto der Reise, den Platzhalter nur noch als Fallback. Ein Fehler der Cover-Abfrage darf die Liste nie blockieren: Dann stehen die Karten eben mit Platzhaltern da.

- [ ] **Step 1: Write the failing test**

```typescript
// coversApi.test.ts
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
import { supabase } from '@/lib/supabase';
import { fetchCovers } from '../coversApi';

test('turns the answer into a map from trip to url', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({
    data: { covers: [{ trip_id: 't1', thumb_url: 'https://x/1.jpg' }], valid_until: '2026-08-21T10:00:00Z' },
    error: null,
  });
  const covers = await fetchCovers(['t1']);
  expect(covers.get('t1')).toBe('https://x/1.jpg');
});

test('an error yields an empty map, never a throw: the list must not depend on covers', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'boom' } });
  expect((await fetchCovers(['t1'])).size).toBe(0);
});

test('a malformed answer yields an empty map as well', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { covers: 'nope' }, error: null });
  expect((await fetchCovers(['t1'])).size).toBe(0);
});

test('without trip ids no call goes out at all', async () => {
  (supabase.functions.invoke as jest.Mock).mockClear();
  expect((await fetchCovers([])).size).toBe(0);
  expect(supabase.functions.invoke).not.toHaveBeenCalled();
});
```

```typescript
// list.test.tsx
test('the card shows the real photo of the trip', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  (fetchCovers as jest.Mock).mockResolvedValue(new Map([['t2', 'https://x/1.jpg']]));
  await wrap();
  const cover = await screen.findByTestId('trip-cover');
  expect(cover.props.source).toEqual({ uri: 'https://x/1.jpg' });
});

test('without a cover the placeholder stays, the list stands regardless', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([recap]));
  (fetchCovers as jest.Mock).mockResolvedValue(new Map());
  await wrap();
  expect(await screen.findByText('Lissabon Städtetrip')).toBeTruthy();
  const cover = screen.getByTestId('trip-cover');
  expect(cover.props.source).not.toEqual({ uri: expect.any(String) });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest src/features/recap/__tests__/coversApi.test.ts`
Expected: FAIL, `Cannot find module '../coversApi'`

- [ ] **Step 3: Write minimal implementation**

`coversApi.ts` folgt dem Muster von `urlPool.ts` (`supabase.functions.invoke`), aber ohne dessen Fehlerübersetzung: Es gibt hier keinen Text, den ein Mensch je sieht. Jeder Fehlerfall endet in einer leeren `Map`; der Grund gehört als Kommentar an die Funktion.

`TripCover` bekommt `coverUrl?: string | null` und wählt: `source={coverUrl ? { uri: coverUrl } : placeholderCover(position)}`. `TripCard` reicht den Wert nur durch.

In `recap/index.tsx` die Cover nach den Reisen laden, in einem eigenen Schritt und ohne den Listenaufbau zu blockieren:

```tsx
const load = useCallback(async () => {
  const { data, error: loadError } = await fetchTrips();
  if (!active.current) return;
  setTrips(data);
  setError(loadError);
  setLoaded(true);
  const recapIds = groupTrips(data, todaysCalendarDay()).recaps.map((t) => t.id);
  const found = await fetchCovers(recapIds);
  if (!active.current) return;
  setCovers(found);
}, []);
```

Die Reihenfolge ist Absicht: Erst steht die Liste, dann füllen sich die Bilder. `expo-image` blendet sie mit der vorhandenen `transition` ein, ein Sprung entsteht nicht, weil der Platzhalter dieselbe Fläche hält.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/features/recap src/app/\(tabs\)/recap`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/recap/coversApi.ts mobile/src/features/recap/__tests__/coversApi.test.ts mobile/src/app/\(tabs\)/recap mobile/src/components/TripCard.tsx mobile/src/components/TripCover.tsx
git commit -m "feat(recap): recap cards show the trip's own photo"
```

---

## Task 8: Das Kachelmuster

**Files:**
- Create: `mobile/src/features/recap/mosaic.ts`
- Test: `mobile/src/features/recap/__tests__/mosaic.test.ts`

**Interfaces:**
- Consumes: `RecapMoment` aus `./types`
- Produces:
  ```typescript
  export type MosaicTile = { moment: RecapMoment; shape: 'lead' | 'wide' | 'half' | 'third' };
  export type MosaicRow = { kind: 'feature' | 'triple' | 'single' | 'pair'; tiles: MosaicTile[] };
  export function mosaicRows(moments: RecapMoment[]): MosaicRow[];
  ```

Das Muster je Tag als reine Funktion, damit die Randfälle nicht im Screen verstecken. Ein Tag mit einem Moment darf nicht als angeschnittenes Mosaik dastehen, und einer mit zweien nicht als grosse Kachel neben einer Lücke.

Regeln aus der Spec:

| Momente am Tag | Ergebnis |
|---|---|
| 0 | leere Liste |
| 1 | eine Reihe `single` mit einer Kachel `wide` (volle Breite, 3:2) |
| 2 | eine Reihe `pair` mit zwei Kacheln `half` |
| 3 und mehr | eine Reihe `feature` (eine `lead`, zwei `third`), danach `triple`-Reihen zu je drei `third`; die letzte Reihe darf kürzer sein |

Die Reihenfolge bleibt die übergebene (nach `captured_at` sortiert): Das Muster ändert Grössen, nie die Folge.

- [ ] **Step 1: Write the failing test**

```typescript
import { mosaicRows } from '../mosaic';
import type { RecapMoment } from '../types';

const moment = (id: string): RecapMoment => ({
  id, trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
  captured_at: '2026-08-01T08:00:00Z', captured_tz: 'Europe/Zurich', place_name: null,
  lat: null, lng: null, upload_status: 'uploaded', authorName: 'Lea', authorAvatarKey: null,
});
const moments = (n: number) => Array.from({ length: n }, (_, i) => moment(`p${i + 1}`));

test('no moments, no rows', () => {
  expect(mosaicRows([])).toEqual([]);
});

test('a single moment stands full width instead of a lonely tile', () => {
  const rows = mosaicRows(moments(1));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('single');
  expect(rows[0].tiles.map((t) => t.shape)).toEqual(['wide']);
});

test('two moments stand side by side, not as a feature with a gap', () => {
  const rows = mosaicRows(moments(2));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('pair');
  expect(rows[0].tiles.map((t) => t.shape)).toEqual(['half', 'half']);
});

test('three moments make exactly one feature row', () => {
  const rows = mosaicRows(moments(3));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('feature');
  expect(rows[0].tiles.map((t) => t.shape)).toEqual(['lead', 'third', 'third']);
});

test('beyond the feature row the rest falls into rows of three', () => {
  const rows = mosaicRows(moments(9));
  expect(rows.map((r) => r.kind)).toEqual(['feature', 'triple', 'triple']);
  expect(rows[2].tiles).toHaveLength(3);
});

test('a last, shorter row is kept, never padded or dropped', () => {
  const rows = mosaicRows(moments(5));
  expect(rows.map((r) => r.kind)).toEqual(['feature', 'triple']);
  expect(rows[1].tiles.map((t) => t.moment.id)).toEqual(['p4', 'p5']);
});

test('the order of the moments survives the pattern untouched', () => {
  const ids = mosaicRows(moments(7)).flatMap((r) => r.tiles.map((t) => t.moment.id));
  expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
});

test('the lead is the earliest moment of the day, never a chosen one', () => {
  const rows = mosaicRows(moments(4));
  expect(rows[0].tiles[0].shape).toBe('lead');
  expect(rows[0].tiles[0].moment.id).toBe('p1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/features/recap/__tests__/mosaic.test.ts`
Expected: FAIL, `Cannot find module '../mosaic'`

- [ ] **Step 3: Write minimal implementation**

Kein `null`, keine Füllkacheln: Eine kürzere letzte Reihe ist eine kürzere Reihe, das Layout löst das über `flex-start`.

```typescript
// mobile/src/features/recap/mosaic.ts
import type { RecapMoment } from './types';

export type MosaicTile = { moment: RecapMoment; shape: 'lead' | 'wide' | 'half' | 'third' };
export type MosaicRow = { kind: 'feature' | 'triple' | 'single' | 'pair'; tiles: MosaicTile[] };

const tile = (moment: RecapMoment, shape: MosaicTile['shape']): MosaicTile => ({ moment, shape });

export function mosaicRows(moments: RecapMoment[]): MosaicRow[] {
  if (moments.length === 0) return [];
  if (moments.length === 1) {
    return [{ kind: 'single', tiles: [tile(moments[0], 'wide')] }];
  }
  if (moments.length === 2) {
    return [{ kind: 'pair', tiles: moments.map((m) => tile(m, 'half')) }];
  }

  const rows: MosaicRow[] = [
    {
      kind: 'feature',
      tiles: [tile(moments[0], 'lead'), tile(moments[1], 'third'), tile(moments[2], 'third')],
    },
  ];
  for (let i = 3; i < moments.length; i += 3) {
    rows.push({ kind: 'triple', tiles: moments.slice(i, i + 3).map((m) => tile(m, 'third')) });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/features/recap/__tests__/mosaic.test.ts`
Expected: PASS, 8 Tests

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/recap/mosaic.ts mobile/src/features/recap/__tests__/mosaic.test.ts
git commit -m "feat(recap): mosaic pattern for a day's moments"
```

---

## Task 9: Der Foto-Hero der Übersicht

**Files:**
- Create: `mobile/src/components/RecapHero.tsx`
- Create: `mobile/src/components/__tests__/RecapHero.test.tsx`
- Modify: `mobile/src/app/(tabs)/recap/[id]/overview.tsx`
- Test: `mobile/src/app/(tabs)/recap/__tests__/overview.test.tsx`

**Interfaces:**
- Consumes: `Pill`, `PressScale`, `formatRange` aus `@/features/trips/tripDay`
- Produces:
  ```tsx
  export function RecapHero(props: {
    title: string; subtitle: string; coverUrl: string | null; position?: number;
    onBack: () => void; onPlay: () => void;
  }): JSX.Element
  ```

Der Hero ersetzt Kopfzeile, H1, Siegel-Bühne und Popcorn. Er trägt Foto, Titelblock und die zwei Glaspillen.

Die Untertitel-Zeile lautet "1.–14. Aug 2026 · 42 Momente · zu dritt". Die Momente-Zahl ist die der angezeigten Momente (alle Mitreisenden), nicht `my_post_count` wie auf der Karte. Bei einer einzelnen Person entfällt der dritte Teil ersatzlos.

- [ ] **Step 1: Write the failing test**

```typescript
// RecapHero.test.tsx
const props = {
  title: 'Sommer in Lissabon', subtitle: '1.–14. Aug 2026 · 42 Momente · zu dritt',
  coverUrl: 'https://x/1.jpg', onBack: jest.fn(), onPlay: jest.fn(),
};

test('carries title, subtitle and the trip photo', () => {
  render(<ThemeProvider><RecapHero {...props} /></ThemeProvider>);
  expect(screen.getByText('Sommer in Lissabon')).toBeTruthy();
  expect(screen.getByText('1.–14. Aug 2026 · 42 Momente · zu dritt')).toBeTruthy();
  expect(screen.getByTestId('recap-hero-image').props.source).toEqual({ uri: 'https://x/1.jpg' });
});

test('without a cover url the placeholder holds the surface', () => {
  render(<ThemeProvider><RecapHero {...props} coverUrl={null} /></ThemeProvider>);
  expect(screen.getByTestId('recap-hero-image').props.source).not.toEqual({ uri: expect.any(String) });
});

test('the play pill starts the show again', () => {
  const onPlay = jest.fn();
  render(<ThemeProvider><RecapHero {...props} onPlay={onPlay} /></ThemeProvider>);
  fireEvent.press(screen.getByTestId('recap-hero-play'));
  expect(onPlay).toHaveBeenCalled();
});

test('a long trip name stays inside the scrim, capped at two lines', () => {
  render(<ThemeProvider><RecapHero {...props} title={'Sehr lange Reise '.repeat(10)} /></ThemeProvider>);
  expect(screen.getByTestId('recap-hero-title').props.numberOfLines).toBe(2);
});
```

```typescript
// overview.test.tsx
test('the overview opens with the hero, not with a seal', async () => {
  await wrap();
  expect(await screen.findByTestId('recap-hero-image')).toBeTruthy();
  expect(screen.queryByTestId('recap-seal')).toBeNull();
  expect(screen.queryByTestId('recap-popcorn')).toBeNull();
});

test('the hero counts all moments of the recap, not only my own', async () => {
  // fetchTrip liefert my_post_count: 7, der Pool traegt 3 Momente
  await wrap();
  expect(await screen.findByText(/3 Momente/)).toBeTruthy();
});

test('play from the hero repeats the show without a seal, so with start=0', async () => {
  await wrap();
  fireEvent.press(await screen.findByTestId('recap-hero-play'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player', params: { id: 't1', start: '0' },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest src/components/__tests__/RecapHero.test.tsx`
Expected: FAIL, `Cannot find module '@/components/RecapHero'`

- [ ] **Step 3: Write minimal implementation**

`RecapHero.tsx`: Ein `View` mit `aspectRatio: 3/2`, `borderRadius: radius.card`, `overflow: 'hidden'`, darin das Bild formatfüllend, darüber die zwei Scrims (oben und unten, dieselbe Technik wie in Task 5), darauf die Pillen und der Titelblock.

- Chevron oben links: `Pill` mit fester Grösse (44, wie die Segment-Pills), Icon `ChevronLeft`, `accessibilityLabel="Zurück"`.
- Play oben rechts: `Pill` mit `Play`-Icon und "Nochmal ansehen", testID `recap-hero-play`, `accessibilityLabel="Recap nochmal ansehen"`.
- Titelblock unten links: Titel `type.h2` in `palette['bg-0']`, `numberOfLines={2}`, `ellipsizeMode="tail"`; Untertitel `type.secondary`, ebenfalls weiss.

Beide Pillen sitzen unter einer `PressScale`, nicht als eigene `Pressable`: Press-Feedback ist Scale per Spring (DESIGN-LANGUAGE §5), nie Opacity-Dimmen.

In `overview.tsx`:

1. `header`, die H1, die Siegel-Bühne (`sealed`, `unsealed`, `unsealedRef`, `fadeIn`, `SEAL_STAGE_MAX`, `stage`) und das Popcorn-Bild entfernen. Der Import von `SealPeel` und `useReducedMotion` fällt damit womöglich weg; ESLint zeigt es.
2. Den Hero an den Kopf setzen, mit `coverUrl` aus dem ersten Eintrag der bereits sortierten Liste mit Thumbnail (`withImage.find((m) => urls.get(m.id)?.thumb_url)`).
3. Darunter eine Zeile: links die bestehenden Segment-Pills, rechts die Download- und Share-Icons aus dem alten Header.
4. `onPlay` schickt in den Player mit `start: '0'`.

Der Untertitel entsteht aus `formatRange(trip.start_date, trip.end_date)`, der Zahl der angezeigten Momente und der Mitgliederzahl. Für die dritte Angabe eine kleine lokale Funktion schreiben ("zu zweit", "zu dritt", ab vier "zu viert" und höher "mit N Mitreisenden"); bei einer Person gibt sie `null` zurück und der Teil entfällt.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/components/__tests__/RecapHero.test.tsx src/app/\(tabs\)/recap/__tests__/overview.test.tsx`
Expected: PASS. Die bestehenden Siegel-Tests der Übersicht (`describe('the seal on the recap overview')`) werden in diesem Schritt gelöscht, das Siegel steht dort nicht mehr; ihre Absicht lebt in Task 2 weiter.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/RecapHero.tsx mobile/src/components/__tests__/RecapHero.test.tsx mobile/src/app/\(tabs\)/recap
git commit -m "feat(recap): the overview opens with a photo hero"
```

---

## Task 10: Das Mosaik in der Übersicht

**Files:**
- Modify: `mobile/src/app/(tabs)/recap/[id]/overview.tsx` (`DaySection`, `SkeletonScreen`, Styles)
- Test: `mobile/src/app/(tabs)/recap/__tests__/overview.test.tsx`

**Interfaces:**
- Consumes: `mosaicRows`, `MosaicRow`, `MosaicTile` aus Task 8
- Produces: nichts für spätere Tasks

Das Dreier-Raster weicht dem Mosaik. Der Tageskopf wird zweizeilig ("Tag 1" als H2, darunter "Lissabon · 1. August" sekundär). Video-Kacheln bekommen ein kleines Play-Badge, auf der grossen Kachel wie auf den kleinen. Der Skeleton bildet den neuen Aufbau ab.

- [ ] **Step 1: Write the failing test**

```typescript
test('a day heads its moments in two lines', async () => {
  await wrap();
  expect(await screen.findByText('Tag 1')).toBeTruthy();
  expect(screen.getByText('Lissabon · 1. August')).toBeTruthy();
  expect(screen.queryByText('Tag 1 · Lissabon · 1. August')).toBeNull();
});

test('the first moment of a day leads the mosaic', async () => {
  // Tag mit vier Momenten
  await wrap();
  expect(await screen.findByTestId('recap-tile-lead-p1')).toBeTruthy();
});

test('every moment stays tappable, the lead one too', async () => {
  await wrap();
  fireEvent.press(await screen.findByTestId('recap-tile-lead-p1'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recap/[id]/player', params: { id: 't1', start: '0' },
  });
});

test('a video tile carries a play badge, a photo does not', async () => {
  // ein Video und ein Foto am selben Tag
  await wrap();
  expect(await screen.findByTestId('recap-tile-video-p2')).toBeTruthy();
  expect(screen.queryByTestId('recap-tile-video-p1')).toBeNull();
});

test('a day with a single moment shows it full width instead of a lonely tile', async () => {
  await wrap();
  expect(await screen.findByTestId('recap-tile-wide-p1')).toBeTruthy();
});

test('the skeleton shows hero and mosaic, not the old grid', async () => {
  // fetchTrip auf eine nie aufloesende Promise stellen, damit `loaded` false
  // bleibt: `(fetchTrip as jest.Mock).mockReturnValue(new Promise(() => {}))`.
  await wrap();
  expect(await screen.findByTestId('recap-skeleton')).toBeTruthy();
});
```

Die bestehenden Kachel-Tests der Datei greifen `recap-tile-${m.id}`. Weil die Kachelform jetzt Teil der Aussage ist, tragen die neuen testIDs die Form (`recap-tile-lead-p1`, `recap-tile-wide-p1`, `recap-tile-third-p4`). Passe die bestehenden Tests entsprechend an, statt beide Schemata nebeneinander zu führen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap/__tests__/overview.test.tsx -t "mosaic"`
Expected: FAIL, `recap-tile-lead-p1` fehlt

- [ ] **Step 3: Write minimal implementation**

`DaySection` rendert `mosaicRows(day.moments)` statt des Rasters. Eine `MosaicRow` wird zu einem `View` mit `flexDirection: 'row'` und `gap: spacing.xs`; die Formen bestimmen die Breite:

- `wide`: volle Breite, `aspectRatio: 3/2`
- `half`: `flex: 1`, quadratisch
- `lead`: zwei Drittel der Breite, doppelt so hoch wie eine `third`-Kachel plus der Abstand dazwischen
- `third`: ein Drittel, quadratisch

Die `feature`-Reihe ist die einzige mit zwei Spalten unterschiedlicher Höhe: links die `lead`-Kachel, rechts eine Spalte (`flexDirection: 'column'`) mit den zwei `third`-Kacheln. Damit die Höhen aufgehen, muss die rechte Spalte dieselbe Höhe haben wie links; `aspectRatio` auf der linken Kachel und `flex: 1` auf den rechten reicht dafür.

Alle Kacheln behalten Radius 12 (`radius.control`), Abstände 4 (`spacing.xs`).

Das Play-Badge ist eine `Pill` mit `Play`-Icon unten links in der Kachel, testID `recap-tile-video-${id}`, `accessible={false}` (die Kachel selbst trägt die Beschriftung).

Der Skeleton bekommt einen Hero-Block (`aspectRatio: 3/2`, `radius.card`), darunter zwei Textblöcke und eine angedeutete `feature`-Reihe.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/app/\(tabs\)/recap`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/recap
git commit -m "feat(recap): days stand as a mosaic in the overview"
```

---

## Task 11: Abschluss

**Files:** keine neuen; Aufräumen und Nachweis

- [ ] **Step 1: Die ganze Suite**

Run: `cd mobile && npx jest`
Expected: PASS, keine übersprungenen Recap-Tests

- [ ] **Step 2: Typen und Lint**

Run: `cd mobile && npx tsc --noEmit && npx eslint src`
Expected: `tsc` sauber; `eslint` mit höchstens den 29 vorbestehenden Fehlern, keinem neuen. Zähle die Fehler vor dem ersten Task einmal, damit der Vergleich am Ende trägt.

- [ ] **Step 3: Server-Tests**

Run: `cd supabase/functions/media-urls && deno test covers_test.ts readAccess_test.ts keys_test.ts`
Expected: PASS

- [ ] **Step 4: Tote Reste suchen**

Run: `cd mobile && grep -rn "unsealedRef\|SEAL_STAGE_MAX\|recap-popcorn\|popcornbecher" src`
Expected: keine Treffer. Ist das Popcorn-Bild nirgends mehr referenziert, gehört die PNG-Datei gelöscht; `seen.ts` bleibt, es dient dem Reveal auf dem Reise-Detail, nicht der Übersicht (prüfe das mit `grep -rn "hasSeenReveal\|markRevealSeen" src`, bevor du etwas entfernst).

- [ ] **Step 5: Am Gerät oder im Simulator abnehmen**

Jest sieht kein Layout. Diese fünf Punkte müssen mit den Augen geprüft werden:

1. Der Kino-Fade beim Tap auf die Recap-Karte, und ob das Siegel sauber steht.
2. Ob das Mosaik mit echten Fotos trägt, besonders bei einem Tag mit vier oder fünf Momenten.
3. Ob die 2 Sekunden der End-Karte sich richtig anfühlen.
4. Ob ein langer Reisename im Hero umbricht, ohne den Titelblock aus dem Scrim zu schieben.
5. Ob die translucenten Pillen auf hellen Fotos lesbar bleiben (ein Strandfoto ist der harte Fall).

Für die Cover-Action muss der lokale Stack laufen (`supabase start`, `supabase functions serve`). Läuft die Edge-Runtime nicht, antwortet die Funktion mit 503 statt 401; das ist das Erkennungszeichen dafür, dass der Runtime aus dem Stack gefallen ist und ein `supabase stop && supabase start` fällig ist.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(recap): remove leftovers of the sealed overview"
```
