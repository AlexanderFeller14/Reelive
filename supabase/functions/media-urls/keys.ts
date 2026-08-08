// Spiegelt bewusst mobile/src/features/moments/medien.ts: der Client braucht die
// Schlüssel vor dem Insert, diese Funktion traut ihm nicht und leitet sie neu ab.
//
// Phase-4-Final-Review, Important 5: die Endung kommt aus posts.media_ext, also
// aus der Zeile, die die Function selbst gelesen hat — nie aus dem Anfrage-Body.
// `expo-camera` nimmt auf iOS QuickTime (.mov) auf und auf Android .mp4; ohne
// diese Unterscheidung lägen die iOS-Bytes dauerhaft unter `.mp4` mit
// Content-Type video/mp4 im Speicher, und der Schlüssel ist pro Moment
// unveränderlich.
//
// Die Liste hier ist die zweite Absicherung neben der Check-Constraint aus
// 20260807100000_post_media_ext.sql: was nicht darin steht, fällt auf den
// Standard der Aufnahmeart zurück. Damit kann selbst eine später gelockerte
// Constraint der Function keinen fremden Pfadbestandteil unterschieben.
const ERLAUBTE_ENDUNGEN: Record<'photo' | 'video', readonly string[]> = {
  photo: ['jpg'],
  video: ['mp4', 'mov'],
};
const STANDARD_ENDUNG: Record<'photo' | 'video', string> = { photo: 'jpg', video: 'mp4' };

// ---------------------------------------------------------------------------
// ACHTUNG, bevor hier jemand etwas ändert: Das ist kein Hilfsmittel mehr,
// sondern das SPEICHERFORMAT.
// ---------------------------------------------------------------------------
// Seit Phase 5 leitet auch die Aktion `lesen` den Pfad hierüber ab, statt
// posts.storage_key zu übernehmen (Begründung in index.ts). Damit ist diese
// Funktion der einzige Ort, der weiss, wo die Bytes liegen — für ALLE bereits
// hochgeladenen Momente, rückwirkend.
//
// Eine Änderung an Präfix, Endung oder Thumb-Suffix entwertet deshalb jedes
// gespeicherte Objekt: die Zeilen zeigen weiterhin auf den alten Pfad, die
// Ableitung auf einen neuen, und `lesen` lässt jeden betroffenen Moment aus
// (der Abgleich in index.ts schlägt an). Das ist keine Datenmigration, das ist
// eine Umbenennung im Bucket — jedes Objekt, bevor die neue Fassung live geht.
//
// Wer das Schema wirklich ändern muss, braucht dreierlei: die Umbenennung im
// Speicher, ein Nachziehen von posts.storage_key/thumb_key, und einen Plan für
// die Zeit dazwischen (beide Schemata parallel lesen). Ohne das ist der Recap
// aller Altreisen leer.
// ---------------------------------------------------------------------------
export function erwarteteSchluessel(
  tripId: string,
  postId: string,
  typ: 'photo' | 'video',
  mediaExt?: string | null,
): { storage_key: string; thumb_key: string } {
  const kandidat = (mediaExt ?? '').toLowerCase();
  const ext = ERLAUBTE_ENDUNGEN[typ].includes(kandidat) ? kandidat : STANDARD_ENDUNG[typ];
  return {
    storage_key: `trips/${tripId}/${postId}.${ext}`,
    // Thumbnails entstehen immer lokal als JPEG (Spec §4) — unabhängig davon,
    // was das Medium selbst für ein Container ist.
    thumb_key: `trips/${tripId}/${postId}_t.jpg`,
  };
}
