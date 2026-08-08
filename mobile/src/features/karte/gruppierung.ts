import type { Ausschnitt, Gruppe, KartenPunkt } from './typen';

// Zwei Nadeln naeher als das verdecken einander: das Thumbnail ist 44 Punkte
// breit, ab rund 40 Punkten Abstand ueberlappen die Raender sichtbar.
export const GRUPPEN_ABSTAND_PT = 40;

type Bildpunkt = { x: number; y: number };

// Lineare Projektion des sichtbaren Ausschnitts auf die Flaeche. Bewusst OHNE
// Mercator-Korrektur: es geht nicht um Kartografie, sondern um die Frage «wie
// weit sind diese zwei Nadeln auf DIESEM Bildschirm auseinander» — und der
// Ausschnitt ist klein genug, dass die Verzerrung darin nicht ins Gewicht
// faellt.
function aufBildschirm(
  punkt: KartenPunkt,
  ausschnitt: Ausschnitt,
  breite: number,
  hoehe: number
): Bildpunkt {
  const westen = ausschnitt.longitude - ausschnitt.longitudeDelta / 2;
  const norden = ausschnitt.latitude + ausschnitt.latitudeDelta / 2;
  // Der Versatz nach Osten, auf einen vollen Umlauf normiert. Ohne das
  // schiesst ein Punkt oestlich der Datumsgrenze ins Millionenfache: fuer
  // einen gewickelten Ausschnitt (longitude -180) ist `westen` -180.014, und
  // 179.99 minus -180.014 ergibt 360.004 statt 0.004. Die Schwesterfunktion
  // ausschnittFuer faengt diesen Fall schon ab — hier fehlte er.
  const versatz = (((punkt.lng - westen) % 360) + 360) % 360;
  return {
    x: (versatz / ausschnitt.longitudeDelta) * breite,
    y: ((norden - punkt.lat) / ausschnitt.latitudeDelta) * hoehe,
  };
}

// Fasst Punkte zusammen, die auf dem Bildschirm zu nah beieinander liegen.
//
// Bewusst gierig und in Eingabereihenfolge statt als k-means o.ae.: die
// Eingabe ist nach captured_at sortiert, also ist das Ergebnis deterministisch
// und der Anker jeder Gruppe ihr fruehester Moment. Ein Verfahren mit
// Zufallsstart wuerde die Karte bei jedem Rendern anders aussehen lassen.
export function gruppiere(
  punkte: KartenPunkt[],
  ausschnitt: Ausschnitt,
  breite: number,
  hoehe: number,
  schwelle: number = GRUPPEN_ABSTAND_PT
): Gruppe[] {
  const gruppen: { gruppe: Gruppe; ankerBild: Bildpunkt }[] = [];

  for (const punkt of punkte) {
    const bild = aufBildschirm(punkt, ausschnitt, breite, hoehe);
    const treffer = gruppen.find(({ ankerBild }) => {
      return Math.hypot(bild.x - ankerBild.x, bild.y - ankerBild.y) < schwelle;
    });
    if (treffer) {
      treffer.gruppe.punkte.push(punkt);
      continue;
    }
    gruppen.push({ gruppe: { anker: punkt, punkte: [punkt] }, ankerBild: bild });
  }

  return gruppen.map(({ gruppe }) => gruppe);
}
