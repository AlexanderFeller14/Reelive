// Zugang zum nativen Modul `modules/kamera-zoom` (Swift, siehe dort
// KameraZoomModule.swift). Diese Datei ist die EINZIGE Stelle, die es kennt.
//
// Wozu überhaupt eigenes Swift: `expo-camera` nimmt keinen Zoomfaktor
// entgegen, sondern einen Regler von 0 bis 1, den iOS exponentiell auf
// `activeFormat.videoMaxZoomFactor` bezieht — eine Zahl, die JavaScript nicht
// lesen kann und die ausserdem zwischen Foto- und Videoformat wechselt. Das
// Modul setzt `videoZoomFactor` deshalb direkt. Ausserdem liefert es die
// Umschaltpunkte des Geräts, aus denen die Stufen entstehen (siehe zoom.ts),
// und die Zuordnung Gerätetyp → lokalisierter Name: `expo-camera` wählt
// Linsen über `localizedName` (CameraSessionManager.swift:91), und der heisst
// auf einem deutschen iPhone anders als auf einem englischen.
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Linse, LinsenTyp } from './zoom';

type NativeLinse = {
  name: string;
  typ: string;
  bestandteile: string[];
  umschaltpunkte: number[];
};

type KameraZoomModul = {
  linsen(position: 'back' | 'front'): NativeLinse[];
  zoomGrenzen(name: string): { min: number; max: number } | null;
  setzeZoom(name: string, faktor: number, sanft: boolean): void;
  fokussiere(x: number, y: number): Promise<void>;
};

// `undefined` heisst «noch nicht nachgesehen», `null` heisst «gibt es hier
// nicht»: auf Android und am Simulator ist das der Normalfall, kein Fehler.
let modul: KameraZoomModul | null | undefined;

function nativesModul(): KameraZoomModul | null {
  if (modul === undefined) modul = requireOptionalNativeModule<KameraZoomModul>('KameraZoom');
  return modul;
}

const BEKANNTE_TYPEN: LinsenTyp[] = [
  'ultraWide',
  'wide',
  'telephoto',
  'trueDepth',
  'triple',
  'dual',
  'dualWide',
];

// Apple kann jederzeit einen Gerätetyp ergänzen. Der soll ankommen dürfen,
// ohne dass eine unbekannte Zeichenkette als Typ weiterwandert — die Rechnung
// in zoom.ts fragt nur nach `ultraWide`, alles andere behandelt sie gleich.
function alsTyp(roh: string): LinsenTyp {
  return (BEKANNTE_TYPEN as string[]).includes(roh) ? (roh as LinsenTyp) : 'unbekannt';
}

export function linsen(position: 'back' | 'front'): Linse[] {
  const nativ = nativesModul();
  if (!nativ) return [];
  return nativ.linsen(position).map((linse) => ({
    name: linse.name,
    typ: alsTyp(linse.typ),
    bestandteile: linse.bestandteile.map(alsTyp),
    umschaltpunkte: linse.umschaltpunkte,
  }));
}

/** Grenzen in der Zählung des Geräts, nicht in der angezeigten. */
export function zoomGrenzen(name: string): { min: number; max: number } | null {
  return nativesModul()?.zoomGrenzen(name) ?? null;
}

/** `sanft` fährt hinein (Rampe wie in der Kamera-App), sonst folgt es dem Finger. */
export function setzeZoom(name: string, faktor: number, sanft: boolean): void {
  nativesModul()?.setzeZoom(name, faktor, sanft);
}

/**
 * Fokus und Belichtung auf den Punkt, in Fenster-Koordinaten (pageX/pageY).
 * Die Umrechnung in Geräte-Koordinaten übernimmt nativ die Preview-Layer
 * (Orientierung und Aspect-Fill-Beschnitt inklusive), zurückgestellt wird
 * von selbst, sobald sich die Szene ändert (Subject-Area-Monitoring). Auch
 * das steckt im eigenen Modul: expo-camera kennt nur den globalen
 * autoFocus-Modus, keinen Fokus-Punkt.
 */
export function fokussiere(x: number, y: number): void {
  void nativesModul()?.fokussiere(x, y).catch(() => {});
}
