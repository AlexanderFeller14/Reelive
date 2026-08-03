-- Einzige erlaubte Information über versiegelte Posts: der EIGENE Zähler.
-- security definer, weil RLS die Posts vor dem Reveal komplett verbirgt.
create or replace function public.my_post_count(p_trip_id uuid)
returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip_id, auth.uid()) then
    raise exception 'not a trip member';
  end if;
  return (
    select count(*) from public.posts
    where trip_id = p_trip_id and author_id = auth.uid()
  );
end $$;
