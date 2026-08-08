// Export in die Galerie (Task-7-Brief, Spec §6, Versprechen W9): einen
// Moment sichern, alle sichern — über dieselben signierten Lese-URLs, die
// der Player schon hat (urlVorrat.ts). Gesichert wird IMMER `medium_url`
// (volle Auflösung), nie `thumb_url`.
//
// === Der Zwischenschritt, und warum er diesmal aufräumt (Phase-4-Lehre) ===
//
// expo-media-library sichert nur von einer LOKALEN Datei
// (MediaLibrary.createAssetAsync(filePath)) — die Medien liegen aber hinter
// einer signierten HTTPS-URL. Es braucht also einen Download über
// expo-file-system, bevor überhaupt etwas in die Galerie kann.
//
// In Phase 4 hat genau dieses Muster (Rohaufnahme → aufbereitete Datei →
// Warteschlange) einen Fehler produziert: abgeleitete Zwischendateien blieben
// nach Gebrauch liegen und erzeugten selbst den Speicherdruck, der die
// eigene Warteschlange zerstörte (siehe medien.ts, Abschnitt "Dauerhafte
// Ablage"). Drei Entscheidungen, die das hier von Anfang an vermeiden:
//
// 1. **Cache, nicht Documents.** medien.ts kopiert bewusst NACH Documents,
//    weil die Warteschlange Momente tagelang halten muss, bevor der Upload
//    sie verbraucht. Hier ist es umgekehrt: die heruntergeladene Datei lebt
//    nur für die Dauer EINES einzelnen `Asset.create()`-Aufrufs — Sekunden,
//    nicht Tage. `Paths.cache` (vom System bei Speicherdruck löschbar) ist
//    dafür der richtige Ort, nicht der falsche: es gibt nichts, das über
//    diesen einen Aufruf hinaus erhalten bleiben müsste.
// 2. **`finally`, nicht "danach".** Jede heruntergeladene Datei wird in
//    einem `finally`-Block gelöscht, der auf JEDEM Pfad läuft — Erfolg,
//    ein regulärer Fehlschlag (Netzwerk, 4xx/5xx) UND ein Abbruch über
//    `AbortSignal`. Ein "danach aufräumen" nur im Erfolgspfad war genau die
//    Lücke, die Phase 4 offen liess: ein abgebrochener oder fehlgeschlagener
//    Download hinterliess dort ebenfalls eine Datei, nur unbeobachtet.
// 3. **Aufräumen VOR dem ersten Download, nicht nur danach.** Stürzt die App
//    mitten in einem Download ab (kein JS-`finally` kann das auffangen),
//    bliebe ohne diesen Schritt eine verwaiste Datei bis zum nächsten
//    Export liegen. `raeumeExportOrdnerAufNeu()` löscht den GESAMTEN
//    Export-Ordner, bevor ein neuer Lauf beginnt — ein verwaistes Rest aus
//    einem abgestürzten vorherigen Lauf überlebt also nie länger als bis
//    zum nächsten Export-Versuch.
// Bewusst der LEGACY-Einstieg ('expo-media-library/legacy'), nicht die
// modernere klassenbasierte API (Asset.create(), aus dem Hauptexport) —
// obwohl das SDK-57-Changelog Letztere für neuen Code empfiehlt. Grund:
// `expo-media-library`s Haupteinstieg (`index.ts`) deklariert
// `class Asset extends ExpoMediaLibraryNext.Asset {}`, ausgewertet BEIM
// MODUL-LADEN — `ExpoMediaLibraryNext` selbst ist `requireNativeModule(...)`
// OHNE eigene Web-Fassung. Web-Export dieses Projekts bündelt laut Task 4/5
// dieser Phase die GESAMTE App als SPA, inklusive dieses Screens — mit dem
// modernen Einstieg bricht `npx expo export --platform web` deshalb schon
// beim Bündeln mit "Class extends value undefined is not a constructor or
// null" (selbst geprüft, reproduziert, siehe Bericht). Der LEGACY-Einstieg
// importiert stattdessen `ExpoMediaLibrary` (ohne "Next") — DAFÜR existiert
// eine echte `ExpoMediaLibrary.web.ts`, die `getPermissionsAsync`/
// `requestPermissionsAsync` mit `granted:false` beantwortet, statt beim
// Import zu werfen. Auf Web (ohnehin über `istWebGesperrt()` gesperrt,
// Task 4/5) bleibt der Effekt derselbe wie beabsichtigt: keine Berechtigung,
// also nie ein tatsächlicher `createAssetAsync`-Aufruf — nur bricht das
// Bündeln selbst nicht mehr.
import * as MediaLibrary from 'expo-media-library/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import { medienEndung } from '@/features/moments/medien';
import type { RecapMoment } from './types';
import type { MedienUrl } from './urlVorrat';

const EXPORT_ORDNER = 'export';

function exportOrdner(): Directory {
  return new Directory(Paths.cache, EXPORT_ORDNER);
}

// Best effort, wirft nie (gleiches Prinzip wie medien.ts,
// momentDateienEntfernen/dateiVerwerfen): ein misslungenes Aufräumen darf
// weder den Export selbst noch einen späteren Versuch blockieren.
function raeumeExportOrdnerAufNeu(): void {
  const ordner = exportOrdner();
  try {
    if (ordner.exists) ordner.delete();
  } catch (fehler) {
    console.error('[exportApi] Export-Ordner konnte nicht geräumt werden', fehler);
  }
  ordner.create({ intermediates: true, idempotent: true });
}

// Ohne Berechtigung: ein erklärender Hinweis mit Weg in die Einstellungen —
// NIE ein stiller Fehlschlag (Brief, wörtlich). `writeOnly: true` fragt auf
// iOS gezielt "Fotos hinzufügen" statt vollen Lesezugriff auf die
// Bibliothek — die App liest nie vorhandene Fotos, sie schreibt nur eigene.
export const KEIN_ZUGRIFF_TEXT =
  'Reelive braucht Zugriff auf deine Fotobibliothek, um Momente dort zu sichern. Erlaube das in den Systemeinstellungen.';
const BERECHTIGUNGSPRUEFUNG_FEHLER =
  'Der Zugriff auf die Fotobibliothek konnte nicht geprüft werden. Probier es gleich nochmal.';

export type BerechtigungsErgebnis = { erlaubt: true } | { erlaubt: false; text: string };

export async function sichergestellteBerechtigung(): Promise<BerechtigungsErgebnis> {
  try {
    const aktuell = await MediaLibrary.getPermissionsAsync(true);
    if (aktuell.granted) return { erlaubt: true };
    if (!aktuell.canAskAgain) return { erlaubt: false, text: KEIN_ZUGRIFF_TEXT };
    const angefragt = await MediaLibrary.requestPermissionsAsync(true);
    if (angefragt.granted) return { erlaubt: true };
    return { erlaubt: false, text: KEIN_ZUGRIFF_TEXT };
  } catch {
    // Praktisch nie erreichbar (reine OS-Abfrage, kein Netzwerk) — aber
    // "nie ein stiller Fehlschlag" gilt auch für diesen Randfall.
    return { erlaubt: false, text: BERECHTIGUNGSPRUEFUNG_FEHLER };
  }
}

function istAbbruchFehler(fehler: unknown): boolean {
  return fehler instanceof Error && fehler.name === 'AbortError';
}

// Lädt EIN Medium in eine temporäre Cache-Datei und übergibt sie an
// expo-media-library. Räumt die temporäre Datei auf JEDEM Pfad auf (siehe
// Kopfkommentar, Punkt 2) — deshalb `finally`, nicht ein zusätzlicher aufruf
// nach einem erfolgreichen `try`.
async function ladeUndSichereEinzeln(url: string, dateiname: string, signal?: AbortSignal): Promise<void> {
  const ziel = new File(exportOrdner(), dateiname);
  try {
    const datei = await File.downloadFileAsync(url, ziel, { idempotent: true, signal });
    await MediaLibrary.createAssetAsync(datei.uri);
  } finally {
    if (ziel.exists) {
      try {
        ziel.delete();
      } catch (fehler) {
        // Ein misslungenes Aufräumen darf den Erfolg/Fehlschlag des
        // Sicherns selbst nicht überschreiben (gleiches Prinzip wie
        // medien.ts) — nur geloggt, nie geworfen.
        console.error('[exportApi] Zwischendatei konnte nicht gelöscht werden', dateiname, fehler);
      }
    }
  }
}

const EINZEL_FEHLER = 'Dieser Moment konnte nicht gesichert werden. Probier es gleich nochmal.';

export type EinzelErgebnis = { ok: true } | { ok: false; grund: 'keine_berechtigung' | 'fehler'; text: string };

// Sichert GENAU EINEN Moment: den vollen Datenträger (url.medium_url), nie
// das Thumbnail (Brief, Versprechen W9: "der Export schreibt genau das, was
// man sieht").
export async function sichereMomentInGalerie(moment: RecapMoment, url: MedienUrl): Promise<EinzelErgebnis> {
  const berechtigung = await sichergestellteBerechtigung();
  if (!berechtigung.erlaubt) return { ok: false, grund: 'keine_berechtigung', text: berechtigung.text };

  raeumeExportOrdnerAufNeu();
  const endung = medienEndung(moment.type, url.medium_url);
  try {
    await ladeUndSichereEinzeln(url.medium_url, `${moment.id}.${endung}`);
    return { ok: true };
  } catch {
    return { ok: false, grund: 'fehler', text: EINZEL_FEHLER };
  }
}

export type AlleFortschritt = { erledigt: number; gesamt: number };

// Diskriminiert bewusst zwischen "kam nie los" (keine Berechtigung — vor dem
// ersten Download) und "ist fertig" (eine Bilanz, auch wenn sie unvollständig
// ist) — eine gemeinsame Form hätte einen Aufrufer gezwungen, `gesichert:0,
// gesamt:0` von einem echten Nulldurchlauf zu unterscheiden, ohne dass die
// Form selbst das hergäbe.
export type AlleErgebnis =
  | { status: 'keine_berechtigung'; text: string }
  | { status: 'fertig'; gesichert: number; gesamt: number; fehlgeschlagen: number; abgebrochen: boolean };

// «Alle sichern»: Fortschritt («7 von 23») über `onFortschritt`, abbrechbar
// über `signal` (Brief). Bricht ein Aufruf per Signal ab — vor dem nächsten
// Element ODER mitten in einem laufenden Download —, endet die Schleife
// SOFORT mit `abgebrochen:true` und der bis dahin ehrlich gezählten Bilanz,
// statt weiterzumachen oder die bisherigen Zahlen zu verschweigen.
//
// Kein `Promise.all`: sequentiell, absichtlich — ein Fortschritt "7 von 23"
// setzt voraus, dass es zu jedem Zeitpunkt ein wohldefiniertes "bis hierhin
// erledigt" gibt; parallele Downloads würden das nur verkomplizieren, ohne
// dass der Brief eine Parallelität verlangt.
export async function sichereAlleInGalerie(
  eintraege: { moment: RecapMoment; url: MedienUrl }[],
  onFortschritt: (stand: AlleFortschritt) => void,
  signal?: AbortSignal
): Promise<AlleErgebnis> {
  const berechtigung = await sichergestellteBerechtigung();
  if (!berechtigung.erlaubt) return { status: 'keine_berechtigung', text: berechtigung.text };

  raeumeExportOrdnerAufNeu();

  const gesamt = eintraege.length;
  let gesichert = 0;
  let fehlgeschlagen = 0;

  for (let i = 0; i < gesamt; i++) {
    if (signal?.aborted) {
      return { status: 'fertig', gesichert, gesamt, fehlgeschlagen, abgebrochen: true };
    }
    const { moment, url } = eintraege[i];
    const endung = medienEndung(moment.type, url.medium_url);
    try {
      await ladeUndSichereEinzeln(url.medium_url, `${moment.id}.${endung}`, signal);
      gesichert += 1;
    } catch (fehler) {
      if (istAbbruchFehler(fehler)) {
        return { status: 'fertig', gesichert, gesamt, fehlgeschlagen, abgebrochen: true };
      }
      fehlgeschlagen += 1;
    }
    onFortschritt({ erledigt: i + 1, gesamt });
  }

  return { status: 'fertig', gesichert, gesamt, fehlgeschlagen, abgebrochen: false };
}
