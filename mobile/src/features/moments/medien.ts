import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

const FOTO_MAX_KANTE = 1080;
const THUMB_MAX_KANTE = 320;
const JPEG_QUALITAET = 0.8;

// Unterhalb des Dokumentenverzeichnisses, ein Ordner je Moment.
const MOMENTE_ORDNER = 'momente';

// Dateiendung aus einem lokalen Pfad oder Speicherschlüssel, klein
// geschrieben und ohne Punkt. Leer, wenn keine erkennbar ist.
export function endungAus(uri: string): string {
  const ohneAnhang = uri.split(/[?#]/)[0];
  const name = ohneAnhang.slice(ohneAnhang.lastIndexOf('/') + 1);
  const punkt = name.lastIndexOf('.');
  return punkt > 0 ? name.slice(punkt + 1).toLowerCase() : '';
}

// Welche Endungen es je Aufnahmeart überhaupt geben darf, und was gilt, wenn
// sich aus der Aufnahme nichts Brauchbares ablesen lässt.
//
// Final-Review, Important 5: expo-camera erzeugt auf iOS eine QuickTime-Datei
// (.mov), auf Android .mp4. Die Vorfassung lud die iOS-Bytes trotzdem unter
// ….mp4 mit Content-Type video/mp4 hoch — der Bucket nahm es an, weil er den
// DEKLARIERTEN Typ prüft. Das Ergebnis waren dauerhaft falsch etikettierte
// Objekte, und weil der Schlüssel pro Moment unveränderlich ist, nachträglich
// nicht zu heilen. Fotos gehen unverändert immer als JPEG raus: sie werden von
// fotoAufbereiten neu als JPEG kodiert, egal was die Kamera lieferte.
const ERLAUBTE_ENDUNGEN: Record<'photo' | 'video', readonly string[]> = {
  photo: ['jpg'],
  video: ['mp4', 'mov'],
};
const STANDARD_ENDUNG: Record<'photo' | 'video', string> = { photo: 'jpg', video: 'mp4' };

const CONTENT_TYPEN: Record<string, string> = {
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

// Die tatsächliche Endung der Aufnahme, auf die erlaubte Liste eingeschränkt.
// Etwas Unbekanntes fällt auf den Standard zurück, statt in den Schlüssel und
// damit in den signierten Pfad durchzuschlagen.
export function medienEndung(typ: 'photo' | 'video', uri: string): string {
  const kandidat = endungAus(uri);
  return ERLAUBTE_ENDUNGEN[typ].includes(kandidat) ? kandidat : STANDARD_ENDUNG[typ];
}

// Schlüssel-Logik existiert bewusst zweimal: hier und in der Edge Function
// supabase/functions/media-urls/keys.ts (erwarteteSchluessel). Der Client
// braucht die Schlüssel schon vor dem Insert; die Function traut dem Client
// nicht und leitet sie serverseitig aus der posts-Zeile neu ab (Spec §6) —
// inklusive der Endung, die dafür als posts.media_ext mitgeschrieben wird.
export function storageKey(tripId: string, postId: string, endung: string): string {
  return `trips/${tripId}/${postId}.${endung}`;
}

export function thumbKey(tripId: string, postId: string): string {
  return `trips/${tripId}/${postId}_t.jpg`;
}

// Die Endung steckt bereits im Speicherschlüssel — sie muss deshalb weder ein
// zweites Mal im Queue-Job stehen noch mit ihm auseinanderlaufen. Genutzt vom
// Worker für den Content-Type des PUT und von postsApi für posts.media_ext.
export function contentTypeFuerSchluessel(key: string): string {
  return CONTENT_TYPEN[endungAus(key)] ?? 'application/octet-stream';
}

export function neuePostId(): string {
  return Crypto.randomUUID();
}

type Abmessung = { width: number; height: number };
type ResizeZiel = { width?: number; height?: number };

// Lädt das Bild einmal unverändert (kein resize()), nur um die tatsächlichen
// Quellmasse zu erfahren — die kontextbasierte API kennt Breite/Höhe erst nach
// renderAsync(). Context und Ergebnis werden sofort wieder freigegeben.
async function quellmasseErmitteln(uri: string): Promise<Abmessung> {
  const kontext = ImageManipulator.manipulate(uri);
  try {
    const original = await kontext.renderAsync();
    try {
      return { width: original.width, height: original.height };
    } finally {
      original.release();
    }
  } finally {
    kontext.release();
  }
}

// Skaliert die LANGE Kante auf `langeKante`: bei Querformat/Quadrat die Breite,
// bei Hochformat die Höhe (nur eine Dimension setzen, die andere zieht die
// native Implementierung seitenverhältnistreu nach). Ist das Bild schon
// kleiner, wird nicht hochskaliert — leeres Ziel bedeutet "resize überspringen".
function langeKanteSkalieren(quelle: Abmessung, langeKante: number): ResizeZiel {
  const laengsteSeite = Math.max(quelle.width, quelle.height);
  if (laengsteSeite <= langeKante) return {};
  return quelle.width >= quelle.height ? { width: langeKante } : { height: langeKante };
}

// Skaliert `uri` auf `ziel` und speichert als JPEG mit fester Qualität.
// expo-image-manipulator setzt seit SDK 54 auf diese kontextbasierte,
// verkettbare API (manipulate → resize → renderAsync → saveAsync); das alte
// manipulateAsync ist nur noch ein @deprecated Wrapper darüber. Der Wrapper
// gibt seine SharedObjects nach Gebrauch frei ("these shared objects will not
// be used anymore") — dasselbe Muster hier, per try/finally auch im Fehlerfall.
async function alsJpegSpeichern(uri: string, ziel: ResizeZiel): Promise<string> {
  const kontext = ImageManipulator.manipulate(uri);
  try {
    if (ziel.width !== undefined || ziel.height !== undefined) {
      kontext.resize(ziel);
    }
    const gerendert = await kontext.renderAsync();
    try {
      const ergebnis = await gerendert.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITAET });
      return ergebnis.uri;
    } finally {
      gerendert.release();
    }
  } finally {
    kontext.release();
  }
}

export async function fotoAufbereiten(uri: string): Promise<{ medium: string; thumb: string }> {
  const quellmasse = await quellmasseErmitteln(uri);
  const medium = await alsJpegSpeichern(uri, langeKanteSkalieren(quellmasse, FOTO_MAX_KANTE));
  const thumb = await alsJpegSpeichern(uri, langeKanteSkalieren(quellmasse, THUMB_MAX_KANTE));
  return { medium, thumb };
}

// Videos werden nicht nachbearbeitet — die Auflösung kommt schon aus der
// Aufnahmequalität der Kamera (Task-Brief). Nur ein Standbild fürs Thumbnail
// wird gezogen; der Aufrufer (Preview) fängt Fehler ab und zeigt eine Meldung.
export async function videoAufbereiten(uri: string): Promise<{ medium: string; thumb: string }> {
  const standbild = await getThumbnailAsync(uri, { time: 0 });
  return { medium: uri, thumb: standbild.uri };
}

// === Dauerhafte Ablage (Final-Review, Critical 2) ===
//
// takePictureAsync, recordAsync, ImageManipulator.saveAsync und
// getThumbnailAsync schreiben alle nach Library/Caches — ein Verzeichnis, das
// iOS unter Speicherdruck leeren darf und das nicht gesichert wird. Die
// Warteschlange soll Momente aber tagelang halten; sie hielt bisher nur Zeiger
// in ein Verzeichnis, das jederzeit verschwinden kann. Deshalb wandern Medium
// und Thumbnail beim Einreihen in einen eigenen Ordner je Moment unterhalb des
// Dokumentenverzeichnisses, und der Job merkt sich DIESE Pfade.
export function momentOrdner(postId: string): Directory {
  return new Directory(Paths.document, MOMENTE_ORDNER, postId);
}

// KOPIERT Medium und Thumbnail in den Moment-Ordner und liefert die neuen
// Pfade. Die Quellen bleiben dabei unangetastet — sie werden erst freigegeben,
// wenn der Job sie tatsächlich besitzt (siehe zwischenfassungenVerwerfen und
// preview.tsx).
//
// Re-Review: hier stand vorher `move`. Das war für Fotos harmlos
// (fotoAufbereiten erzeugt ohnehin neue Dateien), für Videos aber fatal:
// videoAufbereiten gibt die Rohaufnahme SELBST als Medium zurück. Verschob man
// sie und scheiterte danach irgendetwas — der Thumb, vor allem aber
// jobEinreihen —, räumte der Fehlerpfad den Moment-Ordner ab und nahm die
// einzige Kopie mit. Ein zweiter Druck auf «Einsenden» scheiterte dann schon
// beim Standbild, und die Aufnahme war unwiederbringlich weg. Ausgerechnet im
// Fehlerpfad des Fixes, der Datenverlust verhindern sollte.
//
// Der Preis ist kurzzeitig doppelter Platzbedarf (bei 30 s in 1080p bis ~50 MB,
// die Bucket-Grenze). Das ist die richtige Seite, auf der man irrt: geht der
// Kopiervorgang mangels Platz schief, liegt die Aufnahme noch da und der
// zweite Versuch ist möglich — beim Verschieben war sie weg.
export async function dauerhaftSichern(
  postId: string,
  dateien: { medium: string; thumb: string }
): Promise<{ medium: string; thumb: string }> {
  const ordner = momentOrdner(postId);
  ordner.create({ intermediates: true, idempotent: true });

  const endung = endungAus(dateien.medium) || 'jpg';
  // overwrite: ein Wiederanlauf nach abgebrochenem Einsenden trifft sonst auf
  // eine halbfertige Datei aus dem vorigen Versuch und scheitert daran.
  const zielMedium = new File(ordner, `medium.${endung}`);
  await new File(dateien.medium).copy(zielMedium, { overwrite: true });

  const zielThumb = new File(ordner, 'thumb.jpg');
  await new File(dateien.thumb).copy(zielThumb, { overwrite: true });

  return { medium: zielMedium.uri, thumb: zielThumb.uri };
}

// Aufgerufen, wo ein Job die Warteschlange verlässt — auf dem Erfolgspfad UND
// bei dauerhafter Ablehnung (siehe uploadWorker). Ohne das blieben Medium und
// Thumbnail jedes hochgeladenen Moments für immer liegen, bei Video die vollen
// 30 Sekunden in 1080p.
//
// Wirft nie: ein misslungenes Aufräumen kostet Speicherplatz, ein daran
// scheiternder Worker-Durchlauf würde den Job endlos wiederholen lassen.
export function momentDateienEntfernen(postId: string): void {
  try {
    const ordner = momentOrdner(postId);
    if (ordner.exists) ordner.delete();
  } catch (fehler) {
    console.error('[medien] Moment-Ordner konnte nicht entfernt werden', postId, fehler);
  }
}

// Löscht eine einzelne lokale Datei, falls es sie (noch) gibt. Wirft nie —
// eine liegen gebliebene Datei darf weder das Einsenden noch das Verwerfen
// aufhalten.
//
// Re-Review: hiess vorher `rohaufnahmeVerwerfen`. Der Name log ab dem Moment,
// in dem auch Zwischenfassungen darüber freigegeben werden — und genau diese
// Unschärfe («welche Datei ist eigentlich die einzige Kopie?») steckte hinter
// dem Video-Datenverlust. Wer aufräumt, benennt jetzt ausdrücklich, WAS.
export function dateiVerwerfen(uri: string): void {
  try {
    const datei = new File(uri);
    if (datei.exists) datei.delete();
  } catch (fehler) {
    console.error('[medien] Datei konnte nicht entfernt werden', uri, fehler);
  }
}

// Gibt frei, was aus der Rohaufnahme ABGELEITET wurde: das komprimierte Medium
// und das Thumbnail im Cache. Die Rohaufnahme selbst bleibt garantiert liegen —
// bei einem Video IST sie das Medium (videoAufbereiten gibt `uri` unverändert
// zurück), und sie ist dann die einzige Kopie. Genau diese Unterscheidung
// fehlte und kostete im Fehlerpfad die Aufnahme.
export function zwischenfassungenVerwerfen(
  rohaufnahme: string,
  aufbereitet: { medium: string; thumb: string }
): void {
  for (const pfad of new Set([aufbereitet.medium, aufbereitet.thumb])) {
    if (pfad !== rohaufnahme) dateiVerwerfen(pfad);
  }
}
