import type { RecapMoment } from '@/features/recap/types';

// Ein Moment, von dem feststeht, dass er einen Ort hat. Das ist der
// Unterschied zu RecapMoment: dort sind lat/lng nullable, hier nicht mehr —
// jede Rechnung dieser Feature-Mappe darf sich darauf verlassen.
export type KartenPunkt = {
  moment: RecapMoment;
  lat: number;
  lng: number;
  // Position in der sortierten Gesamtliste aller Momente der Reise. Genau
  // dieser Wert geht als `start` an den Player.
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
