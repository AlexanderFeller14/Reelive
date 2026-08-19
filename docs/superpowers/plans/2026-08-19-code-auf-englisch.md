# Quellcode auf Englisch umstellen: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sämtliche Bezeichner, Datei- und Ordnernamen, Testbeschreibungen und
Kommentare in Reelive sind englisch, während die sichtbare Oberfläche
unverändert Deutsch spricht.

**Architecture:** Vierzehn Etappen von blattnah nach aussen, je ein Commit.
Umbenannt wird über die TypeScript-Sprachebene mit `ts-morph`, nicht textuell,
damit sichtbare Texte strukturell unerreichbar bleiben. Zwei Wächter laufen
nach jeder Etappe und beweisen, dass die Zahl der deutschen UI-Texte konstant
bleibt und im fertigen Bereich keine deutschen Bezeichner übrig sind.

**Tech Stack:** TypeScript strict, Expo/React Native, Jest, Deno (Edge
Functions), Supabase/pgTAP, Swift (eigenes Native-Modul), `ts-morph` als
einmaliges Entwicklungswerkzeug.

**Spec:** `docs/superpowers/specs/2026-08-19-code-auf-englisch-design.md`

## Global Constraints

- **Sichtbare UI-Texte bleiben deutsch**, Du-Form, Vokabular nach
  `DESIGN-LANGUAGE.md` §6. Der Wächter zählt sie: die Zahl muss über alle
  Etappen **exakt 2647** bleiben.
- **Das Glossar der Spec ist verbindlich.** Bei jedem Zweifel entscheidet die
  Tabelle in der Spec, nicht das Sprachgefühl im Moment der Umsetzung.
- **Keine Rückwärtskompatibilität.** Die App läuft nur lokal, es gibt keine
  Datenmigration, keine doppelten Namen, keinen Übergangscode.
- **Keine Verhaltensänderung.** Jede Etappe ist im Ergebnis eine reine
  Umbenennung. Einzige Ausnahme: neue Tests aus der Kommentarregel Fall 2.
- **Keine Em-Dashes** in Code, Kommentaren, Tests und Commit-Messages.
- **Dokumente bleiben deutsch**: alles unter `docs/`, `CLAUDE.md`,
  `DESIGN-LANGUAGE.md`, `README.md`, `TODO.md`.
- **Datenbankschema unverändert**: die Tabelle heisst weiter `posts`, die
  Spalte `post_id`. Nur an der Query-Grenze erscheinen diese Namen.
- Jede Etappe endet grün. Für Etappen in `mobile/` heisst das
  `npx tsc --noEmit`, `npx jest` und `npx expo lint`. Für Etappen ausserhalb
  von `mobile/src` gilt die in der Task genannte Prüfung stattdessen:
  `deno check` und `deno test` für die Edge Functions (Task 13),
  `supabase test db` für die Datenbank (Task 14), der Skriptlauf für die
  Hilfsskripte (Task 16). Eine Task ist nie ohne ihre eigene Prüfung fertig.

## Das Etappenrezept

Die Etappen 3 bis 12 laufen alle nach demselben Verfahren. Es steht hier
einmal vollständig; jede Etappen-Task liefert nur noch ihre eigenen Daten.
Alle Befehle laufen aus `mobile/`, sofern nicht anders angegeben.

1. **Deutsche Symbole der Etappe auflisten:**
   `node scripts/rename/deutsche-symbole.mjs <datei> [<datei> ...]`
2. **Mapping schreiben:** Die Ausgabe nach Glossar übersetzen und als
   `scripts/rename/etappen/<name>.json` ablegen. Format:
   ```json
   {
     "dateien": { "alter/pfad.ts": "neuer/pfad.ts" },
     "symbole": { "alter/pfad.ts": { "alterName": "neuerName" } }
   }
   ```
   Die Schlüssel unter `symbole` sind die **alten** Dateipfade, weil die
   Symbole vor dem Verschieben umbenannt werden.
3. **Trockenlauf:** `node scripts/rename/umbenennen.mjs scripts/rename/etappen/<name>.json`
   Prüfen: Stimmt die Zahl der betroffenen Dateien? Meldet der Wächter
   `kein sichtbarer Text angefasst`? Sieht der Beispieldiff richtig aus?
4. **Schreiben:** derselbe Befehl mit `--schreiben`
5. **Kommentare und Testnamen der berührten Dateien durchgehen**, nach der
   Kommentarregel unten
6. **Verifizieren:** `npx tsc --noEmit && npx jest && npx expo lint`
7. **Wächter:** `node scripts/rename/waechter.mjs <fertige ordner...>`
   Erwartung: `Waechter 1: 2647 sichtbare deutsche Texte` und
   `Waechter 2: keine deutschen Bezeichner in ...`
8. **Committen** mit der in der Task angegebenen Message

### Die Kommentarregel

Für jeden deutschen Kommentar in einer berührten Datei, in dieser Reihenfolge:

1. **Ein Test deckt die Aussage bereits ab** → Kommentar löschen. Auch reines
   Nacherzählen des Codes (`// setzt den Zähler zurück` über `setCounter(0)`)
   fällt hierunter.
2. **Testbar, aber ungetestet** → Test schreiben, englischer Name, erzählend,
   dann Kommentar löschen. Der Test kommt in dieselbe Etappe und denselben
   Commit.
3. **Jest kann es strukturell nicht sehen** (Layout, Kamerabild, Navigation,
   Timing am Gerät) → als kurzer englischer Kommentar behalten, Gerätefund und
   Datum erhalten.

Testbeschreibungen behalten ihre Erzählkraft:
`test('bei einem verschluckten Ortstag kann RecapTag.datum abweichen')` wird zu
`test('a swallowed local day lets RecapTag.datum differ from a moment own local date')`,
nicht zu `test('day assignment')`.

---

### Task 1: Arbeitsbaum sichern

Der Arbeitsbaum enthält 27 offene Änderungen, darunter den MultiKamera-Umbau
und das Siegel-Peel. Ohne diesen Schritt vermischen sich echte Änderungen mit
reinen Umbenennungen und kein Diff ist mehr lesbar.

**Files:**
- Modify: keine Quelldateien, nur Git-Zustand

- [ ] **Step 1: Bestandsaufnahme**

```bash
cd /Users/lx/PycharmProjects/Reelive
git status --porcelain
```

Erwartung: 27 Zeilen, davon 16 mit `M` und 11 mit `??`.

- [ ] **Step 2: Prüfen, dass der Bestand grün ist**

```bash
cd mobile && npx tsc --noEmit && npx jest 2>&1 | tail -4
```

Erwartung: `tsc` ohne Ausgabe, `Tests: 1838 passed, 1838 total`.
Falls rot: hier stoppen und melden. Eine Umbenennung auf rotem Grund ist
nicht verifizierbar.

- [ ] **Step 3: MultiKamera-Umbau committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add mobile/src/features/kamera/ mobile/src/app/\(tabs\)/ mobile/src/features/moments/ \
        mobile/jest.setup.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(kamera): MultiCam-Session, Kino-Buehne und Queue-Pfade"
```

- [ ] **Step 4: Siegel-Peel committen**

```bash
git add mobile/src/components/SiegelAbziehen.tsx \
        mobile/src/components/__tests__/SiegelAbziehen.test.tsx \
        mobile/src/features/recap/siegelPeel.ts \
        mobile/src/features/recap/__tests__/siegelPeel.test.ts \
        mobile/src/app/\(tabs\)/recap/ mobile/assets/images/ \
        docs/design/reelive-sticker-peel.html
git commit -m "feat(recap): Siegel zum Abziehen auf der Recap-Uebersicht"
```

- [ ] **Step 5: Rest committen**

```bash
git add -A
git commit -m "chore: offene Aenderungen vor der Sprachumstellung"
git status --porcelain
```

Erwartung: leere Ausgabe.

---

### Task 2: Werkzeugkasten bauen

Drei Skripte, die alle folgenden Etappen tragen. Sie liegen unter
`mobile/scripts/rename/` und werden nach Abschluss der Umstellung wieder
entfernt (Task 18).

Der Code ist an echtem Projektcode erprobt. Zwei Befunde stecken darin, die
beim Schreiben nicht offensichtlich waren:

- `sourceFile.move()` zieht **relative** Importe nach, lässt aber jeden
  `@/`-Alias-Import auf den alten Pfad zeigen. Bei einer einzigen verschobenen
  Datei waren im Test 4 von 5 Importen gebrochen. Schritt 3 des Skripts
  behebt das.
- 59 Modulpfade stecken in String-Argumenten (`jest.mock('@/features/...')`)
  und sind für `ts-morph` unsichtbar. Schritt 4 behebt das, eng begrenzt auf
  Strings, die Argument eines Aufrufs sind.

**Files:**
- Create: `mobile/scripts/rename/umbenennen.mjs`
- Create: `mobile/scripts/rename/deutsche-symbole.mjs`
- Create: `mobile/scripts/rename/waechter.mjs`
- Create: `mobile/scripts/rename/etappen/` (Verzeichnis für die Mappings)
- Modify: `mobile/package.json` (ts-morph als devDependency)

**Interfaces:**
- Produces: `node scripts/rename/umbenennen.mjs <plan.json> [--schreiben]`,
  `node scripts/rename/deutsche-symbole.mjs <relPfad...>`,
  `node scripts/rename/waechter.mjs [fertigerOrdner...]`

- [ ] **Step 1: ts-morph installieren**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
npm install --save-dev ts-morph
```

- [ ] **Step 2: Das Umbenennungswerkzeug anlegen**

Create `mobile/scripts/rename/umbenennen.mjs`:

```javascript
// Werkzeug für die Sprachumstellung. Vier Klassen von Änderungen, in dieser
// Reihenfolge, weil jede die nächste voraussetzt:
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
  `${symbole} Symbole, ${pfadPaare.length} Dateien verschoben, ` +
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
```

- [ ] **Step 3: Den Symbol-Finder anlegen**

Create `mobile/scripts/rename/deutsche-symbole.mjs`:

```javascript
// Listet alle Symbole einer Datei, deren Name einen deutschen Stamm enthält.
// Grundlage für plan.symbole einer Etappe, nachdem jeder Name gemäss Glossar
// übersetzt wurde. Konstanten wie KEIN_ZUGRIFF_TEXT tauchen hier auf: ihr NAME
// wird englisch, ihr Inhalt bleibt deutsch.
import { Project, SyntaxKind } from "ts-morph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STAEMME =
  /reise|moment[ea]|siegel|karte|kamera|konto|teilen|geteilt|fehler|zaehl|vorrat|nadel|bild|tage|uhrzeit|vorschau|uebersicht|einlad|aufnahme|aufnehm|ausloes|zuschnitt|gesehen|melden|sozial|texte|typen|einstellung|medien|verworfen|pfade|sperre|buehne|uebergabe|gruppier|ausschnitt|flaeche|inhalt|zeile|balken|fortschritt|pille|kalender|zeitraum|feld|platzhalter|gebunden|netz|adresse|entfern|loesch|anleg|laden|speicher|pruef|erstell|senden|abzieh|inszenier|versiegel|wechsel|dateien|zurueck|weiter|abbrech|oberkante|waehler|wahl|ort|zeit|anfrage|antwort|zugriff|aufloesung|benachrichtig|verwaltung|zeitplan|geheim|basis|nutzer|hole|setze|baue|rufe/i;

const [, , ...dateien] = process.argv;
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..") + "/";
const project = new Project({ tsConfigFilePath: WURZEL + "tsconfig.json" });

for (const rel of dateien) {
  const f = project.getSourceFileOrThrow(WURZEL + "src/" + rel);
  const namen = new Set();
  const sammle = (knoten, art) => {
    for (const k of knoten) {
      const n = k.getName?.();
      if (n && STAEMME.test(n)) namen.add(`${art}\t${n}`);
    }
  };
  sammle(f.getFunctions(), "function");
  sammle(f.getVariableDeclarations(), "const");
  sammle(f.getTypeAliases(), "type");
  sammle(f.getInterfaces(), "interface");
  sammle(f.getClasses(), "class");
  sammle(f.getEnums(), "enum");
  for (const p of f.getDescendantsOfKind(SyntaxKind.Parameter)) {
    const n = p.getName?.();
    if (n && STAEMME.test(n)) namen.add(`param\t${n}`);
  }
  console.log(`\n=== ${rel} (${namen.size}) ===`);
  for (const z of [...namen].sort()) console.log(z);
}
```

- [ ] **Step 4: Die Wächter anlegen**

Create `mobile/scripts/rename/waechter.mjs`:

```javascript
// Zwei Waechter fuer jede Etappe der Sprachumstellung.
//
// Waechter 1 zaehlt die sichtbaren deutschen Texte. Die Zahl MUSS ueber alle
// Etappen konstant bleiben. Sinkt sie, hat ein Werkzeug einen Text erwischt.
// Gezaehlt werden String-Literale, JSX-Text und Template-Teile, nie Kommentare,
// damit das Uebersetzen von Kommentaren die Zahl nicht bewegt.
//
// Waechter 2 sucht deutsche Bezeichner in den bereits umgestellten Ordnern.
import { Project, SyntaxKind } from "ts-morph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..") + "/";
const SRC = WURZEL + "src/";
const project = new Project({ tsConfigFilePath: WURZEL + "tsconfig.json" });
const eigene = project
  .getSourceFiles()
  .filter((f) => !f.getFilePath().includes("node_modules"));

const DEUTSCH =
  /[äöüÄÖÜß]|\b(der|die|das|und|nicht|ist|dein|deine|du|mit|von|für|noch|kein|keine|wird|wurde|eine|einen)\b/i;

let texte = 0;
for (const f of eigene) {
  for (const k of f.getDescendantsOfKind(SyntaxKind.StringLiteral))
    if (DEUTSCH.test(k.getLiteralValue())) texte++;
  for (const k of f.getDescendantsOfKind(SyntaxKind.JsxText))
    if (DEUTSCH.test(k.getText())) texte++;
  for (const k of f.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral))
    if (DEUTSCH.test(k.getLiteralValue())) texte++;
  // Template-Teile tragen kein getLiteralValue, hier zaehlt der Rohtext.
  for (const art of [
    SyntaxKind.TemplateHead,
    SyntaxKind.TemplateMiddle,
    SyntaxKind.TemplateTail,
  ])
    for (const k of f.getDescendantsOfKind(art))
      if (DEUTSCH.test(k.getText())) texte++;
}
console.log(`Waechter 1: ${texte} sichtbare deutsche Texte`);

const FERTIG = process.argv.slice(2);
const STAEMME =
  /reise|momente|siegel|karte|kamera|konto|teilen|fehler|zaehl|vorrat|nadel|uhrzeit|vorschau|uebersicht|einlad|aufnahme|ausloes|zuschnitt|gesehen|melden|sozial|einstellung|medien|verworfen|pfade|sperre|buehne|uebergabe|gruppier|ausschnitt|flaeche|fortschritt|pille|zeitraum|platzhalter|oberkante|waehler|loesch|entfern|pruef|erstell|abzieh|inszenier|versiegel/i;

let reste = 0;
for (const f of eigene) {
  const rel = f.getFilePath().replace(SRC, "");
  if (!FERTIG.some((o) => rel.startsWith(o))) continue;
  const treffer = new Set();
  for (const bez of f.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const n = bez.getText();
    if (STAEMME.test(n)) treffer.add(n);
  }
  if (treffer.size) {
    console.log(`  ${rel}: ${[...treffer].join(", ")}`);
    reste += treffer.size;
  }
}
if (FERTIG.length)
  console.log(
    reste === 0
      ? `Waechter 2: keine deutschen Bezeichner in ${FERTIG.join(", ")}`
      : `Waechter 2: ${reste} Reste`
  );
```

- [ ] **Step 5: Die Ausgangsmessung festhalten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
mkdir -p scripts/rename/etappen
node scripts/rename/waechter.mjs
```

Erwartung: `Waechter 1: 2647 sichtbare deutsche Texte`.
Diese Zahl ist ab jetzt die Sollgrösse jeder Etappe. Weicht sie schon hier
ab, wurde vor Task 1 etwas verändert: erst klären, dann weiter.

- [ ] **Step 6: Den Symbol-Finder an einer bekannten Datei prüfen**

```bash
node scripts/rename/deutsche-symbole.mjs lib/fehlermelder.ts theme/useOberkante.ts
```

Erwartung:
```
=== lib/fehlermelder.ts (2) ===
function	initFehlermelder
function	meldeFehler

=== theme/useOberkante.ts (1) ===
function	useOberkante
```

- [ ] **Step 7: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add mobile/scripts/rename mobile/package.json mobile/package-lock.json
git commit -m "chore(rename): Werkzeug und Waechter fuer die Sprachumstellung"
```

---

### Task 3: Etappe lib und theme

Die kleinste Etappe, blattnah und mit wenigen Abhängigen. Sie dient zugleich
als Probelauf für das Rezept.

**Files:**
- Rename: `src/lib/fehlermelder.ts` → `src/lib/errorReporter.ts`
- Rename: `src/lib/netzfehler.ts` → `src/lib/networkError.ts`
- Rename: `src/lib/supabaseAdresse.ts` → `src/lib/supabaseUrl.ts`
- Rename: `src/theme/useOberkante.ts` → `src/theme/useTopInset.ts`
- Rename: die vier zugehörigen Dateien unter `__tests__/`
- Modify: rund 37 Dateien, die davon importieren

**Interfaces:**
- Produces: `initErrorReporter()`, `reportError()`, `useTopInset()`. Alle
  folgenden Etappen verwenden diese Namen.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs lib/fehlermelder.ts lib/netzfehler.ts \
  lib/supabaseAdresse.ts theme/useOberkante.ts
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/01-lib-theme.json`:

```json
{
  "dateien": {
    "lib/fehlermelder.ts": "lib/errorReporter.ts",
    "lib/netzfehler.ts": "lib/networkError.ts",
    "lib/supabaseAdresse.ts": "lib/supabaseUrl.ts",
    "theme/useOberkante.ts": "theme/useTopInset.ts",
    "lib/__tests__/fehlermelder.test.ts": "lib/__tests__/errorReporter.test.ts",
    "lib/__tests__/supabaseAdresse.test.ts": "lib/__tests__/supabaseUrl.test.ts",
    "theme/__tests__/useOberkante.test.tsx": "theme/__tests__/useTopInset.test.tsx"
  },
  "symbole": {
    "lib/fehlermelder.ts": {
      "initFehlermelder": "initErrorReporter",
      "meldeFehler": "reportError"
    },
    "lib/supabaseAdresse.ts": {
      "supabaseBasis": "supabaseBaseUrl",
      "laufendeBasis": "currentBaseUrl"
    },
    "theme/useOberkante.ts": { "useOberkante": "useTopInset" }
  }
}
```

Dieses Mapping ist vollständig und geprüft. Zwei Dinge daran sind nicht
offensichtlich und gelten sinngemäss für jede weitere Etappe:

- `lib/netzfehler.ts` hat **kein** deutsches Symbol, nur einen deutschen
  Dateinamen. Solche Dateien stehen nur unter `dateien`, nicht unter
  `symbole`.
- Zu `netzfehler.ts` gibt es **keine** Testdatei. Ein Eintrag für eine Datei,
  die es nicht gibt, lässt `getSourceFileOrThrow` abbrechen. Vor dem
  Schreiben des Mappings deshalb immer `ls` auf den `__tests__`-Ordner.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/01-lib-theme.json
```

Erwartung: Zeile `Waechter: kein sichtbarer Text angefasst`. Im Trockenlauf
mit den vier Dateien wurden 33 Alias-Importe nachgezogen; eine Zahl in dieser
Grössenordnung ist das Zeichen, dass Schritt 3 des Werkzeugs greift. Steht
dort 0, ist das Mapping falsch geschrieben.

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/01-lib-theme.json --schreiben
```

- [ ] **Step 5: Kommentare und Testnamen der berührten Dateien**

Die vier Module und ihre Tests nach der Kommentarregel durchgehen. In
`lib/fehlermelder.ts` steht der Sentry-Aufbau; Kommentare, die nur den
Aufrufablauf nacherzählen, fallen unter Fall 1.

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

Erwartung: `tsc` still, `Tests: 1838 passed` oder mehr, `expo lint` ohne neue
Fehler gegenüber dem Stand aus Task 1.

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme
```

Erwartung: `Waechter 1: 2647 sichtbare deutsche Texte` und
`Waechter 2: keine deutschen Bezeichner in lib, theme`.

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(lib): lib und theme auf englische Bezeichner"
```

---

### Task 4: Etappe features/moments

**Files:**
- Rename: `einstellungen.ts` → `settings.ts`, `medien.ts` → `media.ts`,
  `ortUndZeit.ts` → `placeAndTime.ts`, `postsApi.ts` → `momentsApi.ts`,
  `queuePfade.ts` → `queuePaths.ts`, `zaehler.ts` → `counter.ts`
- Modify: `queueDb.ts`, `queueDb.web.ts`, `queueLogic.ts`, `uploadWorker.ts`,
  `types.ts` (Bezeichner, Dateiname bleibt)
- Rename: die zugehörigen Testdateien

**Interfaces:**
- Consumes: `reportError` aus Task 3
- Produces: `momentsApi` mit englischen Exporten. `postId` heisst ab hier
  `momentId`. An der Supabase-Grenze bleibt `.from('posts')` und die Spalte
  `post_id` unverändert stehen; nur die TypeScript-Namen wandern.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs features/moments/einstellungen.ts \
  features/moments/medien.ts features/moments/ortUndZeit.ts \
  features/moments/postsApi.ts features/moments/queuePfade.ts \
  features/moments/zaehler.ts features/moments/queueDb.ts \
  features/moments/queueLogic.ts features/moments/uploadWorker.ts \
  features/moments/types.ts
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/02-moments.json` mit den sechs
Dateiumbenennungen oben, den zugehörigen Testdateien und den übersetzten
Symbolen aus Step 1.

Achtung bei diesen drei Namen:
- Die SQLite-Tabelle `verworfene_momente` ist ein **String**, kein Bezeichner.
  Sie bleibt in dieser Etappe unverändert und kommt erst in Task 16 dran.
- Konstanten, deren Wert sichtbarer Text ist, ändern nur den Namen.
- `postId` → `momentId` betrifft viele Dateien; das Rename über die
  Deklaration in `types.ts` erfasst sie alle.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/02-moments.json
```

Erwartung: `Waechter: kein sichtbarer Text angefasst`.

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/02-moments.json --schreiben
```

- [ ] **Step 5: Kommentare und Testnamen**

Nach der Kommentarregel. Zwei Fälle sind hier bekannt:
- Der Kommentarkopf von `queueDb.ts` über den Lazy-Init ist durch
  `test('öffnet die Datenbank nicht beim Import, sondern erst beim ersten
  Zugriff')` gedeckt: Fall 1, löschen. Der Testname selbst wird englisch.
- Der Kommentar über die Spaltenreihenfolge in `queueDb.ts` beschreibt eine
  Migrationsfalle. Prüfen, ob ein Test sie abdeckt; falls nicht, ist das
  Fall 2, also Test schreiben.

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme features/moments
```

Erwartung: `Waechter 1: 2647`, `Waechter 2: keine deutschen Bezeichner`.

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(moments): features/moments auf englische Bezeichner"
```

---

### Task 5: Etappe features/recap

**Files:**
- Rename: `gesehen.ts` → `seen.ts`, `meldenApi.ts` → `reportApi.ts`,
  `siegelPeel.ts` → `sealPeel.ts`, `sozialApi.ts` → `socialApi.ts`,
  `tage.ts` → `days.ts`, `uhrzeit.ts` → `timeOfDay.ts`,
  `urlVorrat.ts` → `urlPool.ts`
- Modify: `exportApi.ts`, `playerLogic.ts`, `recapApi.ts`, `types.ts`
- Rename: die zugehörigen Testdateien

**Interfaces:**
- Consumes: `momentId` aus Task 4, `reportError` aus Task 3
- Produces: `RecapDay` statt `RecapTag`, `getPool` statt `holeVorrat`,
  `seen`-API statt `gesehen`. Task 12 (Routen) verwendet diese Namen.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs features/recap/gesehen.ts \
  features/recap/meldenApi.ts features/recap/siegelPeel.ts \
  features/recap/sozialApi.ts features/recap/tage.ts features/recap/uhrzeit.ts \
  features/recap/urlVorrat.ts features/recap/exportApi.ts \
  features/recap/playerLogic.ts features/recap/recapApi.ts features/recap/types.ts
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/03-recap.json`.

`RecapTag` wird zu `RecapDay`. Dieser Typ erscheint auch in Kommentaren und
Testnamen anderer Ordner; das Rename fasst nur den Code, die Textstellen
werden in Step 5 der jeweiligen Etappe nachgezogen.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/03-recap.json
```

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/03-recap.json --schreiben
```

- [ ] **Step 5: Kommentare und Testnamen**

Bekannter Fall: Der Kommentar in `tage.ts` über die Datumsgrenze ostwärts ist
durch `test('bei einem verschluckten Ortstag kann RecapTag.datum vom eigenen
lokalen Datum eines Moments abweichen')` gedeckt. Fall 1, löschen; der
Testname wird englisch und behält seine Aussage.

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme features/moments features/recap
```

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(recap): features/recap auf englische Bezeichner"
```

---

### Task 6: Etappe features/trips und features/auth

**Files:**
- Rename: `trips/kalender.ts` → `trips/calendar.ts`,
  `trips/platzhalterCover.ts` → `trips/placeholderCover.ts`,
  `trips/useReiseGebunden.ts` → `trips/useTripBound.ts`
- Rename: `auth/zuschnitt.ts` → `auth/crop.ts`
- Modify: `trips/inviteLink.ts`, `trips/joinFlow.ts`, `trips/tripDay.ts`,
  `trips/tripsApi.ts`, `trips/tripsCache.ts`, `trips/types.ts`,
  `auth/avatar.ts`, `auth/authApi.ts`, `auth/profileApi.ts`, `auth/guard.ts`,
  `auth/phone.ts`, `auth/AuthProvider.tsx`
- Rename: die zugehörigen Testdateien

**Interfaces:**
- Produces: `useTripBound()`, `placeholderCover()`. Task 12 nutzt beide.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs features/trips/kalender.ts \
  features/trips/platzhalterCover.ts features/trips/useReiseGebunden.ts \
  features/trips/inviteLink.ts features/trips/joinFlow.ts \
  features/trips/tripDay.ts features/trips/tripsApi.ts \
  features/trips/tripsCache.ts features/trips/types.ts features/auth/zuschnitt.ts \
  features/auth/avatar.ts features/auth/authApi.ts features/auth/profileApi.ts \
  features/auth/guard.ts features/auth/phone.ts features/auth/AuthProvider.tsx
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/04-trips-auth.json`.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/04-trips-auth.json
```

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/04-trips-auth.json --schreiben
```

- [ ] **Step 5: Kommentare und Testnamen** nach der Kommentarregel

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme features/moments features/recap \
  features/trips features/auth
```

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(trips): features/trips und features/auth auf englische Bezeichner"
```

---

### Task 7: Etappe features/kamera wird features/camera

Die erste Etappe mit einem Ordnerwechsel. Das Werkzeug bildet das ab, indem
jede Datei einzeln von `features/kamera/x.ts` nach `features/camera/y.ts`
verschoben wird; einen eigenen Ordner-Befehl gibt es nicht.

**Files:**
- Rename: `kamera/aufnahmeSperre.ts` → `camera/captureLock.ts`
- Rename: `kamera/kinoBuehne.ts` → `camera/cinemaStage.ts`
- Rename: `kamera/multiKamera.ts` → `camera/multiCamera.ts`
- Rename: `kamera/nativeAufnahme.ts` → `camera/nativeCapture.ts`
- Rename: `kamera/nativeZoom.ts` → `camera/nativeZoom.ts`
- Rename: `kamera/uebergabe.ts` → `camera/handoff.ts`
- Rename: `kamera/zoom.ts` → `camera/zoom.ts`
- Rename: alle sieben Dateien unter `kamera/__tests__/`
- Modify: `app/(tabs)/_layout.tsx`, `app/(tabs)/aufnehmen/index.tsx` und deren
  Tests (Import-Pfade; die Dateien selbst kommen erst in Task 12 dran)

**Interfaces:**
- Produces: `cinemaStage` mit `set()` und `subscribe()`, `captureLock`,
  `handoff.savedFile`. Task 12 und Task 13 hängen daran.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs features/kamera/aufnahmeSperre.ts \
  features/kamera/kinoBuehne.ts features/kamera/multiKamera.ts \
  features/kamera/nativeAufnahme.ts features/kamera/nativeZoom.ts \
  features/kamera/uebergabe.ts features/kamera/zoom.ts
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/05-camera.json`. Alle vierzehn Dateien
inklusive Tests aufführen, auch die, deren Name gleich bleibt
(`zoom.ts`, `nativeZoom.ts`), weil sich ihr Ordner ändert.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/05-camera.json
```

Hier gilt besondere Aufmerksamkeit der Zeile mit den Alias-Importen: allein
`kinoBuehne.ts` hat vier Importeure über `@/`, die ohne Schritt 3 des
Werkzeugs ins Leere zeigen würden.

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/05-camera.json --schreiben
```

- [ ] **Step 5: Leeren Ordner entfernen und Kommentare**

```bash
rmdir src/features/kamera/__tests__ src/features/kamera 2>/dev/null; true
```

Der Kommentarkopf von `kinoBuehne.ts` über die 10 Prozent Bildbreite ist
Fall 3 der Kommentarregel: Jest sieht kein Layout. Er bleibt, auf Englisch,
mitsamt Gerätefund und Datum.

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme features/moments features/recap \
  features/trips features/auth features/camera
```

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(camera): features/kamera wird features/camera"
```

---

### Task 8: Etappe features/karte wird features/map

**Files:**
- Rename: `karte/KartenFlaeche.tsx` → `map/MapSurface.tsx`
- Rename: `karte/KartenFlaeche.web.tsx` → `map/MapSurface.web.tsx`
- Rename: `karte/MomentSheet.tsx` → `map/MomentSheet.tsx`
- Rename: `karte/ausschnitt.ts` → `map/viewport.ts`
- Rename: `karte/gruppenTipp.ts` → `map/clusterTap.ts`
- Rename: `karte/gruppierung.ts` → `map/clustering.ts`
- Rename: `karte/kartenPunkte.ts` → `map/mapPoints.ts`
- Rename: `karte/nadel.ts` → `map/pin.ts`
- Rename: `karte/typen.ts` → `map/types.ts`
- Rename: alle Dateien unter `karte/__tests__/`

**Interfaces:**
- Consumes: `RecapDay` aus Task 5
- Produces: `MapSurface`, `clustering`, `mapPoints`, `pin`. Task 12 nutzt sie.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs features/karte/KartenFlaeche.tsx \
  features/karte/MomentSheet.tsx features/karte/ausschnitt.ts \
  features/karte/gruppenTipp.ts features/karte/gruppierung.ts \
  features/karte/kartenPunkte.ts features/karte/nadel.ts features/karte/typen.ts
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/06-map.json`. Die `.web.tsx`-Variante
nicht vergessen: sie wird von Metro über die Endung aufgelöst und taucht in
keinem Import auf.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/06-map.json
```

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/06-map.json --schreiben
```

- [ ] **Step 5: Leeren Ordner entfernen und Kommentare**

```bash
rmdir src/features/karte/__tests__ src/features/karte 2>/dev/null; true
```

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme features/moments features/recap \
  features/trips features/auth features/camera features/map
```

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(map): features/karte wird features/map"
```

---

### Task 9: Etappe features/teilen, features/konto und features/push

**Files:**
- Rename: `teilen/TeilenSheetInhalt.tsx` → `sharing/ShareSheetContent.tsx`
- Rename: `teilen/linkVerwaltenApi.ts` → `sharing/linkManagementApi.ts`
- Rename: `teilen/shareApi.ts` → `sharing/shareApi.ts`
- Rename: `teilen/texte.ts` → `sharing/texts.ts`
- Rename: `konto/kontoApi.ts` → `account/accountApi.ts`
- Rename: `push/einstellungen.ts` → `push/settings.ts`
- Modify: `push/pushApi.ts`, `push/pushApi.web.ts`
- Rename: alle zugehörigen Testdateien

**Interfaces:**
- Produces: `shareApi`, `linkManagementApi.isRecapShared()`, `accountApi`.
  Task 12 und Task 14 hängen daran.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs features/teilen/TeilenSheetInhalt.tsx \
  features/teilen/linkVerwaltenApi.ts features/teilen/shareApi.ts \
  features/teilen/texte.ts features/konto/kontoApi.ts \
  features/push/einstellungen.ts features/push/pushApi.ts
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/07-sharing-account-push.json`.

`texte.ts` enthält sichtbare Texte als Konstanten. Nur die Konstantennamen
werden englisch, die Werte bleiben Wort für Wort stehen. Der Wächter in
Step 7 beweist das.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/07-sharing-account-push.json
```

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/07-sharing-account-push.json --schreiben
```

- [ ] **Step 5: Leere Ordner entfernen und Kommentare**

```bash
rmdir src/features/teilen/__tests__ src/features/teilen \
      src/features/konto/__tests__ src/features/konto 2>/dev/null; true
```

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme features
```

Ab hier ist der gesamte Ordner `features` fertig, deshalb genügt ein Argument.

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(sharing): teilen, konto und push auf englische Bezeichner"
```

---

### Task 10: Etappe components

**Files:**
- Rename: die vierzehn Komponenten aus der Spec-Tabelle, dazu ihre Tests

**Interfaces:**
- Consumes: alles aus `features`, bereits englisch
- Produces: `ShutterButton`, `AvatarPicker`, `AvatarCropper`, `ProgressBar`,
  `Calendar`, `MapPin`, `MomentSubmissionAnimation`, `Pill`, `RevealSequence`,
  `SealPeel`, `SealAnimation`, `CounterRoll`, `DateRangeField`,
  `ZoomSelector`. Task 12 verwendet diese Namen.

- [ ] **Step 1: Symbole auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/deutsche-symbole.mjs components/Ausloeser.tsx \
  components/AvatarWaehler.tsx components/AvatarZuschnitt.tsx \
  components/Fortschrittsbalken.tsx components/Kalender.tsx \
  components/KartenNadel.tsx components/MemorySubmissionAnimation.tsx \
  components/Pille.tsx components/RevealInszenierung.tsx \
  components/SiegelAbziehen.tsx components/Versiegelung.tsx \
  components/ZaehlerRoll.tsx components/Zeitraumfeld.tsx components/ZoomWahl.tsx
```

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/08-components.json` mit den vierzehn
Umbenennungen aus der Spec plus Tests.

- [ ] **Step 3: Trockenlauf**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/08-components.json
```

- [ ] **Step 4: Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/08-components.json --schreiben
```

- [ ] **Step 5: Verweise auf Versiegelung.tsx nachziehen**

`Versiegelung.tsx` wird nirgends importiert, aber in sechs Kommentaren als
Referenzmuster zitiert. Diese Verweise auf `SealAnimation.tsx` aktualisieren:

```bash
grep -rn 'Versiegelung' src --include='*.tsx' --include='*.ts'
```

Betroffen sind `app/(tabs)/profil.tsx` (zwei Stellen),
`app/(tabs)/recap/[id]/player.tsx` (drei Stellen) und
`app/(tabs)/aufnehmen/index.tsx`. Wo das Wort einen sichtbaren Text meint
oder den Fachbegriff der Versiegelung beschreibt, bleibt es unverändert; nur
Dateiverweise wandern.

- [ ] **Step 6: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

- [ ] **Step 7: Wächter**

```bash
node scripts/rename/waechter.mjs lib theme features components
```

- [ ] **Step 8: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(components): Komponenten auf englische Namen"
```

---

### Task 11: Etappe app, Routen und Navigationspfade

Die heikelste Etappe. Der Dateiname einer Route **ist** ihre URL, und die 46
Navigationsziele stehen als String im Code. Beides muss gemeinsam wandern,
sonst kompiliert alles und die App bricht erst beim Antippen.

**Files:**
- Rename: die zehn Routen aus der Spec-Tabelle plus Ordner
- Modify: alle Dateien mit `router.push`, `router.replace`, `href` oder
  `pathname` auf einen umbenannten Pfad
- Modify: `supabase/functions/share-link/index.ts:372` und die Konstante
  `TEILEN_BASIS_URL`
- Modify: `supabase/functions/share-link/share_link_integration_test.ts:400`

**Interfaces:**
- Consumes: alle Namen aus den Tasks 3 bis 10
- Produces: die endgültigen Routen `/capture`, `/trip`, `/trip/new`,
  `/trip/[id]/edit`, `/trip/[id]/invite`, `/recap/[id]/overview`,
  `/recap/[id]/map`, `/share/[token]`, `/preview`, `/profile`

- [ ] **Step 1: Alle Navigationsziele auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
grep -rn "push(\|replace(\|navigate(\|href=\|pathname:" src --include='*.tsx' --include='*.ts' \
  | grep -E "/(reise|recap|aufnehmen|vorschau|teilen|profil)" | tee /tmp/routen-vorher.txt | wc -l
```

Erwartung: 46 Zeilen. Diese Datei ist die Checkliste für Step 5.

- [ ] **Step 2: Mapping schreiben**

Create `mobile/scripts/rename/etappen/09-routes.json` mit den zehn
Routendateien und ihren Symbolen.

- [ ] **Step 3: Trockenlauf und Schreiben**

```bash
node scripts/rename/umbenennen.mjs scripts/rename/etappen/09-routes.json
node scripts/rename/umbenennen.mjs scripts/rename/etappen/09-routes.json --schreiben
```

- [ ] **Step 4: Leere Ordner entfernen**

```bash
rmdir "src/app/(tabs)/reise/[id]" "src/app/(tabs)/reise/__tests__" \
      "src/app/(tabs)/reise" "src/app/(tabs)/aufnehmen/__tests__" \
      "src/app/(tabs)/aufnehmen" src/app/teilen/__tests__ src/app/teilen 2>/dev/null; true
```

- [ ] **Step 5: Die 46 Pfad-Strings von Hand nachziehen**

Das Werkzeug fasst diese Strings nicht an, weil sie Routen sind und keine
Modulpfade. Jede Zeile aus `/tmp/routen-vorher.txt` durchgehen und ersetzen:

| alt | neu |
|---|---|
| `/reise` | `/trip` |
| `/reise/neu` | `/trip/new` |
| `/reise/${id}` | `/trip/${id}` |
| `/reise/${id}/einladen` | `/trip/${id}/invite` |
| `/reise/${id}/bearbeiten` | `/trip/${id}/edit` |
| `/recap/[id]/uebersicht` | `/recap/[id]/overview` |
| `/recap/${id}/uebersicht` | `/recap/${id}/overview` |
| `/recap/[id]/karte` | `/recap/[id]/map` |
| `/aufnehmen` | `/capture` |
| `/vorschau` | `/preview` |
| `/teilen/` | `/share/` |
| `/profil` | `/profile` |

Danach prüfen, dass keiner übrig ist:

```bash
grep -rn "/(reise|aufnehmen|vorschau|teilen|profil)" src --include='*.tsx' --include='*.ts' \
  -E | grep -v "^Binary" | wc -l
```

Erwartung: 0.

- [ ] **Step 6: Den serverseitig erzeugten Share-Link anpassen**

In `supabase/functions/share-link/index.ts` die Konstante `TEILEN_BASIS_URL`
zu `SHARE_BASE_URL` umbenennen und in Zeile 372 den Pfad ändern:

```typescript
return json({ token, url: `${SHARE_BASE_URL}/share/${token}` }, 200);
```

In `share_link_integration_test.ts:400` die Zusicherung mitziehen:

```typescript
assert(erstellt.url.endsWith(`/share/${erstellt.token}`), erstellt.url);
```

Der übrige Code dieser Function bleibt bis Task 13 unberührt.

- [ ] **Step 7: Verifizieren**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
cd ../supabase/functions && deno test --allow-env share-link/ 2>&1 | tail -4
```

- [ ] **Step 8: Am Gerät prüfen**

Die Jest-Suite sieht keine Navigation. Deshalb hier zwingend ein Lauf im
Simulator oder am iPhone: jeden Tab öffnen, eine Reise anlegen, einladen,
bearbeiten, aufnehmen, Vorschau, Recap-Übersicht, Karte, Player, teilen.
Jeder Pfad, der ins Leere zeigt, fällt sofort auf.

- [ ] **Step 9: Wächter und Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/waechter.mjs lib theme features components app
cd .. && git add -A
git commit -m "refactor(app): Routen und Navigationspfade auf Englisch"
```

---

### Task 12: Etappe natives Modul

**Files:**
- Rename: `mobile/modules/kamera-zoom/` → `mobile/modules/camera-zoom/`
- Rename: die fünf Swift-Dateien aus der Spec-Tabelle
- Rename: `ios/KameraZoom.podspec` → `ios/CameraZoom.podspec`
- Modify: `expo-module.config.json`
- Modify: `src/features/camera/nativeZoom.ts`, `nativeCapture.ts`,
  `multiCamera.ts` (die `requireNativeModule`- und
  `requireNativeViewManager`-Aufrufe)

**Interfaces:**
- Produces: Native-Modulnamen `CameraZoomModule`, `CameraCaptureModule`,
  `MultiCameraModule`, View-Manager-Name `CameraCapture`

- [ ] **Step 1: Ordner und Dateien umbenennen**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile/modules
git mv kamera-zoom camera-zoom
cd camera-zoom/ios
git mv KameraZoomModule.swift CameraZoomModule.swift
git mv KameraAufnahmeModule.swift CameraCaptureModule.swift
git mv MultiKameraModule.swift MultiCameraModule.swift
git mv MultiKameraSucherView.swift MultiCameraViewfinderView.swift
git mv SofortVorschauView.swift InstantPreviewView.swift
git mv KameraZoom.podspec CameraZoom.podspec
```

- [ ] **Step 2: Swift-Klassennamen und Bezeichner umstellen**

In jeder der fünf Swift-Dateien den Klassennamen, die `Name(...)`-Angabe der
Expo-Modul-Definition und alle deutschen Bezeichner nach Glossar umstellen.
Die Kommentare nach der Kommentarregel behandeln; Swift-Code ist von Jest
grundsätzlich ungesehen, hier greift überwiegend Fall 3.

- [ ] **Step 3: Modulkonfiguration anpassen**

`mobile/modules/camera-zoom/expo-module.config.json`:

```json
{
  "platforms": ["apple"],
  "apple": {
    "modules": ["CameraZoomModule", "CameraCaptureModule", "MultiCameraModule"],
    "podspecPath": ["ios/CameraZoom.podspec"]
  }
}
```

- [ ] **Step 4: Die JavaScript-Seite anpassen**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
grep -rn "requireNativeModule\|requireNativeViewManager" src/features/camera/
```

Jeden Namen auf die neuen Werte setzen, insbesondere
`requireNativeViewManager('KameraAufnahme')` zu
`requireNativeViewManager('CameraCapture')`.

- [ ] **Step 5: Neu bauen**

```bash
npx expo prebuild --platform ios --clean
npx expo run:ios
```

`prebuild --clean` setzt die Xcode-Signierung zurück. Nach dem Lauf in Xcode
prüfen, dass das Entwicklerteam wieder gesetzt ist, sonst schlägt der Build
auf dem Gerät fehl.

- [ ] **Step 6: Am Gerät prüfen**

Sucher öffnen, zwischen den Zoomstufen wechseln, Kamera wechseln, ein Foto
und ein Video aufnehmen. Bricht das Native-Modul, erscheint beim Öffnen des
Suchers ein Fehler über ein unbekanntes Modul.

- [ ] **Step 7: Verifizieren und Committen**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4
cd .. && git add -A
git commit -m "refactor(native): kamera-zoom wird camera-zoom mit englischen Klassen"
```

---

### Task 13: Etappe Edge Functions

41 Dateien mit 10 659 Zeilen. `ts-morph` steht hier nicht zur Verfügung, weil
Deno seine Abhängigkeiten über URL-Importe auflöst und kein
`tsconfig.json`-Projekt bildet. Umgestellt wird von Hand, abgesichert durch
`deno check` und die 20 vorhandenen Tests. Das Risiko ist gering, weil dieser
Code keine sichtbaren UI-Texte enthält.

**Files:**
- Modify: alle 41 Dateien unter `supabase/functions/`
- Rename: die Dateien aus der Spec-Tabelle
- Rename: `konto-loeschen/` → `delete-account/`,
  `moment-entfernen/` → `remove-moment/`,
  `reveal-zeitplan/` → `reveal-schedule/`
- Modify: die Aufrufstellen im Client

**Interfaces:**
- Consumes: die Client-Namen aus Task 9
- Produces: Function-Namen `delete-account`, `remove-moment`,
  `reveal-schedule`. Task 14 ruft `reveal-schedule` aus dem Cron-Job auf.

- [ ] **Step 1: Bestand sichern**

```bash
cd /Users/lx/PycharmProjects/Reelive/supabase/functions
deno test --allow-env 2>&1 | tail -5
```

Erwartung: alle 20 Tests grün. Die Zahl notieren.

- [ ] **Step 2: Code innerhalb der Functions umstellen**

Function für Function, in dieser Reihenfolge: `_shared`, `media-urls`,
`share-link`, `moment-entfernen`, `reveal-trip`, `reveal-zeitplan`,
`konto-loeschen`. Glossar der Spec plus die Ergänzungen für den Server:
`Anfrage` zu `request`, `Antwort` zu `response`, `Zugriff` zu `access`,
`Auflösung` zu `resolution`, `Benachrichtigung` zu `notification`,
`Verwaltung` zu `management`, `Zeitplan` zu `schedule`.

**Ausgenommen sind drei Namen in `reveal-zeitplan`:** der Header
`x-cron-geheimnis`, die Body-Felder `aufgabe` und `heute` sowie der Wert
`'erinnerung'`. Sie sind ein Vertrag mit dem SQL-Cron-Job und wandern
geschlossen in Task 14. Werden sie hier schon umbenannt, laeuft der Job bis
dahin gegen eine Function, die seinen Body nicht mehr versteht. Die internen
Bezeichner ringsum werden dagegen normal englisch.

Nach jeder Function:

```bash
deno check <ordner>/*.ts && deno test --allow-env <ordner>/ 2>&1 | tail -3
```

- [ ] **Step 3: Dateien umbenennen**

```bash
cd /Users/lx/PycharmProjects/Reelive/supabase/functions
git mv _shared/fehlermelder.ts _shared/errorReporter.ts
git mv _shared/fehlermelder_test.ts _shared/errorReporter_test.ts
git mv share-link/aufloesung.ts share-link/resolution.ts
git mv share-link/aufloesung_test.ts share-link/resolution_test.ts
git mv share-link/benachrichtigung.ts share-link/notification.ts
git mv share-link/benachrichtigung_test.ts share-link/notification_test.ts
git mv share-link/benachrichtigungStore_integration_test.ts \
       share-link/notificationStore_integration_test.ts
git mv share-link/verwaltung.ts share-link/management.ts
git mv share-link/verwaltung_test.ts share-link/management_test.ts
git mv moment-entfernen/zugriff.ts moment-entfernen/access.ts
git mv moment-entfernen/zugriff_test.ts moment-entfernen/access_test.ts
git mv reveal-zeitplan/zeitplan.ts reveal-zeitplan/schedule.ts
git mv reveal-zeitplan/zeitplan_test.ts reveal-zeitplan/schedule_test.ts
git mv reveal-zeitplan/zeitplanStore.ts reveal-zeitplan/scheduleStore.ts
git mv reveal-zeitplan/zeitplanStore_integration_test.ts \
       reveal-zeitplan/scheduleStore_integration_test.ts
```

Die weiteren deutschen Dateinamen (`lesenZugriff.ts`,
`konto_loeschen_integration_test.ts`) mit `find . -name '*.ts'` aufspüren und
nach Glossar mitziehen. Danach alle Importe in den betroffenen Functions auf
die neuen Dateinamen setzen; Deno importiert mit Dateiendung, ein vergessener
Pfad fällt bei `deno check` sofort auf.

- [ ] **Step 4: Verzeichnisse umbenennen**

```bash
git mv konto-loeschen delete-account
git mv moment-entfernen remove-moment
git mv reveal-zeitplan reveal-schedule
```

- [ ] **Step 5: Aufrufstellen im Client anpassen**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
grep -rn "konto-loeschen\|moment-entfernen\|reveal-zeitplan" src/
```

Jeden Treffer auf den neuen Namen setzen. Betroffen sind
`functions.invoke('konto-loeschen')` in der Konto-API und
`functions.invoke('moment-entfernen')` in der Moments-API, dazu die Mocks in
den zugehörigen Tests.

- [ ] **Step 6: Verifizieren**

```bash
cd /Users/lx/PycharmProjects/Reelive/supabase/functions
deno check **/*.ts && deno test --allow-env 2>&1 | tail -5
cd ../../mobile && npx tsc --noEmit && npx jest 2>&1 | tail -4
```

Erwartung: dieselbe Testzahl wie in Step 1, Jest unverändert grün.

- [ ] **Step 7: Gegen die lokale Instanz prüfen**

```bash
cd /Users/lx/PycharmProjects/Reelive
supabase functions serve &
```

Jede der sieben Functions einmal aufrufen und auf `401` statt `503` prüfen:
Ein `401` heisst, die Function läuft und weist den Aufruf ab. Ein `503`
heisst, sie existiert nicht mehr unter diesem Namen.

- [ ] **Step 8: Committen**

```bash
git add -A
git commit -m "refactor(functions): Edge Functions auf englische Namen und Bezeichner"
```

---

### Task 14: Etappe Datenbank und der Cron-Vertrag

Diese Etappe trägt die einzige Stelle im Projekt, an der SQL und TypeScript
über nicht typisierte Namen miteinander reden. Der Cron-Job baut in SQL einen
HTTP-Aufruf zusammen, den die Edge Function auf der anderen Seite auseinander
nimmt. Drei Dinge sind dabei verabredet und nirgends vom Compiler geprüft:

| Vertrag | heute | nachher |
|---|---|---|
| HTTP-Header | `x-cron-geheimnis` | `x-cron-secret` |
| Body-Felder | `aufgabe`, `heute` | `task`, `today` |
| Werte von `aufgabe` | `'reveal'`, `'erinnerung'` | `'reveal'`, `'reminder'` |

Beide Seiten wandern deshalb in dieser Task gemeinsam. Wird nur eine
umgestellt, läuft der Job weiter und die Function antwortet stumm mit 400:
kein Absturz, keine Fehlermeldung, nur kein Reveal am nächsten Morgen.

**Files:**
- Create: `supabase/migrations/20260819120000_englische_funktionsnamen.sql`
- Modify: `supabase/functions/reveal-schedule/schedule.ts` (aus Task 13),
  dessen `index.ts` und die zugehörigen Tests
- Modify: die pgTAP-Tests, die die alten Funktionsnamen prüfen
- Modify: `supabase/README.md` (Zeilen 23 und 36)

**Interfaces:**
- Produces: `public.recap_is_shared(uuid)`,
  `public.call_reveal_schedule(task text)`, Vault-Secrets `project_url` und
  `cron_secret`, Cron-Jobs `reveal-schedule-reveal` und
  `reveal-schedule-reminder`

- [ ] **Step 1: Den Vertrag auf der TypeScript-Seite finden**

```bash
cd /Users/lx/PycharmProjects/Reelive/supabase/functions
grep -rn "geheimnis\|aufgabe\|heute\|erinnerung" reveal-schedule/ | grep -v "^Binary"
```

Erwartung unter anderem: `export type ZeitplanAnfrage = { aufgabe: ZeitplanAufgabe; heute: string }`
in `schedule.ts` und die Prüfung
`if (b.aufgabe !== 'reveal' && b.aufgabe !== 'erinnerung')`. Jede Zeile aus
dieser Ausgabe wird in Step 4 angefasst.

- [ ] **Step 2: Die Migration schreiben**

Die Funktionskörper sind aus `20260810120000_aktive_share_links.sql` und
`20260818100000_auto_reveal.sql` übernommen, inhaltlich unverändert; nur
Namen und Vertragsfelder wandern.

Create `supabase/migrations/20260819120000_englische_funktionsnamen.sql`:

```sql
-- Sprachumstellung: die beiden verbliebenen deutschen SQL-Funktionen, die
-- Vault-Secrets und der Cron-Vertrag bekommen englische Namen. Drop und
-- Create statt alter ... rename, weil zwei Cron-Jobs auf den Namen zeigen
-- und in derselben Migration mitwandern muessen. Die Funktionskoerper sind
-- unveraendert uebernommen.

-- --- recap_ist_geteilt -> recap_is_shared -------------------------------
drop function if exists public.recap_ist_geteilt(uuid);

create or replace function public.recap_is_shared(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.aktive_share_links s where s.trip_id = p_trip_id
  )
  -- Unveraendert und weiterhin die wichtigste Zeile: `security definer` hebt
  -- RLS auf, ohne die Mitgliedschafts-Bedingung waere die Funktion ein Orakel,
  -- mit dem sich fuer beliebige trip_ids abfragen liesse, ob dort gerade
  -- geteilt wird.
  and public.is_trip_member(p_trip_id, auth.uid());
$$;

revoke execute on function public.recap_is_shared(uuid) from public;
grant execute on function public.recap_is_shared(uuid) to authenticated, service_role;

-- --- rufe_reveal_zeitplan -> call_reveal_schedule -----------------------
-- Erst die Jobs abhaengen, sonst zeigt der Scheduler auf eine Funktion, die
-- es zwischen drop und schedule nicht gibt.
select cron.unschedule('reveal-zeitplan-reveal');
select cron.unschedule('reveal-zeitplan-erinnerung');

drop function if exists public.rufe_reveal_zeitplan(text);

create or replace function public.call_reveal_schedule(task text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  project_url text;
  secret      text;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_secret';

  -- Warnung statt Exception: eine fehlende Konfiguration soll im Log
  -- auffallen, aber keinen dauerhaft roten Job-Verlauf erzeugen; der
  -- naechste Lauf nach dem Einrichten holt alles nach (der Reveal fragt
  -- end_date < heute ab, nicht end_date = gestern).
  if project_url is null or secret is null then
    raise warning 'call_reveal_schedule: Vault-Secrets project_url/cron_secret fehlen, Aufruf uebersprungen.';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/reveal-schedule',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', secret
    ),
    body := jsonb_build_object(
      'task', task,
      'today', to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM-DD')
    )
  );
end $$;

comment on function public.call_reveal_schedule(text) is
  'Cron wrapper: reads project_url/cron_secret from the vault and calls the reveal-schedule edge function with {task, today}; today is the calendar day in Europe/Zurich by the database clock.';

-- Nur der Cron (laeuft als postgres) ruft den Wrapper; Client-Rollen koennten
-- sonst beliebig oft Reveal-Laeufe anstossen (harmlos wegen CAS, aber ein
-- unnoetiger Hebel) und die Existenz der Vault-Secrets abfragen.
revoke execute on function public.call_reveal_schedule(text) from public, anon, authenticated;

select cron.schedule('reveal-schedule-reveal', '10 23 * * *',
  $$select public.call_reveal_schedule('reveal')$$);
select cron.schedule('reveal-schedule-reminder', '30 7 * * *',
  $$select public.call_reveal_schedule('reminder')$$);
```

- [ ] **Step 3: Prüfen, dass die Aufrufstelle im Client mitwandert**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
grep -rn "recap_ist_geteilt\|recap_is_shared" src/
```

Jeder Treffer ist ein `rpc('recap_ist_geteilt')`-Aufruf und wird auf
`recap_is_shared` gesetzt, samt der Mocks in den Tests.

- [ ] **Step 4: Den Vertrag auf der TypeScript-Seite nachziehen**

In `supabase/functions/reveal-schedule/`:

```typescript
export type ScheduleTask = 'reveal' | 'reminder';
export type ScheduleRequest = { task: ScheduleTask; today: string };
```

und die Prüfung entsprechend:

```typescript
const b = (body ?? {}) as { task?: unknown; today?: unknown };
if (b.task !== 'reveal' && b.task !== 'reminder') {
```

Den Header-Namen in `index.ts` von `x-cron-geheimnis` auf `x-cron-secret`
setzen. Die Deno-Tests, die den alten Body senden, mitziehen: sie sind das
Netz, das diesen Vertrag hält.

- [ ] **Step 5: Vault-Secrets neu setzen**

```bash
cd /Users/lx/PycharmProjects/Reelive
supabase db reset
psql "$DATABASE_URL" \
  -c "select vault.create_secret('http://host.docker.internal:54321', 'project_url');" \
  -c "select vault.create_secret('<geheimnis aus functions/.env>', 'cron_secret');"
```

- [ ] **Step 6: pgTAP-Tests anpassen**

```bash
grep -rln "recap_ist_geteilt\|rufe_reveal_zeitplan" supabase/tests/
```

In jeder Trefferdatei den Funktionsnamen setzen und die Testbeschreibung
englisch formulieren.

- [ ] **Step 7: Verifizieren**

```bash
supabase test db 2>&1 | tail -10
psql "$DATABASE_URL" -c "select jobname, command from cron.job;"
cd supabase/functions && deno test --allow-env reveal-schedule/ 2>&1 | tail -4
```

Erwartung: pgTAP grün; genau zwei Jobs, `reveal-schedule-reveal` und
`reveal-schedule-reminder`, beide mit `public.call_reveal_schedule(...)`;
Deno-Tests grün.

- [ ] **Step 8: Den Cron-Vertrag einmal wirklich auslösen**

```bash
psql "$DATABASE_URL" -c "select public.call_reveal_schedule('reveal');"
```

Danach im Log der Edge Function nachsehen: Ein Aufruf, der mit 200 endet,
beweist Header, Body-Felder und Wert gemeinsam. Ein 400 heisst, dass eine
Seite des Vertrags nicht mitgewandert ist; ein 401 heisst, der Header-Name
stimmt nicht.

- [ ] **Step 9: README anpassen und committen**

`supabase/README.md` Zeile 23 und 36 auf `project_url` und `cron_secret`
setzen.

```bash
git add -A
git commit -m "refactor(db): SQL-Funktionen, Vault-Secrets und Cron-Vertrag auf Englisch"
```

---

### Task 15: Etappe persistente Keys

Bewusst zuletzt und ohne Migration: die lokalen Daten auf dem Testgerät
werden verworfen. Nach dieser Etappe verhält sich die App beim ersten Start
wie eine Neuinstallation.

**Files:**
- Modify: `src/features/push/settings.ts`, `src/features/trips/tripsCache.ts`,
  `src/features/recap/seen.ts`, `src/features/moments/counter.ts`
- Modify: `src/features/moments/queueDb.ts`, `queueDb.web.ts`
- Modify: die zugehörigen Tests

- [ ] **Step 1: Alle Keys auflisten**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
grep -rn "reelive\.\|verworfene_momente" src --include='*.ts' --include='*.tsx'
```

- [ ] **Step 2: Keys umstellen**

| alt | neu |
|---|---|
| `reelive.benachrichtigungen` | `reelive.notifications` |
| `reelive.reisen.` | `reelive.trips.` |
| `reelive.reveal_gesehen.` | `reelive.reveal_seen.` |
| `reelive.zaehler.` | `reelive.counters.` |
| SQLite `verworfene_momente` | `discarded_moments` |

Die SQLite-Tabelle erscheint in `create table if not exists`, in den
`insert`- und `select`-Anweisungen und in den Tests. Alle Stellen zusammen
ändern, sonst schlägt die Queue beim ersten Zugriff fehl.

- [ ] **Step 3: Verifizieren**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4
```

- [ ] **Step 4: Am Gerät prüfen**

App neu starten, eine Aufnahme einsenden, App beenden und erneut starten.
Erwartung: die Warteschlange arbeitet, kein Absturz beim Start. Ein Fehler
über eine fehlende Tabelle bedeutet, dass eine Stelle in Step 2 fehlt.

- [ ] **Step 5: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(storage): Speicher-Keys und SQLite-Tabelle auf Englisch"
```

---

### Task 16: Etappe Hilfsskripte

**Files:**
- Rename: `scripts/testmedien-hochladen.mjs` → `scripts/upload-test-media.mjs`
- Rename: `mobile/scripts/netz.js` → `mobile/scripts/network.js`
- Rename: `mobile/scripts/netzAdresse.js` → `mobile/scripts/networkAddress.js`
- Modify: `mobile/package.json`, `mobile/scripts/__tests__/`

- [ ] **Step 1: Umbenennen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git mv scripts/testmedien-hochladen.mjs scripts/upload-test-media.mjs
cd mobile/scripts
git mv netz.js network.js
git mv netzAdresse.js networkAddress.js
ls __tests__/
```

Die Testdateien unter `mobile/scripts/__tests__/` mit `git mv` mitziehen und
ihre `require`-Pfade anpassen.

- [ ] **Step 2: npm-Skript anpassen**

In `mobile/package.json` den Eintrag `"netz": "node scripts/netz.js"` zu
`"network": "node scripts/network.js"` ändern.

- [ ] **Step 3: Bezeichner und Kommentare in den drei Skripten**

Nach Glossar, Kommentarregel wie gehabt.

- [ ] **Step 4: Verifizieren**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
npm run network
npx jest scripts 2>&1 | tail -4
```

Erwartung: das Skript gibt die Netzwerkadresse aus, die Skript-Tests sind grün.

- [ ] **Step 5: Committen**

```bash
cd /Users/lx/PycharmProjects/Reelive
git add -A
git commit -m "refactor(scripts): Hilfsskripte auf englische Namen"
```

---

### Task 17: Abschluss und Aufräumen

**Files:**
- Delete: `mobile/scripts/rename/`
- Modify: `mobile/package.json` (ts-morph entfernen)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Schlussmessung**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
node scripts/rename/waechter.mjs src
npx tsc --noEmit && npx jest 2>&1 | tail -4 && npx expo lint 2>&1 | tail -3
```

Erwartung: `Waechter 1: 2647 sichtbare deutsche Texte`, `Waechter 2: keine
deutschen Bezeichner`, Tests grün.

Weicht Wächter 1 von 2647 ab, ist unterwegs ein sichtbarer Text verändert
worden. Dann `git log --oneline` durchgehen und die Etappe finden, in der die
Zahl gesprungen ist, statt die Abweichung hinzunehmen.

- [ ] **Step 2: Vollständiger Gerätelauf**

Anmelden, Reise anlegen, Freund einladen, Foto und Video aufnehmen und
einsenden, Reveal auslösen, Recap ansehen, Karte öffnen, Player durchlaufen,
Link teilen und im Browser öffnen, Profil bearbeiten, Konto löschen. Jede
Station einmal, weil hier alles zusammenläuft, was Jest nicht sieht.

- [ ] **Step 3: Werkzeug entfernen**

```bash
cd /Users/lx/PycharmProjects/Reelive/mobile
git rm -r scripts/rename
npm uninstall ts-morph
```

Die Mappings unter `scripts/rename/etappen/` gehen dabei mit. Sie stehen in
der Git-Historie, falls jemand eine Entscheidung nachschlagen will.

- [ ] **Step 4: Die Regel in CLAUDE.md verankern**

Unter «Eckpfeiler (nicht neu verhandeln)» diesen Punkt ergänzen:

```markdown
- Quellcode ist englisch: Bezeichner, Datei- und Ordnernamen, Kommentare und
  Testbeschreibungen. Nur sichtbare UI-Texte sind deutsch (Du-Form,
  Vokabular gemäss DESIGN-LANGUAGE.md §6)
```

- [ ] **Step 5: Verifizieren und Committen**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -4
cd .. && git add -A
git commit -m "chore(rename): Werkzeug ausgebaut, Sprachregel in CLAUDE.md verankert"
```

---

## Selbstprüfung des Plans

**Spec-Abdeckung.** Jeder Abschnitt der Spec hat eine Task: Glossar in allen
Etappen-Tasks; `app`-Tabelle in Task 11; `components` in Task 10; `features`
in den Tasks 4 bis 9; natives Modul in Task 12; Edge Functions in Task 13;
Datenbank in Task 14; persistente Keys in Task 15; Hilfsskripte in Task 16;
Werkzeugwahl in Task 2; Kommentarregel im Etappenrezept und in jedem Step 5;
Verifikation in jedem Step 6 bis 8; Erfolgskriterium in Task 17.

**Offene Punkte, die beim Umsetzen entstehen.** Die Symbollisten der Etappen
stehen nicht im Plan, weil sie erst der Finder erzeugt. Das ist Absicht: eine
hier abgeschriebene Liste wäre am Tag der Umsetzung veraltet. Step 1 jeder
Etappe erzeugt sie, Step 2 übersetzt sie nach dem verbindlichen Glossar.

**Bekannte Fallen, im Plan berücksichtigt.** `move()` und die Alias-Importe
(Task 2, verifiziert). Modulpfade in `jest.mock`-Strings (Task 2, verifiziert).
Routen-Strings, die kein Werkzeug sieht (Task 11, Step 5). Der serverseitig
erzeugte Share-Link (Task 11, Step 6). `prebuild --clean` und die verlorene
Signierung (Task 12, Step 5). Cron-Job und Funktionsname in einer Migration
(Task 14, Step 2). `.web.tsx`-Varianten ohne Import (Task 8, Step 2).
