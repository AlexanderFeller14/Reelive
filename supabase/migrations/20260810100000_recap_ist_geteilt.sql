-- Mitreisende sollen sehen, DASS ihr Recap gerade geteilt ist.
--
-- ----------------------------------------------------------------------------
-- Warum eine Funktion und keine Policy
-- ----------------------------------------------------------------------------
-- Der Link ist seit Phase 7 mehr als eine Bilderstrecke: er trägt die Orte,
-- an denen die Momente entstanden sind, unbeschnitten. Wer mitreist, hat ein
-- Recht darauf zu wissen, dass seine Momente gerade hinter einer öffentlichen
-- URL stehen, und nicht nur die Owner-Person, die den Link erstellt hat.
--
-- Die naheliegende Lösung, eine zweite SELECT-Policy auf share_links für
-- Mitglieder, ist die falsche: Policies entscheiden über ZEILEN, nicht über
-- Spalten. Wer die Zeile lesen darf, liest auch `token`, und der Token IST
-- die Berechtigung (share-link/aufloesung.ts). Ein Spalten-Grant könnte das
-- nicht auffangen, er gilt für die ganze Rolle `authenticated` und damit für
-- die Owner-Person genauso, die ihren Token sehr wohl braucht.
--
-- Also eine Funktion, die nur ja oder nein sagt. Der Token verlässt die
-- Tabelle damit für Mitglieder nie, auch nicht versehentlich über einen
-- `select *` in irgendeinem späteren Screen.
--
-- ----------------------------------------------------------------------------
-- Was «geteilt» genau heisst
-- ----------------------------------------------------------------------------
-- Dieselben drei Bedingungen, an denen `share-link/aufloesen` einen Link
-- annimmt (supabase/functions/share-link/aufloesung.ts): die Zeile existiert,
-- sie ist nicht widerrufen, und ihr Ablauf liegt nicht in der Vergangenheit.
-- `expires_at is null` heisst «ohne Ablauf», das ist der Normalfall, Links
-- entstehen standardmässig unbefristet.
--
-- Läuft die Antwort je auseinander mit dem, was `aufloesen` tut, sagt diese
-- App das Falsche über ihre eigenen Daten: entweder «geteilt», wo der Link
-- längst nichts mehr hergibt (unnötige Sorge), oder «nicht geteilt», wo er
-- weiterhin trägt (die schlimmere Richtung). Die pgTAP-Tests halten beide
-- Grenzfälle fest.
create or replace function public.recap_ist_geteilt(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.share_links s
     where s.trip_id = p_trip_id
       and s.revoked = false
       and (s.expires_at is null or s.expires_at > now())
  )
  -- Die Mitgliedschaft steht als UND-Bedingung im selben `exists`-Ausdruck
  -- und nicht davor: `security definer` hebt RLS auf, die Funktion sähe sonst
  -- für JEDE angemeldete Person jede Reise. Ohne diese Zeile wäre sie ein
  -- Orakel, mit dem sich für beliebige trip_ids abfragen liesse, ob dort
  -- gerade geteilt wird.
  and public.is_trip_member(p_trip_id, auth.uid());
$$;

-- Wie is_trip_member selbst (20260803090600_role_hardening.sql): erst allen
-- entziehen, dann gezielt vergeben. `public` schliesst `anon` ein, und eine
-- Auskunft über eine Reise hat ohne Anmeldung nichts zu suchen.
revoke execute on function public.recap_ist_geteilt(uuid) from public;
grant execute on function public.recap_ist_geteilt(uuid) to authenticated, service_role;
