import type { RecapMoment } from '@/features/recap/types';
import { zeitInZone } from '@/features/recap/uhrzeit';

// Was eine Nadel SAGT und WOVON ihr Aussehen abhängt — die beiden Regeln, die
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
// Im Browser entscheidet derselbe Wert, ob das `divIcon` neu gebaut wird —
// ungefragt neu gebaut lüde es sein Bild bei jeder Kartenbewegung erneut und
// die Nadel flackerte beim Schieben.
export function nadelAbbild(moment: RecapMoment, thumbUrl: string | null, anzahl: number): string {
  return `${moment.type}|${anzahl}|${thumbUrl ?? ''}`;
}

// Nach dem Rastern ist die Nadel für VoiceOver EIN Element — was innen steht,
// ist dann nicht mehr erreichbar. Die Beschriftung gehört deshalb an den
// Marker, nicht in die Nadel. Form wie in uebersicht.tsx («Moment 3 öffnen»),
// nur mit dem, was hier bekannt ist: Autor und Uhrzeit — und für eine Gruppe
// ihre Anzahl statt eines einzelnen Moments.
//
// Für die Gruppe nennt das Label die Aktion, die der Tipp WIRKLICH auslöst: er
// zoomt hinein (Spec §5.5), er öffnet nichts. Wer sich per VoiceOver ansagen
// lässt, was ein Element tut, bekommt sonst ein Versprechen, das die Karte
// nicht einlöst. «An diesem Ort» wäre dazu gelogen: gruppiert wird nach 40
// BILDSCHIRMpunkten, und die sind bei einem Kontinent-Ausschnitt über 150 km.
//
// `unteilbar` ist die eine Gruppe, für die das nicht gilt: liegen alle
// Momente auf exakt derselben Koordinate, trennt sie keine Zoomstufe
// (features/karte/gruppierung.ts, `aufEinemFleck`) — dort öffnet der Tipp das
// Sheet mit der Liste (Spec §5.7). «An diesem Ort» ist hier, anders als bei
// einer nach Bildschirmpunkten gebildeten Gruppe, wörtlich wahr.
export function nadelBeschriftung(moment: RecapMoment, anzahl: number, unteilbar: boolean): string {
  if (anzahl > 1) {
    return unteilbar ? `${anzahl} Momente an diesem Ort ansehen` : `Auf ${anzahl} Momente heranzoomen`;
  }
  const uhrzeit = zeitInZone(moment.captured_at, moment.captured_tz);
  return `Moment von ${moment.autor_name} um ${uhrzeit} öffnen`;
}
