import type { RecapMoment } from '@/features/recap/types';

// Ein Moment, von dem feststeht, dass er einen Ort hat. Das ist der
// Unterschied zu RecapMoment: dort sind lat/lng nullable, hier nicht mehr —
// jede Rechnung dieser Feature-Mappe darf sich darauf verlassen.
export type KartenPunkt = {
  moment: RecapMoment;
  lat: number;
  lng: number;
  // Position in der Liste, die zuKartenPunkten HEREINBEKOMMT — und die muss
  // die Spielliste sein, dieselbe, die der Recap-Player aufbaut:
  // uploaded.filter((m) => urls.has(m.id)) (player.tsx, uebersicht.tsx).
  // Genau dieser Wert geht als `start` an den Player. Wer stattdessen die
  // rohe Momente-Liste hereingibt, verschiebt mit jedem noch hochladenden
  // Moment alles dahinter, und der Sprung landet beim falschen Moment —
  // ohne dass es jemand merkt, ausser er zaehlt nach.
  index: number;
};

// Der sichtbare Kartenausschnitt, in der Form, die react-native-maps erwartet.
export type Ausschnitt = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

// Punkte, die auf dem Bildschirm zu nah beieinander liegen, um sie einzeln
// zu zeigen. `anker` ist der frueheste Moment der Gruppe und stellt sie dar.
export type Gruppe = {
  anker: KartenPunkt;
  punkte: KartenPunkt[];
};
