-- Respite: the Leaderboard boards profiles could not answer.
--
-- How to run: after schema.sql, 002 and 003, in the Supabase SQL Editor. Paste the whole file
-- and press Run. Safe to run again (columns use if not exists, the function and trigger are
-- replaced, the backfill only recomputes). It all runs in one transaction, so a failure leaves
-- the database as it was.
--
-- Optional, not required: Total, the five trades and the five benches are answered by
-- hiscores() in schema.sql and keep working without this file. Until it is run, the Leaderboard
-- page says the Hunt and Monsters killed boards are not kept yet, because leaderboard() is not
-- there to ask.
--
-- Nothing in src/server changes, so the game function does not need redeploying. Both facts the
-- new boards rank by already sit in the save the function writes (player.klass, stats.kills),
-- and it writes the save before the profile in the same transaction, so a trigger on profiles
-- can read them back out of saves.data as the profile row is written. Keeping it in SQL means a
-- realm lights these boards up with one query and no deploy.
--
-- Tests: node tests/sql/run.mjs covers schema.sql only; the dev stage (npm run dev) loads this
-- file after the schema, so the boards are live there.

begin;

-- ============================================================
-- 1. WHAT THE NEW BOARDS RANK BY
-- ============================================================
-- profiles_select_all lets any signed in player read every profile row, so these two are public
-- facts by design: they are exactly what the boards put on screen.

alter table public.profiles add column if not exists klass text;
alter table public.profiles add column if not exists kills bigint not null default 0;

-- Outside public so PostgREST does not publish a trigger function as an RPC, the way
-- private.my_party_id() stays out of the API.
create schema if not exists private;

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

  -- A save that carries junk in either place leaves the player off the boards rather than
  -- failing the write the game function is in the middle of.
  new.klass := case when jsonb_typeof(v_data #> '{player,klass}') = 'string'
                    then v_data #>> '{player,klass}' end;
  new.kills := case when jsonb_typeof(v_data #> '{stats,kills}') = 'number'
                    then greatest(0, floor((v_data #>> '{stats,kills}')::numeric))::bigint
                    else 0 end;
  return new;
end;
$$;

revoke execute on function private.profile_facts() from public, anon;

drop trigger if exists profiles_facts on public.profiles;
create trigger profiles_facts
  before insert or update on public.profiles
  for each row execute function private.profile_facts();

-- Every profile that already exists, including the bare ones 003 made for v4 players. The
-- trigger skips these rows (updated_at does not move), so the values here are the final word.
update public.profiles p
set klass = case when jsonb_typeof(s.data #> '{player,klass}') = 'string'
                 then s.data #>> '{player,klass}' end,
    kills = case when jsonb_typeof(s.data #> '{stats,kills}') = 'number'
                 then greatest(0, floor((s.data #>> '{stats,kills}')::numeric))::bigint
                 else 0 end
from public.saves s
where s.user_id = p.user_id;

-- The kills board reads one narrow column, so it gets the index. The Hunt boards sort on
-- skills->>'warfare' and there is no index for that here: an expression index would have to
-- cast a value out of jsonb on every profile write, and a save with junk in it would then fail
-- the write instead of just missing the board. Total level sorts unindexed in schema.sql for
-- the same kind of reason; a realm this size sorts a few thousand rows in memory.
create index if not exists profiles_kills_idx on public.profiles (kills desc) where kills > 0;

-- ============================================================
-- 2. THE BOARDS
-- ============================================================
-- Separate from hiscores() on purpose: a realm without this file keeps every board hiscores()
-- answers, and the page can tell "the realm does not keep this yet" (no such function) from
-- "the realm did not answer" (anything else).
--
-- Boards: 'kills', 'hunt_warrior', 'hunt_rogue', 'hunt_mage'. Ties fall back to username so
-- pages are stable, as the skill boards do. discipline is the player's klass, null for a player
-- who has not sworn one, and null on every board where it means nothing.

create or replace function public.leaderboard(p_board text default 'kills', p_limit int default 50)
returns table (rank bigint, username text, level int, xp numeric, discipline text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_board text := lower(btrim(coalesce(p_board, '')));
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
  v_class text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if v_board = 'kills' then
    return query
      select row_number() over (order by s.n desc, s.who),
             s.who,
             null::int,
             s.n::numeric,
             null::text
      from (
        select p.username as who, p.kills as n
        from public.profiles p
        where p.kills > 0
      ) s
      order by 1
      limit v_limit;
    return;
  end if;

  v_class := case v_board
    when 'hunt_warrior' then 'warrior'
    when 'hunt_rogue' then 'rogue'
    when 'hunt_mage' then 'mage'
  end;
  if v_class is null then
    raise exception 'Unknown board.';
  end if;

  -- A player who has sworn no discipline stands on all three boards, ranked by the same raw
  -- Hunt level as everyone else: nothing is specialised yet, so nothing is left out. A klass
  -- that names no discipline stands on none of them.
  return query
    select row_number() over (order by s.x desc, s.who),
           s.who,
           s.lvl,
           s.x,
           s.kl
    from (
      select p.username as who,
             p.klass as kl,
             case when jsonb_typeof(p.skills -> 'warfare') = 'number'
                  then (p.skills ->> 'warfare')::numeric end as x,
             case when jsonb_typeof(p.levels -> 'warfare') = 'number'
                  then floor((p.levels ->> 'warfare')::numeric)::int end as lvl
      from public.profiles p
      where p.klass is null or p.klass = v_class
    ) s
    where s.x > 0
    order by 1
    limit v_limit;
end;
$$;

revoke execute on function public.leaderboard(text, int) from public, anon;
grant execute on function public.leaderboard(text, int) to authenticated;

-- ============================================================
-- 3. WEALTH: NOT WRITTEN HERE, AND WHY
-- ============================================================
-- The Wealth board is meant to rank the value of what a player gathered and made themselves,
-- and to count nothing that was traded for, so a rich player cannot buy their way up it. The
-- save (schema 9) cannot tell that story yet, so there is no wealth board in this file. What is
-- there to go on:
--
--   Gear: an item key carries a uid whose first letter records where the piece came from
--   ("slag_sword|rare|c17.42"): c crafted, f found on a kill, s a Sovereign's piece, m bought on
--   the market (src/shared/items.js). So uncommon and better gear can be told apart, and c is
--   self-crafted. Common gear stacks as "slag_sword|common" with no uid at all, so a sword the
--   player forged and one they bought are the same stack and cannot be separated.
--
--   Materials: a stack is just "slag_delve". A dug ore, a skinned hide and a bought one share
--   one key. There is no provenance on materials whatsoever, so "self-gathered materials", the
--   larger half of the board, cannot be measured at any accuracy.
--
-- Writing the sum of every pool here would count bought goods as self-made, which is the one
-- thing the board exists to refuse, so it is not written. What the engine would have to keep
-- first, either of:
--
--   1. A running value in the save, say stats.selfMade, added to when a gather action yields a
--      material and when a craft finishes, and never on a market buy or a shop buy. Then the
--      board is a kills board in a different column, and this file's trigger pulls it out of
--      saves.data next to stats.kills.
--   2. Provenance per stack, which means splitting material stacks by source. That is a change
--      to the storage rules and every page that reads a pool, for a leaderboard.
--
-- (1) is the cheap one and the one the board was specified for. Until a save carries it, the
-- page says the board is not kept yet.

commit;
