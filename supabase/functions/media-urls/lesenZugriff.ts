// Die Prüfkette der Aktion `lesen`, herausgelöst aus Deno.serve — Reaktion auf
// den Final-Review-Befund, dass ihr einziger Beleg (lesen_test.ts) mit
// `ignore: !stackBereit` ohne laufenden Stack kommentarlos übersprungen wird,
// statt fehlzuschlagen. Wer die Prüfung entfernt oder verwässert, bekam auf
// einer Maschine ohne Docker eine vollständig grüne Suite — nichts hier
// zeigte an, dass ausgerechnet Versprechen V1 der Spec («vor dem Reveal
// liest niemand ein Medium, auch nicht die Autorin des Moments») ungeprüft
// blieb.
//
// Diese Datei ist reine Logik ohne I/O — kein Deno.serve, kein Netz, kein
// Supabase-Client — und folgt darin demselben Muster wie keys.ts in diesem
// Ordner, push.ts in ../reveal-trip und queueLogic.ts in
// mobile/src/features/moments: die sicherheitsrelevante Entscheidung steht
// als reine Funktion da, unabhängig testbar, ohne `supabase start` und ohne
// ein zweites Terminal mit `functions serve`. index.ts liest trip- und
// trip_members-Zeile weiterhin selbst (Service-Role, siehe dortiger
// Kommentar zum Oracle-Guard) und ruft `beurteileLesezugriff` nur noch mit
// dem Ergebnis auf — die Reihenfolge und die Kurzschluss-Eigenschaft der
// Abfragen (trip_members wird nur abgefragt, wenn die Reise existiert UND
// nicht mehr versiegelt ist) bleibt in index.ts erhalten, diese Funktion
// entscheidet nur noch anhand dessen, was ihr übergeben wird.
//
// Beleg für Verhaltensgleichheit mit der Vorfassung: lesenZugriff_test.ts
// deckt exakt die sechs Fälle aus dem "Belegt"-Kopfkommentar von
// lesen_test.ts (Nummern 1–3 dort, plus Archiv-Variante) OHNE Docker/Stack
// — lesen_test.ts selbst blieb unverändert und bleibt zusätzlich grün gegen
// den echten Stack (S3-Signierung, Blättern, HTTP-Fehlertexte — das kann
// eine reine Funktion nicht abdecken, das deckt weiterhin der
// Integrationstest).

export type TripStatus = 'active' | 'revealed' | 'archived';

// Nur das Feld, das die Entscheidung tatsächlich braucht — nicht die volle
// TripZeile aus index.ts (die auch `id` trägt, hier irrelevant).
export type LesePruefTrip = { status: TripStatus };

export type LeseUrteil =
  | { erlaubt: true }
  | { erlaubt: false; nachricht: string; status: number };

// trip === null: keine Zeile gefunden, die Reise existiert nicht (oder die
// trip_id ist erfunden).
// mitgliedschaft === null: keine trip_members-Zeile für die anfragende
// Person — nie Mitglied gewesen oder entfernt worden, ununterscheidbar und
// das auch absichtlich (index.ts: "wer aus der Reise entfernt wurde, hat
// keine trip_members-Zeile mehr und fällt damit ab hier heraus"). Ein
// mitgliedError beim Abfragen wird von index.ts VOR dem Aufruf dieser
// Funktion zu null gefaltet — derselbe Fehlertext, dieselbe Behandlung wie
// "keine Zeile", nur der console.error-Seiteneffekt bleibt dort.
export function beurteileLesezugriff(
  trip: LesePruefTrip | null,
  mitgliedschaft: unknown | null,
): LeseUrteil {
  if (!trip) {
    return { erlaubt: false, nachricht: 'Reise nicht gefunden.', status: 404 };
  }

  // Die Versiegelung. 'active' heisst: noch niemand sieht etwas, auch nicht
  // die Autorin ihres eigenen Moments — das ist der ganze Punkt des
  // Produkts, nicht eine Bequemlichkeit der Oberfläche. 'archived' bleibt
  // lesbar: weggelegt ist nicht zugesperrt (dieselbe Menge wie in
  // posts_select_revealed_members). Dieser Zweig entscheidet unabhängig
  // davon, ob `mitgliedschaft` gesetzt ist — die Autorin selbst ist Mitglied
  // und würde sonst hier durchrutschen.
  if (trip.status !== 'revealed' && trip.status !== 'archived') {
    return { erlaubt: false, nachricht: 'Diese Reise ist noch versiegelt.', status: 403 };
  }

  if (!mitgliedschaft) {
    return { erlaubt: false, nachricht: 'Kein Zugriff auf diese Reise.', status: 403 };
  }

  return { erlaubt: true };
}
