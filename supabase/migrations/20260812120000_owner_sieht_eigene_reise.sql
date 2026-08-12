-- Der Owner darf seine Reise sehen, auch bevor der Trigger ihn eingetragen hat.
--
-- `trips_select_member` verlangte bislang ausschliesslich
-- `is_trip_member(id, auth.uid())`, also eine Zeile in `trip_members`. Die legt
-- `add_owner_membership` an, ein AFTER-INSERT-Trigger (20260803090200).
--
-- Das schloss den Weg, den die App beim Anlegen geht. `createTrip` hängt ein
-- `.select('id').single()` an, weil es die neue id für die Navigation zum
-- Einladen-Screen braucht. Daraus wird ein INSERT ... RETURNING, und dabei
-- prüft Postgres nicht nur die WITH-CHECK-Bedingung der Insert-Policy, sondern
-- zusätzlich die SELECT-Policy auf der neuen Zeile. Zu diesem Zeitpunkt ist der
-- AFTER-Trigger noch nicht gelaufen, es gibt also keine Mitgliedschaft,
-- `is_trip_member` liefert false, und Postgres bricht ab. Die Meldung lautet
-- dabei «new row violates row-level security policy» und ist von einer
-- WITH-CHECK-Verletzung nicht zu unterscheiden, was die Suche in die Irre
-- führte: an der Insert-Policy lag es nie.
--
-- In der App kam davon «Die Reise konnte nicht angelegt werden. Probier es
-- gleich nochmal.» an, und zwar bei jedem Versuch. Ohne RETURNING lief derselbe
-- Insert durch, weshalb 03_membership_rls_test.sql die Lücke nicht sah.
--
-- `owner_id = auth.uid()` macht nichts auf, was nicht ohnehin gälte: der
-- Trigger trägt genau diesen Nutzer eine Wimper später als Owner-Mitglied ein.
-- Die Bedingung steht zuerst, damit der häufige Fall ohne den Umweg über
-- `trip_members` auskommt.
--
-- Der Policy-Name bleibt, obwohl er jetzt zwei Fälle deckt: er wird in den
-- Kommentaren von 20260803090700 und 20260806120000 namentlich erwähnt, und
-- eine Umbenennung machte diese Verweise stumm falsch.

drop policy if exists trips_select_member on public.trips;

create policy trips_select_member on public.trips
  for select
  using (owner_id = auth.uid() or is_trip_member(id, auth.uid()));
