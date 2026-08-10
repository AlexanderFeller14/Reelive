import { ausschnittFuer } from './ausschnitt';
import { aufEinemFleck } from './gruppierung';
import type { Ausschnitt, Gruppe } from './typen';

// Was ein Tipp auf eine Gruppe auslöst, die Regel, die sich der Kartenscreen
// der App (recap/[id]/karte.tsx) und der geteilte Recap (teilen/[token].tsx)
// teilen. Zwei Kopien liefen hier garantiert auseinander, und die eine wäre
// die, an der die Sackgasse unten wieder aufginge.
//
// Spec §5.5: der Tipp fährt in die Gruppe HINEIN, solange das etwas ausrichtet.
// Erst wo Zoomen nichts mehr bringt, öffnet er das Sheet.
//
// «Nichts mehr bringen» hiess bis zur Merge-Fixrunde ausschliesslich
// `aufEinemFleck`, bitgleiche Koordinaten. Die Begründung dafür (Task 8) war:
// für JEDE Ausdehnung grösser null wächst der Bildschirmabstand mit jedem
// Tipp (die sichtbare Spanne wird höchstens halbiert) und überschreitet nach
// endlich vielen die Gruppenschwelle von 40 Punkten.
//
// Dieser Beweis setzt voraus, dass die Karte beliebig weit hineinzoomen kann.
// Sie kann es nicht. Im Browser ist bei Zoomstufe 19 Schluss (`MAX_ZOOM` in
// KartenFlaeche.web.tsx, so weit reichen die OpenStreetMap-Kacheln), und
// `getBoundsZoom` deckelt darauf. Auf dieser Stufe sind 8 Meter noch rund 34
// Bildschirmpunkte, also WENIGER als die 40, ab denen zwei Nadeln einzeln
// gezeichnet werden; erst ab gut 9 Metern fällt eine Gruppe dort auseinander.
// Zwei Aufnahmen am selben Ort liegen durch den GPS-Versatz regelmässig 3 bis
// 8 Meter auseinander, für sie war der Tipp eine Sackgasse: Haptik,
// Kamerafahrt auf dieselbe Stufe, keine Änderung, kein Sheet, beliebig oft.
//
// Nativ gibt es dieselbe Grenze, nur auf einer anderen Stufe (MapKit
// entscheidet sie selbst). Die Antwort darf deshalb keine Zahl kennen, sondern
// nur die BEOBACHTUNG: hat der letzte Tipp auf diese Gruppe die Kamera bewegt?
// Wenn nicht, wird der nächste es auch nicht, und dann öffnet er das Sheet.

// Der letzte Zoom-Versuch: für WELCHE Gruppe gefahren wurde und was VOR der
// Fahrt zu sehen war. Der Anker identifiziert die Gruppe: er ist ihr frühester
// Moment (gruppierung.ts) und bleibt derselbe, solange die Gruppe besteht,
// und wenn die Kamera stillsteht, ändert sich die Gruppierung nicht.
export type ZoomVersuch = { ankerId: string; vorher: Ausschnitt };

// Ab welchem Anteil der sichtbaren Spanne eine Kamerabewegung als Bewegung
// zählt. Eine echte Fahrt halbiert die Spanne (50 %) oder verschiebt die Mitte
// sichtbar; eine Fahrt gegen den Anschlag ändert exakt nichts. Ein Prozent
// liegt weit von beidem entfernt und ist kein Schwellenwert, den ein
// Rundungsfehler überschreitet.
const BEWEGUNGS_ANTEIL = 0.01;

// Abstand zweier Längengrade, auf den kürzeren Weg um die Erde gerechnet.
// Ohne das wären 179.9 und -179.9 rund 360 Grad auseinander statt 0.2, die
// Karte gälte über der Datumsgrenze immer als «bewegt».
function laengenAbstand(a: number, b: number): number {
  return Math.abs((((a - b + 540) % 360) - 180));
}

// Hat sich der sichtbare Ausschnitt messbar geändert?
//
// Gemessen wird an der Spanne VORHER, nicht an einer absoluten Gradzahl: ein
// Prozent eines Kontinent-Ausschnitts sind Hunderte Kilometer, ein Prozent
// eines Häuserblocks sind Zentimeter. Beide Male ist gemeint «so viel, dass
// man es sieht».
export function kameraBewegt(vorher: Ausschnitt, nachher: Ausschnitt): boolean {
  const latSchwelle = vorher.latitudeDelta * BEWEGUNGS_ANTEIL;
  const lngSchwelle = vorher.longitudeDelta * BEWEGUNGS_ANTEIL;
  return (
    Math.abs(nachher.latitude - vorher.latitude) > latSchwelle ||
    laengenAbstand(nachher.longitude, vorher.longitude) > lngSchwelle ||
    Math.abs(nachher.latitudeDelta - vorher.latitudeDelta) > latSchwelle ||
    Math.abs(nachher.longitudeDelta - vorher.longitudeDelta) > lngSchwelle
  );
}

// Wohin ein Tipp auf diese Gruppe fährt. `null` ist unerreichbar (eine Gruppe
// hat mindestens einen Punkt), aber der Typ von `ausschnittFuer` verlangt die
// Behandlung.
export function zoomZiel(gruppe: Gruppe, sichtbar: Ausschnitt): Ausschnitt | null {
  const umfasst = ausschnittFuer(gruppe.punkte);
  if (!umfasst) return null;
  return {
    ...umfasst,
    // Die Fahrt geht immer HINEIN, nie hinaus: `ausschnittFuer` hat eine
    // Mindestspanne von rund 1,1 km, sie ist für den Erststart gedacht, damit
    // ein einzelner Moment nicht maximal herangezoomt wird. Liegen die Momente
    // einer Gruppe enger beieinander, ist ihr Ergebnis WEITER als das, was
    // gerade zu sehen ist, und der Tipp zoomte hinaus.
    latitudeDelta: Math.min(umfasst.latitudeDelta, sichtbar.latitudeDelta / 2),
    longitudeDelta: Math.min(umfasst.longitudeDelta, sichtbar.longitudeDelta / 2),
  };
}

// Richtet ein Tipp auf diese Gruppe noch etwas aus, oder gehört ihr das
// Sheet? Zwei Wege führen zu «nein, das Zoomen ist durch»:
//
// - Alle Momente liegen auf exakt derselben Koordinate. Das steht ohne jeden
//   Versuch fest, und ein Ruckler ins Leere davor wäre reine Unhöflichkeit.
// - Der letzte Tipp auf GENAU DIESE Gruppe hat die Kamera nicht bewegt. Dann
//   steht sie am Anschlag ihrer Zoomstufen, und ein zweiter Versuch täte
//   dasselbe Nichts.
//
// Der Anker muss übereinstimmen: eine andere Gruppe liegt woanders, dorthin
// kann die Kamera sehr wohl fahren (die MITTE bewegt sich, auch wenn die
// Zoomstufe schon am Anschlag ist).
export function zoomAussichtslos(
  gruppe: Gruppe,
  sichtbar: Ausschnitt,
  letzter: ZoomVersuch | null
): boolean {
  if (aufEinemFleck(gruppe)) return true;
  if (letzter === null || letzter.ankerId !== gruppe.anker.moment.id) return false;
  return !kameraBewegt(letzter.vorher, sichtbar);
}
