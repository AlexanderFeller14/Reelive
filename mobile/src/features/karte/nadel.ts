import type { RecapMoment } from '@/features/recap/types';
import { timeInZone } from '@/features/recap/timeOfDay';

// Was eine Nadel SAGT und WOVON ihr Aussehen abhängt, die beiden Regeln, die
// sich die native Nadel (components/KartenNadel.tsx) und die Browser-Nadel
// (KartenFlaeche.web.tsx) teilen.
//
// Sie standen bis Task 14 modulprivat in KartenNadel.tsx. Dort können sie
// nicht bleiben: diese Datei importiert `Marker` aus react-native-maps, und
// die Bibliothek hat keine Web-Fassung (`main` zeigt auf TypeScript-Quelle mit
// nativen Modulen). Ein Import von dort in die `.web.tsx` zöge sie in den
// Browser-Bundle, wo sie nicht gebaut werden kann.
//
// Beide Fassungen aus DERSELBEN Quelle: eine zweite Formulierung des Labels
// verspräche per VoiceOver irgendwann etwas anderes, als der Tipp tut, und ein
// zweites Abbild liesse die eine Fassung nachzeichnen, wo die andere stillsteht.

// Alles, was das Aussehen der Nadel bestimmt, als EIN Wert.
//
// Nativ bilden ihn beide Komponenten in KartenNadel.tsx damit: die Nadel, um zu
// wissen, wann sie ihren Fertig-Stand neu melden muss, und der Marker, um zu
// wissen, ob der gemeldete Stand noch der aktuelle ist (`tracksViewChanges`).
// Im Browser entscheidet derselbe Wert, ob das `divIcon` neu gebaut wird,
// ungefragt neu gebaut lüde es sein Bild bei jeder Kartenbewegung erneut und
// die Nadel flackerte beim Schieben.
export function nadelAbbild(moment: RecapMoment, thumbUrl: string | null, anzahl: number): string {
  return `${moment.type}|${anzahl}|${thumbUrl ?? ''}`;
}

// Nach dem Rastern ist die Nadel für VoiceOver EIN Element, was innen steht,
// ist dann nicht mehr erreichbar. Die Beschriftung gehört deshalb an den
// Marker, nicht in die Nadel. Form wie in uebersicht.tsx («Moment 3 öffnen»),
// nur mit dem, was hier bekannt ist: Autor und Uhrzeit, und für eine Gruppe
// ihre Anzahl statt eines einzelnen Moments.
//
// Für die Gruppe nennt das Label die Aktion, die der Tipp WIRKLICH auslöst.
// Wer sich per VoiceOver ansagen lässt, was ein Element tut, bekommt sonst ein
// Versprechen, das die Karte nicht einlöst. Und das sind hier zwei
// verschiedene Dinge: entweder fährt der Tipp in die Gruppe hinein (Spec §5.5)
// oder er öffnet ihre Liste (§5.7).
//
// `oeffnetSheet` sagt, welches von beiden. Es ist bewusst NICHT «liegen alle
// auf demselben Fleck»: das war der einzige Grund, bis die Merge-Fixrunde von
// Phase 7 den zweiten hinzufügte (die Karte steht am Anschlag ihrer
// Zoomstufen, features/karte/gruppenTipp.ts). Wer hier nach dem GRUND fragt
// statt nach der FOLGE, sagt beim zweiten Grund wieder das Falsche. Die Frage
// beantwortet deshalb der Screen, mit derselben Funktion, die auch den Tipp
// entscheidet.
//
// «An diesem Ort» ist in beiden Fällen wörtlich wahr: bitgleiche Koordinaten
// im einen, und im anderen die 40 Bildschirmpunkte der Gruppierung auf der
// letzten Zoomstufe, also rund neun Meter. Bei einer Gruppe, aus der noch
// herausgezoomt werden kann, wäre es gelogen, dort können dieselben 40 Punkte
// über 150 km sein, und genau dort steht es auch nicht.
export function nadelBeschriftung(
  moment: RecapMoment,
  anzahl: number,
  oeffnetSheet: boolean
): string {
  if (anzahl > 1) {
    return oeffnetSheet
      ? `${anzahl} Momente an diesem Ort ansehen`
      : `Auf ${anzahl} Momente heranzoomen`;
  }
  return momentLabel(moment);
}

// Was VoiceOver zu EINEM Moment sagt, an jeder Stelle, an der er sich öffnen
// lässt: die einzelne Nadel oben, die Zeilen der Gruppenliste und die Kacheln
// der Momente ohne Ort (features/karte/MomentSheet.tsx), in der App wie im
// geteilten Recap.
//
// Es stand bis hierher dreimal wortgleich im Projekt, einmal je Aufrufstelle.
// Drei Kopien einer Ansage, die alle dieselbe Handlung beschreiben, laufen
// auseinander, sobald eine davon angefasst wird, und die Abweichung sieht nur,
// wer VoiceOver einschaltet.
export function momentLabel(moment: RecapMoment): string {
  const uhrzeit = timeInZone(moment.captured_at, moment.captured_tz);
  return `Moment von ${moment.autor_name} um ${uhrzeit} öffnen`;
}
