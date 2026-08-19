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
