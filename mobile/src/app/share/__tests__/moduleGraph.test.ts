// W4 (spec promise): the web player can write nothing. A test that only checks
// for the absence of a button is weaker than one proving that no writing call
// is REACHABLE IN THE MODULE GRAPH (task brief, verbatim), and this test does
// exactly that. On the source level it reads EVERY local file reachable from
// share/[token].tsx (transitively via `@/` and relative imports) and proves:
//
//   1. None of these files reaches a table via `supabase.from(...)` or
//      `supabase.rpc(...)` (neither reading nor writing, the web player needs
//      that nowhere, share-link/aufloesen runs entirely through the edge
//      function).
//   2. None of these files calls `supabase.auth.*` (no login path).
//   3. The ONLY `functions.invoke(...)` call in the whole graph sits in
//      shareApi.ts, calls nothing but 'share-link', and the only `aktion` used
//      there is 'aufloesen'.
//
// Unlike a mocked render test this stays true even when the screen is never
// actually mounted or interacted with, it is a property of the CODE (which
// modules are reachable at all), not of the path a test happens to execute. A
// second, complementary test (w4Behavior.test.tsx) checks the same assurance
// behaviour-based on top of that (spies on the whole Supabase client, real
// interaction on screen); the combination catches both "a new, unused import
// with writing ability sneaks in" (this test) and "a path that really runs
// writes on the quiet" (the other one).
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// mobile/src/app/share/__tests__, three levels up to mobile/src.
const SRC_ROOT = path.resolve(__dirname, '../../..');
const ENTRY = path.resolve(__dirname, '../[token].tsx');

const FROM_IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

// Resolves an import specifier to a file in the repo, `@/…` relative to
// mobile/src, `./` and `../` relative to the importing file. A bare specifier
// (a node_modules package) returns `null` and is NOT followed: third party
// code (@supabase/supabase-js, expo-*, react-native) is deliberately outside
// this test, we trust that those packages do not write of their own accord
// without OUR code telling them to (which is exactly what this test checks:
// whether OUR code does that).
//
// `.web.ts`/`.web.tsx` is tried BEFORE the platform-neutral version, which is
// what Metro resolves on the actual web platform as well (secureSessionStorage
// .web.ts instead of secureSessionStorage.ts, for instance).
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
  const seen = new Map<string, string>(); // absolute path to source text
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    seen.set(file, source);
    for (const re of [FROM_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, REQUIRE_RE]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source))) {
        const target = resolveFile(match[1], file);
        if (target && !seen.has(target)) queue.push(target);
      }
    }
  }
  return seen;
}

const graph = collectGraph(ENTRY);

describe('W4: the web player can write nothing (module graph proof)', () => {
  // A counter-check for the test setup itself (lesson from phase 5: a test
  // whose mechanism is broken is green without checking anything). If the
  // resolver fails (a wrong SRC_ROOT, a broken regex), the graph would be the
  // entry file alone, and all the tests below would be pointlessly "green".
  // At least these REUSED files have to show up in the graph, otherwise the
  // collection did not work.
  test('test setup: the module graph really does contain the reused files it is supposed to', () => {
    const files = [...graph.keys()];
    expect(files.some((f) => f.endsWith(path.join('sharing', 'shareApi.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('recap', 'playerLogic.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('recap', 'days.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('components', 'ProgressBar.tsx')))).toBe(true);
    expect(files.length).toBeGreaterThan(6);
  });

  // A positive counter-check for the claim that follows: the native player
  // (NOT in the graph, because share/[token].tsx never imports it) does
  // contain `.insert(`/`.upsert(` (socialApi.ts), so the assertions below are
  // NOT a free pass that happens to hold everywhere but really do cut.
  test('test setup: recap/socialApi.ts (which really does write) is NOT in the graph, otherwise this test would prove nothing', () => {
    const files = [...graph.keys()];
    expect(files.some((f) => f.endsWith(path.join('recap', 'socialApi.ts')))).toBe(false);
    expect(files.some((f) => f.endsWith(path.join('recap', 'recapApi.ts')))).toBe(false);
    expect(files.some((f) => f.endsWith(path.join('auth', 'AuthProvider.tsx')))).toBe(false);
  });

  test('no file in the graph reaches a table via supabase.from() or supabase.rpc()', () => {
    const hits: string[] = [];
    for (const [filePath, source] of graph) {
      if (/\bsupabase\s*\.\s*from\s*\(/.test(source) || /\bsupabase\s*\.\s*rpc\s*\(/.test(source)) {
        hits.push(filePath);
      }
    }
    expect(hits).toEqual([]);
  });

  test('no file in the graph calls supabase.auth (login, logout, update)', () => {
    const hits: string[] = [];
    for (const [filePath, source] of graph) {
      if (/\bsupabase\s*\.\s*auth\s*\./.test(source)) hits.push(filePath);
    }
    expect(hits).toEqual([]);
  });

  test('the only functions.invoke() call in the whole graph sits in shareApi.ts and calls nothing but "share-link" with aktion "aufloesen"', () => {
    const INVOKE_RE = /functions\s*\.\s*invoke\s*\(\s*['"]([^'"]+)['"]/g;
    const ACTION_RE = /aktion:\s*['"]([^'"]+)['"]/g;
    const filesWithInvoke: string[] = [];
    const functionNames = new Set<string>();
    const actions = new Set<string>();

    for (const [filePath, source] of graph) {
      INVOKE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      let found = false;
      while ((match = INVOKE_RE.exec(source))) {
        functionNames.add(match[1]);
        found = true;
      }
      if (found) filesWithInvoke.push(filePath);

      ACTION_RE.lastIndex = 0;
      while ((match = ACTION_RE.exec(source))) actions.add(match[1]);
    }

    expect(filesWithInvoke).toHaveLength(1);
    expect(filesWithInvoke[0].endsWith(path.join('sharing', 'shareApi.ts'))).toBe(true);
    expect([...functionNames]).toEqual(['share-link']);
    expect([...actions]).toEqual(['aufloesen']);
  });
});
