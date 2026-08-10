// Uhrzeit in DER ZEITZONE DES MOMENTS (`captured_tz`), nicht in Gerätezeit:
// wer den Recap zu Hause ansieht, will die Uhrzeit von damals, nicht die
// umgerechnete. Das braucht zwingend Intl.DateTimeFormat mit `timeZone`, einen
// Intl-freien Weg gibt es dafür nicht.
//
// `captured_tz` hat keine CHECK-Constraint (nur `text not null`, siehe
// tage.ts, gleiches Verteidigungsprinzip), ein unbekannter Zonenname wirft
// hier einen RangeError. Lieber eine best-effort Gerätezeit zeigen als
// abstürzen oder eine leere Stelle lassen.
//
// Wortgleich zu den privaten Kopien in `recap/[id]/player.tsx` und
// `teilen/[token].tsx`. Diese Datei ist der Ort, an dem sie zusammenlaufen
// sollen; die beiden Screens umzustellen ist eine mechanische Nachfolgearbeit
// und gehört nicht in eine Fixrunde der Karte (beide Dateien stehen unter
// anderen offenen Tasks).
export function zeitInZone(capturedAt: string, capturedTz: string): string {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: capturedTz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(capturedAt));
  } catch {
    const d = new Date(capturedAt);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
