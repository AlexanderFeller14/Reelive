// Was ein Teilen-Link preisgibt, in einem Satz.
//
// Er steht an zwei Stellen im Bild und muss an beiden derselbe sein:
//
//   - im Teilen-Sheet, wo die Owner-Person ihn liest, BEVOR sie einen Link
//     erstellt (features/teilen/TeilenSheetInhalt.tsx),
//   - im Reise-Screen, wo alle Mitreisenden ihn lesen, WÄHREND ein Link
//     besteht (app/(tabs)/reise/[id]/index.tsx).
//
// Zwei Fassungen desselben Satzes wären hier besonders unangenehm: es ist die
// Auskunft darüber, was mit fremden Momenten passiert. Weicht die eine von der
// anderen ab, hat jemand einem Link zugestimmt, der etwas anderes zeigt als
// das, was den Mitreisenden gesagt wird.
//
// Die Orte stehen ausdrücklich drin. Sie sind seit Phase 7 Teil dessen, was
// der Link zeigt, unbeschnitten (Spec-Entscheid R4), und genau das ist die
// Tatsache, die ohne diesen Satz niemand erfährt.
export const LINK_REICHWEITE =
  'Wer diesen Link hat, sieht den ganzen Recap: alle Momente aller Mitreisenden samt den Orten, an denen sie entstanden sind, auch ohne eigenes Konto.';
