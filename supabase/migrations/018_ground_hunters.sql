-- ============================================================
-- Respite · 018_ground_hunters.sql · Who Else Is Out
-- ------------------------------------------------------------
-- The Hunt page draws the region you stand in as a map, its four
-- zones as rings, and puts on it everyone out hunting there: you,
-- your party, and the rest of the realm. The first two it knows
-- already (the save, and party_state()). The realm it asks here.
--
-- hunt_presence has held every live hunt since schema.sql (the
-- game function writes it, solo and party alike) and clients hold
-- no grant on it, so this is the one way to read it wholesale:
-- who, where, and since when, for one region at a time. Nothing
-- in it is new to the realm: player_profile() already answers the
-- same hunt for any name you ask it about.
--
-- Optional. A realm without it answers "no such function" and the
-- map shows you and your party alone. Run after schema.sql; safe
-- to run again. Nothing in src/server changes.
-- ============================================================

begin;

-- 004 adds the discipline to profiles and keeps it filled; here only so this file needs
-- nothing but schema.sql under it. A no-op on a realm that has run 004.
alter table public.profiles add column if not exists klass text;

-- The live hunts are the ones never ended, and a map asks for one tier of them at a time.
create index if not exists hunt_presence_live_idx on public.hunt_presence (tier) where ended_at is null;

-- Dropped first so a later change to what it returns lands on a re-run.
drop function if exists public.ground_hunters(int);

create or replace function public.ground_hunters(p_tier int)
returns table (username text, skin text, discipline text, zone text, started_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if p_tier is null or p_tier < 1 or p_tier > 9 then
    raise exception 'No such ground.';
  end if;

  /* A hunt still running on this tier: never ended, and not past the latest it
     could last. The caller is left out, because the page draws its own hunt off
     the save, which is newer than any row here. Whoever was seen last comes
     first, so a busy region shows the camps that are awake. */
  return query
    select p.username, p.skin, p.klass, h.zone, h.started_at
    from public.hunt_presence h
    join public.profiles p on p.user_id = h.user_id
    where h.tier = p_tier
      and h.ended_at is null
      and h.ends_by > now()
      and h.user_id <> auth.uid()
      and p.username is not null
    order by p.last_seen desc nulls last, p.username
    limit 100;
end;
$$;

revoke execute on function public.ground_hunters(int) from public, anon;
grant execute on function public.ground_hunters(int) to authenticated;

commit;

-- Supabase caches which functions exist; if the page still finds none after this, the
-- cache has not turned over yet:
--   notify pgrst, 'reload schema';
