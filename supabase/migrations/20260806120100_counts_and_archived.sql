-- Batch-Variante zu my_post_count(trip_id) aus Phase 1: die Reise-Liste
-- braucht den Zähler für alle Reisen auf einmal, sonst ein Roundtrip pro Karte.
-- Gleiche Regel wie das Original: NUR die eigenen Momente, nie fremde.
create or replace function public.my_post_counts()
returns table (trip_id uuid, count bigint)
language sql stable security definer set search_path = public as $$
  select m.trip_id,
         (select count(*) from public.posts p
          where p.trip_id = m.trip_id and p.author_id = auth.uid())
  from public.trip_members m
  where m.user_id = auth.uid();
$$;

revoke execute on function public.my_post_counts() from public;
grant execute on function public.my_post_counts() to authenticated;

-- Korrektur: Bisher erlaubte die Policy nur status = 'revealed'. Eine
-- archivierte Reise war damit für ALLE unlesbar, auch für ihre Mitglieder.
-- «Archiviert» heisst weggelegt, nicht zugesperrt.
drop policy posts_select_revealed_members on public.posts;

create policy posts_select_revealed_members on public.posts
  for select using (
    public.is_trip_member(trip_id, auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id and t.status in ('revealed', 'archived')
    )
  );
