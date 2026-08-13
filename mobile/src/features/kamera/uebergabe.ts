// Das aufgenommene Foto wandert als natives Speicher-Objekt (PictureRef) vom
// Kamera-Screen zur Vorschau. Router-Params sind Strings, ein Ref passt
// nicht hindurch — deshalb dieser Holder, das kleinste Ding, das die Lücke
// schliesst (Spec 2026-08-13-aufnahme-tempo-design.md §4). Er hält genau
// EINE Übergabe: mehr als eine Aufnahme ist nie gleichzeitig unterwegs.
import type { PictureRef } from 'expo-camera';

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
