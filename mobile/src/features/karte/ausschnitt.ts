import type { Ausschnitt, KartenPunkt } from './typen';

// Rand um die aeussersten Punkte, damit keine Nadel am Bildschirmrand klebt.
const RAND = 1.4;
// Ausdehnung fuer den Fall, dass es keine gibt (ein einziger Punkt, oder
// mehrere auf exakt derselben Koordinate). Rund 1,1 km in der Breite.
const MINDESTSPANNE = 0.01;

// Die kleinste Laengengrad-Spanne, die alle Punkte enthaelt.
//
// Die naive Rechnung max - min stimmt ueberall ausser dort, wo die Reise den
// 180. Laengengrad kreuzt: fuer 179 und -179.5 ergaebe sie 358.5 Grad und
// einen Mittelpunkt auf der anderen Seite der Erde. Stattdessen wird die
// GROESSTE LUECKE zwischen zwei benachbarten Laengengraden gesucht — was
// uebrig bleibt, ist die gesuchte Spanne.
function laengenSpanne(lngs: number[]): { mitte: number; spanne: number } {
  const sortiert = [...lngs].sort((a, b) => a - b);
  let groessteLuecke = -1;
  let nachLuecke = 0;
  for (let i = 0; i < sortiert.length; i++) {
    const luecke = (sortiert[(i + 1) % sortiert.length] - sortiert[i] + 360) % 360;
    if (luecke > groessteLuecke) {
      groessteLuecke = luecke;
      nachLuecke = (i + 1) % sortiert.length;
    }
  }
  // Sind alle Laengengrade gleich (ein einziger Punkt, oder mehrere auf
  // derselben Koordinate), ist JEDE Luecke 0 — auch die Umrundung, denn
  // (x - x + 360) % 360 ist 0. Ohne diesen Ausstieg ergaebe `360 - 0` eine
  // Spanne von 360 Grad und einen Mittelpunkt auf dem Antipoden: fuer Lissabon
  // (-9.13) landete die Karte bei 170.87 im Pazifik. Groesste Luecke = 0 heisst
  // genau dann «alle gleich»: bei zwei verschiedenen Werten a < b sind beide
  // Luecken (b-a) und (a-b+360) groesser als null.
  if (groessteLuecke === 0) return { mitte: sortiert[0], spanne: 0 };

  const west = sortiert[nachLuecke];
  const spanne = 360 - groessteLuecke;
  // +540 statt +180 vor dem Modulo: der Zwischenwert kann negativ werden, und
  // JavaScripts % behaelt bei negativen Zahlen das Vorzeichen.
  const mitte = ((west + spanne / 2 + 540) % 360) - 180;
  return { mitte, spanne };
}

// Die Region, in der ALLE uebergebenen Punkte sichtbar sind (Spec K2).
// `null` heisst: es gibt nichts zu zeigen — der Screen entscheidet dann auf
// den Leer-Zustand, statt einen erfundenen Ausschnitt zu bekommen.
export function ausschnittFuer(punkte: KartenPunkt[]): Ausschnitt | null {
  if (punkte.length === 0) return null;

  const lats = punkte.map((p) => p.lat);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const { mitte: longitude, spanne } = laengenSpanne(punkte.map((p) => p.lng));

  return {
    latitude: (minLat + maxLat) / 2,
    longitude,
    latitudeDelta: Math.max((maxLat - minLat) * RAND, MINDESTSPANNE),
    longitudeDelta: Math.max(spanne * RAND, MINDESTSPANNE),
  };
}
