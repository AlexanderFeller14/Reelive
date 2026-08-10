-- ----------------------------------------------------------------------------
-- share_links_all_owner wird in vier einzelne Policies aufgeteilt.
--
-- Der Befund (Task 1 dieser Phase, belegt in supabase/tests/15_share_links_test.sql
-- Abschnitt 6-8): `share_links_all_owner` (20260803090500_social_rls.sql:38-46)
-- trägt in `with check` die Bedingung `status = 'revealed'`, in `using` dagegen
-- gar keine Status-Bedingung. Eine `for all`-Policy kann INSERT und UPDATE nicht
-- unterscheiden, `with check` gilt für beide. Folge:
--
--   * INSERT verhält sich wie der Kommentar behauptet (nur revealed).
--   * UPDATE trifft dieselbe `with check`, ein Widerruf auf einer archivierten
--     Reise scheitert mit 42501.
--   * SELECT und DELETE bleiben nach dem Archivieren uneingeschränkt.
--
-- Das ist genau die falsche Richtung: Eine archivierte Reise mit einem nicht
-- widerrufenen Link bleibt dauerhaft öffentlich lesbar, weil die Owner-Person
-- ihn nur noch LÖSCHEN (und damit die Rechenschaft verlieren: «gab es diesen
-- Link je?») statt WIDERRUFEN kann. Ein Widerruf macht einen Link schwächer,
-- nie stärker, er darf an keinem Reise-Status scheitern, an dem das Anlegen
-- scheitert.
--
-- Entscheid (Phase 6, Task 2): **Anlegen bleibt `revealed`-only, Widerrufen
-- muss auch für `archived` gehen.**
--
-- Warum die Status-Bedingung im UPDATE trotzdem nicht ganz entfällt: `with
-- check` wird gegen die NEUE Zeile ausgewertet. Ohne Status-Bedingung liesse
-- sich ein bestehender Link per `update share_links set trip_id = <eigene
-- aktive Reise>` auf eine noch versiegelte Reise umhängen, und damit genau
-- das erzeugen, was das INSERT-Verbot verhindert: ein funktionierender
-- öffentlicher Link auf eine versiegelte Reise (Spec §4, W3). Die Bedingung
-- lautet deshalb `in ('revealed', 'archived')` statt `= 'revealed'`: sie lässt
-- den Widerruf auf einer archivierten Reise zu und sperrt den Weg auf eine
-- aktive weiterhin.
--
-- Residuum, bewusst in Kauf genommen und in 15_share_links_test.sql
-- festgenagelt: Ein Link, der auf einer AKTIVEN Reise liegt, liesse sich auch
-- danach nicht widerrufen. Ein solcher Link kann über keinen legitimen Weg
-- entstehen (INSERT verlangt 'revealed', `trips.status` wechselt nur über
-- reveal-trip und nie zurück nach 'active'), und die Edge Function
-- `share-link` arbeitet ohnehin mit Service-Role an RLS vorbei, für sie ist
-- der Widerruf immer möglich. Die Alternative wäre, das UPDATE-Grant auf
-- (revoked, expires_at) einzuschränken und die Status-Bedingung ganz zu
-- streichen; das ist eine grössere Änderung an der Client-Schnittstelle und
-- gehört nicht in diese Migration.
--
-- SELECT und DELETE bleiben wortgleich zur bisherigen `using`-Klausel: nur
-- Eigentümerschaft, keine Status-Bedingung. Sie ändern sich durch diese
-- Migration nicht, sie bekommen nur einen eigenen Namen.
-- ----------------------------------------------------------------------------

drop policy share_links_all_owner on public.share_links;

create policy share_links_select_owner on public.share_links
  for select using (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid())
  );

-- Anlegen: unverändert nur für eine aufgedeckte Reise.
create policy share_links_insert_owner on public.share_links
  for insert with check (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid()
              and t.status = 'revealed')
  );

-- Ändern (in der Praxis: widerrufen, Ablaufdatum setzen): auch für eine
-- archivierte Reise. `using` gegen die alte, `with check` gegen die neue Zeile,
-- siehe Kopfkommentar.
create policy share_links_update_owner on public.share_links
  for update using (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid()
              and t.status in ('revealed', 'archived'))
  );

create policy share_links_delete_owner on public.share_links
  for delete using (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.owner_id = auth.uid())
  );

-- Grants bleiben unverändert (select, insert, update, delete für
-- authenticated, gesetzt in 20260803090500_social_rls.sql; volle DML für
-- service_role in 20260803090600_role_hardening.sql). Diese Migration ändert
-- nur, welche Zeilen die Policies durchlassen, nicht welche Tabelle erreichbar
-- ist.
