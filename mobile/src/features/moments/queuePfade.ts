import { Paths } from 'expo-file-system';

// === Warteschlangen-Pfade: relativ statt absolut (Fix 2026-08-18) ===
//
// Der Dokumente-Ordner trägt die Container-UUID der Installation im Pfad,
// und jeder App-Neubau vergibt eine neue: ein absolut gespeicherter Pfad
// zeigt nach dem nächsten Update ins Leere, obwohl iOS die Dateien selbst
// in den neuen Container mitgenommen hat. Genau so gingen am 2026-08-17
// vier wartende Momente verloren — der Worker fand die Dateien nicht und
// verwarf die Jobs als dauerhaft gescheitert. Die Warteschlange speichert
// deshalb nur noch den Teil UNTERHALB von Documents; aufgelöst wird beim
// Lesen gegen den jeweils aktuellen Ort (queueDb ist die einzige
// Übersetzungsstelle, siehe zuZeile/zuJob dort).
const MARKE = '/Documents/';

// Für die Ablage: 'file:///…/Documents/momente/p1/medium.mov' →
// 'momente/p1/medium.mov'. Was nicht unter Documents liegt, bleibt wie es
// ist — und altert dann wie bisher mit dem Container.
export function fuerAblage(uri: string): string {
  const i = uri.indexOf(MARKE);
  return i >= 0 ? uri.slice(i + MARKE.length) : uri;
}

// Für das Lesen: die relative Neuform an den AKTUELLEN Documents-Ort
// hängen. Absolute Alt-Zeilen (von vor diesem Fix) werden dabei neu
// verankert; nur was nie unter Documents lag, bleibt unverändert und läuft
// beim Worker regulär in die Fehlende-Datei-Behandlung.
export function fuerLesen(gespeichert: string): string {
  if (gespeichert.startsWith('file://')) {
    const relativ = fuerAblage(gespeichert);
    return relativ === gespeichert ? gespeichert : fuerLesen(relativ);
  }
  const basis = Paths.document.uri;
  return basis.endsWith('/') ? basis + gespeichert : `${basis}/${gespeichert}`;
}
