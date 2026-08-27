# Fotos-Import: Hinweis vor dem Picker, Bestätigung danach

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vor dem Foto-Picker erklärt ein Sheet die Regeln (Reisezeitraum, Videolänge, ohne Caption), nach der Auswahl bestätigt ein zweites Sheet mit Vorschau und Zahlen, ob die Momente wirklich eingesendet werden, oder bricht ab.

**Architektur:** Zwei neue Sheet-Komponenten im Kino-Modus (`ImportIntroSheet`, `ImportConfirmSheet`) auf dem bestehenden `Sheet`. Der bisherige Handler `importFromLibrary` im Kamera-Screen zerfällt in `openImport` (Hinweis), `pickAndAssess` (Picker plus Bewertung, endet im Bestätigungs-Sheet), `confirmImport` (Batch wie bisher) und `cancelImport`. Der helle Vollflächen-Knopf der Kino-Screens (`CinemaButton`, heute zweimal lokal kopiert) wird eine gemeinsame Komponente. `refusalSummary` bekommt einen Modus `preview` für die Gegenwartsform im Bestätigungs-Sheet.

**Tech Stack:** Expo SDK 57, React Native, TypeScript strict, Jest + @testing-library/react-native, expo-image, Lucide.

**Spec:** `docs/superpowers/specs/2026-08-27-fotos-import-design.md` (Abschnitte «Ablauf in der Kamera» und «Copy» werden in Task 6 nachgeführt; die Entscheide dieses Plans stehen im Gespräch vom 2026-08-27: Hinweis jedes Mal, Bestätigung mit Vorschau, keine Abwahl einzelner Elemente).

**Branch:** `worktree-library-import-confirm` ab `main` (1dd6604, enthält den Fotos-Import).

## Global Constraints

- Quellcode englisch (Bezeichner, Kommentare, Testtitel); sichtbare Texte deutsch in Du-Form, Schweizer «ss», Vokabular «Moment», «einsenden», «Reise», nie «Snap», «Galerie», «hochladen».
- Keine Em-Dashes («—») in Code, Kommentaren, Tests, Commit-Nachrichten, Spec. Der Bis-Strich in Datumsbereichen aus `formatRange` («1.–14. Aug 2026») bleibt.
- Medien-Screens tragen die Kino-Palette: Sheets über dem Sucher mit `<Sheet cinemaMode>`, Text `cinema['text-1']`/`cinema['text-2']`, Knöpfe als `CinemaButton` (helle Fläche) plus unterstrichener Textlink, kein Akzent-Button im Kino. Radius nur 12/24/999, Abstände aus `spacing`, keine Hex-Werte im Code.
- Der Hinweis erscheint bei jedem Tipp (kein gespeicherter Zustand). Abbrechen im Bestätigungs-Sheet löscht jede Picker-Kopie (`discardRefused`), nichts wird eingesendet.
- Nach dem Batch zeigt die Fehler-Pille nur noch Elemente, die beim Sichern gescheitert sind; Ablehnungen wurden im Bestätigungs-Sheet erklärt.
- `importRunning` (Ref) sperrt Picker und Batch, nicht die Sheets; `captureLock` gilt wie bisher vom Batchstart bis zum Ende der Animation.
- Nach Code-Änderungen immer ganz `src/` linten (`npx eslint src --ext .ts,.tsx`), 28 vorbestehende Fehler sind bekannt und bleiben; `npx tsc --noEmit` muss still sein.
- Alle Befehle laufen in `mobile/`. Commit-Nachrichten `typ(scope): deutscher Satz`.

---

### Task 1: `CinemaButton` und `CinemaTextLink` als gemeinsame Komponente

Der helle Kino-Knopf existiert identisch in `recap/[id]/player.tsx:191-199` und `share/[token].tsx:182-190`, der unterstrichene Textlink in `player.tsx:201-207`. Beide werden eine Komponente; die zwei Screens wechseln auf den Import.

**Files:**
- Create: `mobile/src/components/CinemaButton.tsx`
- Test: `mobile/src/components/__tests__/CinemaButton.test.tsx`
- Modify: `mobile/src/app/(tabs)/recap/[id]/player.tsx:189-207` (lokale `CinemaButton` und `TextLink` entfernen), `:2054-2062` (Styles `cinemaButton`, `textLink` entfernen)
- Modify: `mobile/src/app/share/[token].tsx:182-190` (lokale `CinemaButton` entfernen), `:1013-1020` (Style `cinemaButton` entfernen)

**Interfaces:**
- Produces: `export function CinemaButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string })` und `export function CinemaTextLink({ label, onPress }: { label: string; onPress: () => void })` aus `@/components/CinemaButton`. Beide setzen `accessibilityRole="button"` und `accessibilityLabel={label}`; der Text steht als `<Text>`-Kind, so finden Tests ihn über `getByText` und `getByLabelText`.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`mobile/src/components/__tests__/CinemaButton.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { cinema } from '@/theme/tokens';
import { CinemaButton, CinemaTextLink } from '../CinemaButton';

test('the button shows its label on a light surface and reports the press', () => {
  const onPress = jest.fn();
  render(<CinemaButton label="Fotos auswählen" onPress={onPress} testID="cinema-button" />);
  expect(screen.getByLabelText('Fotos auswählen')).toBeTruthy();
  expect(screen.getByText('Fotos auswählen')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Fotos auswählen'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('the text link is underlined in the cinema text color and reports the press', () => {
  const onPress = jest.fn();
  render(<CinemaTextLink label="Abbrechen" onPress={onPress} />);
  const text = screen.getByText('Abbrechen');
  const flat = Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean));
  expect(flat.textDecorationLine).toBe('underline');
  expect(flat.color).toBe(cinema['text-1']);
  fireEvent.press(screen.getByLabelText('Abbrechen'));
  expect(onPress).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/components/__tests__/CinemaButton.test.tsx`
Expected: FAIL mit `Cannot find module '../CinemaButton'`.

- [ ] **Step 3: Komponente schreiben**

`mobile/src/components/CinemaButton.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from './PressScale';
import { cinema, radius, spacing, type } from '@/theme/tokens';

// The solid button of the media screens (DESIGN-LANGUAGE v2 §1): a light
// text-1 surface with a dark label instead of the accent, so it does not
// compete with the picture underneath. It used to live as two identical
// copies in recap/[id]/player.tsx and share/[token].tsx; the library-import
// sheets would have been the third.
export function CinemaButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress}>
      <View style={styles.button}>
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

// The quiet action next to it: an underlined text-1 link, the cinema twin
// of Button's `text` variant (which is bound to the light palette).
export function CinemaTextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Text style={[type.bodyMedium, styles.link]}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: cinema['text-1'],
  },
  link: { color: cinema['text-1'], textDecorationLine: 'underline', textAlign: 'center' },
});
```

- [ ] **Step 4: Die zwei Screens umstellen**

In `player.tsx`: die lokalen Funktionen `CinemaButton` (Zeilen 189-199 inklusive des Kommentars «Media screen (DESIGN-LANGUAGE v2 §1) …») und `TextLink` (201-207) löschen, dafür `import { CinemaButton, CinemaTextLink } from '@/components/CinemaButton';` bei den anderen `@/components`-Imports ergänzen und jede `<TextLink` -Verwendung in `<CinemaTextLink` umbenennen (mit `grep -n "TextLink" player.tsx` alle Stellen finden). Die Styles `cinemaButton` und `textLink` (2054-2062) löschen. Den Kommentar bei Zeile 210 («the same tone CinemaButton already uses …») unverändert lassen, er bleibt wahr.

In `share/[token].tsx`: die lokale Funktion `CinemaButton` (182-190) löschen, `import { CinemaButton } from '@/components/CinemaButton';` ergänzen, den Style `cinemaButton` (1013-1020) löschen. Der Kommentar bei Zeile 333 bleibt.

Falls `radius`, `spacing` oder `cinema` in einer der beiden Dateien danach ungenutzt sind, meldet ESLint das: dann den ungenutzten Import entfernen.

- [ ] **Step 5: Tests laufen lassen**

Run: `cd mobile && npx jest src/components/__tests__/CinemaButton.test.tsx "src/app/(tabs)/recap/__tests__/player.test.tsx" src/app/share`
Expected: alle grün (die Player- und Share-Tests finden ihre Knöpfe weiterhin über Text und Label).

- [ ] **Step 6: Typen und Lint**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: tsc still; eslint nur die bekannten 28 Fehler.

- [ ] **Step 7: Commit**

```bash
cd mobile
git add src/components/CinemaButton.tsx src/components/__tests__/CinemaButton.test.tsx "src/app/(tabs)/recap/[id]/player.tsx" "src/app/share/[token].tsx"
git commit -m "refactor(ui): CinemaButton und CinemaTextLink als gemeinsame Komponente der Kino-Screens"
```

---

### Task 2: `refusalSummary` in der Gegenwartsform (`mode: 'preview'`)

Das Bestätigungs-Sheet sagt, was nicht mitkommt, bevor etwas eingesendet ist. Gleiche Gründe, andere Einleitung.

**Files:**
- Modify: `mobile/src/features/moments/libraryImport.ts:173-197` (`refusalSummary`)
- Test: `mobile/src/features/moments/__tests__/libraryImport.test.ts` (Block `describe('refusalSummary')`)

**Interfaces:**
- Produces: `refusalSummary(reasons, total, period, maxVideoSeconds, mode: 'result' | 'preview' = 'result')`. Bestehende Aufrufer ohne fünftes Argument bleiben unverändert (`result`).

- [ ] **Step 1: Fehlschlagende Tests schreiben**

Am Ende des `describe('refusalSummary', …)`-Blocks in `libraryImport.test.ts` ergänzen:

```ts
  test('the preview mode speaks in the present tense, before anything is submitted', () => {
    expect(refusalSummary(['outside_period'], 1, PERIOD, MAX_SECONDS, 'preview')).toBe(
      'Der Moment kommt nicht mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).'
    );
    expect(refusalSummary(['too_long'], 3, PERIOD, MAX_SECONDS, 'preview')).toBe(
      '1 von 3 Momenten kommt nicht mit: Video länger als 90 Sekunden.'
    );
    expect(refusalSummary(['outside_period', 'outside_period'], 5, PERIOD, MAX_SECONDS, 'preview')).toBe(
      '2 von 5 Momenten kommen nicht mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).'
    );
    expect(refusalSummary(['too_long', 'unknown_date'], 2, PERIOD, MAX_SECONDS, 'preview')).toBe(
      'Keiner der 2 Momente kommt mit: 1 Video länger als 90 Sekunden, 1 Aufnahmedatum unbekannt. Mit Zugriff auf deine Fotos kommt das Aufnahmedatum meist mit.'
    );
  });

  test('the default mode stays the past tense of the result', () => {
    expect(refusalSummary(['outside_period'], 1, PERIOD, MAX_SECONDS)).toBe(
      refusalSummary(['outside_period'], 1, PERIOD, MAX_SECONDS, 'result')
    );
  });
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryImport.test.ts`
Expected: der Preview-Test scheitert (die Einleitung lautet noch «wurde nicht eingesendet»), alle anderen grün.

- [ ] **Step 3: Modus einbauen**

`refusalSummary` in `libraryImport.ts` ersetzen durch:

```ts
export type SummaryMode = 'result' | 'preview';

// The lead of the sentence: past tense for the pill after the batch
// ("wurde nicht eingesendet"), present tense for the confirmation sheet
// before anything is submitted ("kommt nicht mit").
function lead(mode: SummaryMode, refused: number, total: number): string {
  if (mode === 'preview') {
    if (total === 1) return 'Der Moment kommt nicht mit';
    if (refused === total) return `Keiner der ${total} Momente kommt mit`;
    return refused === 1
      ? `1 von ${total} Momenten kommt nicht mit`
      : `${refused} von ${total} Momenten kommen nicht mit`;
  }
  if (total === 1) return 'Der Moment wurde nicht eingesendet';
  if (refused === total) return `Keiner der ${total} Momente wurde eingesendet`;
  return `${refused} von ${total} Momenten wurden nicht eingesendet`;
}

// One sentence: how many of the batch stay out and why. With mixed reasons
// each one carries its count; a single reason stands alone. null when
// nothing was refused.
export function refusalSummary(
  reasons: RefusalReason[],
  total: number,
  period: ImportPeriod,
  maxVideoSeconds: number,
  mode: SummaryMode = 'result'
): string | null {
  const refused = reasons.length;
  if (refused === 0) return null;
  const counts = new Map<RefusalReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const mixed = counts.size > 1;
  const parts = REASON_ORDER.filter((reason) => counts.has(reason)).map((reason) => {
    const count = counts.get(reason) ?? 0;
    const text = reasonText(reason, count, period, maxVideoSeconds);
    return mixed ? `${count} ${text}` : text;
  });
  const hint = counts.has('unknown_date') ? ` ${DATE_HINT}` : '';
  return `${lead(mode, refused, total)}: ${parts.join(', ')}.${hint}`;
}
```

Achtung: im bisherigen Ergebnis-Modus lautete «1 von 3 Momenten wurden nicht eingesendet» (Plural-Verb auch bei 1); das bleibt so, die bestehenden Tests erwarten es. Nur der Preview-Modus unterscheidet «kommt» und «kommen».

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/features/moments/__tests__/libraryImport.test.ts`
Expected: alle grün.

- [ ] **Step 5: Typen und Lint**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: tsc still; eslint nur die bekannten 28.

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/features/moments/libraryImport.ts src/features/moments/__tests__/libraryImport.test.ts
git commit -m "feat(moments): Zusammenfassung der Ablehnungen auch in der Gegenwartsform für die Bestätigung"
```

---

### Task 3: `ImportIntroSheet`

Das Hinweis-Sheet vor dem Picker: ein Satz, drei Regeln mit den echten Werten, «Fotos auswählen», «Abbrechen».

**Files:**
- Create: `mobile/src/components/ImportIntroSheet.tsx`
- Test: `mobile/src/components/__tests__/ImportIntroSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet` (`@/components/Sheet`, Props `visible`, `title`, `onClose`, `cinemaMode`), `CinemaButton`/`CinemaTextLink` (Task 1), `formatRange` (`@/features/trips/tripDay`), `ImportPeriod` (`@/features/moments/libraryImport`).
- Produces: `export function ImportIntroSheet({ visible, period, maxVideoSeconds, selectionLimit, onPick, onClose }: { visible: boolean; period: ImportPeriod; maxVideoSeconds: number; selectionLimit: number; onPick: () => void; onClose: () => void })`. Sichtbare Texte: Titel «Momente aus Fotos», Knopf «Fotos auswählen», Link «Abbrechen».

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`mobile/src/components/__tests__/ImportIntroSheet.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { ImportIntroSheet } from '../ImportIntroSheet';

const PERIOD = { start_date: '2026-08-01', end_date: '2026-08-14' };

function renderSheet(over: Partial<React.ComponentProps<typeof ImportIntroSheet>> = {}) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  render(
    <ImportIntroSheet
      visible
      period={PERIOD}
      maxVideoSeconds={90}
      selectionLimit={20}
      onPick={onPick}
      onClose={onClose}
      {...over}
    />
  );
  return { onPick, onClose };
}

test('explains the three rules with the trip period, the video limit, and the selection limit', () => {
  renderSheet();
  expect(screen.getByText('Momente aus Fotos')).toBeTruthy();
  expect(
    screen.getByText(
      'Reelive holt Fotos und Videos aus deiner Fotomediathek in die Reise. Es gelten dieselben Regeln wie beim Aufnehmen:'
    )
  ).toBeTruthy();
  expect(screen.getByText('Nur Momente aus dem Reisezeitraum (1.–14. Aug 2026)')).toBeTruthy();
  expect(screen.getByText('Videos bis 90 Sekunden')).toBeTruthy();
  expect(screen.getByText('Ohne Caption, bis zum Recap versiegelt, höchstens 20 auf einmal')).toBeTruthy();
});

test('"Fotos auswählen" hands over to the picker, "Abbrechen" closes', () => {
  const { onPick, onClose } = renderSheet();
  fireEvent.press(screen.getByLabelText('Fotos auswählen'));
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Abbrechen'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the backdrop closes like "Abbrechen"', () => {
  const { onClose } = renderSheet();
  fireEvent.press(screen.getByTestId('sheet-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('invisible renders nothing', () => {
  renderSheet({ visible: false });
  expect(screen.queryByText('Momente aus Fotos')).toBeNull();
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/components/__tests__/ImportIntroSheet.test.tsx`
Expected: FAIL mit `Cannot find module '../ImportIntroSheet'`.

- [ ] **Step 3: Komponente schreiben**

`mobile/src/components/ImportIntroSheet.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { CinemaButton, CinemaTextLink } from './CinemaButton';
import { cinema, spacing, type } from '@/theme/tokens';
import { formatRange } from '@/features/trips/tripDay';
import type { ImportPeriod } from '@/features/moments/libraryImport';

type Props = {
  visible: boolean;
  period: ImportPeriod;
  maxVideoSeconds: number;
  selectionLimit: number;
  onPick: () => void;
  onClose: () => void;
};

// The sheet before the photo picker (decision 2026-08-27: shown on every
// tap, nothing remembered). It states the rules the assessment will apply,
// with the trip's own values, so a refusal afterwards never comes as a
// surprise. Cinema mode: it sits over the running viewfinder.
export function ImportIntroSheet({
  visible,
  period,
  maxVideoSeconds,
  selectionLimit,
  onPick,
  onClose,
}: Props) {
  const rules = [
    `Nur Momente aus dem Reisezeitraum (${formatRange(period.start_date, period.end_date)})`,
    `Videos bis ${maxVideoSeconds} Sekunden`,
    `Ohne Caption, bis zum Recap versiegelt, höchstens ${selectionLimit} auf einmal`,
  ];
  return (
    <Sheet visible={visible} title="Momente aus Fotos" onClose={onClose} cinemaMode>
      <Text style={[type.body, { color: cinema['text-1'] }]}>
        Reelive holt Fotos und Videos aus deiner Fotomediathek in die Reise. Es gelten dieselben
        Regeln wie beim Aufnehmen:
      </Text>
      <View style={styles.rules}>
        {rules.map((rule) => (
          <Text key={rule} style={[type.secondary, { color: cinema['text-2'] }]}>
            {rule}
          </Text>
        ))}
      </View>
      <CinemaButton label="Fotos auswählen" onPress={onPick} />
      <CinemaTextLink label="Abbrechen" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Tighter than the gap the sheet holds between its children: the three
  // rules belong together (4-pt grid, §3).
  rules: { gap: spacing.s },
});
```

Hinweis: der Satz im JSX ist über zwei Zeilen umbrochen; JSX fasst die Zeilen mit einem Leerzeichen zusammen, der Test erwartet genau «… in die Reise. Es gelten dieselben Regeln wie beim Aufnehmen:». Scheitert der Test am Umbruch, den Satz als Template-String in eine Konstante `INTRO_TEXT` ziehen.

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/components/__tests__/ImportIntroSheet.test.tsx`
Expected: alle grün.

- [ ] **Step 5: Typen und Lint, Commit**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`

```bash
cd mobile
git add src/components/ImportIntroSheet.tsx src/components/__tests__/ImportIntroSheet.test.tsx
git commit -m "feat(camera): Hinweis-Sheet vor dem Foto-Picker erklärt Reisezeitraum, Videolänge und Caption"
```

---

### Task 4: `ImportConfirmSheet`

Das Bestätigungs-Sheet nach der Auswahl: Vorschau-Streifen der zulässigen Elemente, Anzahl, was nicht mitkommt, «N Momente einsenden», «Abbrechen». Sind alle abgelehnt: «Nichts zum Einsenden» mit «Verstanden».

**Files:**
- Create: `mobile/src/components/ImportConfirmSheet.tsx`
- Test: `mobile/src/components/__tests__/ImportConfirmSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet`, `CinemaButton`/`CinemaTextLink` (Task 1), `AcceptedMedia` (`@/features/moments/libraryImport`), `Image` aus `expo-image`, Lucide `Film`.
- Produces: `export function ImportConfirmSheet({ visible, accepted, summary, onConfirm, onClose }: { visible: boolean; accepted: AcceptedMedia[]; summary: string | null; onConfirm: () => void; onClose: () => void })`. `summary` ist der Text aus `refusalSummary(..., 'preview')` oder null. Test-IDs `import-thumb-photo`, `import-thumb-video`. Texte: Titel «Einsenden?» bzw. «Nichts zum Einsenden»; «N Momente passen in den Reisezeitraum.» / «1 Moment passt in den Reisezeitraum.»; Knopf «N Momente einsenden» / «1 Moment einsenden» bzw. «Verstanden»; Link «Abbrechen».

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`mobile/src/components/__tests__/ImportConfirmSheet.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import type { AcceptedMedia } from '@/features/moments/libraryImport';
import { ImportConfirmSheet } from '../ImportConfirmSheet';

// expo-image is a native view; the stand-in passes the source through so
// the test can check which uri lands in which tile.
const mockImageProps = jest.fn();
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: Record<string, unknown>) => {
      mockImageProps(props);
      return ReactActual.createElement(View, props);
    },
  };
});

function accepted(uri: string, kind: 'photo' | 'video'): AcceptedMedia {
  return {
    accepted: true,
    media: { uri, kind, durationMs: kind === 'video' ? 12_000 : null, exif: null, creationTime: null, location: null },
    captured_at: '2026-08-05T12:00:00.000Z',
    captured_tz: 'Europe/Zurich',
    duration_s: kind === 'video' ? 12 : null,
    lat: null,
    lng: null,
  };
}

function renderSheet(over: Partial<React.ComponentProps<typeof ImportConfirmSheet>> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  render(
    <ImportConfirmSheet
      visible
      accepted={[accepted('file:///a.jpg', 'photo'), accepted('file:///b.mov', 'video'), accepted('file:///c.jpg', 'photo')]}
      summary={null}
      onConfirm={onConfirm}
      onClose={onClose}
      {...over}
    />
  );
  return { onConfirm, onClose };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('previews the accepted elements, photos as images and videos as film tiles, and counts them', () => {
  renderSheet();
  expect(screen.getByText('Einsenden?')).toBeTruthy();
  expect(screen.getAllByTestId('import-thumb-photo')).toHaveLength(2);
  expect(screen.getAllByTestId('import-thumb-video')).toHaveLength(1);
  expect(mockImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: { uri: 'file:///a.jpg' } }));
  expect(mockImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: { uri: 'file:///c.jpg' } }));
  expect(screen.getByText('3 Momente passen in den Reisezeitraum.')).toBeTruthy();
  expect(screen.getByLabelText('3 Momente einsenden')).toBeTruthy();
});

test('shows what stays out, in the present tense, above the buttons', () => {
  renderSheet({
    summary: '1 von 4 Momenten kommt nicht mit: Video länger als 90 Sekunden.',
  });
  expect(screen.getByText('1 von 4 Momenten kommt nicht mit: Video länger als 90 Sekunden.')).toBeTruthy();
});

test('a single element speaks in the singular', () => {
  renderSheet({ accepted: [accepted('file:///a.jpg', 'photo')] });
  expect(screen.getByText('1 Moment passt in den Reisezeitraum.')).toBeTruthy();
  expect(screen.getByLabelText('1 Moment einsenden')).toBeTruthy();
});

test('confirming and cancelling report to the caller', () => {
  const { onConfirm, onClose } = renderSheet();
  fireEvent.press(screen.getByLabelText('3 Momente einsenden'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Abbrechen'));
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('sheet-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('with nothing accepted there is only the explanation and "Verstanden"', () => {
  const { onConfirm, onClose } = renderSheet({
    accepted: [],
    summary: 'Keiner der 2 Momente kommt mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).',
  });
  expect(screen.getByText('Nichts zum Einsenden')).toBeTruthy();
  expect(
    screen.getByText('Keiner der 2 Momente kommt mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).')
  ).toBeTruthy();
  expect(screen.queryByLabelText(/einsenden$/)).toBeNull();
  expect(screen.queryByLabelText('Abbrechen')).toBeNull();
  fireEvent.press(screen.getByLabelText('Verstanden'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('invisible renders nothing', () => {
  renderSheet({ visible: false });
  expect(screen.queryByText('Einsenden?')).toBeNull();
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest src/components/__tests__/ImportConfirmSheet.test.tsx`
Expected: FAIL mit `Cannot find module '../ImportConfirmSheet'`.

- [ ] **Step 3: Komponente schreiben**

`mobile/src/components/ImportConfirmSheet.tsx`:

```tsx
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Film } from 'lucide-react-native';
import { Sheet } from './Sheet';
import { CinemaButton, CinemaTextLink } from './CinemaButton';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import type { AcceptedMedia } from '@/features/moments/libraryImport';

type Props = {
  visible: boolean;
  accepted: AcceptedMedia[];
  // The preview-tense refusal summary (refusalSummary(..., 'preview')), or
  // null when everything picked passed the rules.
  summary: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

const THUMB = 64;

function momentsText(count: number): string {
  return count === 1 ? '1 Moment' : `${count} Momente`;
}

// The confirmation after the picker (decision 2026-08-27): what would go
// in, as thumbnails and a count, what stays out and why, then the choice
// to submit or to cancel. A cancel releases every picked copy (the caller
// does that in onClose); nothing has entered the queue at this point.
export function ImportConfirmSheet({ visible, accepted, summary, onConfirm, onClose }: Props) {
  const count = accepted.length;
  if (count === 0) {
    return (
      <Sheet visible={visible} title="Nichts zum Einsenden" onClose={onClose} cinemaMode>
        {summary ? <Text style={[type.body, { color: cinema['text-1'] }]}>{summary}</Text> : null}
        <CinemaButton label="Verstanden" onPress={onClose} />
      </Sheet>
    );
  }
  return (
    <Sheet visible={visible} title="Einsenden?" onClose={onClose} cinemaMode>
      {/* A video's frame is not on hand yet (prepareVideo renders it only
          when submitting), so a video shows as a dark film tile; photos
          come straight from the picker copy. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {accepted.map((item) =>
          item.media.kind === 'photo' ? (
            <Image
              key={item.media.uri}
              testID="import-thumb-photo"
              accessible={false}
              source={{ uri: item.media.uri }}
              style={styles.thumb}
              contentFit="cover"
            />
          ) : (
            <View key={item.media.uri} testID="import-thumb-video" style={[styles.thumb, styles.videoTile]}>
              <Film size={22} color={cinema['text-2']} strokeWidth={1.75} />
            </View>
          )
        )}
      </ScrollView>
      <Text style={[type.body, { color: cinema['text-1'] }]}>
        {count === 1 ? '1 Moment passt in den Reisezeitraum.' : `${count} Momente passen in den Reisezeitraum.`}
      </Text>
      {summary ? <Text style={[type.secondary, { color: cinema['text-2'] }]}>{summary}</Text> : null}
      <CinemaButton label={`${momentsText(count)} einsenden`} onPress={onConfirm} />
      <CinemaTextLink label="Abbrechen" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: spacing.s },
  // Thumbnails at radius 12 (DESIGN-LANGUAGE §3), a fixed square so the
  // strip scrolls instead of the sheet growing.
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.control, overflow: 'hidden' },
  videoTile: { backgroundColor: cinema['bg-0'], alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd mobile && npx jest src/components/__tests__/ImportConfirmSheet.test.tsx`
Expected: alle grün.

- [ ] **Step 5: Typen und Lint, Commit**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`

```bash
cd mobile
git add src/components/ImportConfirmSheet.tsx src/components/__tests__/ImportConfirmSheet.test.tsx
git commit -m "feat(camera): Bestätigungs-Sheet zeigt Vorschau und Zahlen, bevor Momente aus Fotos eingesendet werden"
```

---

### Task 5: Kamera-Screen: Hinweis → Picker → Bestätigung → Batch

Der Handler `importFromLibrary` wird zu vier Funktionen; die zwei Sheets hängen im Screen. Die Import-Tests der Kamera werden auf den neuen Fluss umgeschrieben.

**Files:**
- Modify: `mobile/src/app/(tabs)/capture/index.tsx` (Imports Zeile 56-66, State bei 571-588, Handler 1210-1332, Render: Knopf bei 1978, Sheets vor `<MomentSubmissionAnimation` bei 2047)
- Test: `mobile/src/app/(tabs)/capture/__tests__/camera.test.tsx` (Mock bei 279-281, Import-Tests ab Zeile 3057 bis Dateiende)

**Interfaces:**
- Consumes: `ImportIntroSheet` (Task 3), `ImportConfirmSheet` (Task 4), `refusalSummary(..., 'preview')` (Task 2), `SELECTION_LIMIT` und `pickFromLibrary` aus `@/features/moments/libraryPicker`, alles Bestehende (`assess`, `submitImports`, `discardRefused`, `captureLock`, `MomentSubmissionAnimation`).
- Produces: sichtbarer Ablauf mit den Labels «Momente aus Fotos einsenden» (Knopf), «Fotos auswählen», «Abbrechen», «N Momente einsenden», «Verstanden».

- [ ] **Step 1: Tests umschreiben**

In `camera.test.tsx` den Picker-Mock (Zeile 279-281) um die Konstante ergänzen, sonst stünde «höchstens undefined auf einmal» im Sheet:

```ts
jest.mock('@/features/moments/libraryPicker', () => ({
  pickFromLibrary: () => mockPickFromLibrary(),
  SELECTION_LIMIT: 20,
}));
```

Einen Helfer hinter `pickedPhoto` ergänzen:

```ts
// Walks through the intro sheet: tap the header button, then "Fotos
// auswählen". Every import path starts this way now.
async function openLibrary() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Fotos auswählen'));
  });
}
```

Dann den gesamten Block ab dem Kommentar `// === Library import (spec 2026-08-27) ===` bis zum Dateiende durch diesen ersetzen:

```ts
// === Library import (spec 2026-08-27, confirmation 2026-08-27) ===

test('the import button opens the intro sheet; Abbrechen closes it without touching the library', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });

  expect(screen.getByText('Momente aus Fotos')).toBeTruthy();
  expect(screen.getByText('Nur Momente aus dem Reisezeitraum (1.–14. Aug 2026)')).toBeTruthy();
  expect(screen.getByText('Videos bis 90 Sekunden')).toBeTruthy();
  expect(screen.getByText('Ohne Caption, bis zum Recap versiegelt, höchstens 20 auf einmal')).toBeTruthy();
  expect(mockPickFromLibrary).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });

  expect(screen.queryByText('Momente aus Fotos')).toBeNull();
  expect(mockPickFromLibrary).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(false);
});

test('"Fotos auswählen" opens the picker, and a canceled picker leaves the viewfinder untouched', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(mockPickFromLibrary).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Momente aus Fotos')).toBeNull();
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockDiscardRefused).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(screen.queryByTestId('import-progress')).toBeNull();
  expect(captureLock.isLocked()).toBe(false);
});

test('elements outside the trip period end in "Nichts zum Einsenden", nothing is submitted', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///old.jpg', Date.UTC(2026, 6, 20, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(screen.getByText('Nichts zum Einsenden')).toBeTruthy();
  expect(
    screen.getByText('Der Moment kommt nicht mit: ausserhalb des Reisezeitraums (1.–14. Aug 2026).')
  ).toBeTruthy();
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///old.jpg' })]);

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Verstanden'));
  });

  expect(screen.queryByText('Nichts zum Einsenden')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();
});

test('the confirmation previews the accepted elements and names the refusals; Abbrechen releases every copy', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      {
        uri: 'file:///long.mov',
        kind: 'video' as const,
        durationMs: 120_000,
        exif: null,
        creationTime: Date.UTC(2026, 7, 5, 12),
        location: null,
      },
      pickedPhoto('file:///c.jpg', Date.UTC(2026, 7, 5, 12)),
    ],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(screen.getByText('Einsenden?')).toBeTruthy();
  expect(screen.getAllByTestId('import-thumb-photo')).toHaveLength(2);
  expect(screen.getByText('2 Momente passen in den Reisezeitraum.')).toBeTruthy();
  expect(screen.getByText('1 von 3 Momenten kommt nicht mit: Video länger als 90 Sekunden.')).toBeTruthy();
  // The refused copy leaves tmp as soon as it is assessed.
  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///long.mov' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Abbrechen'));
  });

  // Cancelling releases the accepted copies too: nothing of this batch
  // ever entered the queue.
  expect(mockDiscardRefused).toHaveBeenLastCalledWith([
    expect.objectContaining({ uri: 'file:///a.jpg' }),
    expect.objectContaining({ uri: 'file:///c.jpg' }),
  ]);
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(false);
});

test('confirming runs the batch: the shutter yields to the progress pill, the lock holds through the cover, the counter refetches', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockOwnCounter.mockImplementation(async () => 4);
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      pickedPhoto('file:///b.jpg', Date.UTC(2026, 7, 6, 12)),
    ],
  });
  let finishSubmit: (outcome: { submitted: number; failed: number }) => void = () => {};
  mockSubmitImports.mockImplementation(
    (_accepted: unknown, _target: unknown, onProgress: (done: number, total: number) => void) =>
      new Promise<{ submitted: number; failed: number }>((resolve) => {
        onProgress(1, 2);
        finishSubmit = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  await screen.findByText('4 Momente');

  await openLibrary();
  expect(screen.getByText('2 Momente passen in den Reisezeitraum.')).toBeTruthy();
  expect(mockSubmitImports).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('2 Momente einsenden'));
  });

  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).toHaveBeenCalledWith(
    [
      expect.objectContaining({ accepted: true, captured_at: '2026-08-05T12:00:00.000Z' }),
      expect.objectContaining({ accepted: true, captured_at: '2026-08-06T12:00:00.000Z' }),
    ],
    { tripId: 't1', authorId: 'u1' },
    expect.any(Function)
  );
  // During the batch: no shutter, no header, no tab switch, a progress pill.
  expect(screen.queryByLabelText('Auslöser')).toBeNull();
  expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();
  expect(screen.queryByLabelText('Reise wechseln, Norwegen mit dem Camper')).toBeNull();
  expect(screen.getByTestId('import-progress')).toBeTruthy();
  expect(screen.getByText('1 von 2 Momenten eingesendet')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(true);

  await act(async () => {
    finishSubmit({ submitted: 2, failed: 0 });
  });

  // The lock stays until the cover is gone.
  expect(captureLock.isLocked()).toBe(true);
  expect(screen.queryByTestId('import-progress')).toBeNull();
  expect(mockAnimationProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ visible: true, counter: 4, added: 2 })
  );

  mockOwnCounter.mockImplementation(async () => 6);
  await act(async () => {
    mockFinishAnimation?.();
  });

  expect(captureLock.isLocked()).toBe(false);
  expect(mockAnimationProps).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(screen.getByLabelText('Momente aus Fotos einsenden')).toBeTruthy();
  await screen.findByText('6 Momente');
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();
});

test('a failure inside the batch is explained after the animation, refusals are not repeated', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [
      pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12)),
      {
        uri: 'file:///long.mov',
        kind: 'video' as const,
        durationMs: 120_000,
        exif: null,
        creationTime: Date.UTC(2026, 7, 5, 12),
        location: null,
      },
      pickedPhoto('file:///c.jpg', Date.UTC(2026, 7, 5, 12)),
    ],
  });
  mockSubmitImports.mockResolvedValue({ submitted: 1, failed: 1 });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('2 Momente einsenden'));
  });

  expect(mockSubmitImports.mock.calls[0][0]).toHaveLength(2);
  expect(mockAnimationProps).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, added: 1 }));
  expect(screen.queryByText(/nicht eingesendet/)).toBeNull();
  expect(captureLock.isLocked()).toBe(true);

  await act(async () => {
    mockFinishAnimation?.();
  });

  expect(captureLock.isLocked()).toBe(false);
  // Only the batch failure: the long video was already explained in the
  // confirmation sheet and does not count against the two that were sent.
  expect(
    screen.getByText('1 von 2 Momenten wurden nicht eingesendet: beim Sichern gescheitert.')
  ).toBeTruthy();
});

test('when every confirmed element fails there is no animation, only the summary', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  mockSubmitImports.mockResolvedValue({ submitted: 0, failed: 1 });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });

  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(screen.getByText('Der Moment wurde nicht eingesendet: beim Sichern gescheitert.')).toBeTruthy();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(captureLock.isLocked()).toBe(false);
});

test('a failing picker says so in the pill', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockRejectedValue(new Error('picker broke'));
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(screen.getByText('Deine Fotos liessen sich nicht öffnen. Probier es nochmal.')).toBeTruthy();
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(mockSubmitImports).not.toHaveBeenCalled();
});

test('without a session the picked elements are released and the pill says so', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');
  // The session goes away AFTER the viewfinder stands (a screen without a
  // session would not load its trips); the refocus re-renders the screen so
  // the handler closes over the missing user id.
  mockAuth.userId = null;
  await refocusScreen();
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(screen.queryByText('Einsenden?')).toBeNull();
  expect(screen.getByText('Du bist nicht angemeldet. Melde dich an und probier es nochmal.')).toBeTruthy();
});

test('while the picker is pending the header button opens no second intro, and during the batch it is gone', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePicker: (result: { canceled: true } | { canceled: false; media: unknown[] }) => void =
    () => {};
  mockPickFromLibrary.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  // "Fotos auswählen" closes the intro and starts the picker; the native
  // round trip is still pending (requestReadAccess awaits a permission
  // check before launchImageLibraryAsync even presents), so the header
  // button is back on screen and tappable.
  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Momente aus Fotos einsenden'));
  });
  expect(screen.queryByText('Momente aus Fotos')).toBeNull();

  await act(async () => {
    resolvePicker({ canceled: true });
  });
  expect(mockPickFromLibrary).toHaveBeenCalledTimes(1);

  // Once a batch runs the header, and with it the button, is removed.
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  let resolveSubmit: (outcome: { submitted: number; failed: number }) => void = () => {};
  mockSubmitImports.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSubmit = resolve;
      })
  );
  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });

  expect(screen.queryByLabelText('Momente aus Fotos einsenden')).toBeNull();
  expect(mockSubmitImports).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveSubmit({ submitted: 1, failed: 0 });
  });
});

test('a blur during the batch clears the import state so the viewfinder comes back', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  mockPickFromLibrary.mockResolvedValue({
    canceled: false,
    media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
  });
  let resolveSubmit: (outcome: { submitted: number; failed: number }) => void = () => {};
  mockSubmitImports.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSubmit = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('1 Moment einsenden'));
  });
  expect(screen.getByTestId('import-progress')).toBeTruthy();

  await blurScreen();

  await act(async () => {
    resolveSubmit({ submitted: 1, failed: 0 });
  });

  await refocusScreen();
  await screen.findByLabelText('Auslöser');

  expect(screen.queryByTestId('import-progress')).toBeNull();
  expect(screen.getByLabelText('Auslöser')).toBeTruthy();
  expect(mockAnimationProps).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  expect(captureLock.isLocked()).toBe(false);
});

test('a blur while the picker is open releases the picked copies', async () => {
  (fetchTrips as jest.Mock).mockResolvedValue(loaded([trip()]));
  let resolvePicker: (result: { canceled: false; media: unknown[] }) => void = () => {};
  mockPickFromLibrary.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
  );
  await render(<CaptureScreen />);
  await screen.findByLabelText('Auslöser');

  await openLibrary();

  await blurScreen();

  await act(async () => {
    resolvePicker({
      canceled: false,
      media: [pickedPhoto('file:///a.jpg', Date.UTC(2026, 7, 5, 12))],
    });
  });

  expect(mockDiscardRefused).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///a.jpg' })]);
  expect(mockSubmitImports).not.toHaveBeenCalled();
  expect(screen.queryByText('Einsenden?')).toBeNull();
});
```

Der bisherige Test «a long refusal summary stays longer than a short error» entfällt: Ablehnungen erscheinen jetzt im Sheet, nicht in der Pille; die längenabhängige Haltezeit bleibt im Code für Batch-Fehler.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd mobile && npx jest "src/app/(tabs)/capture/__tests__/camera.test.tsx"`
Expected: die zwölf Import-Tests scheitern (der erste an `Unable to find an element with text: Momente aus Fotos`, die anderen an `Unable to find an element with accessibility label: Fotos auswählen`); alle übrigen Tests der Datei bleiben grün.

- [ ] **Step 3: Imports**

Bei den Komponenten-Imports (nach `import { MomentSubmissionAnimation } from '@/components/MomentSubmissionAnimation';`):

```ts
import { ImportIntroSheet } from '@/components/ImportIntroSheet';
import { ImportConfirmSheet } from '@/components/ImportConfirmSheet';
```

Den Picker-Import erweitern:

```ts
import { pickFromLibrary, SELECTION_LIMIT, type PickResult } from '@/features/moments/libraryPicker';
```

- [ ] **Step 4: Zustand**

Hinter `const heldSummary = useRef<string | null>(null);`:

```ts
  // Where the library import stands between the two sheets: the intro
  // (rules, "Fotos auswählen") and the confirmation (what would go in,
  // what stays out). null: no sheet open. The picker itself and the batch
  // live in importRunning/importing, not here.
  const [importStage, setImportStage] = useState<
    | { kind: 'intro' }
    | { kind: 'confirm'; total: number; accepted: AcceptedMedia[]; reasons: RefusalReason[] }
    | null
  >(null);
```

- [ ] **Step 5: Handler**

Die ganze Funktion `importFromLibrary` (vom Kommentar «The library import (spec 2026-08-27): pick, assess …» bis zum schliessenden `};` vor dem Kommentar «The success animation has played») ersetzen durch:

```ts
  // The library import (spec 2026-08-27, confirmation 2026-08-27), in four
  // moves: the intro sheet (openImport), picker plus assessment ending in
  // the confirmation sheet (pickAndAssess), the batch (confirmImport), and
  // the way out (cancelImport). `trip` is a const narrowed above, so the
  // closures keep it non-null across the awaits.
  const openImport = () => {
    if (importing || capturing || importRunning.current) return;
    setCaptureError(null);
    setImportStage({ kind: 'intro' });
  };

  // Abbrechen, the backdrop, or a swipe on either sheet. In the
  // confirmation stage the accepted copies never entered the queue, so
  // they leave tmp like the refused ones did.
  const cancelImport = () => {
    if (importStage?.kind === 'confirm') {
      discardRefused(importStage.accepted.map((item) => item.media));
    }
    setImportStage(null);
  };

  const pickAndAssess = async () => {
    // Re-entry guard (same pattern as photoRunning above): pickFromLibrary
    // awaits a permission check (requestReadAccess in libraryPicker.ts)
    // before it even presents, so the screen stays fully interactive for
    // that whole native round trip; the header button is back the moment
    // the intro sheet closes.
    if (importRunning.current) return;
    importRunning.current = true;
    setImportStage(null);
    try {
      let picked: PickResult;
      try {
        picked = await pickFromLibrary();
      } catch (error) {
        console.error('[capture] library picker failed', error);
        if (active.current) setCaptureError(IMPORT_PICKER_ERROR_TEXT);
        return;
      }
      if (picked.canceled || picked.media.length === 0) return;
      if (!active.current) {
        // A blur while the picker was open (deep link, back navigation): the
        // picked copies still sit in tmp and have to leave, same as any
        // other refusal path.
        discardRefused(picked.media);
        return;
      }
      if (!userId) {
        discardRefused(picked.media);
        setCaptureError(IMPORT_WITHOUT_SESSION_TEXT);
        return;
      }

      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const assessed = picked.media.map((item) => assess(item, trip, MAX_VIDEO_SECONDS, deviceTz));
      const accepted = assessed.filter((item): item is AcceptedMedia => item.accepted);
      const reasons: RefusalReason[] = [];
      const refused: PickedMedia[] = [];
      for (const item of assessed) {
        if (!item.accepted) {
          reasons.push(item.reason);
          refused.push(item.media);
        }
      }
      // Refused copies leave tmp right away; the accepted ones wait for the
      // confirmation (submitImports releases them, or cancelImport does).
      discardRefused(refused);
      setImportStage({ kind: 'confirm', total: picked.media.length, accepted, reasons });
    } finally {
      importRunning.current = false;
    }
  };

  const confirmImport = async () => {
    if (importStage?.kind !== 'confirm' || importRunning.current) return;
    const { accepted } = importStage;
    if (!userId) {
      discardRefused(accepted.map((item) => item.media));
      setImportStage(null);
      setCaptureError(IMPORT_WITHOUT_SESSION_TEXT);
      return;
    }
    importRunning.current = true;
    setImportStage(null);
    try {
      // No tab switch in the middle of the batch (captureLock.ts), for the
      // same reason as during a capture: the focus cleanup must not
      // interrupt it.
      captureLock.lock(true);
      const counterBefore = counter;
      setImporting({ done: 0, total: accepted.length });
      let outcome: ImportOutcome;
      try {
        outcome = await submitImports(
          accepted,
          { tripId: trip.id, authorId: userId },
          (done, count) => {
            if (active.current) setImporting({ done, total: count });
          }
        );
      } catch (error) {
        // submitImports catches per element; this is the queue itself
        // failing to initialize. Every accepted element then counts as
        // failed.
        console.error('[capture] library import failed', error);
        outcome = { submitted: 0, failed: accepted.length };
      }
      // Cleared unconditionally: a blur during the batch (deep link, router
      // push) sets active.current false but never re-enters this handler,
      // and `importing` is the only thing keeping shutter and header gone.
      setImporting(null);
      if (!active.current) {
        // Nobody is left to watch the cover, so nothing holds the lock open
        // for it either.
        captureLock.lock(false);
        return;
      }
      // The refusals were explained in the confirmation sheet; the pill
      // afterwards only reports what failed inside the batch, measured
      // against what was confirmed.
      const failures: RefusalReason[] = [];
      for (let i = 0; i < outcome.failed; i += 1) failures.push('failed');
      const summary = refusalSummary(failures, accepted.length, trip, MAX_VIDEO_SECONDS);
      if (outcome.submitted === 0) {
        // Nothing was submitted, so there is no cover to hold the lock for
        // either: the summary is the whole story, right away.
        captureLock.lock(false);
        setCaptureError(summary);
        return;
      }
      // The lock stays SET here: the cinema tab bar sits over this screen,
      // and a tab tap during the 3.6 s cover must not slip past a lock that
      // was already released. finishImport below releases it once the
      // cover is gone.
      heldSummary.current = summary;
      setImportDone({ added: outcome.submitted, counterBefore });
    } finally {
      importRunning.current = false;
    }
  };
```

`finishImport` bleibt unverändert.

- [ ] **Step 6: Render**

Den Knopf umhängen:

```tsx
            <PillButton label="Momente aus Fotos einsenden" onPress={openImport}>
```

Direkt vor `<MomentSubmissionAnimation` die zwei Sheets einfügen (Geschwister des Sucher-Baums, wie das Kommentar-Sheet im Player, damit sie über allen Tipp-Zonen liegen):

```tsx
      <ImportIntroSheet
        visible={importStage?.kind === 'intro'}
        period={trip}
        maxVideoSeconds={MAX_VIDEO_SECONDS}
        selectionLimit={SELECTION_LIMIT}
        onPick={() => void pickAndAssess()}
        onClose={cancelImport}
      />
      <ImportConfirmSheet
        visible={importStage?.kind === 'confirm'}
        accepted={importStage?.kind === 'confirm' ? importStage.accepted : []}
        summary={
          importStage?.kind === 'confirm'
            ? refusalSummary(importStage.reasons, importStage.total, trip, MAX_VIDEO_SECONDS, 'preview')
            : null
        }
        onConfirm={() => void confirmImport()}
        onClose={cancelImport}
      />
```

- [ ] **Step 7: Tests laufen lassen**

Run: `cd mobile && npx jest "src/app/(tabs)/capture/__tests__/camera.test.tsx"`
Expected: die ganze Datei grün.

Stolpersteine:
- Findet ein Test «Fotos auswählen» nicht: `Sheet` rendert nur bei `visible`; `importStage?.kind === 'intro'` muss nach dem Knopf-Tipp wahr sein, also `openImport` synchron `setImportStage` setzen (kein `await` davor).
- Steht nach «Abbrechen» im Bestätigungs-Sheet der letzte `discardRefused`-Aufruf nicht mit den zwei Fotos: `cancelImport` liest `importStage` aus dem Render-Closure; das Sheet muss `onClose={cancelImport}` bekommen, nicht eine ältere Referenz.

- [ ] **Step 8: Typen und Lint**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: tsc still; eslint nur die bekannten 28. Falls `PickedMedia` oder `RefusalReason` nach dem Umbau als ungenutzt gemeldet würden: sie werden in `pickAndAssess` bzw. im State-Typ weiter gebraucht, dann stimmt etwas am Umbau.

- [ ] **Step 9: Commit**

```bash
cd mobile
git add "src/app/(tabs)/capture/index.tsx" "src/app/(tabs)/capture/__tests__/camera.test.tsx"
git commit -m "feat(camera): Fotos-Import fragt vor dem Picker mit den Regeln und bestätigt die Auswahl vor dem Einsenden"
```

---

### Task 6: Spec nachführen, Gesamtlauf

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-fotos-import-design.md` (Abschnitte «Ablauf in der Kamera», «Copy», «Module», «Tests»)

- [ ] **Step 1: Spec anpassen**

In «Ablauf in der Kamera» die Punkte 2 bis 5 ersetzen durch:

```markdown
2. Tipp → **Hinweis-Sheet** «Momente aus Fotos» (Kino-Modus, jedes Mal,
   Entscheid 2026-08-27): ein Satz und drei Regeln mit den Werten der
   Reise (Reisezeitraum aus `formatRange`, Videolänge, «Ohne Caption, bis
   zum Recap versiegelt, höchstens 20 auf einmal»), Knopf «Fotos auswählen»,
   Textlink «Abbrechen». Wischen oder Tipp daneben gilt als Abbrechen.
3. «Fotos auswählen» → Leseberechtigung anfragen (eine Ablehnung stoppt
   nichts) → iOS-Picker mit `mediaTypes: ['images', 'videos']`,
   `allowsMultipleSelection`, `selectionLimit: 20`, `orderedSelection`,
   `exif: true`, `quality: 1`, `preferredAssetRepresentationMode: Compatible`
   (HEIC → JPEG), `videoExportPreset: H264_1920x1080` (erzwingt HEVC →
   H.264, siehe Entscheide), **kein `allowsEditing`** (der Avatar-Bug vom
   2026-08-13). Abbruch im Picker: nichts passiert.
4. Jedes Element wird bewertet (Datum, Zeitraum, Videolänge). Abgelehnte
   Picker-Kopien werden sofort gelöscht.
5. **Bestätigungs-Sheet** «Einsenden?»: Vorschau-Streifen der zulässigen
   Elemente (Fotos aus der Picker-Kopie, Videos als dunkle Film-Kachel),
   «N Momente passen in den Reisezeitraum.», darunter in Zweitfarbe die
   Zusammenfassung der Ablehnungen in der Gegenwartsform, Knopf «N Momente
   einsenden», Textlink «Abbrechen». Abbrechen löscht alle Kopien, nichts
   wird eingesendet. Sind alle abgelehnt: Titel «Nichts zum Einsenden», die
   Erklärung, ein Knopf «Verstanden».
```

Punkt 7, letzter Satz («… und eine zurückgehaltene Zusammenfassung der Ablehnungen bekommt die Pille.») ersetzen durch: «… und eine zurückgehaltene Zusammenfassung der Elemente, die beim Sichern gescheitert sind, bekommt die Pille (die Ablehnungen hat das Bestätigungs-Sheet schon erklärt).»

In «Copy» nach der Zeile «Knopf: …» ergänzen:

```markdown
- Hinweis-Sheet: Titel «Momente aus Fotos», «Reelive holt Fotos und Videos
  aus deiner Fotomediathek in die Reise. Es gelten dieselben Regeln wie beim
  Aufnehmen:», «Nur Momente aus dem Reisezeitraum (1.–14. Aug 2026)», «Videos
  bis 90 Sekunden», «Ohne Caption, bis zum Recap versiegelt, höchstens 20 auf
  einmal», «Fotos auswählen», «Abbrechen»
- Bestätigungs-Sheet: Titel «Einsenden?» bzw. «Nichts zum Einsenden», «N
  Momente passen in den Reisezeitraum.» / «1 Moment passt in den
  Reisezeitraum.», «N Momente einsenden» / «1 Moment einsenden», «Abbrechen»,
  «Verstanden»
- Zusammenfassung in der Gegenwartsform (Bestätigungs-Sheet): «Der Moment
  kommt nicht mit: …», «1 von {total} Momenten kommt nicht mit: …»,
  «{refused} von {total} Momenten kommen nicht mit: …», «Keiner der {total}
  Momente kommt mit: …»; dieselben Gründe wie unten.
```

In «Module» ergänzen: `components/CinemaButton.tsx` (aus Player und Share herausgelöst), `components/ImportIntroSheet.tsx`, `components/ImportConfirmSheet.tsx`; bei `capture/index.tsx` den Zustand `importStage` und die vier Handler nennen. In «Tests» die Sheets und den neuen Kamera-Fluss ergänzen.

- [ ] **Step 2: Gesamtlauf**

Run: `cd mobile && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npm test`
Expected: tsc still, eslint nur die 28 bekannten Fehler, Jest komplett grün (Baseline 122 Suites / 2134 Tests plus die drei neuen Komponenten-Suites).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-fotos-import-design.md
git commit -m "docs(spec): Fotos-Import: Hinweis-Sheet und Bestätigung im Ablauf und in der Copy"
```

- [ ] **Step 4: Geräte-Prüfliste (manuell)**

Zusätzlich zur Liste in der Spec: Hinweis-Sheet über dem laufenden Sucher (Kino-Fläche, Grabber, Wischen schliesst); Bestätigungs-Sheet mit echten Thumbnails (HEIC-Fotos, Video-Kachel), Scrollen des Streifens bei 20 Elementen; «Abbrechen» im Bestätigungs-Sheet lässt keine tmp-Dateien zurück (Metro-Log auf `discardFile`); Bestätigen führt in Fortschritt und Animation wie bisher.
