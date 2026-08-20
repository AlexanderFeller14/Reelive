# Reise-Tab: Abschnitte «Aktiv» und «Geplant»

Stand: 2026-08-20, freigegeben.

## Problem

Der Reise-Tab zeigt alle Reisen mit Status `active` in einer flachen Liste,
sortiert nach `start_date` absteigend. Eine geplante Zukunftsreise steht damit
ueber der gerade laufenden Reise. Der Status unterscheidet nicht zwischen
«laeuft gerade» und «geplant».

## Entscheid

Rein client-seitige Ableitung, kein neuer DB-Status: «geplant» ist vollstaendig
aus `start_date` ableitbar (Beginn > heute). Ein DB-Status `planned` mit
Umschalt-Cron waere eine Migration plus Statuswechsel-Logik fuer eine
Information, die das Geraet selbst kennt. Verworfen.

## Logik (`features/trips/tripDay.ts`)

`groupTrips(trips, todayIso)` bekommt den heutigen Kalendertag als zweiten
Parameter (aus dem vorhandenen `todaysCalendarDay()`, das die Ortszeit-Falle
bereits loest) und liefert `{ running, planned, recaps }` statt
`{ ongoing, recaps }`:

- `running`: Status `active` und Beginn <= heute. Dazu zaehlt auch eine Reise,
  deren Ende vorbei, aber noch nicht aufgedeckt ist: der Status entscheidet,
  wie bisher. Reihenfolge bleibt wie geliefert (Beginn absteigend, die zuletzt
  gestartete zuoberst).
- `planned`: Status `active` und Beginn > heute, aufsteigend sortiert, die
  naechste Reise zuoberst.
- `recaps`: unveraendert (Status nicht `active`). Der Recap-Tab als zweiter
  Verwender uebergibt ebenfalls `todaysCalendarDay()` und liest weiter nur
  `recaps`.

Grenzfall: Beginn = heute zaehlt als laufend (Tag 1).

## Screen (`app/(tabs)/trip/index.tsx`)

- Keine geplante Reise: der Tab sieht exakt aus wie heute (Liste ohne Titel).
- Mit geplanten Reisen: Sektionstitel «Aktiv» (`type.h2`, Design-Language:
  H2 = Sektionstitel) ueber den laufenden, darunter Sektionstitel «Geplant»
  ueber den geplanten. Ohne laufende Reise entfaellt der «Aktiv»-Abschnitt
  komplett; nur «Geplant» steht da, ohne Empty-State.
- Empty-State «Gerade keine Reise unterwegs» nur noch, wenn weder laufende
  noch geplante Reisen da sind, aber Recaps existieren. «Noch keine Reise»
  unveraendert (gar keine Reisen).
- Der `position`-Index fuer die Platzhalter-Cover laeuft ueber beide
  Abschnitte durch (geplante starten bei `running.length`), damit nicht zwei
  gleiche Cover uebereinander stehen. Der `cover`-Query-Parameter beim
  Navigieren traegt denselben durchlaufenden Index.

## Tests

- `tripDay.test.ts`: Grenze (Beginn = heute -> laufend, Beginn = morgen ->
  geplant), Sortierung von `planned` aufsteigend, `recaps` unveraendert.
- Screen-Test: drei Zustaende (ohne geplante wie heute ohne Titel, mit beiden
  Abschnitten samt Titeln, nur «Geplant» ohne Empty-State).

## Nicht in Scope

Server, Migrationen, Push beim Reisebeginn (eigener TODO-Punkt).
