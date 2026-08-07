import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

const FOTO_MAX_KANTE = 1080;
const THUMB_MAX_KANTE = 320;
const JPEG_QUALITAET = 0.8;

// Schlüssel-Logik existiert bewusst zweimal: hier und in der Edge Function
// supabase/functions/media-urls/keys.ts (erwarteteSchluessel). Der Client
// braucht die Schlüssel schon vor dem Insert; die Function traut dem Client
// nicht und leitet sie serverseitig aus der posts-Zeile neu ab (Spec §6).
export function storageKey(tripId: string, postId: string, typ: 'photo' | 'video'): string {
  const endung = typ === 'video' ? 'mp4' : 'jpg';
  return `trips/${tripId}/${postId}.${endung}`;
}

export function thumbKey(tripId: string, postId: string): string {
  return `trips/${tripId}/${postId}_t.jpg`;
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
