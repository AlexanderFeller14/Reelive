// The browser version of the map surface must not touch react-native-maps.
//
// The library has no web version: its `main` points at TypeScript source
// with native modules. If it lands in the web bundle, the build breaks,
// and only while bundling, with an error that points at a foreign file.
//
// A test that only reads THIS one file's imports would be too weak: the
// separation can tip over via a shared file. `features/map/types.ts` is
// the most obvious one, an `import type { Region } from 'react-native-maps'`
// in it would be harmless for tsc, but a module in the graph for Metro.
// That's exactly why this test walks the WHOLE graph.
//
// Model and mechanism: app/teilen/__tests__/modulgraph.test.ts (Phase 6),
// which proves the same way that the web player can't write anything. As
// there, `.web.ts`/`.web.tsx` is resolved FIRST, that's what Metro also
// does on the web platform.
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// mobile/src/features/map/__tests__ → three levels up to mobile/src.
const SRC_ROOT = path.resolve(__dirname, '../../..');
const ENTRY = path.resolve(__dirname, '../MapSurface.web.tsx');
const NATIVE_VERSION = path.resolve(__dirname, '../MapSurface.tsx');

const FROM_IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

// All module names a file actually pulls in.
//
// Deliberately the specifiers, not the bare text: the library IS named in
// these files, in comments that explain why it has no business here. A
// test that fired on the word would thereby forbid the reasoning for its
// own existence.
function importedModules(source: string): string[] {
  const names: string[] = [];
  for (const re of [FROM_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source))) names.push(match[1]);
  }
  return names;
}

// `react-native-maps` itself and every subpath from it.
function isMaps(spec: string): boolean {
  return spec === 'react-native-maps' || spec.startsWith('react-native-maps/');
}

// Bare specifiers (node_modules packages) are NOT followed further,
// what's checked is whether OUR code names the library.
function resolveFile(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) {
    base = path.join(SRC_ROOT, spec.slice(2));
  } else if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  const candidates = [
    `${base}.web.ts`, `${base}.web.tsx`,
    base,
    `${base}.ts`, `${base}.tsx`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function collectGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    seen.set(file, source);
    for (const spec of importedModules(source)) {
      const target = resolveFile(spec, file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const graph = collectGraph(ENTRY);

describe('the browser version of the map surface does not pull in react-native-maps', () => {
  // Sanity check for the test setup itself: if the resolver fails (wrong
  // SRC_ROOT, broken regex), the graph would just be the entry file, and
  // every assertion below would pass green without checking anything.
  //
  // `clustering.ts` used to stand here, as long as the surface called
  // `isSameSpot` itself to label its pins. It now asks the screen instead
  // (`opensSheet`, types.ts) and no longer calculates anything about
  // clusters; the file has not belonged in its graph since.
  test('test setup: the graph contains the reused files', () => {
    const files = [...graph.keys()];
    expect(files.some((d) => d.endsWith(path.join('map', 'pin.ts')))).toBe(true);
    expect(files.some((d) => d.endsWith(path.join('map', 'types.ts')))).toBe(true);
    expect(files.some((d) => d.endsWith(path.join('theme', 'tokens.ts')))).toBe(true);
    expect(files.some((d) => d.endsWith(path.join('recap', 'timeOfDay.ts')))).toBe(true);
    expect(files.length).toBeGreaterThan(5);
  });

  // And the discriminating power: the NATIVE version does pull in the
  // library. Without this test, the assertion below would be a free pass
  // that would hold everywhere, for instance because the detection itself
  // is broken.
  test('test setup: the native version actually pulls in react-native-maps', () => {
    expect(importedModules(readFileSync(NATIVE_VERSION, 'utf8')).filter(isMaps)).toEqual([
      'react-native-maps',
    ]);
  });

  test('the native version is not in the graph of the browser version', () => {
    const files = [...graph.keys()];
    expect(files.some((d) => d === NATIVE_VERSION)).toBe(false);
    // And neither is the pin component: it imports `Marker`, and that's
    // exactly why `pinAppearance`/`pinLabel` live platform-free in
    // features/map/pin.ts instead of in it.
    expect(files.some((d) => d.endsWith(path.join('components', 'KartenNadel.tsx')))).toBe(false);
  });

  // The actual assertion. It holds for EVERY file in the graph, not just
  // the entry file: an `import type { Region } from 'react-native-maps'`
  // in types.ts would be harmless for tsc (Babel throws type imports
  // away), but a module in the graph for Metro, and the break would only
  // show up at the web build.
  test('no file in the graph pulls in react-native-maps', () => {
    const hits: string[] = [];
    for (const [path0, source] of graph) {
      if (importedModules(source).some(isMaps)) hits.push(path0);
    }
    expect(hits).toEqual([]);
  });
});
