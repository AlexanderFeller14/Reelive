// Reine Zustandsmaschine des Story-Players: rein, netzfrei, kein React
// (Task-7-Brief). Der Screen aus Task 11 bedient nur noch diese Funktionen,
// alle Entscheidungen (welcher Moment als nächstes, wann ein Tag beginnt,
// wie lange ein Moment steht) sind hier und damit ohne laufenden Stack
// testbar.
import type { RecapMoment } from './types';
import { gruppiereNachTagen } from './tage';

export type PlayerStand = { index: number; pausiert: boolean; fortschritt: number };

// Anzeigedauer eines Fotos, bevor der Player automatisch weiterspringt.
export const FOTO_DAUER_MS = 5000;

// duration_s ist auf posts nullable (Task-7-Brief) — ein Video ohne bekannte
// Länge braucht trotzdem eine endliche Anzeigedauer für den Fortschritts-
// balken, sonst würde duration_s * 1000 zu NaN und der Balken (der reale
// Zeit abbildet, DESIGN-LANGUAGE §5) könnte nie füllen. Der genaue Wert ist
// nirgends in Spec oder Brief vorgegeben; 15 s ist grosszügig genug, um ein
// kurzes Reise-Video nicht vorzeitig abzuschneiden, und endlich genug, um
// den Recap nicht an einem einzelnen kaputten Datensatz hängenzulassen.
export const VIDEO_DAUER_FALLBACK_MS = 15_000;

export function dauerFuer(m: RecapMoment): number {
  if (m.type === 'photo') return FOTO_DAUER_MS;
  return m.duration_s === null ? VIDEO_DAUER_FALLBACK_MS : m.duration_s * 1000;
}

// Ein Moment weiter. `pausiert` bleibt unangetastet (weiter/zurueck
// entscheiden nicht über Pause — das ist eine eigene, vom Screen gesteuerte
// Geste, siehe Task 11 «Halten = Pause»), `fortschritt` beginnt beim neuen
// Moment immer bei 0. Am letzten Moment (und bei einer leeren Liste: dort
// ist index + 1 = 1 >= 0 = anzahl, der Vergleich greift ohne Sonderfall)
// liefert die Funktion 'ende', NIE den Index `anzahl` — es gibt an dieser
// Stelle keinen Moment mehr, den ein Aufrufer als "aktuell" behandeln könnte.
export function weiter(stand: PlayerStand, anzahl: number): PlayerStand | 'ende' {
  const naechsterIndex = stand.index + 1;
  if (naechsterIndex >= anzahl) return 'ende';
  return { ...stand, index: naechsterIndex, fortschritt: 0 };
}

// Ein Moment zurück. fortschritt geht IMMER auf 0 — auch mitten in einem
// Video zurückgetippt, beginnt der (nun vorherige) Moment von vorn, nie an
// der Stelle, an der man ihn verlassen hatte. Am ersten Moment (index 0)
// bleibt der Index bei 0: ein "zurueck" darf nie vor den Anfang der Filmrolle
// hinaus- oder in einen vorherigen Tag hineinspringen (Brief) — es setzt nur
// den Fortschritt des ersten Moments zurück.
export function zurueck(stand: PlayerStand): PlayerStand {
  return { ...stand, index: Math.max(0, stand.index - 1), fortschritt: 0 };
}

// true genau beim allerersten Moment überhaupt (index 0) und immer dann,
// wenn der Moment an `index` einem anderen Reisetag angehört als der Moment
// direkt davor. Die Tageszuordnung kommt bewusst aus gruppiereNachTagen
// (Brief: "Benutz gruppiereNachTagen, statt die Logik nachzubauen") statt
// aus einer eigenen, isolierten Berechnung pro Moment — die Tagesnummer
// eines Moments hängt von den Momenten VOR ihm ab (monotones Fortschreiben
// bei einem Zeitzonensprung, siehe tage.ts), sie lässt sich für einen
// einzelnen Moment gar nicht isoliert bestimmen.
//
// Die Zuordnung läuft über `id`, nicht über die Position im von
// gruppiereNachTagen zurückgegebenen (gruppierten, ggf. um kaputte Momente
// verkürzten) Ergebnis: gruppiereNachTagen lässt einen Moment mit
// unbrauchbarem captured_at/captured_tz aus (tage.ts, Review-Fund Important
// 2) — dessen Position im Ergebnis würde dann nicht mehr mit `index` in der
// hier übergebenen `momente`-Liste übereinstimmen. Über `id` bleibt die
// Zuordnung auch in diesem Randfall korrekt: ein kaputter Moment hat schlicht
// keinen Eintrag in der Map und gilt als (undefined !== jede echte Zahl)
// abweichend vom Vortag, was ihn nicht zum Crash, sondern höchstens zu einer
// zusätzlichen Tages-Zwischenkarte macht.
export function tagWechselt(momente: RecapMoment[], startDate: string, index: number): boolean {
  if (index < 0 || index >= momente.length) return false;
  if (index === 0) return true;

  const tageNummer = new Map<string, number>();
  for (const tag of gruppiereNachTagen(momente, startDate)) {
    for (const moment of tag.momente) tageNummer.set(moment.id, tag.nummer);
  }

  return tageNummer.get(momente[index].id) !== tageNummer.get(momente[index - 1].id);
}
