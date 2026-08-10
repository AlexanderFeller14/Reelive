import type { RecapMoment } from '@/features/recap/types';

// Ein Moment, von dem feststeht, dass er einen Ort hat. Das ist der
// Unterschied zu RecapMoment: dort sind lat/lng nullable, hier nicht mehr,
// jede Rechnung dieser Feature-Mappe darf sich darauf verlassen.
export type KartenPunkt = {
  moment: RecapMoment;
  lat: number;
  lng: number;
  // Position in der Liste, die zuKartenPunkten HEREINBEKOMMT, und die muss
  // die Spielliste sein, dieselbe, die der Recap-Player aufbaut:
  // uploaded.filter((m) => urls.has(m.id)) (player.tsx, uebersicht.tsx).
  // Genau dieser Wert geht als `start` an den Player. Wer stattdessen die
  // rohe Momente-Liste hereingibt, verschiebt mit jedem noch hochladenden
  // Moment alles dahinter, und der Sprung landet beim falschen Moment,
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

// Der Vertrag der Kartenflaeche, von BEIDEN Fassungen erfuellt: KartenFlaeche.tsx
// (react-native-maps) und KartenFlaeche.web.tsx (Leaflet). Metro waehlt die
// `.web.tsx` im Web-Bundle und die `.tsx` sonst, ohne dass ein Aufrufer davon
// weiss, derselbe Plattform-Schalter wie bei queueDb.web.ts, pushApi.web.ts
// und secureSessionStorage.web.ts aus Phase 6.
//
// Der Vertrag steht HIER und nicht in einer der beiden Fassungen: die
// Web-Fassung darf die native nicht anfassen, auch nicht fuer einen Typ,
// react-native-maps hat keine Web-Fassung, und schon ein `import type` von
// dort waere eine Einladung, spaeter einen Wert nachzuziehen.
export type KartenFlaecheProps = {
  /**
   * Der Ausschnitt, MIT DEM die Karte oeffnet, und nur der. Spaetere
   * Aenderungen dieses Props bewegen nichts mehr: danach fuehrt die Flaeche
   * ihre Kamera selbst. Wo sie steht, meldet `aufAusschnitt`; wohin sie fahren
   * soll, sagt `zeige` am Handle unten.
   *
   * Der Name sagt das, weil ein Kommentar es nicht verhindern kann: hiesse er
   * `ausschnitt`, waere «ich setze ihn neu, dann faehrt sie hin» die
   * naheliegende Annahme, und sie ist falsch. Der Kartenscreen kommt heute
   * nur deshalb durch, weil er bei einem Reisewechsel auf `null` geht und die
   * Flaeche neu mountet.
   */
  initialerAusschnitt: Ausschnitt;
  gruppen: Gruppe[];
  linie: { latitude: number; longitude: number }[];
  /** Bild-URL fuer die Nadel eines Moments; `null`, wenn es keine gibt. */
  thumbFuer: (postId: string) => string | null;
  /** Tipp auf eine Nadel, mit der GANZEN Gruppe, die dahintersteckt. */
  aufGruppe: (gruppe: Gruppe) => void;
  /** Die Karte steht still und zeigt DAS hier. Grundlage der Gruppierung. */
  aufAusschnitt: (ausschnitt: Ausschnitt) => void;
  /** DESIGN-LANGUAGE §5: damit wird gesprungen statt gefahren. */
  reducedMotion: boolean;
};

// Eine Kamerafahrt ist ein BEFEHL, kein Zustand: zweimal dasselbe Ziel heisst
// zweimal fahren (zweimal auf dieselbe Gruppe getippt), und ein Prop mit
// gleichem Wert loeste beim zweiten Mal nichts aus. Deshalb ein imperatives
// Handle statt eines `ziel`-Props, beide Fassungen bieten es an.
//
// Der Befehl gilt ab dem Mounten, auch aus einem `useLayoutEffect` des
// Aufrufers heraus: die Web-Fassung baut ihre Karte in einem passiven Effekt
// auf und holt ein frueher gekommenes Ziel nach, statt es zu verschlucken
// (Begruendung dort). Der geteilte Player braucht genau das, er springt beim
// Oeffnen auf den Moment aus dem Link.
export type KartenFlaecheHandle = {
  zeige: (ziel: Ausschnitt) => void;
};
