-- Respite: the weapon mastery boards, and the Saint.
--
-- How to run: after schema.sql, 002, 003 and 004, in the Supabase SQL Editor. Paste the whole
-- file and press Run. Safe to run again (the column uses if not exists, the functions and the
-- trigger are replaced, the backfill only recomputes). It all runs in one transaction, so a
-- failure leaves the database as it was.
--
-- Optional, not required: without this file the Mastery page still shows every line, its level,
-- its grade and its milestones. Only the rank line and the Saint mark go quiet, because
-- mastery_ranks() is not there to ask -- the same way the page tells "the realm does not keep
-- this yet" from "the realm did not answer" everywhere else.
--
-- Nothing in src/server changes, so the game function does not need redeploying. Mastery already
-- sits in the save the function writes (state.mastery), and it writes the save before the
-- profile in the same transaction, so a trigger on profiles reads it back out of saves.data as
-- the profile row is written -- exactly as 004 does for klass and kills.
--
-- WHY POINTS AND NOT LEVELS
-- The board ranks on raw mastery points, not on the level they come to. Two hunters at 100 are
-- not equal and the realm should be able to say which of them got there first and kept going;
-- levels would tie thousands of people at the top of a track that never ends. The level shown
-- beside a rank is worked out in JS from the same points, by the one curve in CONFIG.

begin;

-- ============================================================
-- 1. WHAT THE BOARDS RANK BY
-- ============================================================
-- profiles_select_all lets any signed in player read every profile row, so this is a public
-- fact by design: it is exactly what the boards put on screen.

alter table public.profiles add column if not exists mastery jsonb not null default '{}';

-- 004 already owns this trigger function; this replaces it with the same body plus mastery, so
-- running 008 without 004 is not a thing anyone should do and running 004 after 008 undoes it.
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

  -- A save that carries junk in any of these leaves the player off those boards rather than
  -- failing the write the game function is in the middle of.
  new.klass := case when jsonb_typeof(v_data #> '{player,klass}') = 'string'
                    then v_data #>> '{player,klass}' end;
  new.kills := case when jsonb_typeof(v_data #> '{stats,kills}') = 'number'
                    then greatest(0, floor((v_data #>> '{stats,kills}')::numeric))::bigint
                    else 0 end;
  new.mastery := case when jsonb_typeof(v_data -> 'mastery') = 'object'
                      then v_data -> 'mastery'
                      else '{}'::jsonb end;
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
set mastery = case when jsonb_typeof(s.data -> 'mastery') = 'object'
                   then s.data -> 'mastery'
                   else '{}'::jsonb end
from public.saves s
where s.user_id = p.user_id;

-- ============================================================
-- 2. THE BOARDS
-- ============================================================
-- One board a line: 'mastery_sword', 'mastery_shield', and so on. The line is not checked
-- against a list here on purpose -- the registry in JS owns which lines exist and which are
-- released, and a board for a line nobody has points in simply comes back empty rather than
-- raising. That way shipping a new weapon needs no migration.
--
-- Ties fall back to username so pages are stable, as every other board does. `level` is left
-- null: the mastery curve lives in CONFIG and the page reads the level off the points it is
-- handed, so the curve can be retuned without a database change.

create or replace function public.mastery_board(p_line text, p_limit int default 50)
returns table (rank bigint, username text, level int, xp numeric, discipline text)
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
  -- A line is a bare identifier. Anything else is a caller with ideas.
  if v_line !~ '^[a-z_]{1,32}$' then
    raise exception 'Unknown board.';
  end if;

  return query
    select row_number() over (order by s.n desc, s.who),
           s.who,
           null::int,
           s.n,
           s.kl
    from (
      select p.username as who,
             p.klass as kl,
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

-- ============================================================
-- 3. WHERE THE CALLER STANDS, ON EVERY LINE AT ONCE
-- ============================================================
-- The Mastery page wants one thing the board cannot give it: your own rank, which is usually
-- not in the top fifty. One call answers for every line you have points in, so the page asks
-- once on mount rather than seven times, and a rank of 1 is what lights the Saint.
--
-- `total` is how many players have any points on that line, so the page can say "3 of 412"
-- rather than a bare number, and can tell an empty realm from a crowded one.

create or replace function public.mastery_ranks()
returns table (line text, points numeric, rank bigint, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  return query
    with mine as (
      select k.key as line, (k.value #>> '{}')::numeric as n
      from public.profiles p
      cross join lateral jsonb_each(p.mastery) k
      where p.user_id = v_uid
        and jsonb_typeof(k.value) = 'number'
        and (k.value #>> '{}')::numeric > 0
    ),
    everyone as (
      select k.key as line, (k.value #>> '{}')::numeric as n
      from public.profiles p
      cross join lateral jsonb_each(p.mastery) k
      where jsonb_typeof(k.value) = 'number'
        and (k.value #>> '{}')::numeric > 0
    )
    select m.line,
           m.n,
           (select count(*) + 1 from everyone e where e.line = m.line and e.n > m.n),
           (select count(*) from everyone e where e.line = m.line)
    from mine m
    order by m.line;
end;
$$;

revoke execute on function public.mastery_ranks() from public, anon;
grant execute on function public.mastery_ranks() to authenticated;

-- A realm of any size sorts a few thousand rows in memory, as the other boards do. An
-- expression index per line would have to cast a value out of jsonb on every profile write,
-- and a save with junk in it would then fail the write instead of just missing the board --
-- the same reasoning 004 gives for leaving the Hunt boards unindexed.

commit;
