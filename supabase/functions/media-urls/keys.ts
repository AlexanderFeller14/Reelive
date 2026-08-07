// Spiegelt bewusst mobile/src/features/moments/medien.ts: der Client braucht die
// Schlüssel vor dem Insert, diese Funktion traut ihm nicht und leitet sie neu ab.
export function erwarteteSchluessel(
  tripId: string,
  postId: string,
  typ: 'photo' | 'video'
): { storage_key: string; thumb_key: string } {
  const ext = typ === 'video' ? 'mp4' : 'jpg';
  return {
    storage_key: `trips/${tripId}/${postId}.${ext}`,
    thumb_key: `trips/${tripId}/${postId}_t.jpg`,
  };
}
