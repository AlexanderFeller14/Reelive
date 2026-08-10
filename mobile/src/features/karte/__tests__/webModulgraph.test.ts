// Die Browser-Fassung der Kartenfläche darf react-native-maps nicht berühren.
//
// Die Bibliothek hat keine Web-Fassung: ihr `main` zeigt auf TypeScript-Quelle
// mit nativen Modulen. Landet sie im Web-Bundle, bricht der Build, und zwar
// erst beim Bündeln, mit einem Fehler, der auf eine fremde Datei zeigt.
//
// Ein Test, der nur die Importe DIESER einen Datei liest, wäre zu schwach: die
// Trennung kippt über eine gemeinsame Datei. `features/karte/typen.ts` ist die
// naheliegendste, ein `import type { Region } from 'react-native-maps'` darin
// wäre für tsc harmlos, für Metro aber ein Modul im Graphen. Genau deshalb
// läuft dieser Test den GANZEN Graphen ab.
//
// Vorbild und Mechanik: app/teilen/__tests__/modulgraph.test.ts (Phase 6), das
// auf demselben Weg belegt, dass der Web-Player nichts schreiben kann. Wie
// dort wird `.web.ts`/`.web.tsx` ZUERST aufgelöst, das ist es, was Metro auf
// der Web-Plattform auch tut.
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// mobile/src/features/karte/__tests__ → drei Ebenen hoch bis mobile/src.
const SRC_ROOT = path.resolve(__dirname, '../../..');
const EINSTIEG = path.resolve(__dirname, '../KartenFlaeche.web.tsx');
const NATIVE_FASSUNG = path.resolve(__dirname, '../KartenFlaeche.tsx');

const FROM_IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const SEITENEFFEKT_IMPORT_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

// Alle Modulnamen, die eine Datei tatsächlich einbindet.
//
// Bewusst die Specifier und nicht der blosse Text: die Bibliothek WIRD in
// diesen Dateien genannt, in Kommentaren, die erklären, warum sie hier nichts
// zu suchen hat. Ein Test, der auf das Wort anspränge, verböte damit die
// Begründung seiner eigenen Existenz.
function importierteModule(quelltext: string): string[] {
  const namen: string[] = [];
  for (const re of [FROM_IMPORT_RE, SEITENEFFEKT_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let treffer: RegExpExecArray | null;
    while ((treffer = re.exec(quelltext))) namen.push(treffer[1]);
  }
  return namen;
}

// `react-native-maps` selbst und jeder Unterpfad daraus.
function istMaps(spec: string): boolean {
  return spec === 'react-native-maps' || spec.startsWith('react-native-maps/');
}

// Bare Specifier (node_modules-Pakete) werden NICHT weiterverfolgt, geprüft
// wird, ob UNSER Code die Bibliothek nennt.
function resolveDatei(spec: string, ausDatei: string): string | null {
  let basis: string;
  if (spec.startsWith('@/')) {
    basis = path.join(SRC_ROOT, spec.slice(2));
  } else if (spec.startsWith('.')) {
    basis = path.resolve(path.dirname(ausDatei), spec);
  } else {
    return null;
  }
  const kandidaten = [
    `${basis}.web.ts`, `${basis}.web.tsx`,
    basis,
    `${basis}.ts`, `${basis}.tsx`,
    path.join(basis, 'index.ts'), path.join(basis, 'index.tsx'),
  ];
  for (const kandidat of kandidaten) {
    if (existsSync(kandidat)) return kandidat;
  }
  return null;
}

function sammleGraph(einstieg: string): Map<string, string> {
  const gesehen = new Map<string, string>();
  const warteschlange = [einstieg];
  while (warteschlange.length > 0) {
    const datei = warteschlange.pop() as string;
    if (gesehen.has(datei)) continue;
    const quelltext = readFileSync(datei, 'utf8');
    gesehen.set(datei, quelltext);
    for (const spec of importierteModule(quelltext)) {
      const ziel = resolveDatei(spec, datei);
      if (ziel && !gesehen.has(ziel)) warteschlange.push(ziel);
    }
  }
  return gesehen;
}

const graph = sammleGraph(EINSTIEG);

describe('die Browser-Fassung der Kartenflaeche zieht react-native-maps nicht mit', () => {
  // Gegenprobe für den Testaufbau selbst: schlägt der Resolver fehl (falscher
  // SRC_ROOT, kaputte Regex), wäre der Graph nur die Einstiegsdatei, und
  // jede Zusicherung unten grün, ohne etwas zu prüfen.
  test('Testaufbau: der Graph enthaelt die wiederverwendeten Dateien', () => {
    const dateien = [...graph.keys()];
    expect(dateien.some((d) => d.endsWith(path.join('karte', 'nadel.ts')))).toBe(true);
    expect(dateien.some((d) => d.endsWith(path.join('karte', 'gruppierung.ts')))).toBe(true);
    expect(dateien.some((d) => d.endsWith(path.join('karte', 'typen.ts')))).toBe(true);
    expect(dateien.some((d) => d.endsWith(path.join('theme', 'tokens.ts')))).toBe(true);
    expect(dateien.some((d) => d.endsWith(path.join('recap', 'uhrzeit.ts')))).toBe(true);
    expect(dateien.length).toBeGreaterThan(5);
  });

  // Und die Trennschärfe: die NATIVE Fassung bindet die Bibliothek sehr wohl
  // ein. Ohne diesen Test wäre die Zusicherung unten ein Freifahrtschein, der
  // überall zuträfe, etwa, weil die Erkennung selbst kaputt ist.
  test('Testaufbau: die native Fassung bindet react-native-maps tatsaechlich ein', () => {
    expect(importierteModule(readFileSync(NATIVE_FASSUNG, 'utf8')).filter(istMaps)).toEqual([
      'react-native-maps',
    ]);
  });

  test('die native Fassung ist nicht im Graphen der Browser-Fassung', () => {
    const dateien = [...graph.keys()];
    expect(dateien.some((d) => d === NATIVE_FASSUNG)).toBe(false);
    // Und die Nadel-Komponente ebenso wenig: sie importiert `Marker`, und
    // genau deshalb liegen `nadelAbbild`/`nadelBeschriftung` plattformfrei in
    // features/karte/nadel.ts statt in ihr.
    expect(dateien.some((d) => d.endsWith(path.join('components', 'KartenNadel.tsx')))).toBe(false);
  });

  // Die eigentliche Zusicherung. Sie gilt für JEDE Datei im Graphen, nicht nur
  // für die Einstiegsdatei: ein `import type { Region } from 'react-native-maps'`
  // in typen.ts wäre für tsc harmlos (Babel wirft Typ-Importe weg), für Metro
  // aber ein Modul im Graphen, und der Bruch fiele erst beim Web-Build auf.
  test('keine Datei im Graphen bindet react-native-maps ein', () => {
    const treffer: string[] = [];
    for (const [pfad, quelltext] of graph) {
      if (importierteModule(quelltext).some(istMaps)) treffer.push(pfad);
    }
    expect(treffer).toEqual([]);
  });
});
