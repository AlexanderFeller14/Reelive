-- ============================================================================
-- Mitgliedschafts-Orakel schliessen (Finding 1, finaler Whole-Branch-Review)
-- ----------------------------------------------------------------------------
-- is_trip_member() ist SECURITY DEFINER mit EXECUTE für authenticated (siehe
-- 20260803090600_role_hardening.sql, Punkt 4) und daher via PostgREST als RPC
-- aufrufbar. Ohne Guard konnte JEDER authentifizierte Nutzer, auch ein
-- Fremder ohne jede Mitgliedschaft, rpc('is_trip_member', {trip, user}) mit
-- beliebigen fremden UUIDs aufrufen und so Mitgliedschaften Dritter
-- überwachen: z.B. könnte ein aus einem Trip entferntes Ex-Mitglied mit
-- bekannter Trip-UUID für immer beobachten, wer (noch) Mitglied ist. Genau
-- das verbietet bereits profiles_select_own_or_shared, das Orakel unterlief
-- diese Absicht über einen Seitenkanal.
--
-- Fix: die Funktion beantwortet nur noch Fragen über den Aufrufer selbst.
-- Ist auth.uid() nicht identisch mit p_user_id, liefert sie false, ohne die
-- trip_members-Tabelle überhaupt anzusehen. Das ist sicher, weil AUSNAHMSLOS
-- jeder interne Aufrufer (trips_select_member, trip_members_select_member,
-- posts_select_revealed_members, posts_insert_member aus den bisherigen
-- Migrationen sowie can_see_post und my_post_count) auth.uid() als p_user_id
-- übergibt, für sie ändert der Guard das Ergebnis nicht.
--
-- service_role: braucht die Funktion nicht (BYPASSRLS, liest trip_members
-- direkt) und kein bestehender Codepfad ruft sie auf. Falls sie dennoch
-- aufgerufen würde: auth.uid() liest 'sub' aus request.jwt.claims und ist für
-- service_role-Requests ohne diesen Claim NULL, also praktisch nie gleich
-- einer konkreten p_user_id, die Funktion würde dann fälschlich false statt
-- des wahren Werts liefern (nie fälschlich true; sicher in die falsche
-- Richtung). Edge Functions (Phasen 3–6) sollten trip_members deshalb direkt
-- abfragen statt diese Funktion zu rufen.
-- ============================================================================
create or replace function public.is_trip_member(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() = p_user_id, false) and exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = p_user_id
  );
$$;

comment on function public.is_trip_member(uuid, uuid) is
  'Mitgliedschafts-Check, security definer wegen RLS-Rekursion auf trip_members. Guard: liefert false, sobald auth.uid() nicht p_user_id ist, verhindert das Mitgliedschafts-Orakel (ein authenticated Aufrufer könnte sonst per RPC fremde Mitgliedschaften erfragen). Alle internen Aufrufer übergeben auth.uid() als p_user_id und sind unbetroffen. service_role hat i.d.R. keinen auth.uid()-Claim (NULL) und sollte trip_members ohnehin direkt lesen statt diese Funktion zu rufen, ein direkter Aufruf würde fälschlich false statt des wahren Werts liefern, nie fälschlich true.';
