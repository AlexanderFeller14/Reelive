# Push beim Reisebeginn

Stand: 2026-08-20, Design freigegeben.

## Problem

Am ersten Reisetag erfährt niemand aktiv, dass die Reise jetzt läuft. Ein Push
soll das ändern, aber zu einer verträglichen Uhrzeit (rund 10 Uhr), nicht um
Mitternacht, wenn der Kalendertag wechselt.

## Entscheid

Dritter Task im bestehenden `reveal-schedule`-Mechanismus (Spec
2026-08-18-auto-reveal-design.md). Die Function ist genau dafür gebaut:
Task-Dispatch per pg_cron mit `x-cron-secret`, CAS-Marker gegen Doppel-Pushes,
Store-Adapter mit Integrationstests. Eine eigene Edge-Function wäre
Duplikation von Zulassungsprüfung, Store und Fehlerbehandlung. Verworfen.

Entscheidungen (2026-08-20):
- Empfänger: ALLE Mitglieder der Reise, wie beim Reveal-Push. Der Beginn
  betrifft alle, nicht nur den Ersteller. (Die Erinnerung am letzten Tag geht
  weiterhin nur an den Owner.)
- Uhrzeit: 08:00 UTC, also 10:00 Sommer / 09:00 Winter in der Schweiz.
  pg_cron kennt nur UTC; gleiche Bauart wie die Erinnerung um 07:30 UTC.
- Text: «Heute beginnt eure Reise «NAME». Sendet eure ersten Momente ein!»
  (Vokabular der Design-Language: Momente, einsenden. Wie bei den
  bestehenden Pushes steht derselbe Text in title und body.)

## Migration (`supabase/migrations/<timestamp>_trip_start_push.sql`)

1. Neue Spalte `trips.start_push_sent_at timestamptz` (null = noch nicht
   verschickt), Marker analog `end_reminder_sent_at`, mit Kommentar.
2. Neuer Cron-Job `reveal-schedule-trip-start`, Schedule `0 8 * * *`,
   Befehl `select public.call_reveal_schedule('trip_start')`.
   `call_reveal_schedule` selbst bleibt unverändert: sie reicht den Task
   durch und berechnet `today` in Europe/Zurich.
3. pgTAP-Tests in `supabase/tests/` (neue Datei nach dem Muster von
   `21_auto_reveal_test.sql`): Spalte existiert, Job existiert genau einmal,
   Schedule stimmt.

## Edge-Function (`supabase/functions/reveal-schedule/`)

Wire-Vertrag SQL <-> Function wächst um den Task-Wert `'trip_start'`; die
Vertragskommentare an beiden Enden (Migration, index.ts, schedule.ts) wandern
mit.

- `ScheduleTask` wird `'reveal' | 'reminder' | 'trip_start'`;
  `checkScheduleRequest` akzeptiert den neuen Wert.
- `ScheduleStore` wächst um:
  - `fetchTripStartTrips(today)`: Status `active`, `start_date = today`,
    `start_push_sent_at is null`.
  - `markStartPush(tripId)`: CAS-Update (`start_push_sent_at = now` nur wo
    null, zusätzlich `status = 'active'`), analog `markReminder`.
- Der Versand an alle Mitglieder existiert schon als Kern von
  `sendRevealPush` (reveal-trip/reveal.ts): Mitglieder holen, Tokens holen,
  Nachrichten bauen, tote Tokens aufräumen. Dieser Kern wird zu einem
  parametrisierten Helfer `sendTripPush(store, sendFn, trip, text,
  triggeringUserId)` verallgemeinert; `sendRevealPush` bleibt als dünner
  Wrapper mit dem Reveal-Text bestehen, alle Aufrufer unverändert.
- `performTripStart(store, sendFn, today, report)`: analog `performReminder`
  (Auswahl, CAS, nur der Gewinner sendet, Fehler je Reise stoppen die
  Schleife nicht), aber der Versand geht über `sendTripPush` mit dem
  Beginn-Text an alle Mitglieder (`triggeringUserId` null).
- `index.ts`: dritter Dispatch-Zweig.

## Randfälle (bewusst so)

- Reise wird am Starttag NACH dem Cron-Lauf angelegt: kein Push. Der nächste
  Lauf sieht `start_date < today`, die Gleichheits-Bedingung greift nicht
  mehr. Wer die Reise gerade anlegt, weiss, dass sie läuft.
- Push-Fehler nach gesetztem Marker: der Push entfällt ersatzlos, kein
  Retry, wie bei der Erinnerung. Er ist Convenience, nichts hängt davon ab.
- Reise wird zwischen Auswahl und CAS aufgedeckt oder gelöscht: die
  Status-Bedingung im CAS bzw. die verschwundene Zeile verhindern den Push.
- Erster Lauf nach dem Deploy: nur Reisen mit Beginn exakt heute, kein
  Nachhol-Schwall für laufende Alt-Reisen.
- App-Seite: nichts zu tun. Der Push öffnet die App, einen Tap-Handler gibt
  es wie bei den bestehenden Pushes bewusst nicht.

## Tests

- pgTAP: siehe Migration.
- `schedule_test.ts` (rein, ohne Docker): `checkScheduleRequest` akzeptiert
  `'trip_start'`; `performTripStart` sendet an alle Mitglieder, respektiert
  den CAS-Verlierer, meldet Fehler je Reise und läuft weiter.
- `scheduleStore_integration_test.ts`: Bedingungen der zwei neuen Queries
  gegen den echten Stack (Gleichheit auf `start_date`, Marker-CAS setzt nur
  einmal, Status-Bedingung).
- Bestehende `reveal_test.ts`-Fälle für `sendRevealPush` bleiben grün
  (Wrapper-Umbau ist verhaltensneutral).

## Hosted-Rollout

Lokal reicht Migration + `supabase functions serve`. Auf Hosted gehört der
Schritt zur ohnehin offenen reveal-schedule-Deploy-Liste (Function neu
deployen mit `--no-verify-jwt`, Migration pushen); Vault-Secrets und
CRON_SECRET existieren dort dann schon.

## Nicht in Scope

Konfigurierbare Uhrzeit pro Reise oder Nutzer, Zeitzonen je Nutzer,
Tap-Navigation in der App, Push-Einstellungen.
