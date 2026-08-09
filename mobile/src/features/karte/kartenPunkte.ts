import { sortiereMomente } from '@/features/recap/tage';
import type { RecapMoment } from '@/features/recap/types';
import type { KartenPunkt } from './typen';

// Zieht aus allen Momenten einer Reise die heraus, die einen Ort tragen — und
// behaelt die anderen, statt sie fallen zu lassen: eine Karte, auf der drei
// Momente einfach fehlen, ohne dass es jemand erfaehrt, luegt ueber die Reise
// (Spec K6).
//
// Sortiert selbst ueber sortiereMomente, statt sich auf den Aufrufer zu
// verlassen. Der Grund ist nicht Bequemlichkeit: `index` muss in dieselbe
// Reihenfolge zeigen, die der Player spielt, sonst startet er am falschen
// Moment — und diese Reihenfolge ist per CLAUDE.md IMMER captured_at.
//
// zuKartenPunkten sortiert und zaehlt ausschliesslich ueber das, was es
// hereinbekommt — die Filterung auf die Spielliste (uploaded.filter((m) =>
// urls.has(m.id)), siehe player.tsx/uebersicht.tsx) ist Sache des Aufrufers.
// Wer hier die rohe Momente-Liste hereingibt statt der Spielliste, bekommt
// einen index, der nicht zum `start`-Parameter des Players passt.
export function zuKartenPunkten(momente: RecapMoment[]): {
  punkte: KartenPunkt[];
  ohneOrt: RecapMoment[];
} {
  const sortiert = sortiereMomente(momente);
  const punkte: KartenPunkt[] = [];
  const ohneOrt: RecapMoment[] = [];

  sortiert.forEach((moment, index) => {
    // Beide Werte oder keiner: eine halbe Koordinate ist auf einer Karte
    // nicht darstellbar, und `lat ?? 0` waere ein Punkt im Golf von Guinea.
    if (moment.lat === null || moment.lng === null) {
      ohneOrt.push(moment);
      return;
    }
    punkte.push({ moment, lat: moment.lat, lng: moment.lng, index });
  });

  return { punkte, ohneOrt };
}
