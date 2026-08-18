// Die Zoom-Stufen des Suchers. Reine Rechnung, kein React, kein natives
// Modul — beides kommt von aussen herein (siehe nativeZoom.ts und ZoomWahl.tsx).
//
// Warum diese Datei überhaupt rechnet, statt Zahlen zu kennen: `expo-camera`
// nimmt keinen Zoomfaktor entgegen, sondern einen Regler von 0 bis 1, den iOS
// exponentiell auf `activeFormat.videoMaxZoomFactor` bezieht
// (CameraSessionManager.swift:221). Diese Obergrenze ist von JavaScript aus
// nicht lesbar und wechselt ausserdem mit dem Kameraformat, also zwischen Foto
// und Video. Eine fest verdrahtete «4×» wäre auf dem einen Gerät 2×, auf dem
// anderen 8×. Deshalb setzt das native Modul den Faktor direkt, und deshalb
// stammen die Stufen vom Gerät statt aus einer gepflegten Tabelle.

export type LinsenTyp =
  | 'ultraWide'
  | 'wide'
  | 'telephoto'
  | 'trueDepth'
  | 'triple'
  | 'dual'
  | 'dualWide'
  | 'unbekannt';

export type Linse = {
  /** Lokalisierter Gerätename — genau die Zeichenkette, die `selectedLens` erwartet. */
  name: string;
  typ: LinsenTyp;
  /** Bei virtuellen Geräten die enthaltenen Linsen, von der weitesten zur längsten. */
  bestandteile: LinsenTyp[];
  /** Faktoren, bei denen iOS auf die nächste Linse wechselt. */
  umschaltpunkte: number[];
};

export type Zoomgeraet = {
  /** Geht an `selectedLens`. */
  name: string;
  /** Anzeige-Faktor, der dem nativen Faktor 1,0 entspricht: 0,5 oder 1. */
  basis: number;
  /** Anzeige-Faktoren der Reihe, aufsteigend. */
  stufen: number[];
};

// Nimmt aus allen Kameras einer Blickrichtung die, die am meisten Linsen
// vereint. Das ist die virtuelle Mehrfach-Kamera: iOS schaltet in ihr selbst
// zwischen den Linsen um, nahtlos und ohne die Session neu aufzubauen — der
// Grund, warum der Pinch über die Stufen hinweg nicht stockt.
//
// Die Stufen sind die Umschaltpunkte des Geräts selbst
// (`virtualDeviceSwitchOverVideoZoomFactors`), also genau die Faktoren, bei
// denen der Linsenwechsel stattfindet. Es sind dieselben Zahlen, die Apple in
// der Kamera-App anbietet, und sie stimmen damit auf jedem künftigen iPhone
// von selbst.
//
// Der native Faktor 1,0 meint immer die WEITESTE Linse. Ist das ein
// Ultraweitwinkel, heisst dieselbe Ansicht in Apples Zählung «0,5×». Der
// Umrechnungsschlüssel steckt im ersten Umschaltpunkt: dort übernimmt der
// Weitwinkel, der die Anzeige 1× trägt.
export function zoomGeraet(linsen: Linse[]): Zoomgeraet | null {
  let beste: Linse | null = null;
  for (const linse of linsen) {
    if (!beste || linse.bestandteile.length > beste.bestandteile.length) beste = linse;
  }
  // Ohne Umschaltpunkt gibt es nur eine Linse und damit nichts zu wählen —
  // iPhone SE, jede Frontkamera, und Android, das gar keine Linsen meldet.
  if (!beste || beste.umschaltpunkte.length === 0) return null;

  const basis = beste.bestandteile[0] === 'ultraWide' ? 1 / beste.umschaltpunkte[0] : 1;
  return {
    name: beste.name,
    basis,
    stufen: [1, ...beste.umschaltpunkte].map((faktor) => faktor * basis),
  };
}

/** Rechnet den angezeigten Faktor in die Zählung des Geräts um. */
export function nativerFaktor(anzeige: number, basis: number): number {
  return anzeige / basis;
}

// Die Grenzen liefert das Gerät in SEINER Zählung
// (`minAvailableVideoZoomFactor` / `maxAvailableVideoZoomFactor`), deshalb
// wandert die Basis hier hinein statt beim Aufrufer zu liegen: sonst müsste
// jede Stelle, die begrenzt, die Umrechnung selbst richtig herum treffen.
export function begrenzen(
  anzeige: number,
  grenzen: { min: number; max: number },
  basis: number
): number {
  return Math.min(Math.max(anzeige, grenzen.min * basis), grenzen.max * basis);
}

// Ab wann die Nachkommastelle entfällt. Zweistellig plus Komma plus Ziffer
// wären fünf Zeichen, und die Stufe ist ein kleiner Kreis — die Kamera-App
// macht an derselben Grenze dasselbe.
const OHNE_NACHKOMMA_AB = 10;

// Eine Nachkommastelle, und die nur, wenn sie etwas sagt: «1×» statt «1,0×».
// Komma statt Punkt, weil die Oberfläche deutsch ist (DESIGN-LANGUAGE §6).
export function beschriftung(faktor: number): string {
  const gerundet =
    faktor >= OHNE_NACHKOMMA_AB ? Math.round(faktor) : Math.round(faktor * 10) / 10;
  return `${String(gerundet).replace('.', ',')}×`;
}

// Der Pinch misst den Abstand der beiden Finger. Sein Verhältnis zum Abstand
// beim Aufsetzen ist der Faktor, um den sich der Zoom ändert — deshalb reicht
// eine Strecke, ohne Wissen darüber, wo auf dem Bild sie liegt.
export function fingerAbstand(finger: { pageX: number; pageY: number }[]): number | null {
  if (finger.length < 2) return null;
  return Math.hypot(finger[1].pageX - finger[0].pageX, finger[1].pageY - finger[0].pageY);
}

// Welche Stufe gerade gilt: die grösste, die der Faktor erreicht hat. Zwischen
// zwei Stufen bleibt damit die kleinere aktiv und trägt den laufenden Wert —
// so hält es die Kamera-App, während der Pinch läuft.
export function aktiveStufe(faktor: number, stufen: number[]): number {
  let aktiv = stufen[0];
  for (const stufe of stufen) {
    if (stufe <= faktor) aktiv = stufe;
  }
  return aktiv;
}

// Der Zug-Zoom des Auslösers (Snapchat-Muster): Halten und nach oben ziehen.
// `hub` ist die Fingerbewegung seit dem Aufsetzen (nach oben positiv, pt),
// `start` der Anzeige-Faktor beim Aufnahmestart, `wege` die Strecken, die
// den vollen Bereich abdecken — nach oben bis zum Maximum, nach unten bis
// zum Minimum (der Auslöser sitzt fast am Boden, viel Weg gibt es dort
// nicht, deshalb zwei getrennte Strecken).
//
// Exponentiell statt linear: Zoom ist multiplikativ. Linear gemappt läge
// zwischen 30× und 60× die halbe Strecke, obwohl es EIN Verdopplungsschritt
// ist — das fühlt sich oben träge und unten hektisch an. So trägt jeder
// Zentimeter Weg denselben Faktor.
export function zugFaktor(
  hub: number,
  start: number,
  grenzen: { min: number; max: number },
  basis: number,
  wege: { hoch: number; runter: number }
): number {
  const ziel =
    hub >= 0
      ? start * Math.pow((grenzen.max * basis) / start, Math.min(hub / wege.hoch, 1))
      : start * Math.pow((grenzen.min * basis) / start, Math.min(-hub / wege.runter, 1));
  return begrenzen(ziel, grenzen, basis);
}

export type MultiCamKamera = 'front' | 'weit' | 'ultraweit';
export type MultiCamZiel = { kamera: MultiCamKamera; faktor: number };

export function multiCamZiel(
  anzeige: number,
  richtung: 'back' | 'front',
  hatUltraweit: boolean
): MultiCamZiel {
  if (richtung === 'front') return { kamera: 'front', faktor: Math.max(anzeige, 1) };
  if (anzeige < 1 && hatUltraweit) return { kamera: 'ultraweit', faktor: anzeige * 2 };
  return { kamera: 'weit', faktor: Math.max(anzeige, 1) };
}
