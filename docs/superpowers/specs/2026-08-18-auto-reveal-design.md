# Auto-Reveal am Tag nach dem Enddatum

**Datum:** 2026-08-18
**Status:** Ansatz im Chat abgenommen, Spec zur Review

## 1. Ziel

Eine Reise wird am Tag nach ihrem Enddatum automatisch zum Recap. Bis 23:59 des
letzten Tages bleibt sie unter «Meine Reisen» sichtbar und kann wie bisher vom
Owner vorzeitig abgeschlossen werden. Ab Mitternacht übernimmt der Server:
Status auf `revealed`, Push an alle Mitglieder, die Reise erscheint im
Recap-Tab.

Das ergänzt die V1-Spec (§ «Reveal durch Owner»): der manuelle Abschluss bleibt
bestehen, neu ist der Kalender als zweiter Auslöser. Die Kernregel bleibt
unangetastet: die Versiegelung wird serverseitig erzwungen (RLS + signierte
URLs), die App sortiert weiterhin nur nach `status`.

## 2. Verhalten

Zeitachse für eine Reise mit Enddatum E (alle Zeiten Europe/Zurich, siehe §3):

1. **Bis E, 23:59:** Reise steht unter «Meine Reisen». «Reise abschliessen»
   steht dem Owner jederzeit offen (ab E prominent, wie bisher).
2. **Am Morgen von E:** Der Owner bekommt einen Erinnerungs-Push:
   Titel und Text «Heute ist der letzte Tag eurer Reise "NAME". Um Mitternacht
   wird euer Recap aufgedeckt.» Die Erinnerung kommt genau einmal, und nur,
   wenn die Reise dann noch `active` ist (wer schon abgeschlossen hat, bekommt
   nichts).
3. **Nach Mitternacht (E+1):** Der Auto-Reveal deckt jede Reise mit
   `status = 'active'` und `end_date < heute` auf: CAS-Update auf `revealed`,
   danach der bestehende Reveal-Push «Euer Recap von "NAME" ist bereit!» an
   **alle** Mitglieder. Beim Auto-Reveal gibt es keine auslösende Person, die
   von der Benachrichtigung ausgenommen würde.
4. **Alt-Reisen:** Beim ersten Lauf nach dem Ausrollen werden auch aktive
   Reisen aufgedeckt, deren Enddatum länger zurückliegt (inklusive Push). Eine
   Erinnerung bekommen nur Reisen, deren Enddatum genau heute ist. Abgenommen
   im Chat am 2026-08-18.

Ein falsch gesetztes Enddatum führt zu einem unumkehrbaren Reveal mitten in
der Reise. Abfederung: der Erinnerungs-Push am Morgen des letzten Tages plus
die bestehende Bearbeiten-Funktion für das Enddatum.

## 3. Zeitzone

Reisen kennen keine Zeitzone, `end_date` ist ein reiner Kalendertag.
«Mitternacht» braucht deshalb eine feste Referenz: **Europe/Zurich**, im Code
dokumentiert. Die Datums-Vergleiche rechnen mit
`(now() at time zone 'Europe/Zurich')::date`.

Die Cron-Jobs laufen zu festen UTC-Zeiten, die das ganzjährig abdecken
(pg_cron kennt keine Zeitzonen-Angabe):

| Job | UTC | Europe/Zurich | Aufgabe |
|---|---|---|---|
| Auto-Reveal | 23:10 | 00:10 (Winter) / 01:10 (Sommer) | Reveal fälliger Reisen |
| Erinnerung | 07:30 | 08:30 (Winter) / 09:30 (Sommer) | Push an Owner am letzten Tag |

Bewusst nicht im Umfang: eine Zeitzone pro Reise. Für den Zweck (Freundes-
gruppen, primär Schweiz) reicht die feste Referenz; eine per-Trip-Zeitzone
wäre eine Schema- und UI-Erweiterung ohne aktuellen Bedarf.

## 4. Architektur

```
pg_cron (2 Jobs, UTC)
  └─> SQL-Wrapper (liest Vault-Secrets)
        └─> pg_net: HTTP POST an Edge Function reveal-zeitplan
              ├─ Aufgabe 'reveal':     fällige Reisen aufdecken + Push an alle
              └─ Aufgabe 'erinnerung': Owner-Push am letzten Tag, einmalig
```

- **pg_cron + pg_net** werden per Migration aktiviert. Zwei Jobs rufen einen
  SQL-Wrapper auf, der Projekt-URL und Cron-Secret aus dem Supabase-Vault
  liest und per `net.http_post` die Edge Function anstösst. Body:
  `{"aufgabe": "reveal"}` bzw. `{"aufgabe": "erinnerung"}`.
- **Edge Function `reveal-zeitplan`** (neu): läuft mit Service-Role und
  `verify_jwt = false`, denn der Aufrufer ist Postgres, kein Nutzer mit JWT.
  Statt des JWT prüft sie ein geteiltes Secret im Header `x-cron-geheimnis`
  gegen die Umgebungsvariable `CRON_GEHEIMNIS`; ohne Treffer 401. Damit ist
  sie, wie share-link, eine Function mit eigener Auth statt JWT-Pflicht
  (Begründungs-Kommentar in config.toml, gleiches Muster wie dort).
- **Wiederverwendung:** Die Function importiert die bestehenden Bausteine
  relativ aus `../reveal-trip/`: den Store-Adapter (CAS-Update
  `aktualisiereWennAktiv`, Token-Abfragen) und `versendeRevealPush`. Der
  Owner-Check aus `fuehreRevealAus` gilt hier bewusst nicht, den Abschluss
  löst der Kalender aus. Die neue Entscheidungslogik (welche Reisen sind
  fällig, wer bekommt welchen Push, Idempotenz) liegt als reine Funktion in
  `zeitplan.ts` über einer schmalen Store-Schnittstelle, wie `reveal.ts`.

## 5. Datenmodell

Migration `supabase/migrations/`:

- `create extension pg_cron` / `pg_net` (idempotent mit `if not exists`).
- Neue Spalte `trips.end_reminder_sent_at timestamptz null`: Marker, dass die
  Erinnerung für diese Reise verschickt wurde. Geschrieben nur von der
  Service-Role; `authenticated` bekommt keinen Grant auf die Spalte, es gibt
  keine RLS-Änderung.
- SQL-Wrapper-Funktion für den pg_net-Aufruf plus zwei `cron.schedule`-Einträge
  (Zeiten aus §3).

Pro Umgebung (lokal, Hosted) müssen im Vault zwei Secrets stehen:
`projekt_url` (Basis-URL der Edge Functions) und `cron_geheimnis` (derselbe
Wert wie `CRON_GEHEIMNIS` in der Function-Umgebung). Das Einrichten ist ein einmaliger
Schritt pro Umgebung, nicht Teil der Migration (Secrets gehören nicht in
versionierte Dateien); die genauen Befehle beschreibt der Umsetzungsplan und
sie werden in `supabase/README.md` festgehalten.

## 6. Ablauf in der Edge Function

**Aufgabe `reveal`:**

1. Lies alle Reisen mit `status = 'active'` und
   `end_date < (now() at time zone 'Europe/Zurich')::date`.
2. Pro Reise: CAS-Update wie beim manuellen Reveal (`status = 'active'` als
   Bedingung). Gewinnt der Update (1 Zeile), folgt der Push an alle
   Mitglieder. Verliert er (0 Zeilen, jemand hat parallel manuell
   abgeschlossen), passiert nichts weiter, insbesondere kein zweiter Push.
3. Fehler bei einer Reise (Push scheitert, Update scheitert) werden gemeldet
   (Sentry-Melder wie in reveal-trip) und stoppen die Schleife nicht: die
   übrigen Reisen kommen trotzdem dran.

**Aufgabe `erinnerung`:**

1. Lies alle Reisen mit `status = 'active'` und
   `end_date = (now() at time zone 'Europe/Zurich')::date` und
   `end_reminder_sent_at is null`.
2. Pro Reise: CAS-Update `set end_reminder_sent_at = now() where id = … and
   end_reminder_sent_at is null`. Nur wer den Update gewinnt, schickt den
   Push an den Owner. Damit ist ein doppelter Cron-Lauf folgenlos.
3. Fehlerbehandlung wie oben: melden, weitermachen. Scheitert der Push NACH
   dem gesetzten Marker, bleibt die Erinnerung aus (kein Retry). Das ist
   akzeptiert: die Erinnerung ist Komfort, der Reveal am Folgetag kommt
   unabhängig davon.

Beide Aufgaben antworten mit einer kleinen Zusammenfassung
(`{ok: true, verarbeitet: n}`) für das Cron-Log.

## 7. App-Seite

Keine Änderung nötig. Die Reise-Liste und der Recap-Tab gruppieren nach
`status`; der Server dreht ihn um Mitternacht, beim nächsten Laden (Fokus-
Reload existiert) steht die Reise im Recap-Tab. Der manuelle Abschluss und
sein Bestätigungs-Sheet bleiben unverändert.

## 8. Tests

- **Deno-Unit-Tests** (`zeitplan_test.ts`, Fake-Store, Stil wie
  `reveal_test.ts`): fällige Auswahl leer, eine Reise, mehrere Reisen; CAS
  verloren heisst kein Push; Erinnerung nur einmal (CAS auf den Marker);
  Erinnerung nur für `active`; Fehler bei Reise n stoppt Reise n+1 nicht;
  falsches oder fehlendes Cron-Secret ergibt 401 und führt nichts aus.
- **Integrationstests** gegen den echten Stack (Stil wie
  `revealStore_integration_test.ts`): die Fällig-Abfrage mit echtem
  Datums-Vergleich, das CAS-Rennen manuell gegen automatisch (nur ein
  Gewinner, ein Push), der Erinnerungs-Marker über zwei Läufe.
- **pgTAP:** keine neuen Policies, darum keine neuen Policy-Tests. Der
  bestehende Schema-Test (01) wird um die neue Spalte ergänzt, falls er
  Spalten aufzählt; der ACL-Baseline-Test (08) muss belegen, dass
  `authenticated` die neue Spalte nicht schreiben kann.
- **Nicht automatisiert:** der pg_cron-Zeitplan selbst (feste UTC-Zeiten);
  Beleg ist ein manueller `select cron.schedule`-Blick nach dem Ausrollen.

## 9. Risiken und offene Punkte

- **Unumkehrbarkeit:** siehe §2. Bewusst akzeptiert, abgefedert durch
  Erinnerung und editierbares Enddatum.
- **Lokale Entwicklung:** die lokale Edge-Runtime fällt gelegentlich aus dem
  Stack (bekanntes Verhalten, siehe Memory «Edge-Runtime verschwindet»). Der
  Cron läuft lokal trotzdem an; ein 503 im Cron-Log ist dann Diagnose, kein
  Bug der Function.
- **Push-Zustellung:** Expo-Tickets werden wie bisher behandelt (tote Tokens
  aufräumen). Ein fehlgeschlagener Push nimmt den Statuswechsel nicht zurück,
  identisch zum manuellen Reveal.
