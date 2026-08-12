# Zeitraum-Auswahl Implementierungsplan

> **Für agentische Worker:** ERFORDERLICHE SUB-SKILL: `superpowers:executing-plans`
> oder `superpowers:subagent-driven-development`, um diesen Plan Task für Task
> umzusetzen. Die Schritte nutzen Checkbox-Syntax (`- [ ]`) zur Nachverfolgung.

**Ziel:** Die getippten Datumsfelder «Beginn» und «Ende» in beiden
Reise-Formularen durch eine Zeitraum-Auswahl im Kalender ersetzen, die
aussieht und sich bedient wie der Datepicker von Airbnb.

**Architektur:** Drei Einheiten. `kalender.ts` trägt die gesamte Logik als
reine Funktionen ohne React, `Kalender.tsx` rendert den Monatsstapel
zustandslos, `Zeitraumfeld.tsx` verbindet Formularfeld und Sheet. Die beiden
Screens halten danach eine `Auswahl` aus ISO-Kalendertagen statt zweier
getippter Strings.

**Tech-Stack:** Expo 57 / React Native 0.86, TypeScript strict, Jest mit
`@testing-library/react-native`, bestehende Komponenten `Sheet`, `PressScale`,
`Button` und die Tokens aus `src/theme/tokens.ts`.

**Spec:** `docs/superpowers/specs/2026-08-12-datumsauswahl-design.md`

## Global Constraints

- Arbeitsverzeichnis für alle Befehle: `mobile/`. Tests laufen mit `npm test`,
  Linting mit `npm run lint`.
- UI-Sprache Deutsch, Du-Form. Vokabular gemäss DESIGN-LANGUAGE §6.
- **Keine Gedankenstriche in sichtbarem Text**, inklusive Vorlese-Beschriftungen
  (DESIGN-LANGUAGE §6). Der Bis-Strich in Bereichen (`1.–14. Aug 2026`) ist
  ausgenommen und bleibt.
- Farben ausschliesslich über Tokens, nie als Hex-Wert im Code
  (DESIGN-LANGUAGE §1 und §9).
- Radius nur aus `radius` (`control` 12, `card` 24, `pill` 999). Abstände nur
  aus `spacing`.
- Press-Feedback als Scale per Spring über `PressScale`, nie Opacity-Dimmen
  (DESIGN-LANGUAGE §5).
- Datumswerte sind überall ISO-Kalendertage `YYYY-MM-DD` ohne Zeitzone.
  Vergleiche laufen direkt auf den Strings, nie über `Date`-Objekte.
  Datumsarithmetik rechnet in UTC, wie `tripDay.ts` es vormacht.
- Jede neue Komponente nimmt `heute` als optionales Prop mit Default
  `heutigerKalendertag()`. Ohne diesen Einstieg hingen die Tests am echten
  Systemdatum und würden im Folgemonat brechen.
- Commit-Nachrichten auf Deutsch im bestehenden Stil des Repos
  (`feat(bereich): …`, `test(bereich): …`, `refactor(bereich): …`).

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `src/features/trips/kalender.ts` (neu) | Reine Logik: Monatsraster, Auswahlregeln, Zellrollen, Höhen, Beschriftungen |
| `src/features/trips/__tests__/kalender.test.ts` (neu) | Tests dazu, ohne Rendering |
| `src/components/Kalender.tsx` (neu) | Wochentagszeile und Monatsstapel, zustandslos |
| `src/components/__tests__/Kalender.test.tsx` (neu) | Rendering, Rollen, Tipps |
| `src/components/Zeitraumfeld.tsx` (neu) | Formularfeld plus Sheet, hält den Entwurf |
| `src/components/__tests__/Zeitraumfeld.test.tsx` (neu) | Öffnen, Wählen, Übernehmen, Verwerfen |
| `src/app/(tabs)/reise/neu.tsx` (ändern) | Zwei Datumsfelder durch ein `Zeitraumfeld` ersetzen |
| `src/app/(tabs)/reise/[id]/bearbeiten.tsx` (ändern) | Dasselbe, plus Vorbelegung ohne Umformatierung |
| `src/app/(tabs)/reise/__tests__/formular.test.tsx` (ändern) | Drei Tests umbauen, zwei entfernen |
| `src/features/trips/tripDay.ts` (ändern) | `parseGermanDate` und `formatGermanDate` entfernen |
| `src/features/trips/__tests__/tripDay.test.ts` (ändern) | Deren Tests entfernen |

---

### Task 1: Kalender-Logik

Reine Funktionen, kein React. Dieselbe Trennung wie `wischUeberSchwelle` in
`Sheet.tsx`: die Entscheidungen sind ohne simulierte Touch-Events prüfbar.

**Files:**
- Create: `src/features/trips/kalender.ts`
- Test: `src/features/trips/__tests__/kalender.test.ts`

**Interfaces:**
- Consumes: `heutigerKalendertag` aus `src/features/trips/tripDay.ts`
- Produces:
  - `type Auswahl = { start: string | null; end: string | null }`
  - `type Zellrolle = 'frei' | 'beginn' | 'ende' | 'dazwischen' | 'einzeln' | 'gesperrt'`
  - `type Monat = { jahr: number; monat: number; titel: string; wochen: (string | null)[][] }`
  - `monatRaster(jahr: number, monat: number): Monat`
  - `monateImBereich(heute: string): Monat[]`
  - `naechsteAuswahl(aktuell: Auswahl, getippt: string): Auswahl`
  - `zellrolle(tag: string, auswahl: Auswahl, ersterTag: string, letzterTag: string): Zellrolle`
  - `monatHoehe(monat: Monat): number`
  - `monatVersatz(monate: Monat[], index: number): number`
  - `monatIndexFuer(monate: Monat[], tag: string | null): number`
  - `tagLabel(tag: string): string`
  - Konstanten `ZEILE_HOEHE`, `MONAT_KOPF_HOEHE`, `MONAT_ABSTAND`,
    `MONATE_ZURUECK`, `MONATE_VORWAERTS`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `src/features/trips/__tests__/kalender.test.ts`:

```ts
import {
  MONATE_VORWAERTS, MONATE_ZURUECK, monatHoehe, monatIndexFuer, monatRaster,
  monatVersatz, monateImBereich, naechsteAuswahl, tagLabel, zellrolle,
  ZEILE_HOEHE, MONAT_KOPF_HOEHE, MONAT_ABSTAND,
} from '../kalender';

const LEER = { start: null, end: null };

test('monatRaster füllt den August 2026 mit Montag als Wochenstart', () => {
  const m = monatRaster(2026, 8);
  expect(m.titel).toBe('August 2026');
  // Der 1.8.2026 ist ein Samstag, also fünf Leerzellen davor.
  expect(m.wochen[0]).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02']);
  expect(m.wochen[1][0]).toBe('2026-08-03');
});

test('monatRaster füllt die letzte Woche bis zum Sonntag auf', () => {
  const m = monatRaster(2026, 8);
  const letzte = m.wochen[m.wochen.length - 1];
  expect(letzte).toHaveLength(7);
  expect(letzte.filter((t) => t === null).length).toBeGreaterThan(0);
});

test('monatRaster kennt den Schaltjahr-Februar', () => {
  const tage = monatRaster(2028, 2).wochen.flat().filter(Boolean);
  expect(tage).toHaveLength(29);
  expect(tage[28]).toBe('2028-02-29');
});

test('monatRaster kennt den gewöhnlichen Februar', () => {
  expect(monatRaster(2027, 2).wochen.flat().filter(Boolean)).toHaveLength(28);
});

test('monateImBereich reicht ein Jahr zurück und zwei Jahre vorwärts', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monate).toHaveLength(MONATE_ZURUECK + MONATE_VORWAERTS + 1);
  expect(monate[0].titel).toBe('August 2025');
  expect(monate[MONATE_ZURUECK].titel).toBe('August 2026');
  expect(monate[monate.length - 1].titel).toBe('August 2028');
});

test('monateImBereich läuft sauber über die Jahresgrenze', () => {
  const monate = monateImBereich('2026-01-15');
  expect(monate[0].titel).toBe('Januar 2025');
  expect(monate[MONATE_ZURUECK].titel).toBe('Januar 2026');
});

test('naechsteAuswahl: der erste Tipp setzt den Beginn', () => {
  expect(naechsteAuswahl(LEER, '2026-08-05')).toEqual({ start: '2026-08-05', end: null });
});

test('naechsteAuswahl: ein späterer Tag wird zum Ende', () => {
  const vorher = { start: '2026-08-05', end: null };
  expect(naechsteAuswahl(vorher, '2026-08-14')).toEqual({ start: '2026-08-05', end: '2026-08-14' });
});

test('naechsteAuswahl: ein früherer Tag setzt den Beginn neu', () => {
  const vorher = { start: '2026-08-05', end: null };
  expect(naechsteAuswahl(vorher, '2026-08-01')).toEqual({ start: '2026-08-01', end: null });
});

test('naechsteAuswahl: derselbe Tag ergibt die Tagesreise', () => {
  const vorher = { start: '2026-08-05', end: null };
  expect(naechsteAuswahl(vorher, '2026-08-05')).toEqual({ start: '2026-08-05', end: '2026-08-05' });
});

test('naechsteAuswahl: ein fertiger Zeitraum beginnt von vorn', () => {
  const vorher = { start: '2026-08-05', end: '2026-08-14' };
  expect(naechsteAuswahl(vorher, '2026-09-02')).toEqual({ start: '2026-09-02', end: null });
});

describe('zellrolle', () => {
  const auswahl = { start: '2026-08-05', end: '2026-08-14' };
  const ersterTag = '2025-08-01';
  const letzterTag = '2028-08-31';
  const rolle = (tag: string, a = auswahl) => zellrolle(tag, a, ersterTag, letzterTag);

  test('erkennt Beginn und Ende', () => {
    expect(rolle('2026-08-05')).toBe('beginn');
    expect(rolle('2026-08-14')).toBe('ende');
  });

  test('erkennt die Tage dazwischen', () => {
    expect(rolle('2026-08-09')).toBe('dazwischen');
  });

  test('lässt Tage ausserhalb der Spanne frei', () => {
    expect(rolle('2026-08-04')).toBe('frei');
    expect(rolle('2026-08-15')).toBe('frei');
  });

  test('sperrt Tage ausserhalb des Bereichs', () => {
    expect(rolle('2025-07-31')).toBe('gesperrt');
    expect(rolle('2028-09-01')).toBe('gesperrt');
  });

  test('nennt die Tagesreise einzeln, nicht Beginn', () => {
    const tagesreise = { start: '2026-08-05', end: '2026-08-05' };
    expect(rolle('2026-08-05', tagesreise)).toBe('einzeln');
  });

  test('markiert bei halber Auswahl nur den Beginn', () => {
    const halb = { start: '2026-08-05', end: null };
    expect(rolle('2026-08-05', halb)).toBe('beginn');
    expect(rolle('2026-08-09', halb)).toBe('frei');
  });
});

test('monatHoehe rechnet Kopf, Wochenzeilen und Abstand zusammen', () => {
  const m = monatRaster(2026, 8);
  expect(monatHoehe(m)).toBe(MONAT_KOPF_HOEHE + m.wochen.length * ZEILE_HOEHE + MONAT_ABSTAND);
});

test('monatVersatz summiert die Höhen der Monate davor', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monatVersatz(monate, 0)).toBe(0);
  expect(monatVersatz(monate, 2)).toBe(monatHoehe(monate[0]) + monatHoehe(monate[1]));
});

test('monatIndexFuer findet den Monat eines Tages', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monatIndexFuer(monate, '2026-08-05')).toBe(MONATE_ZURUECK);
  expect(monatIndexFuer(monate, '2026-09-02')).toBe(MONATE_ZURUECK + 1);
});

test('monatIndexFuer fällt ohne Tag auf den ersten Monat zurück', () => {
  const monate = monateImBereich('2026-08-12');
  expect(monatIndexFuer(monate, null)).toBe(0);
});

test('tagLabel schreibt den Monat aus', () => {
  expect(tagLabel('2026-08-14')).toBe('14. August 2026');
  expect(tagLabel('2026-01-01')).toBe('1. Januar 2026');
});
```

- [ ] **Schritt 2: Test laufen lassen und Fehlschlag prüfen**

```bash
cd mobile && npm test -- kalender.test.ts
```

Erwartet: FAIL mit `Cannot find module '../kalender'`.

- [ ] **Schritt 3: Die Logik schreiben**

Datei `src/features/trips/kalender.ts`:

```ts
import { heutigerKalendertag } from './tripDay';

// Ausgeschriebene Monatsnamen. `tripDay.ts` führt daneben eine Kurzliste für
// `formatRange`; beide bleiben getrennt, weil sie verschiedene Zwecke haben:
// die Kurzform steht am Feld, die Langform wird vorgelesen (Spec §9).
const MONATE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export const MONATE_ZURUECK = 12;
export const MONATE_VORWAERTS = 24;

// Masse des Rasters. Sie stehen hier und nicht in der Komponente, weil
// `getItemLayout` die Monatshöhe kennen muss, BEVOR gerendert wird.
export const ZEILE_HOEHE = 48;
export const MONAT_KOPF_HOEHE = 44;
export const MONAT_ABSTAND = 24;

export type Auswahl = { start: string | null; end: string | null };

export type Zellrolle = 'frei' | 'beginn' | 'ende' | 'dazwischen' | 'einzeln' | 'gesperrt';

export type Monat = {
  jahr: number;
  monat: number; // 1 bis 12
  titel: string;
  // Sieben Einträge je Woche, `null` für die Leerzellen vor dem Ersten und
  // nach dem Letzten.
  wochen: (string | null)[][];
};

function alsIso(jahr: number, monat: number, tag: number): string {
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

// Tag 0 des Folgemonats ist der letzte Tag dieses Monats, das erspart eine
// eigene Schaltjahr-Regel.
function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

// getUTCDay() zählt ab Sonntag, das Raster beginnt am Montag.
function versatzDesErsten(jahr: number, monat: number): number {
  return (new Date(Date.UTC(jahr, monat - 1, 1)).getUTCDay() + 6) % 7;
}

export function monatRaster(jahr: number, monat: number): Monat {
  const zellen: (string | null)[] = Array(versatzDesErsten(jahr, monat)).fill(null);
  for (let tag = 1; tag <= tageImMonat(jahr, monat); tag++) {
    zellen.push(alsIso(jahr, monat, tag));
  }
  // Auf volle Wochen auffüllen, damit jede Zeile sieben Zellen hat und die
  // Spalten über alle Monate hinweg fluchten.
  while (zellen.length % 7 !== 0) zellen.push(null);

  const wochen: (string | null)[][] = [];
  for (let i = 0; i < zellen.length; i += 7) wochen.push(zellen.slice(i, i + 7));
  return { jahr, monat, titel: `${MONATE[monat - 1]} ${jahr}`, wochen };
}

export function monateImBereich(heute: string): Monat[] {
  const [jahr, monat] = heute.split('-').map(Number);
  // In fortlaufenden Monaten rechnen statt mit Date: so gibt es keinen
  // Sonderfall an der Jahresgrenze.
  const ersterLauf = jahr * 12 + (monat - 1) - MONATE_ZURUECK;
  const anzahl = MONATE_ZURUECK + MONATE_VORWAERTS + 1;
  return Array.from({ length: anzahl }, (_, i) => {
    const lauf = ersterLauf + i;
    return monatRaster(Math.floor(lauf / 12), (lauf % 12) + 1);
  });
}

// Die vier Regeln aus Spec §3. Regel 1 (kein Beginn) und Regel 4 (fertiger
// Zeitraum) fallen zusammen: beide fangen mit dem getippten Tag neu an.
export function naechsteAuswahl(aktuell: Auswahl, getippt: string): Auswahl {
  if (!aktuell.start || aktuell.end) return { start: getippt, end: null };
  if (getippt < aktuell.start) return { start: getippt, end: null };
  return { start: aktuell.start, end: getippt };
}

export function zellrolle(
  tag: string,
  auswahl: Auswahl,
  ersterTag: string,
  letzterTag: string
): Zellrolle {
  if (tag < ersterTag || tag > letzterTag) return 'gesperrt';
  const { start, end } = auswahl;
  // Die Tagesreise zuerst: sie ist Beginn UND Ende, bekommt aber keine
  // halbseitige Fläche, sonst ragte der Balken ins Leere.
  if (start && start === end && tag === start) return 'einzeln';
  if (tag === start) return 'beginn';
  if (tag === end) return 'ende';
  if (start && end && tag > start && tag < end) return 'dazwischen';
  return 'frei';
}

export function monatHoehe(monat: Monat): number {
  return MONAT_KOPF_HOEHE + monat.wochen.length * ZEILE_HOEHE + MONAT_ABSTAND;
}

export function monatVersatz(monate: Monat[], index: number): number {
  let summe = 0;
  for (let i = 0; i < index; i++) summe += monatHoehe(monate[i]);
  return summe;
}

export function monatIndexFuer(monate: Monat[], tag: string | null): number {
  if (!tag) return 0;
  const [jahr, monat] = tag.split('-').map(Number);
  const index = monate.findIndex((m) => m.jahr === jahr && m.monat === monat);
  return index < 0 ? 0 : index;
}

export function tagLabel(tag: string): string {
  const [jahr, monat, tagZahl] = tag.split('-').map(Number);
  return `${tagZahl}. ${MONATE[monat - 1]} ${jahr}`;
}

// Vorlese-Beschriftung des Feldes. Beide Monate ausgeschrieben und «bis» als
// Wort (Spec §9): die Kurzform «Aug» kommt vorgelesen nicht verlässlich als
// «August» an, und DESIGN-LANGUAGE §6 erlaubt den Bis-Strich, verlangt ihn
// aber nicht.
export function zeitraumLabel(auswahl: Auswahl): string {
  if (!auswahl.start || !auswahl.end) return 'Zeitraum, noch nichts gewählt';
  return `Zeitraum, ${tagLabel(auswahl.start)} bis ${tagLabel(auswahl.end)}`;
}

export function heuteOderDefault(heute?: string): string {
  return heute ?? heutigerKalendertag();
}
```

- [ ] **Schritt 4: Test laufen lassen und Erfolg prüfen**

```bash
cd mobile && npm test -- kalender.test.ts
```

Erwartet: PASS, alle Tests grün.

- [ ] **Schritt 5: Den Test für `zeitraumLabel` nachziehen**

`zeitraumLabel` und `heuteOderDefault` sind in Schritt 3 mitgeschrieben, aber
noch ungeprüft. Ans Ende von `kalender.test.ts` anfügen:

```ts
test('zeitraumLabel schreibt beide Monate aus und nutzt «bis» als Wort', () => {
  expect(zeitraumLabel({ start: '2026-08-01', end: '2026-08-14' }))
    .toBe('Zeitraum, 1. August 2026 bis 14. August 2026');
});

test('zeitraumLabel sagt bei leerer Auswahl, dass nichts gewählt ist', () => {
  expect(zeitraumLabel({ start: null, end: null })).toBe('Zeitraum, noch nichts gewählt');
  expect(zeitraumLabel({ start: '2026-08-01', end: null })).toBe('Zeitraum, noch nichts gewählt');
});

test('heuteOderDefault reicht einen gesetzten Wert durch', () => {
  expect(heuteOderDefault('2026-08-12')).toBe('2026-08-12');
});
```

Den Import in Zeile 1 der Testdatei um `zeitraumLabel, heuteOderDefault` ergänzen.

- [ ] **Schritt 6: Tests und Linting laufen lassen**

```bash
cd mobile && npm test -- kalender.test.ts && npm run lint
```

Erwartet: PASS, Linting ohne Fehler.

- [ ] **Schritt 7: Commit**

```bash
git add mobile/src/features/trips/kalender.ts mobile/src/features/trips/__tests__/kalender.test.ts
git commit -m "feat(reise): Kalender-Logik fuer die Zeitraum-Auswahl"
```

---

### Task 2: Kalender-Komponente

**Files:**
- Create: `src/components/Kalender.tsx`
- Test: `src/components/__tests__/Kalender.test.tsx`

**Interfaces:**
- Consumes: alles aus Task 1, `PressScale` aus `src/components/PressScale.tsx`,
  `useTheme` aus `src/theme/ThemeProvider`, Tokens aus `src/theme/tokens`
- Produces: `Kalender` mit Props
  `{ auswahl: Auswahl; onTag: (tag: string) => void; heute?: string }`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `src/components/__tests__/Kalender.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Kalender } from '../Kalender';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const HEUTE = '2026-08-12';
const LEER = { start: null, end: null };

test('zeigt die Wochentagszeile mit Montag zuerst', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  expect(screen.getByTestId('kalender-wochentage')).toBeTruthy();
  expect(screen.getByText('Mo')).toBeTruthy();
  expect(screen.getByText('So')).toBeTruthy();
});

test('zeigt den aktuellen Monat mit seinen Tagen', async () => {
  await wrap(<Kalender auswahl={LEER} onTag={jest.fn()} heute={HEUTE} />);
  expect(screen.getByText('August 2026')).toBeTruthy();
  expect(screen.getByLabelText('14. August 2026')).toBeTruthy();
});

test('ein Tipp meldet den ISO-Tag nach oben', async () => {
  const onTag = jest.fn();
  await wrap(<Kalender auswahl={LEER} onTag={onTag} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('14. August 2026'));
  expect(onTag).toHaveBeenCalledWith('2026-08-14');
});

test('gewählte Tage sind als selected ausgezeichnet', async () => {
  const auswahl = { start: '2026-08-05', end: '2026-08-14' };
  await wrap(<Kalender auswahl={auswahl} onTag={jest.fn()} heute={HEUTE} />);
  expect(screen.getByLabelText('5. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('14. August 2026').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('20. August 2026').props.accessibilityState.selected).toBe(false);
});

test('ein Tag vor dem Bereich ist gesperrt und meldet nichts', async () => {
  const onTag = jest.fn();
  await wrap(<Kalender auswahl={LEER} onTag={onTag} heute={HEUTE} />);
  // Der Bereich beginnt am 1. August 2025, der Juli davor ist nicht im Raster.
  expect(screen.queryByLabelText('31. Juli 2025')).toBeNull();
  expect(onTag).not.toHaveBeenCalled();
});
```

- [ ] **Schritt 2: Test laufen lassen und Fehlschlag prüfen**

```bash
cd mobile && npm test -- Kalender.test.tsx
```

Erwartet: FAIL mit `Cannot find module '../Kalender'`.

- [ ] **Schritt 3: Die Komponente schreiben**

Datei `src/components/Kalender.tsx`:

```tsx
import { useMemo, useRef } from 'react';
import { FlatList, Text, View } from 'react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import {
  heuteOderDefault, monatHoehe, monatIndexFuer, monatVersatz, monateImBereich,
  tagLabel, zellrolle, MONAT_ABSTAND, MONAT_KOPF_HOEHE, ZEILE_HOEHE,
  type Auswahl, type Monat, type Zellrolle,
} from '@/features/trips/kalender';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Der sichtbare Kreis ist kleiner als seine Zelle (Spec §4): die Zelle ist das
// Touch-Ziel und misst ZEILE_HOEHE mal ein Siebtel der Rasterbreite, beides
// über den 44 px aus Apples Human Interface Guidelines.
const KREIS = 40;

type Props = {
  auswahl: Auswahl;
  onTag: (tag: string) => void;
  // Ohne diesen Einstieg hinge jeder Test am echten Systemdatum und bräche im
  // Folgemonat (gleiches Muster wie heutigerKalendertag(jetzt = new Date())).
  heute?: string;
};

export function Kalender({ auswahl, onTag, heute }: Props) {
  const { colors } = useTheme();
  const tagHeute = heuteOderDefault(heute);
  const monate = useMemo(() => monateImBereich(tagHeute), [tagHeute]);
  const ersterTag = monate[0].wochen.flat().find(Boolean) as string;
  const letzteWoche = monate[monate.length - 1].wochen;
  const letzterTag = letzteWoche.flat().filter(Boolean).pop() as string;

  // Nur der erste Rendervorgang springt, danach scrollt der Nutzer selbst.
  const startIndex = useRef(monatIndexFuer(monate, auswahl.start || tagHeute)).current;

  return (
    <View>
      <View testID="kalender-wochentage" style={{ flexDirection: 'row', paddingBottom: spacing.s }}>
        {WOCHENTAGE.map((tag) => (
          <Text key={tag} style={[type.caption, { flex: 1, textAlign: 'center', color: colors['text-2'] }]}>
            {tag}
          </Text>
        ))}
      </View>
      <FlatList
        data={monate}
        keyExtractor={(m) => `${m.jahr}-${m.monat}`}
        initialScrollIndex={startIndex}
        getItemLayout={(_, index) => ({
          length: monatHoehe(monate[index]),
          offset: monatVersatz(monate, index),
          index,
        })}
        renderItem={({ item }) => (
          <MonatsBlock
            monat={item}
            auswahl={auswahl}
            onTag={onTag}
            heute={tagHeute}
            ersterTag={ersterTag}
            letzterTag={letzterTag}
          />
        )}
      />
    </View>
  );
}

function MonatsBlock({
  monat, auswahl, onTag, heute, ersterTag, letzterTag,
}: {
  monat: Monat; auswahl: Auswahl; onTag: (tag: string) => void;
  heute: string; ersterTag: string; letzterTag: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: MONAT_ABSTAND }}>
      <View style={{ height: MONAT_KOPF_HOEHE, justifyContent: 'center' }}>
        <Text style={[type.h3, { color: colors['text-1'] }]}>{monat.titel}</Text>
      </View>
      {monat.wochen.map((woche, i) => (
        <View key={i} style={{ flexDirection: 'row', height: ZEILE_HOEHE }}>
          {woche.map((tag, j) =>
            tag === null ? (
              <View key={`leer-${j}`} style={{ flex: 1 }} />
            ) : (
              <Tageszelle
                key={tag}
                tag={tag}
                rolle={zellrolle(tag, auswahl, ersterTag, letzterTag)}
                istHeute={tag === heute}
                onTag={onTag}
              />
            )
          )}
        </View>
      ))}
    </View>
  );
}

function Tageszelle({
  tag, rolle, istHeute, onTag,
}: {
  tag: string; rolle: Zellrolle; istHeute: boolean; onTag: (tag: string) => void;
}) {
  const { colors } = useTheme();
  const gefuellt = rolle === 'beginn' || rolle === 'ende' || rolle === 'einzeln';
  const gesperrt = rolle === 'gesperrt';

  const zahlFarbe = gefuellt ? colors['bg-0'] : gesperrt ? colors['text-3'] : colors['text-1'];

  // Die Fläche reicht von der Zellmitte bis an die äussere Zellkante, nicht nur
  // bis an den Kreisrand: sonst klafft zwischen Beginn und erstem Tag der
  // Spanne eine Lücke im Balken (Spec §4).
  const spanne =
    rolle === 'dazwischen' ? { left: 0, right: 0 }
    : rolle === 'beginn' ? { left: '50%' as const, right: 0 }
    : rolle === 'ende' ? { left: 0, right: '50%' as const }
    : null;

  return (
    <PressScale
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="button"
      accessibilityLabel={tagLabel(tag)}
      accessibilityState={{ selected: gefuellt || rolle === 'dazwischen', disabled: gesperrt }}
      disabled={gesperrt}
      onPress={() => onTag(tag)}
    >
      {spanne ? (
        <View
          style={{
            position: 'absolute', top: (ZEILE_HOEHE - KREIS) / 2, height: KREIS,
            backgroundColor: colors['bg-1'], ...spanne,
          }}
        />
      ) : null}
      <View
        style={{
          width: KREIS, height: KREIS, borderRadius: radius.pill,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: gefuellt ? colors['text-1'] : 'transparent',
        }}
      >
        <Text style={[type.body, { color: zahlFarbe }]}>{Number(tag.slice(8))}</Text>
        {istHeute ? (
          <View
            style={{
              position: 'absolute', bottom: 6, width: 4, height: 4,
              borderRadius: radius.pill,
              backgroundColor: gefuellt ? colors['bg-0'] : colors['text-2'],
            }}
          />
        ) : null}
      </View>
    </PressScale>
  );
}
```

- [ ] **Schritt 4: Test laufen lassen und Erfolg prüfen**

```bash
cd mobile && npm test -- Kalender.test.tsx
```

Erwartet: PASS.

Falls Tests fehlschlagen, weil `FlatList` nur die ersten Einträge rendert und
der August 2026 nicht im Baum liegt: `initialNumToRender={monate.length}` ist
NICHT die Lösung, das rendert 1300 Zellen. Stattdessen in der Testdatei den
Kalender mit einem `heute` aufrufen, dessen Monat am Index `startIndex` liegt,
und prüfen, ob `initialScrollIndex` von der Testumgebung beachtet wird. Trifft
das nicht zu, in der Komponente zusätzlich `initialNumToRender={3}` setzen und
im Test auf einen Tag des Startmonats prüfen.

- [ ] **Schritt 5: Linting laufen lassen**

```bash
cd mobile && npm run lint
```

Erwartet: keine Fehler. Der Kalender darf keine festen Hex-Werte enthalten.

- [ ] **Schritt 6: Commit**

```bash
git add mobile/src/components/Kalender.tsx mobile/src/components/__tests__/Kalender.test.tsx
git commit -m "feat(reise): Kalender-Komponente mit Zeitraum-Markierung"
```

---

### Task 3: Zeitraumfeld

**Files:**
- Create: `src/components/Zeitraumfeld.tsx`
- Test: `src/components/__tests__/Zeitraumfeld.test.tsx`

**Interfaces:**
- Consumes: `Kalender` aus Task 2, `Sheet` aus `src/components/Sheet.tsx`,
  `Button` aus `src/components/Button.tsx`, `naechsteAuswahl`, `zeitraumLabel`
  aus Task 1, `formatRange` aus `src/features/trips/tripDay.ts`
- Produces: `Zeitraumfeld` mit Props
  `{ wert: Auswahl; onAendern: (a: Auswahl) => void; fehler?: string; heute?: string }`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `src/components/__tests__/Zeitraumfeld.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import * as React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Zeitraumfeld } from '../Zeitraumfeld';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const HEUTE = '2026-08-12';
const LEER = { start: null, end: null };

test('zeigt bei leerer Auswahl nur das Label', async () => {
  await wrap(<Zeitraumfeld wert={LEER} onAendern={jest.fn()} heute={HEUTE} />);
  expect(screen.getByText('Zeitraum')).toBeTruthy();
  expect(screen.queryByTestId('sheet-panel')).toBeNull();
});

test('zeigt einen gesetzten Zeitraum in Kurzform', async () => {
  const wert = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<Zeitraumfeld wert={wert} onAendern={jest.fn()} heute={HEUTE} />);
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('liest sich vor mit ausgeschriebenen Monaten', async () => {
  const wert = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<Zeitraumfeld wert={wert} onAendern={jest.fn()} heute={HEUTE} />);
  expect(screen.getByLabelText('Zeitraum, 1. August 2026 bis 14. August 2026')).toBeTruthy();
});

test('ein Tipp öffnet das Sheet', async () => {
  await wrap(<Zeitraumfeld wert={LEER} onAendern={jest.fn()} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  expect(screen.getByTestId('sheet-panel')).toBeTruthy();
});

test('zwei Tipps im Kalender und Übernehmen melden ISO-Werte nach oben', async () => {
  const onAendern = jest.fn();
  await wrap(<Zeitraumfeld wert={LEER} onAendern={onAendern} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText('5. August 2026'));
  await fireEvent.press(screen.getByLabelText('14. August 2026'));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
  expect(onAendern).toHaveBeenCalledWith({ start: '2026-08-05', end: '2026-08-14' });
});

test('Übernehmen bleibt bei halber Auswahl wirkungslos', async () => {
  const onAendern = jest.fn();
  await wrap(<Zeitraumfeld wert={LEER} onAendern={onAendern} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText('5. August 2026'));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
  expect(onAendern).not.toHaveBeenCalled();
});

test('Schliessen ohne Übernehmen lässt den alten Wert stehen', async () => {
  const onAendern = jest.fn();
  const wert = { start: '2026-08-01', end: '2026-08-14' };
  await wrap(<Zeitraumfeld wert={wert} onAendern={onAendern} heute={HEUTE} />);
  await fireEvent.press(screen.getByLabelText('Zeitraum, 1. August 2026 bis 14. August 2026'));
  await fireEvent.press(screen.getByLabelText('3. August 2026'));
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  expect(onAendern).not.toHaveBeenCalled();
  expect(screen.getByText('1.–14. Aug 2026')).toBeTruthy();
});

test('zeigt einen Fehler unter dem Feld', async () => {
  await wrap(<Zeitraumfeld wert={LEER} onAendern={jest.fn()} fehler="Trag den Zeitraum ein." heute={HEUTE} />);
  expect(screen.getByText('Trag den Zeitraum ein.')).toBeTruthy();
});
```

- [ ] **Schritt 2: Test laufen lassen und Fehlschlag prüfen**

```bash
cd mobile && npm test -- Zeitraumfeld.test.tsx
```

Erwartet: FAIL mit `Cannot find module '../Zeitraumfeld'`.

- [ ] **Schritt 3: Die Komponente schreiben**

Datei `src/components/Zeitraumfeld.tsx`:

```tsx
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Kalender } from '@/components/Kalender';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing, type } from '@/theme/tokens';
import { naechsteAuswahl, zeitraumLabel, type Auswahl } from '@/features/trips/kalender';
import { formatRange } from '@/features/trips/tripDay';

type Props = {
  wert: Auswahl;
  onAendern: (auswahl: Auswahl) => void;
  fehler?: string;
  heute?: string;
};

// Das Feld trägt die Masse des `Input` (DESIGN-LANGUAGE §4), ist aber kein
// Textfeld: seit der Umstellung auf den Kalender gibt es keinen Textpfad mehr,
// deshalb eine Fläche, die das Sheet öffnet.
export function Zeitraumfeld({ wert, onAendern, fehler, heute }: Props) {
  const { colors } = useTheme();
  const [offen, setOffen] = useState(false);
  // Der Entwurf lebt nur, solange das Sheet offen ist. Erst «Übernehmen»
  // meldet nach oben, ein Abbruch verwirft ihn folgenlos.
  const [entwurf, setEntwurf] = useState<Auswahl>(wert);

  const vollstaendig = !!entwurf.start && !!entwurf.end;
  const anzeige = wert.start && wert.end ? formatRange(wert.start, wert.end) : '';

  const oeffnen = () => {
    setEntwurf(wert);
    setOffen(true);
  };

  const uebernehmen = () => {
    if (!vollstaendig) return;
    onAendern(entwurf);
    setOffen(false);
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={zeitraumLabel(wert)}
        onPress={oeffnen}
        style={{
          height: 56,
          borderWidth: 1,
          borderColor: fehler ? palette.danger : colors['line-strong'],
          borderRadius: radius.control,
          backgroundColor: colors['bg-0'],
          paddingHorizontal: spacing.base,
          justifyContent: 'center',
        }}
      >
        <Text style={[type.caption, { color: colors['text-2'] }]}>Zeitraum</Text>
        {anzeige ? <Text style={[type.body, { color: colors['text-1'] }]}>{anzeige}</Text> : null}
      </PressScale>
      {fehler ? <Text style={[type.secondary, { color: palette.danger }]}>{fehler}</Text> : null}

      <Sheet sichtbar={offen} titel="Zeitraum" onSchliessen={() => setOffen(false)}>
        <Kalender
          auswahl={entwurf}
          onTag={(tag) => setEntwurf((bisher) => naechsteAuswahl(bisher, tag))}
          heute={heute}
        />
        <Button
          variant="primary"
          label="Übernehmen"
          onPress={uebernehmen}
          disabled={!vollstaendig}
        />
      </Sheet>
    </View>
  );
}
```

- [ ] **Schritt 4: Prüfen, ob `Button` ein `disabled`-Prop kennt**

```bash
cd mobile && rg -n "disabled|type Props" src/components/Button.tsx
```

Kennt `Button` kein `disabled`, dann NICHT das Prop erfinden, sondern
stattdessen `onPress={uebernehmen}` beibehalten (die Funktion steigt bei
unvollständiger Auswahl ohnehin aus) und den Knopf über
`variant={vollstaendig ? 'primary' : 'text'}` abstufen. Den Test «Übernehmen
bleibt bei halber Auswahl wirkungslos» in beiden Fällen unverändert lassen, er
prüft das Verhalten, nicht die Darstellung.

- [ ] **Schritt 5: Test laufen lassen und Erfolg prüfen**

```bash
cd mobile && npm test -- Zeitraumfeld.test.tsx
```

Erwartet: PASS.

- [ ] **Schritt 6: Commit**

```bash
git add mobile/src/components/Zeitraumfeld.tsx mobile/src/components/__tests__/Zeitraumfeld.test.tsx
git commit -m "feat(reise): Zeitraumfeld verbindet Formular und Kalender-Sheet"
```

---

### Task 4: Anlege-Formular umstellen

**Files:**
- Modify: `src/app/(tabs)/reise/neu.tsx`
- Test: `src/app/(tabs)/reise/__tests__/formular.test.tsx`

**Interfaces:**
- Consumes: `Zeitraumfeld` aus Task 3, `type Auswahl` aus Task 1
- Produces: nichts für spätere Tasks

- [ ] **Schritt 1: Die betroffenen Tests umbauen**

In `src/app/(tabs)/reise/__tests__/formular.test.tsx`:

Zuerst eine Hilfsfunktion nach `beforeEach` einfügen, die den Zeitraum über
den Kalender wählt:

```tsx
// Wählt einen Zeitraum über das Sheet. Zwei Tipps plus «Übernehmen», genau
// wie ein Nutzer es täte.
const zeitraumWaehlen = async (vonLabel: string, bisLabel: string) => {
  await fireEvent.press(screen.getByLabelText('Zeitraum, noch nichts gewählt'));
  await fireEvent.press(screen.getByLabelText(vonLabel));
  await fireEvent.press(screen.getByLabelText(bisLabel));
  await fireEvent.press(screen.getByLabelText('Übernehmen'));
};
```

Test «leerer Name wird abgefangen»: die beiden `changeText`-Zeilen für Beginn
und Ende ersetzen durch

```tsx
await zeitraumWaehlen('1. August 2026', '14. August 2026');
```

Test «gültige Eingabe legt an und führt zum Einladen»: dieselbe Ersetzung.

Die Tests «Ende vor Beginn wird abgefangen, Fehler landet am Ende-Feld» und
«unlesbares Datum wird dem betroffenen Feld zugeordnet» ganz löschen. Beide
Zustände kann der Kalender nicht mehr erzeugen.

Einen neuen Test anfügen, der den verbliebenen Fehlerfall abdeckt:

```tsx
test('fehlender Zeitraum wird am Zeitraum-Feld gemeldet', async () => {
  await wrap(<NeueReise />);
  await fireEvent.changeText(screen.getByLabelText('Name der Reise'), 'Norwegen');
  await fireEvent.press(screen.getByLabelText('Reise anlegen'));
  expect(await screen.findByText('Trag den Zeitraum ein.')).toBeTruthy();
  expect(createTrip).not.toHaveBeenCalled();
});
```

**Wichtig:** Die Tests hängen ab jetzt am Systemdatum, weil `Zeitraumfeld` ohne
`heute`-Prop `heutigerKalendertag()` nutzt und der August 2026 dann irgendwann
ausserhalb des Bereichs liegt. Deshalb im Screen selbst kein `heute` setzen,
sondern in der Testdatei ganz oben die Systemzeit fixieren:

```tsx
beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-08-12T10:00:00Z'));
});
afterAll(() => jest.useRealTimers());
```

- [ ] **Schritt 2: Tests laufen lassen und Fehlschlag prüfen**

```bash
cd mobile && npm test -- formular.test.tsx
```

Erwartet: FAIL, weil `neu.tsx` noch die alten Felder rendert und
`getByLabelText('Zeitraum, noch nichts gewählt')` nichts findet.

- [ ] **Schritt 3: Den Screen umstellen**

In `src/app/(tabs)/reise/neu.tsx`:

Import ändern:

```tsx
import { Zeitraumfeld } from '@/components/Zeitraumfeld';
import { validateDateRange } from '@/features/trips/tripDay';
import type { Auswahl } from '@/features/trips/kalender';
```

`parseGermanDate` aus dem Import entfernen.

Zustand ersetzen: die drei `useState` für `beginn`, `ende`, `beginnFehler` und
`endeFehler` weichen zweien:

```tsx
const [zeitraum, setZeitraum] = useState<Auswahl>({ start: null, end: null });
const [zeitraumFehler, setZeitraumFehler] = useState<string | undefined>();
```

`absenden` ersetzen durch:

```tsx
  const absenden = async () => {
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const { start, end } = zeitraum;
    // Der Kalender liefert entweder beide Enden oder keines, und ein Ende vor
    // dem Beginn kann er gar nicht erzeugen. Bleibt der eine Fall, dass gar
    // nichts gewählt wurde. `validateDateRange` bleibt trotzdem als letzte
    // Pruefung stehen, sie kostet nichts.
    const zFehler = !start || !end
      ? 'Trag den Zeitraum ein.'
      : validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setZeitraumFehler(zFehler ?? undefined);
    if (nFehler || zFehler || !start || !end || !userId) return;

    setLaedt(true);
    const { id, error } = await createTrip({ name, startDate: start, endDate: end, ownerId: userId });
    setLaedt(false);
    if (error || !id) return setNameFehler(error ?? undefined);
    // Direkt weiter zum Einladen (App-Konzept §5.3); replace, damit «zurück»
    // wieder in der Liste landet und nicht im ausgefüllten Formular.
    router.replace(`/reise/${id}/einladen`);
  };
```

Im JSX die beiden `Input`-Zeilen für Beginn und Ende ersetzen durch:

```tsx
      <Zeitraumfeld wert={zeitraum} onAendern={setZeitraum} fehler={zeitraumFehler} />
```

Das Namensfeld und der Button bleiben unverändert.

- [ ] **Schritt 4: Tests laufen lassen und Erfolg prüfen**

```bash
cd mobile && npm test -- formular.test.tsx
```

Erwartet: PASS für alle Tests, die `NeueReise` betreffen. Die
`bearbeiten`-Tests schlagen weiterhin fehl, das ist Task 5.

- [ ] **Schritt 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/reise/neu.tsx mobile/src/app/\(tabs\)/reise/__tests__/formular.test.tsx
git commit -m "feat(reise): Zeitraum im Anlege-Formular ueber den Kalender waehlen"
```

---

### Task 5: Bearbeiten-Formular umstellen

**Files:**
- Modify: `src/app/(tabs)/reise/[id]/bearbeiten.tsx`
- Test: `src/app/(tabs)/reise/__tests__/formular.test.tsx`

**Interfaces:**
- Consumes: `Zeitraumfeld` aus Task 3, `type Auswahl` aus Task 1
- Produces: nichts für spätere Tasks

- [ ] **Schritt 1: Den Bearbeiten-Test umbauen**

In `formular.test.tsx`, Test «Bearbeiten kommt mit vorbelegten Werten und
speichert»: die Zeile

```tsx
  expect(screen.getByDisplayValue('01.08.2026')).toBeTruthy();
```

ersetzen durch

```tsx
  expect(await screen.findByText('1.–14. Aug 2026')).toBeTruthy();
```

Der Rest des Tests bleibt: Name ändern, speichern, `updateTrip` prüfen.

- [ ] **Schritt 2: Tests laufen lassen und Fehlschlag prüfen**

```bash
cd mobile && npm test -- formular.test.tsx
```

Erwartet: FAIL, `1.–14. Aug 2026` steht noch nicht im Baum.

- [ ] **Schritt 3: Den Screen umstellen**

In `src/app/(tabs)/reise/[id]/bearbeiten.tsx`, analog zu Task 3:

Import ändern:

```tsx
import { Zeitraumfeld } from '@/components/Zeitraumfeld';
import { validateDateRange } from '@/features/trips/tripDay';
import type { Auswahl } from '@/features/trips/kalender';
```

`formatGermanDate` und `parseGermanDate` aus dem Import entfernen.

Zustand ersetzen wie in Task 4:

```tsx
const [zeitraum, setZeitraum] = useState<Auswahl>({ start: null, end: null });
const [zeitraumFehler, setZeitraumFehler] = useState<string | undefined>();
```

Im `useEffect` die Vorbelegung ersetzen: statt

```tsx
        setBeginn(formatGermanDate(data.start_date));
        setEnde(formatGermanDate(data.end_date));
```

nun ohne Umformatierung, die Werte liegen bereits als ISO vor:

```tsx
        setZeitraum({ start: data.start_date, end: data.end_date });
```

In `speichern` denselben Block wie in Task 4 einsetzen:

```tsx
    const nFehler = name.trim().length === 0 ? 'Gib deiner Reise einen Namen.' : null;
    const { start, end } = zeitraum;
    const zFehler = !start || !end
      ? 'Trag den Zeitraum ein.'
      : validateDateRange(start, end);
    setNameFehler(nFehler ?? undefined);
    setZeitraumFehler(zFehler ?? undefined);
    setSpeicherFehler(null);
    if (nFehler || zFehler || !start || !end) return;

    setLaedt(true);
    const { error } = await updateTrip(id, { name, startDate: start, endDate: end });
    setLaedt(false);
    // Der Fehler gehoert NICHT in den Namensfeld-Slot: er sagt nichts ueber den
    // Namen aus (DESIGN-LANGUAGE §4 will feldgenaue Zuordnung, und «Probier es
    // gleich nochmal» unter dem Namensfeld behauptet, der Name sei schuld).
    if (error) return setSpeicherFehler(error);
    router.back();
```

Im JSX die beiden `Input`-Zeilen ersetzen durch:

```tsx
      <Zeitraumfeld wert={zeitraum} onAendern={setZeitraum} fehler={zeitraumFehler} />
```

- [ ] **Schritt 4: Die gesamte Suite laufen lassen**

```bash
cd mobile && npm test
```

Erwartet: PASS. Sollte `tripDay.test.ts` noch grün sein, ist das richtig,
`parseGermanDate` existiert bis Task 6 weiter.

- [ ] **Schritt 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/reise/\[id\]/bearbeiten.tsx mobile/src/app/\(tabs\)/reise/__tests__/formular.test.tsx
git commit -m "feat(reise): Zeitraum im Bearbeiten-Formular ueber den Kalender waehlen"
```

---

### Task 6: Toten Code entfernen

Nach Task 4 und 5 haben `parseGermanDate` und `formatGermanDate` keinen
Aufrufer mehr. Sie werden entfernt, nicht als «könnte man noch brauchen»
stehen gelassen.

**Files:**
- Modify: `src/features/trips/tripDay.ts:14-29`
- Modify: `src/features/trips/__tests__/tripDay.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `tripDay.ts` ohne die beiden Funktionen

- [ ] **Schritt 1: Bestätigen, dass es wirklich keinen Aufrufer mehr gibt**

```bash
cd mobile && rg -n "parseGermanDate|formatGermanDate" src
```

Erwartet: Treffer nur noch in `tripDay.ts` selbst und in
`__tests__/tripDay.test.ts`. Findet sich ein anderer Aufrufer, diesen Task
abbrechen und melden, statt die Funktion trotzdem zu löschen.

- [ ] **Schritt 2: Die Tests entfernen**

In `src/features/trips/__tests__/tripDay.test.ts` die Blöcke
`test.each(...)('parseGermanDate(%s) → %s', ...)` und
`test('formatGermanDate kehrt parseGermanDate um', ...)` löschen, dazu beide
Namen aus dem Import in Zeile 2. Die Tests zu `validateDateRange`, `tripDay`,
`tripLength`, `formatRange`, `heutigerKalendertag` und `groupTrips` bleiben.

- [ ] **Schritt 3: Tests laufen lassen und Fehlschlag prüfen**

```bash
cd mobile && npm test -- tripDay.test.ts
```

Erwartet: PASS. Die verbliebenen Tests laufen weiter, die gelöschten fehlen
schlicht. Ein Fehlschlag hier bedeutet, dass zu viel gelöscht wurde.

- [ ] **Schritt 4: Die Funktionen entfernen**

In `src/features/trips/tripDay.ts` die Funktionen `parseGermanDate` und
`formatGermanDate` samt ihrer Kommentare löschen. `toUtc`, `MONATE` und
`MS_PRO_TAG` bleiben, sie tragen die übrigen Funktionen.

- [ ] **Schritt 5: Gesamte Suite, Typprüfung und Linting**

```bash
cd mobile && npm test && npx tsc --noEmit && npm run lint
```

Erwartet: alles grün. `tsc` fängt ab, falls doch irgendwo ein Import auf eine
der beiden Funktionen zeigt.

- [ ] **Schritt 6: Commit**

```bash
git add mobile/src/features/trips/tripDay.ts mobile/src/features/trips/__tests__/tripDay.test.ts
git commit -m "refactor(reise): deutsche Datums-Parser ohne Aufrufer entfernen"
```

---

### Task 7: Im Simulator ansehen

Die Jest-Suite prüft Verhalten, nicht Aussehen. Die Zeitraum-Markierung, der
Sprung auf den richtigen Monat und die Scroll-Leistung über 37 Monate zeigen
sich erst im laufenden Bild.

**Files:** keine

- [ ] **Schritt 1: Simulator starten und App laden**

```bash
xcrun simctl boot E9036C0C-5EF6-44D7-A692-9AF53C8BF26B 2>/dev/null; open -a Simulator
xcrun simctl install E9036C0C-5EF6-44D7-A692-9AF53C8BF26B \
  ~/Library/Developer/Xcode/DerivedData/Reelive-fqfbhphulbqjvubdcvakapzduzzz/Build/Products/Debug-iphonesimulator/Reelive.app
xcrun simctl launch E9036C0C-5EF6-44D7-A692-9AF53C8BF26B com.reelive.app
```

Metro muss laufen (`npx expo start`), damit der Dev-Client den neuen Stand
lädt. Der installierte Build ist ein Dev-Client, der Kalender kommt aus dem
Bundle über Metro, ein Neubau ist nicht nötig.

- [ ] **Schritt 2: Zum Formular navigieren**

```bash
xcrun simctl openurl E9036C0C-5EF6-44D7-A692-9AF53C8BF26B "reelive:///reise/neu"
```

iOS fragt «Open in Reelive?». Der Dialog braucht einen echten Klick, Klicks in
die RN-Oberfläche kommen dagegen nicht an (siehe die Notiz zur
Simulator-Steuerung im Gedächtnis). Fensterposition holen mit

```bash
osascript -e 'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1'
```

und den Knopf «Open» mit `cliclick c:<x>,<y>` treffen.

- [ ] **Schritt 3: Screenshot machen und prüfen**

```bash
xcrun simctl io E9036C0C-5EF6-44D7-A692-9AF53C8BF26B screenshot /tmp/zeitraum.png
```

Zu prüfen:
- Der Kalender öffnet auf dem aktuellen Monat, nicht ganz oben im August 2025.
- Die Spanne zwischen zwei gewählten Tagen ist durchgehend, ohne Lücke neben
  den beiden Kreisen.
- Die Wochentagszeile fluchtet mit den Spalten darunter.
- Der heutige Tag trägt seinen Punkt.
- Das Sheet lässt sich scrollen, ohne dass die Wischgeste es schliesst.

- [ ] **Schritt 4: Befund festhalten**

Weicht etwas ab, als eigenen Task nacharbeiten, nicht still korrigieren. Die
Masse in `kalender.ts` (`ZEILE_HOEHE`, `MONAT_KOPF_HOEHE`, `MONAT_ABSTAND`)
gehen in `getItemLayout` ein: ändert sich eine davon, muss sie in der
Komponente an derselben Stelle ankommen, sonst springt die Liste beim Scrollen.

---

## Self-Review

**Spec-Abdeckung.** §3 Verhalten liegt in Task 1 (`naechsteAuswahl`, alle vier
Regeln plus Tagesreise). §4 Aussehen in Task 2 und 3 (Feld, Sheet, Zellrollen,
Kreis 40, Zelle 48). §5 Aufbau als Task 1 bis 3 in genau der beschriebenen
Dreiteilung. §6 Leistung in Task 2 (`FlatList`, `getItemLayout`,
`initialScrollIndex`). §7 Datenfluss in Task 4, 5 und 6. §8 Fehler in Task 4
und 5 («Trag den Zeitraum ein.»). §9 Vorlesen und Motion in Task 2
(`accessibilityRole`, `accessibilityState`, `PressScale`) und Task 1
(`tagLabel`, `zeitraumLabel`). §10 Tests über alle Tasks verteilt. §11 hält
fest, was nicht dazugehört, insbesondere das Touch-Ziel des bestehenden
`Input`.

**Offene Punkte, bewusst als Verzweigung im Plan statt als Annahme:**
Schritt 4 in Task 3 prüft erst, ob `Button` ein `disabled`-Prop kennt, und
nennt beide Wege. Schritt 4 in Task 2 nennt den Ausweg, falls `FlatList` unter
Jest den Startmonat nicht rendert. Beides wäre sonst geraten.

**Typ-Konsistenz.** `Auswahl` heisst in allen Tasks gleich und trägt überall
`start`/`end` als `string | null`. `heute` ist durchgängig ein optionaler
`string` mit demselben Default. `zellrolle` nimmt in Task 1 und Task 2
dieselben vier Parameter in derselben Reihenfolge.
