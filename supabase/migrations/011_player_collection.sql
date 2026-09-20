-- Respite: a commander's collection, published.
--
-- How to run: after schema.sql and 002 to 010, in the Supabase SQL Editor. Paste the whole file
-- and press Run. Safe to run again. It all runs in one transaction, so a failure leaves the
-- database as it was.
--
-- The Collection (the bestiary, and every item that has been through a camp's hands) lives in
-- the save's roll map: `m:<monster>` counts a foe felled, `i:<base>` marks an item held. A
-- commander page shows a stranger's collection beside their own, so the trigger that keeps a
-- profile in step now lifts those two out of the save and the profile function hands them over.
--
-- What is published is deliberately thin: the monster ids with a count, and the item bases with
-- nothing but the fact of them. Not how many of an item -- that number counts moves between a
-- camp's own pouches as well as arrivals and means nothing to a stranger -- and nothing about
-- where anything is kept. A profile is already public to a signed in player; this adds no name,
-- no gold and no location to it.
--
--   collection  {"felled": {"<monster>": 12, ...}, "found": ["<base>", ...]}
--
-- An older browser ignores the new column, and a browser that predates the save-side record
-- simply publishes an empty collection for a camp that has never written one.
--
-- Tests: node tests/server/run.mjs loads this file (twice); node tests/sql/run.mjs covers
-- schema.sql alone. The dev stage (npm run dev) loads it too.

begin;

-- ============================================================
-- 1. THE COLUMN
-- ============================================================
alter table public.profiles add column if not exists collection jsonb not null default '{}'::jsonb;

-- ============================================================
-- 2. LIFTING IT OUT OF A SAVE
-- ============================================================
-- One pass over the roll map, splitting it by prefix. A key that is neither, or a count that is
-- not a positive number, is left out rather than guessed at -- the same rule normalise() uses on
-- the save itself (src/shared/state.js).
create or replace function private.save_collection(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'felled', coalesce((
      select jsonb_object_agg(substring(r.key from 3), floor(r.value::numeric)::bigint)
      from jsonb_each_text(case when jsonb_typeof(p_data -> 'rolls') = 'object'
                                then p_data -> 'rolls' else '{}'::jsonb end) as r(key, value)
      where r.key like 'm:%'
        and r.value ~ '^[0-9]+(\.[0-9]+)?$'
        and r.value::numeric >= 1
    ), '{}'::jsonb),
    'found', coalesce((
      select jsonb_agg(substring(r.key from 3) order by substring(r.key from 3))
      from jsonb_each_text(case when jsonb_typeof(p_data -> 'rolls') = 'object'
                                then p_data -> 'rolls' else '{}'::jsonb end) as r(key, value)
      where r.key like 'i:%'
        and r.value ~ '^[0-9]+(\.[0-9]+)?$'
        and r.value::numeric >= 1
    ), '[]'::jsonb)
  );
$$;

revoke execute on function private.save_collection(jsonb) from public, anon, authenticated;

-- ============================================================
-- 3. THE TRIGGER, WITH ONE MORE FACT IN IT
-- ============================================================
-- 009's function, replaced whole so there is one of it. Everything it already did is unchanged;
-- the collection is the only line added.
create or replace function private.profile_facts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  -- A heartbeat writes last_seen and nothing else and must not pay for a save read, so only a
  -- write that moved updated_at (the game function's) goes looking.
  if tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
    return new;
  end if;

  select s.data into v_data from public.saves s where s.user_id = new.user_id;
  if v_data is null then
    return new;
  end if;

  -- A save that carries junk in any of these leaves the player off that part of the page
  -- rather than failing the write the game function is in the middle of.
  new.klass := case when jsonb_typeof(v_data #> '{player,klass}') = 'string'
                    then v_data #>> '{player,klass}' end;
  new.skin := case when jsonb_typeof(v_data #> '{player,skin}') = 'string'
                   then v_data #>> '{player,skin}' end;
  new.region := case when jsonb_typeof(v_data -> 'region') = 'string'
                     then v_data ->> 'region' end;
  new.kills := case when jsonb_typeof(v_data #> '{stats,kills}') = 'number'
                    then greatest(0, floor((v_data #>> '{stats,kills}')::numeric))::bigint
                    else 0 end;
  new.mastery := case when jsonb_typeof(v_data -> 'mastery') = 'object'
                      then v_data -> 'mastery' else '{}'::jsonb end;
  new.equipment := case when jsonb_typeof(v_data -> 'equipment') = 'object'
                        then v_data -> 'equipment' else '{}'::jsonb end;
  new.stats := case when jsonb_typeof(v_data -> 'stats') = 'object'
                    then v_data -> 'stats' else '{}'::jsonb end;
  new.collection := private.save_collection(v_data);
  return new;
end;
$$;

revoke execute on function private.profile_facts() from public, anon;

drop trigger if exists profiles_facts on public.profiles;
create trigger profiles_facts
  before insert or update on public.profiles
  for each row execute function private.profile_facts();

-- Every profile that already exists. The trigger skips these rows (updated_at does not move),
-- so this is the only thing that fills them in.
update public.profiles p
set collection = private.save_collection(s.data)
from public.saves s
where s.user_id = p.user_id
  and p.collection = '{}'::jsonb;

-- ============================================================
-- 4. THE PROFILE, WITH THE COLLECTION ON IT
-- ============================================================
-- Postgres will not replace a function whose return type changed, so 009's eleven-column
-- version is dropped first. The suites run these files twice; the drop makes both runs behave.
drop function if exists public.player_profile(text);

create or replace function public.player_profile(p_username text)
returns table (
  username text,
  skin text,
  discipline text,
  region text,
  total_level int,
  levels jsonb,
  equipment jsonb,
  stats jsonb,
  mastery jsonb,
  collection jsonb,
  last_seen timestamptz,
  hunting jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name text := lower(btrim(coalesce(p_username, '')));
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if v_name = '' or length(v_name) > 40 then
    raise exception 'No such commander.';
  end if;

  return query
    select p.username,
           p.skin,
           p.klass,
           p.region,
           p.total_level,
           coalesce(p.levels, '{}'::jsonb),
           coalesce(p.equipment, '{}'::jsonb),
           coalesce(p.stats, '{}'::jsonb),
           coalesce(p.mastery, '{}'::jsonb),
           coalesce(p.collection, '{}'::jsonb),
           p.last_seen,
           -- Where they are hunting, if they are. The same row the party page reads.
           case when h.user_id is null then null
                else jsonb_build_object('tier', h.tier, 'zone', h.zone, 'started_at', h.started_at) end
    from public.profiles p
    left join public.hunt_presence h on h.user_id = p.user_id
    where lower(p.username) = v_name
    limit 1;
end;
$$;

revoke execute on function public.player_profile(text) from public, anon;
grant execute on function public.player_profile(text) to authenticated;

commit;
