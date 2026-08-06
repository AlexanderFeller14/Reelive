-- Beitritt über Invite-Code. security definer, weil trip_members bewusst KEINE
-- Insert-Policy hat (Phase 1) und trips_select_member Nicht-Mitgliedern das
-- Lesen verbietet — beides soll so bleiben.

-- Vorschau vor dem Beitritt: nur das, was der Link ohnehin preisgibt.
-- Gibt NIE invite_code zurück. Unbekannter Code = null Zeilen, kein Fehler.
create or replace function public.peek_invite(p_code text)
returns table (
  trip_id            uuid,
  name               text,
  start_date         date,
  end_date           date,
  status             public.trip_status,
  member_count       bigint,
  owner_display_name text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.start_date, t.end_date, t.status,
         (select count(*) from public.trip_members m where m.trip_id = t.id),
         p.display_name
  from public.trips t
  join public.profiles p on p.id = t.owner_id
  where t.invite_code = p_code;
$$;

-- Beitritt. Erwartbare Fälle kommen als status-Wert zurück, nicht als Exception:
-- der Client kann sie so ohne Fehler-Parsing unterscheiden.
create or replace function public.redeem_invite(p_code text)
returns table (status text, trip_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_trip   public.trips%rowtype;
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  select * into v_trip from public.trips where invite_code = p_code;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if public.is_trip_member(v_trip.id, v_uid) then
    return query select 'already_member'::text, v_trip.id;
    return;
  end if;

  -- Beitritt nur solange die Reise läuft; nach dem Reveal führt der Weg über
  -- den Share-Link (Phase 6), sonst lädt man sich in einen fertigen Recap ein.
  if v_trip.status <> 'active' then
    return query select 'not_active'::text, v_trip.id;
    return;
  end if;

  -- Lücke zwischen der is_trip_member-Prüfung oben und diesem Insert: bei
  -- Doppeltipp oder Mobilfunk-Retry können zwei Aufrufe derselben Person
  -- gleichzeitig hier ankommen. "on conflict do nothing" macht den Insert
  -- selbst zur Beitritts-Prüfung (atomar, kein Savepoint wie bei einem
  -- exception-Handler nötig) — wer den Primary-Key-Konflikt verliert, bekommt
  -- über FOUND denselben 'already_member'-Status wie beim expliziten Re-Beitritt,
  -- nie den rohen unique_violation-Fehler. Ziel ist der Constraint-Name (statt
  -- der Spaltenliste "(trip_id, user_id)"), weil "trip_id" sonst mit dem
  -- gleichnamigen OUT-Parameter dieser Funktion kollidiert.
  insert into public.trip_members (trip_id, user_id, role)
  values (v_trip.id, v_uid, 'member')
  on conflict on constraint trip_members_pkey do nothing;

  if not found then
    return query select 'already_member'::text, v_trip.id;
    return;
  end if;

  return query select 'joined'::text, v_trip.id;
end $$;

revoke execute on function public.peek_invite(text) from public;
revoke execute on function public.redeem_invite(text) from public;
grant execute on function public.peek_invite(text) to anon, authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
