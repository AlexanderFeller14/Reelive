// W4 (Spec-Versprechen): der Web-Player kann nichts schreiben. Ein Test, der
// nur das Fehlen eines Knopfes prüft, ist schwächer als einer, der belegt,
// dass kein schreibender Aufruf im MODULGRAPH erreichbar ist (Task-Auftrag,
// wörtlich), dieser Test tut genau das. Er liest, auf Quelltext-Ebene, JEDE
// lokale Datei, die von teilen/[token].tsx aus (transitiv über `@/`- und
// relative Importe) erreichbar ist, und belegt:
//
//   1. Keine dieser Dateien greift über `supabase.from(...)` oder
//      `supabase.rpc(...)` auf eine Tabelle zu (weder lesend noch
//      schreibend, der Web-Player braucht das nirgends, share-link/
//      aufloesen läuft komplett über die Edge Function).
//   2. Keine dieser Dateien ruft `supabase.auth.*` auf (kein Login-Pfad).
//   3. Der EINZIGE `functions.invoke(...)`-Aufruf im gesamten Graph ist in
//      shareApi.ts, ruft ausschliesslich 'share-link' auf, und die einzige
//      dabei verwendete `aktion` ist 'aufloesen'.
//
// Anders als ein gemockter Render-Test bleibt das auch dann wahr, wenn der
// Screen nie tatsächlich gemountet/interagiert wird, es ist eine
// Eigenschaft des CODES (welche Module überhaupt erreichbar sind), nicht
// des im Test konkret ausgeführten Pfads. Ein zweiter, ergänzender Test
// (token.test.tsx, "W4"-Block) prüft dieselbe Zusicherung zusätzlich
// verhaltensbasiert (Spione auf dem gesamten Supabase-Client, echte
// Bildschirm-Interaktion), die Kombination fängt sowohl "ein neuer,
// ungenutzter Import mit Schreibfähigkeit schleicht sich ein" (dieser Test)
// als auch "ein tatsächlich ausgeführter Pfad schreibt heimlich" (der
// andere).
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// mobile/src/app/teilen/__tests__ → drei Ebenen hoch bis mobile/src.
const SRC_ROOT = path.resolve(__dirname, '../../..');
const EINSTIEG = path.resolve(__dirname, '../[token].tsx');

const FROM_IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const SEITENEFFEKT_IMPORT_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

// Löst einen Import-Specifier zu einer Datei im Repo auf, `@/…` relativ zu
// mobile/src, `./`/`../` relativ zur importierenden Datei. Ein bare
// Specifier (node_modules-Paket) liefert `null` und wird NICHT weiter
// verfolgt: Drittanbieter-Code (@supabase/supabase-js, expo-*, react-native)
// ist bewusst ausserhalb dieses Tests, wir vertrauen darauf, dass diese
// Pakete nicht von sich aus schreiben, ohne dass UNSER Code sie dazu
// aufruft (genau das prüft dieser Test: ob UNSER Code das tut).
//
// `.web.ts`/`.web.tsx` wird VOR der plattformneutralen Fassung probiert,
// das ist es, was Metro auf der tatsächlichen Web-Plattform auch auflöst
// (z.B. secureSessionStorage.web.ts statt secureSessionStorage.ts).
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
  const gesehen = new Map<string, string>(); // absoluter Pfad -> Quelltext
  const warteschlange = [einstieg];
  while (warteschlange.length > 0) {
    const datei = warteschlange.pop() as string;
    if (gesehen.has(datei)) continue;
    const quelltext = readFileSync(datei, 'utf8');
    gesehen.set(datei, quelltext);
    for (const re of [FROM_IMPORT_RE, SEITENEFFEKT_IMPORT_RE, REQUIRE_RE]) {
      re.lastIndex = 0;
      let treffer: RegExpExecArray | null;
      while ((treffer = re.exec(quelltext))) {
        const ziel = resolveDatei(treffer[1], datei);
        if (ziel && !gesehen.has(ziel)) warteschlange.push(ziel);
      }
    }
  }
  return gesehen;
}

const graph = sammleGraph(EINSTIEG);

describe('W4: der Web-Player kann nichts schreiben (Modulgraph-Beweis)', () => {
  // Gegenprobe für den Testaufbau selbst (Phase-5-Lehre: ein Test, dessen
  // Mechanismus kaputt ist, ist grün, ohne etwas zu prüfen). Schlägt der
  // Resolver fehl (z.B. falscher SRC_ROOT, kaputte Regex), wäre der Graph
  // nur die Einstiegsdatei, alle Tests unten würden dann sinnlos "grün"
  // sein. Mindestens diese drei WIEDERVERWENDETEN Dateien müssen im Graph
  // auftauchen, sonst hat die Sammlung nicht funktioniert.
  test('Testaufbau: der Modulgraph enthält tatsächlich die erwarteten, wiederverwendeten Dateien', () => {
    const dateien = [...graph.keys()];
    expect(dateien.some((d) => d.endsWith(path.join('sharing', 'shareApi.ts')))).toBe(true);
    expect(dateien.some((d) => d.endsWith(path.join('recap', 'playerLogic.ts')))).toBe(true);
    expect(dateien.some((d) => d.endsWith(path.join('recap', 'days.ts')))).toBe(true);
    expect(dateien.some((d) => d.endsWith(path.join('components', 'Fortschrittsbalken.tsx')))).toBe(true);
    expect(dateien.length).toBeGreaterThan(6);
  });

  // Positiv-Gegenprobe zur nächsten Behauptung: der native Player (NICHT im
  // Graph, weil teilen/[token].tsx ihn nie importiert) enthält sehr wohl
  // `.insert(`/`.upsert(` (sozialApi.ts), die folgenden Assertions wären
  // also KEIN Freifahrtschein, der zufällig überall zutrifft, sondern
  // treffen echte Trennschärfe.
  test('Testaufbau: recap/sozialApi.ts (schreibt tatsächlich) ist NICHT im Graph, sonst wäre der Test wirkungslos', () => {
    const dateien = [...graph.keys()];
    expect(dateien.some((d) => d.endsWith(path.join('recap', 'sozialApi.ts')))).toBe(false);
    expect(dateien.some((d) => d.endsWith(path.join('recap', 'recapApi.ts')))).toBe(false);
    expect(dateien.some((d) => d.endsWith(path.join('auth', 'AuthProvider.tsx')))).toBe(false);
  });

  test('keine Datei im Graph greift über supabase.from()/supabase.rpc() auf eine Tabelle zu', () => {
    const treffer: string[] = [];
    for (const [pfad, quelltext] of graph) {
      if (/\bsupabase\s*\.\s*from\s*\(/.test(quelltext) || /\bsupabase\s*\.\s*rpc\s*\(/.test(quelltext)) {
        treffer.push(pfad);
      }
    }
    expect(treffer).toEqual([]);
  });

  test('keine Datei im Graph ruft supabase.auth (Login/Logout/Update) auf', () => {
    const treffer: string[] = [];
    for (const [pfad, quelltext] of graph) {
      if (/\bsupabase\s*\.\s*auth\s*\./.test(quelltext)) treffer.push(pfad);
    }
    expect(treffer).toEqual([]);
  });

  test('der einzige functions.invoke()-Aufruf im gesamten Graph ist in shareApi.ts, ruft nur "share-link" mit aktion "aufloesen" auf', () => {
    const AUFRUF_RE = /functions\s*\.\s*invoke\s*\(\s*['"]([^'"]+)['"]/g;
    const AKTION_RE = /aktion:\s*['"]([^'"]+)['"]/g;
    const dateienMitAufruf: string[] = [];
    const funktionsNamen = new Set<string>();
    const aktionen = new Set<string>();

    for (const [pfad, quelltext] of graph) {
      AUFRUF_RE.lastIndex = 0;
      let treffer: RegExpExecArray | null;
      let hatte = false;
      while ((treffer = AUFRUF_RE.exec(quelltext))) {
        funktionsNamen.add(treffer[1]);
        hatte = true;
      }
      if (hatte) dateienMitAufruf.push(pfad);

      AKTION_RE.lastIndex = 0;
      while ((treffer = AKTION_RE.exec(quelltext))) aktionen.add(treffer[1]);
    }

    expect(dateienMitAufruf).toHaveLength(1);
    expect(dateienMitAufruf[0].endsWith(path.join('sharing', 'shareApi.ts'))).toBe(true);
    expect([...funktionsNamen]).toEqual(['share-link']);
    expect([...aktionen]).toEqual(['aufloesen']);
  });
});
