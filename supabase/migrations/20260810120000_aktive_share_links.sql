-- «Welcher Teilen-Link trägt gerade?», ab jetzt an EINER Stelle.
--
-- ----------------------------------------------------------------------------
-- Was hier zusammengeführt wird
-- ----------------------------------------------------------------------------
-- Dieselbe Regel stand seit gestern zweimal im Projekt:
--
--   1. in `public.recap_ist_geteilt` (20260810100000), als SQL, für die
--      Auskunft an alle Mitreisenden,
--   2. in `holeAktivenLink` (mobile/src/features/teilen/linkVerwaltenApi.ts),
--      als Client-Filterung, für das Teilen-Sheet der Owner-Person.
--
-- Beide sagten dasselbe, aber sie sind ohne diese Migration nicht aneinander
-- gebunden. Fasst jemand die eine an, läuft sie von der anderen weg, und der
-- Widerspruch stünde für dieselbe Reise nebeneinander im Bild: das Sheet sagt
-- «kein aktiver Link», die Zeile darunter sagt «dieser Recap ist geteilt».
--
-- ----------------------------------------------------------------------------
-- Warum eine View und keine dritte Funktion
-- ----------------------------------------------------------------------------
-- Die beiden Leser brauchen VERSCHIEDENE Dinge: die Owner-Person den Token und
-- das Ablaufdatum, alle anderen nur ein Ja oder Nein. Eine Funktion müsste sich
-- für eine der beiden Formen entscheiden, eine View liefert Zeilen, und jeder
-- Leser nimmt sich, was er braucht.
--
-- Entscheidend ist `security_invoker = on` (Postgres 15+, hier läuft 17): ohne
-- das gehörte die View ihrem Erzeuger, und JEDE angemeldete Person sähe darin
-- jeden Token jeder Reise. Mit dem Schalter wird die RLS der Basistabelle für
-- den AUFRUFER ausgewertet, `share_links_select_owner` gilt also unverändert
-- weiter: die Owner-Person sieht ihre Zeilen, sonst niemand.
--
-- `recap_ist_geteilt` liest dieselbe View, aber als `security definer`, und
-- läuft damit als Eigentümer: sie sieht alle Zeilen und beschränkt selbst, auf
-- die Mitgliedschaft. Zwei Leser, zwei Sichtweiten, eine Regel.
create view public.aktive_share_links
with (security_invoker = on) as
  select token, trip_id, expires_at, created_at
    from public.share_links
   where revoked = false
     and (expires_at is null or expires_at > now());

-- Ohne Grant ist die View unerreichbar, genau wie eine Tabelle. `anon` bekommt
-- nichts: der öffentliche Leseweg läuft über `share-link/aufloesen` mit dem
-- Token als Berechtigung, nie über eine Tabelle oder View.
grant select on public.aktive_share_links to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Die Auskunft an die Mitreisenden liest jetzt dieselbe View
-- ----------------------------------------------------------------------------
-- Inhaltlich unverändert (siehe 20260810100000, dort steht die volle
-- Begründung, warum es eine Funktion sein muss und keine zweite Policy). Neu
-- ist allein, WOHER die Bedingung kommt: aus der View statt aus einer eigenen
-- Kopie der drei Vergleiche.
create or replace function public.recap_ist_geteilt(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.aktive_share_links s where s.trip_id = p_trip_id
  )
  -- Unverändert und weiterhin die wichtigste Zeile: `security definer` hebt
  -- RLS auf, ohne die Mitgliedschafts-Bedingung wäre die Funktion ein Orakel,
  -- mit dem sich für beliebige trip_ids abfragen liesse, ob dort gerade
  -- geteilt wird.
  and public.is_trip_member(p_trip_id, auth.uid());
$$;

revoke execute on function public.recap_ist_geteilt(uuid) from public;
grant execute on function public.recap_ist_geteilt(uuid) to authenticated, service_role;
