// Während einer laufenden Aufnahme (Foto-Zyklus oder Video) darf die Tab-Bar
// nicht bedienbar sein: ein Tab-Wechsel feuert das Fokus-Cleanup mitten in
// die laufende Session (das mute-Umhängen wäre eine Session-Rekonfiguration,
// siehe den Kommentar an der CameraView) und navigiert von einer Aufnahme
// weg, die gleich in die Vorschau will.
//
// Der Kamera-Screen setzt das Zeichen, der Tab-Navigator liest es synchron
// im tabPress-Listener (app/(tabs)/_layout.tsx). Bewusst kein State und kein
// Context: der Foto-Zyklus lebt in einem Ref (kein Re-Render, an dem ein
// Prop-Wechsel hängen könnte), und ein Listener liest ohnehin erst zum
// Ereignis-Zeitpunkt. Gleiches Holder-Muster wie uebergabe.ts.
let gesperrt = false;

export function sperren(an: boolean): void {
  gesperrt = an;
}

export function istGesperrt(): boolean {
  return gesperrt;
}
