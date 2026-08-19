// Werkzeug für die Sprachumstellung. Fünf Klassen von Änderungen, in dieser
// Reihenfolge, weil jede die nächste voraussetzt:
//   0. Eigenschaften umbenennen (PropertySignature.rename(), erreicht auch
//      inline typisierte Props ohne eigenen Typnamen, zieht destrukturierte
//      Bindungen UND JSX-Attributnamen projektweit mit; Task 10)
//   1. Symbole umbenennen (ts-morph rename, kennt Scopes, lässt Strings in Ruhe)
//   2. Dateien verschieben (ts-morph move, zieht RELATIVE Importe nach)
//   3. Alias-Importe nachziehen (move lässt @/... auf den alten Pfad zeigen)
//   4. Modulpfade in Strings nachziehen (jest.mock etc., für ts-morph unsichtbar)
import { Project, SyntaxKind } from "ts-morph";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [, , plandatei, modus] = process.argv;
if (!plandatei) {
  console.error("Aufruf: node umbenennen.mjs <plan.json> [--schreiben]");
  process.exit(1);
}
const trocken = modus !== "--schreiben";
const plan = JSON.parse(readFileSync(plandatei, "utf8"));
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..") + "/";
const SRC = WURZEL + "src/";

const project = new Project({ tsConfigFilePath: WURZEL + "tsconfig.json" });
const eigene = () =>
  project.getSourceFiles().filter((f) => !f.getFilePath().includes("node_modules"));

// Schluessel ist das SourceFile-Objekt, nicht der Pfad: move() aendert den Pfad.
const vorher = new Map(eigene().map((f) => [f, f.getFullText()]));
const pfadVorher = new Map(eigene().map((f) => [f, f.getFilePath()]));

// --- 0. Eigenschaften (Props) --------------------------------------------
// Props sind keine Top-Level-Deklarationen (PropertySignature in einem
// type-Literal oder Interface, oft sogar inline im Funktionsparameter statt
// in einem benannten Typ), deshalb greift Schritt 1 hier nicht. rename() auf
// der PropertySignature selbst nutzt denselben sprachserver-gestützten Weg
// wie ein IDE-"Rename Symbol" und zieht sowohl die destrukturierten
// Bindungen (`{ titel }: Props`) als auch JSX-Attributnamen
// (`<Sheet titel="x">`) projektweit mit. Kommt ein Name mehrfach vor (z. B.
// zwei Komponenten in derselben Datei mit je eigenem Props-Typ), werden ALLE
// Fundstellen umbenannt.
let eigenschaften = 0;
for (const [datei, paare] of Object.entries(plan.eigenschaften ?? {})) {
  const f = project.getSourceFileOrThrow(SRC + datei);
  for (const [alt, neu] of Object.entries(paare)) {
    const treffer = f
      .getDescendantsOfKind(SyntaxKind.PropertySignature)
      .filter((p) => p.getName() === alt);
    if (treffer.length === 0) throw new Error(`Eigenschaft ${alt} nicht gefunden in ${datei}`);
    for (const t of treffer) t.rename(neu);
    eigenschaften += treffer.length;
  }
}

// --- 1. Symbole ---------------------------------------------------------
let symbole = 0;
for (const [datei, paare] of Object.entries(plan.symbole ?? {})) {
  const f = project.getSourceFileOrThrow(SRC + datei);
  for (const [alt, neu] of Object.entries(paare)) {
    const treffer =
      f.getFunction(alt) ??
      f.getVariableDeclaration(alt) ??
      f.getTypeAlias(alt) ??
      f.getInterface(alt) ??
      f.getClass(alt) ??
      f.getEnum(alt);
    if (!treffer) throw new Error(`Symbol ${alt} nicht gefunden in ${datei}`);
    treffer.rename(neu);
    symbole++;
  }
}

// --- 2. Dateien ---------------------------------------------------------
const pfadPaare = Object.entries(plan.dateien ?? {});
for (const [alt, neu] of pfadPaare) {
  project.getSourceFileOrThrow(SRC + alt).move(SRC + neu);
}

// --- 3. Alias-Importe (move erfasst sie NICHT) --------------------------
const aliasAlt = (p) => "@/" + p.replace(/\.tsx?$/, "");
let alias = 0;
for (const f of eigene()) {
  for (const d of [...f.getImportDeclarations(), ...f.getExportDeclarations()]) {
    const spez = d.getModuleSpecifierValue();
    if (!spez?.startsWith("@/")) continue;
    for (const [alt, neu] of pfadPaare) {
      if (spez === aliasAlt(alt)) {
        d.setModuleSpecifier(aliasAlt(neu));
        alias++;
      }
    }
  }
}

// --- 4. Modulpfade in Strings (jest.mock, require, dynamisches import) --
let strings = 0;
for (const f of eigene()) {
  for (const lit of f.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const wert = lit.getLiteralValue();
    if (!wert.startsWith("@/")) continue;
    // Nur Argumente von Aufrufen, nie freistehende Texte
    if (!lit.getParentIfKind(SyntaxKind.CallExpression)) continue;
    for (const [alt, neu] of pfadPaare) {
      if (wert === aliasAlt(alt)) {
        lit.setLiteralValue(aliasAlt(neu));
        strings++;
      }
    }
  }
}

// --- Bericht ------------------------------------------------------------
const geaendert = eigene().filter((f) => vorher.get(f) !== f.getFullText());
console.log(
  `${eigenschaften} Eigenschaften, ${symbole} Symbole, ${pfadPaare.length} Dateien verschoben, ` +
    `${alias} Alias-Importe, ${strings} Modulpfade in Strings`
);
console.log(`${geaendert.length} Dateien betroffen`);

// Waechter: kein sichtbarer Text darf sich geaendert haben
const textZaehler = (t) =>
  (t.match(/['"`][^'"`\n]*[äöüÄÖÜß][^'"`\n]*['"`]/g) ?? []).length;
let verdacht = 0;
for (const f of geaendert) {
  const alt = textZaehler(vorher.get(f) ?? "");
  const neu = textZaehler(f.getFullText());
  if (alt !== neu) {
    console.error(`  VERDACHT ${f.getFilePath().replace(SRC, "")}: ${alt} -> ${neu}`);
    verdacht++;
  }
}
console.log(
  verdacht === 0
    ? "Waechter: kein sichtbarer Text angefasst"
    : `Waechter: ${verdacht} Dateien pruefen!`
);

if (trocken) {
  console.log("\n--- Trockenlauf, nichts geschrieben. Beispieldiff: ---");
  const bsp = geaendert.find((f) => f.getFilePath().includes("__tests__")) ?? geaendert[0];
  if (bsp) {
    const a = (vorher.get(bsp) ?? "").split("\n");
    const b = bsp.getFullText().split("\n");
    console.log((pfadVorher.get(bsp) ?? bsp.getFilePath()).replace(SRC, ""));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) console.log(`  - ${a[i]}\n  + ${b[i]}`);
    }
  }
} else {
  project.saveSync();
  console.log("geschrieben.");
}
