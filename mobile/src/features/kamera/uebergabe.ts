// Das aufgenommene Foto wandert als natives Speicher-Objekt (PictureRef) vom
// Kamera-Screen zur Vorschau. Router-Params sind Strings, ein Ref passt
// nicht hindurch — deshalb dieser Holder, das kleinste Ding, das die Lücke
// schliesst (Spec 2026-08-13-aufnahme-tempo-design.md §4). Er hält genau
// EINE Übergabe: mehr als eine Aufnahme ist nie gleichzeitig unterwegs.
import type { PictureRef } from 'expo-camera';
import type { VideoPlayer } from 'expo-video';

export type FotoUebergabe = {
  /** Fürs Anzeigen: expo-image nimmt einen SharedRef direkt als source. */
  ref: PictureRef;
  /** savePictureAsync des Refs, fürs Einsenden — läuft ab der Aufnahme im Hintergrund. */
  datei: Promise<{ uri: string }>;
};

let liegt: FotoUebergabe | null = null;

export function uebergeben(uebergabe: FotoUebergabe): void {
  // Ersetzt Liegengebliebenes kommentarlos: der alte Ref fällt dem GC anheim.
  liegt = uebergabe;
  // Solange niemand wartet, darf eine Ablehnung (voller Speicher) keine
  // «Unhandled rejection» werden. Der leere Handler hängt an einem ZWEIG des
  // Promises, nicht am Promise selbst — wer `datei` später awaited (die
  // Vorschau beim Einsenden), bekommt die Ablehnung unverändert.
  void uebergabe.datei.catch(() => {});
}

export function abholen(): FotoUebergabe | null {
  const uebergabe = liegt;
  liegt = null;
  return uebergabe;
}

// Auch das Video reist seit dem Gerätefund 2026-08-14 über den Holder — aber
// nur seine ANZEIGE: der Kamera-Screen wärmt den Player vor der Navigation
// vor und legt ein Poster (Bild 0 des Videos) daneben. Warum beides: die
// VideoView braucht am Gerät ~0,8 s, bis sie selbst einen fertig geladenen
// Player zeichnet (gemessen 2026-08-14, konstant, JS-Thread dabei frei) —
// solange steht das Poster, und der Wechsel ist unsichtbar, weil die
// Schleife bei Bild 0 beginnt. Die Daten des Videos (fürs Einsenden und
// Verwerfen) reisen unverändert als uri in den Router-Params, die
// dokumentierte Grenze bleibt.
export type VideoUebergabe = {
  /** Vorgewärmter, bereits spielender Player. */
  player: VideoPlayer;
  /** Bild 0 als Sofort-Brücke, bis die VideoView zeichnet; null wenn die
   *  Erzeugung scheiterte oder trödelte (dann bleibt die Fläche kurz dunkel,
   *  der alte Zustand als Rückfallebene). */
  poster: string | null;
};

let videoLiegt: VideoUebergabe | null = null;

export function videoUebergeben(uebergabe: VideoUebergabe): void {
  // Anders als der Foto-Ref fällt ein liegengebliebener Player nicht dem GC
  // anheim — er ist ein natives Objekt und braucht ein explizites release.
  videoLiegt?.player.release();
  videoLiegt = uebergabe;
}

export function videoAbholen(): VideoUebergabe | null {
  const uebergabe = videoLiegt;
  videoLiegt = null;
  return uebergabe;
}

// savePictureAsync ist plattform-uneins (expo-camera SDK 57): Android liefert
// das Feld `uri` (CameraViewModule.kt, putString("uri", …)), iOS liefert
// `url` (ExpoCameraUtils.saveImage, result["url"]), und der TS-Typ
// PhotoResult verspricht einheitlich `uri`. Wer dem Typ vertraut und nur
// `.uri` liest, bekommt auf dem iPhone undefined — das Einsenden eines Fotos
// brach dadurch kommentarlos ab (Gerätefund 2026-08-14). Diese Hülle
// begradigt die Diskrepanz an der Quelle; fehlt beides, ist das ein echter
// Fehler und gehört als Ablehnung in den catch des Einsendens, nicht als
// stilles undefined in einen Job.
export function gespeicherteDatei(ref: PictureRef): Promise<{ uri: string }> {
  return ref.savePictureAsync().then((ergebnis) => {
    const { uri, url } = ergebnis as { uri?: string; url?: string };
    const pfad = uri ?? url;
    if (!pfad) throw new Error('savePictureAsync lieferte weder uri noch url');
    return { uri: pfad };
  });
}
