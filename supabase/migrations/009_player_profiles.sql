-- Respite: a commander anyone can look at.
--
-- How to run: after schema.sql and 002-008, in the Supabase SQL Editor. Paste the whole file and
-- press Run. Safe to run again (columns use if not exists, functions and the trigger are
-- replaced, the backfill only recomputes). One transaction, so a failure leaves the database
-- as it was.
--
-- Optional, not required: without this file the Leaderboard still ranks every board and the
-- names on it simply are not clickable, because player_profile() is not there to ask. The
-- pattern is 004's and 008's: a page tells "the realm does not keep this yet" (no such
-- function) from "the realm did not answer" (anything else).
--
-- Nothing in src/server changes. Everything published here already sits in the save the game
-- function writes, and it writes the save before the profile in the same transaction, so the
-- trigger reads it back out of saves.data as the profile row is written.
--
-- WHAT IS PUBLIC, AND WHY
-- A profile is a commander as the realm sees them: their skin, their discipline, the ground
-- they stand on, their levels, what they are wearing and what they have done. Worn gear is
-- public on purpose -- it is what makes a profile worth opening, and it is the only way one
-- player can learn what a build looks like from another. What stays private is everything a
-- profile is not: stored items, gold, the market, the post, and any save field not named here.

begin;

-- ============================================================
-- 1. WHAT A PROFILE SHOWS
-- ============================================================
-- profiles_select_all lets any signed in player read every profile row, so these are public
-- facts by design: they are exactly what the profile page puts on screen.

alter table public.profiles add column if not exists skin text;
alter table public.profiles add column if not exists region text;
alter table public.profiles add column if not exists equipment jsonb not null default '{}';
alter table public.profiles add column if not exists stats jsonb not null default '{}';

-- 004 owns this trigger function and 008 extended it; this is the same body plus the four
-- above. Running an earlier migration after this one would undo it.
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
  return new;
end;
$$;

revoke execute on function private.profile_facts() from public, anon;

drop trigger if exists profiles_facts on public.profiles;
create trigger profiles_facts
  before insert or update on public.profiles
  for each row execute function private.profile_facts();

-- Every profile that already exists. The trigger skips these rows (updated_at does not move),
-- so the values here are the final word.
update public.profiles p
set skin = case when jsonb_typeof(s.data #> '{player,skin}') = 'string'
                then s.data #>> '{player,skin}' end,
    region = case when jsonb_typeof(s.data -> 'region') = 'string'
                  then s.data ->> 'region' end,
    equipment = case when jsonb_typeof(s.data -> 'equipment') = 'object'
                     then s.data -> 'equipment' else '{}'::jsonb end,
    stats = case when jsonb_typeof(s.data -> 'stats') = 'object'
                 then s.data -> 'stats' else '{}'::jsonb end
from public.saves s
where s.user_id = p.user_id;

-- ============================================================
-- 2. ONE COMMANDER, BY NAME
-- ============================================================
-- Looked up case insensitively, because it is reached by clicking a name off a board or a
-- party roster and those carry whatever case the player signed up with. profiles has a
-- lower(username) index already (schema.sql, for party_invite), so this is a lookup and not
-- a scan.
--
-- Item keys come back exactly as the save holds them. Every name, stat, rarity and enchant
-- level is derived from the key in JS by the one registry both sides share, so the database
-- never has an opinion about what a piece of gear is worth and can never disagree with the
-- client about it.

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

-- ============================================================
-- 3. SKINS ON THE BOARDS AND THE ROSTER
-- ============================================================
-- A board row and a party member carry a skin now, so a face can stand where an initial in a
-- circle used to. Both are replaced rather than extended: they are this file's to own from
-- here, and each returns the same shape it did plus `skin`.

-- Postgres will not replace a function whose return type changed, so 008's four-column
-- version is dropped first. Nothing holds a reference to it: the client asks by name.
drop function if exists public.mastery_board(text, int);

create or replace function public.mastery_board(p_line text, p_limit int default 50)
returns table (rank bigint, username text, level int, xp numeric, discipline text, skin text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_line text := lower(btrim(coalesce(p_line, '')));
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if v_line !~ '^[a-z_]{1,32}$' then
    raise exception 'Unknown board.';
  end if;

  return query
    select row_number() over (order by s.n desc, s.who), s.who, null::int, s.n, s.kl, s.sk
    from (
      select p.username as who, p.klass as kl, p.skin as sk,
             case when jsonb_typeof(p.mastery -> v_line) = 'number'
                  then (p.mastery ->> v_line)::numeric end as n
      from public.profiles p
    ) s
    where s.n > 0
    order by 1
    limit v_limit;
end;
$$;

revoke execute on function public.mastery_board(text, int) from public, anon;
grant execute on function public.mastery_board(text, int) to authenticated;

commit;
