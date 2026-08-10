import AsyncStorage from '@react-native-async-storage/async-storage';

// Merkt sich pro Reise, ob die Reveal-Inszenierung (DESIGN-LANGUAGE §5,
// zweite der beiden erlaubten Ausnahmen) schon gezeigt wurde. Der eigentliche
// Zweck dahinter ist Versprechen V6 («der Recap funktioniert, auch wenn nie
// ein Push ankommt»): der Reise-Detail-Screen lädt beim Fokussieren ohnehin
// neu (reise/[id]/index.tsx) und erkennt eine frisch aufgedeckte Reise selbst
// an `status !== 'active'`, er braucht dafür weder Push noch Deep-Link.
// Dieser Bestand sorgt nur noch dafür, dass die einmalige Inszenierung auch
// wirklich nur einmal läuft, egal wie oft der Screen danach fokussiert wird.
//
// Schlüsselmuster wie tripsCache.ts (fester Präfix + Kennung, als String
// konkateniert). Anders als dort (Präfix + Benutzer-Kennung, weil ein
// geteiltes Gerät A's Reisen nie an B zeigen darf) ist hier nichts
// sicherheitsrelevant: eine doppelt gezeigte Animation ist ein kosmetischer
// Fehler, kein Datenleck. Der Schlüssel trägt darum bewusst nur die
// Reise-Kennung, genau die Schnittstelle aus dem Task-9-Brief.

const SCHLUESSEL_PRAEFIX = 'reelive.reveal_gesehen.';

// Ein Fehlschlag beim Lesen (kaputter Speicher) wird wie «noch nicht gesehen»
// behandelt, NICHT wie ein eigener Fehlerzustand: die Inszenierung nochmal zu
// zeigen ist harmlos, sie versehentlich zu unterdrücken wäre der eigentliche
// Fehler, und genau das würde eine Stelle schaffen, an der der Recap von
// einem Zufall abhinge statt zuverlässig erreichbar zu sein (V6).
export async function revealGesehen(tripId: string): Promise<boolean> {
  try {
    const roh = await AsyncStorage.getItem(SCHLUESSEL_PRAEFIX + tripId);
    return roh !== null;
  } catch {
    return false;
  }
}

// Scheitert das Schreiben (AsyncStorage voll oder kaputt), bleibt es beim
// nächsten Aufruf von revealGesehen() bei `false`, die Inszenierung läuft
// dann beim nächsten Fokussieren dieser Reise einfach nochmal. Das ist der
// bewusst in Kauf genommene Rückfall: eine wiederholte Animation nervt
// höchstens, sie versperrt niemals den Weg zum Recap selbst, «Recap
// starten» steht danach in jedem Fall da, ob die Inszenierung lief oder
// nicht (siehe reise/[id]/index.tsx).
export async function merkeRevealGesehen(tripId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SCHLUESSEL_PRAEFIX + tripId, '1');
  } catch {
    // Siehe Kommentar oben.
  }
}
