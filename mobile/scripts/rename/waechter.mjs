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
  /reise|momente|siegel|karte|kamera|konto|teilen|fehler|zaehl|vorrat|nadel|uhrzeit|vorschau|uebersicht|einlad|aufnahme|ausloes|zuschnitt|gesehen|melden|sozial|einstellung|medien|verworfen|pfade|sperre|buehne|uebergabe|gruppier|ausschnitt|flaeche|fortschritt|pille|zeitraum|platzhalter|oberkante|waehler|loesch|entfern|pruef|erstell|abzieh|inszenier|versiegel|unterkante|kontext|muster|lade|lokal|konfigur|entwicklung|teil|anzeige|frisch|aktiv|zeile|kette|abonn|nutzer|gast|leer|voll|halb|klein|gross/i;

// Fix-Runde 1 (Task-3-Review): dieselbe Eingrenzung wie in
// deutsche-symbole.mjs, siehe dort fuer die ausfuehrliche Begruendung.
// Kurze Staemme nur als eigenstaendiges CamelCase-Wortsegment werten,
// sonst kollidieren sie mit englischen Woertern, deren Praefix zufaellig
// gleich lautet ("alternative", "neutral", "understand",
// "NativeModules", "commit", "about"). "teil" bleibt bewusst einfach,
// siehe Begruendung in deutsche-symbole.mjs.
const ci = (s) => [...s].map((z) => `[${z.toLowerCase()}${z.toUpperCase()}]`).join("");
const grenzstamm = (stamm) => {
  const erster = stamm[0].toUpperCase();
  const rest = ci(stamm.slice(1));
  return `(?:(?<![a-zA-Z])${ci(stamm)}|${erster}${rest})(?![a-z])`;
};
const STAEMME_GRENZE = new RegExp(
  ["alt", "neu", "mit", "stand", "modul", "alter", "abo"].map(grenzstamm).join("|")
);
const istDeutscherStamm = (n) => STAEMME.test(n) || STAEMME_GRENZE.test(n);

let reste = 0;
for (const f of eigene) {
  const rel = f.getFilePath().replace(SRC, "");
  if (!FERTIG.some((o) => rel.startsWith(o))) continue;
  const treffer = new Set();
  for (const bez of f.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const n = bez.getText();
    if (istDeutscherStamm(n)) treffer.add(n);
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
