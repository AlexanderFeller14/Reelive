-- ============================================================================
-- Invite-Code rotiert nur noch beim Rauswurf, nicht mehr beim freiwilligen
-- Verlassen.
--
-- Bisher (090600_role_hardening.sql) würfelte der Trigger nach JEDEM Delete auf
-- trip_members einen neuen trips.invite_code. Damit reisst schon ein einzelner
-- Austritt allen anderen den geteilten Link und QR-Code weg: Der Owner schickt
-- den Code an drei Freunde, einer geht wieder — die beiden anderen landen in
-- «Diesen Einladungslink gibt es nicht mehr.». Das trifft genau die Kern-
-- funktion von Phase 3.
--
-- Der Sicherheitszweck bleibt erhalten, denn er greift nur in einer Richtung:
-- Wer ENTFERNT wird, soll nicht mit dem alten Link zurückkommen können — dort
-- rotiert der Code weiterhin. Wer SELBST geht, ist kein Sicherheitsproblem
-- (er hätte einfach bleiben können), also dürfen die Links der anderen leben.
-- ============================================================================

create or replace function public.rotate_invite_code_on_member_removal()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Freiwilliger Austritt: die löschende Person ist die gelöschte. auth.uid()
  -- liest die Request-GUC `request.jwt.claims` und ist von security definer
  -- unberührt (das ändert nur den Ausführungs-Rollenkontext, nicht die
  -- Session-Settings) — im Trigger steht also dieselbe Identität wie im
  -- auslösenden Statement.
  --
  -- auth.uid() is null heisst: kein Client-Kontext — service_role (Edge
  -- Functions ab Phase 4), Migrationen, Seeds, psql. Dann lässt sich gerade
  -- NICHT belegen, dass jemand freiwillig geht; die Löschung kommt von aussen
  -- und ist damit näher am Rauswurf. Deshalb bewusst die sichere Richtung:
  -- ohne Identität wird rotiert. Ein zu oft rotierter Code kostet ein erneutes
  -- Teilen, ein zu selten rotierter lässt einen Rausgeworfenen zurück.
  if auth.uid() is not null and auth.uid() = old.user_id then
    return old;
  end if;

  update public.trips
  set invite_code = encode(gen_random_bytes(6), 'hex')
  where id = old.trip_id;
  return old;
end $$;

comment on function public.rotate_invite_code_on_member_removal() is
  'Rotiert trips.invite_code, wenn ein Mitglied ENTFERNT wird (löschende <> gelöschte Person, oder gar kein Client-Kontext). Beim freiwilligen Verlassen bleibt der Code stehen, damit die Links der übrigen Eingeladenen gültig bleiben.';
