import { useCallback, useState } from 'react';

// Ein Zustand, der zu EINER Reise gehört und mit ihr endet.
//
// Der Fehler, den es hier gar nicht mehr geben soll, trat in Phase 7 viermal
// im selben Screen auf: ein Screen unter `[id]` bleibt bei einem Wechsel der
// Reise-id GEMOUNTET, expo-router tauscht nur den Parameter. Alles, was der
// Screen in `useState` hält, überlebt diesen Wechsel und gehört danach zur
// falschen Reise. Das sieht harmlos aus und ist es nicht: ein stehen
// gebliebenes Sheet zeigte einen Moment der vorherigen Reise, und sein Knopf
// schickte den Player mit DEREN Index in die neue, wo dieselbe Zahl auf einen
// ganz anderen Moment zeigt. Kein Fehler, kein leerer Bildschirm, nur der
// falsche Moment, und das merkt niemand, ausser er zählt nach.
//
// Zurückgesetzt wird BEIM RENDERN, nicht in einem Effekt. Das ist das
// dokumentierte React-Muster für «Zustand beim Wechsel einer Prop verwerfen»:
// React verwirft die Ausgabe dieses Durchlaufs und rendert sofort neu, es wird
// also nie ein fremder Zustand sichtbar. Ein Effekt käme zu spät, das offene
// Sheet der alten Reise wäre einen Frame lang zu sehen (mitsamt seiner
// Eintrittsanimation), und ein `setState` im Effektkörper ist ausserdem ein
// Lint-Verstoss (react-hooks/set-state-in-effect).
//
// Der Zustand wird VERWORFEN, nicht pro Reise aufgehoben. Bei t1 → t2 → t1 ist
// er wieder der Anfangswert, und das ist die Absicht: es gibt kein «das Sheet,
// das ich vorhin in t1 offen hatte», es gibt nur «ich habe hier gerade nichts
// angetippt». Ein Speicher pro id wäre etwas anderes und für diese Zustände
// das Falsche, er brächte genau die Sheets zurück, die niemand geöffnet hat.
//
// Nicht für GELADENE Daten. Für die gilt das Gegenteil: bei t1 → t2 → t1 ist
// t1s geladener Stand wieder der richtige, und ihn zu verwerfen zeigte für die
// Dauer eines erneuten Ladevorgangs ein Skelett über Daten, die längst stimmen.
// Solche Zustände tragen ihren Stempel weiter selbst und werden beim Ableiten
// verglichen (siehe `sichtbarerStand` in recap/[id]/karte.tsx).
export function useReiseGebunden<T>(tripId: string, anfang: T): [T, (wert: T) => void] {
  const [stand, setStand] = useState<{ tripId: string; wert: T }>({ tripId, wert: anfang });

  // Bedingt, und die Bedingung wird durch das Setzen selbst falsch: keine
  // Schleife. Ohne die Bedingung wäre es eine.
  if (stand.tripId !== tripId) setStand({ tripId, wert: anfang });

  const setzen = useCallback((wert: T) => setStand({ tripId, wert }), [tripId]);

  // Der Anfangswert schon in DIESEM Durchlauf, nicht erst im nächsten. Die
  // Ausgabe wird zwar ohnehin verworfen, aber ein Aufrufer, der `wert` beim
  // Rendern weiterverarbeitet (eine Liste daraus filtert, einen Index
  // nachschlägt), liefe sonst einmal mit den Daten der falschen Reise, und
  // eine Ausnahme dabei würde sichtbar, auch wenn die Ausgabe es nicht wird.
  return [stand.tripId === tripId ? stand.wert : anfang, setzen];
}
