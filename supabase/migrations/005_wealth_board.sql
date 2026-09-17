-- Respite: the Wealth board.
--
-- How to run: after schema.sql, 002, 003 and 004, in the Supabase SQL Editor. Paste the whole
-- file and press Run. Safe to run again (the column uses if not exists, the function and trigger
-- are replaced, the backfill only recomputes). It all runs in one transaction, so a failure
-- leaves the database as it was.
--
-- THIS ONE NEEDS THE GAME FUNCTION REDEPLOYED FIRST, unlike 004. The value it ranks by,
-- stats.selfMade, did not exist in the save before engine 4: src/shared/skills.js now adds to it
-- as an action completes. Run this file against a realm still on an older engine and every
-- player reads as zero until their save is written by the new one, which is harmless but means
-- an empty board. Deploy the client and the edge function, then run this.
--
-- 004's section 3 set out why this could not be written then, and which of the two ways it
-- chose. This is way (1): a running value in the save rather than provenance per stack.
--
-- WHAT IT MEASURES, precisely, because the name invites a wrong reading: the gold value a player
-- has *created*, summed as it was created. A gathered material counts at its value the moment it
-- comes out of the ground; a craft counts its output less the materials it ate, so an ore dug
-- and then smelted is counted once, for the ore plus what smelting added. It is a lifetime total
-- and it never falls: selling, losing or spending what you made does not take it back off you.
--
-- What it deliberately does not count: anything bought from the market or a shop, requisitioned,
-- smuggled, mailed, or taken off a corpse. That is the point of the board. A player cannot buy a
-- rank on it, which is what Wealth was asked for, and it needs no per-stack provenance to say so.
--
-- The honest caveat, worth a line on the page: this ranks what a player has *produced*, not what
-- they are *holding*. Holdings restricted to self-made items would need way (2), splitting
-- material stacks by source, which is a change to the storage rules and every page that reads a
-- pool. If that is ever wanted, this column stays useful and the board changes what it reads.

begin;

-- ============================================================
-- 1. THE COLUMN
-- ============================================================
-- profiles_select_all lets any signed in player read every profile row, so this is a public fact
-- by design: it is exactly what the board puts on screen.

alter table public.profiles add column if not exists self_made bigint not null default 0;

-- 004's trigger, with the third fact folded in. Replaced whole rather than chained, so there is
-- one function reading one save row per profile write instead of two.
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

  -- A save that carries junk in any of these leaves the player off that board rather than
  -- failing the write the game function is in the middle of.
  new.klass := case when jsonb_typeof(v_data #> '{player,klass}') = 'string'
                    then v_data #>> '{player,klass}' end;
  new.kills := case when jsonb_typeof(v_data #> '{stats,kills}') = 'number'
                    then greatest(0, floor((v_data #>> '{stats,kills}')::numeric))::bigint
                    else 0 end;
  new.self_made := case when jsonb_typeof(v_data #> '{stats,selfMade}') = 'number'
                        then greatest(0, floor((v_data #>> '{stats,selfMade}')::numeric))::bigint
                        else 0 end;
  return new;
end;
$$;

revoke execute on function private.profile_facts() from public, anon;

-- The trigger itself is unchanged, but recreating it is free and keeps this file runnable on a
-- realm where 004 was never applied by hand.
drop trigger if exists profiles_facts on public.profiles;
create trigger profiles_facts
  before insert or update on public.profiles
  for each row execute function private.profile_facts();

-- Every profile that already exists. A save written by an older engine has no stats.selfMade, so
-- it lands at zero and rises from the next action that player takes. Nothing is invented for
-- work they did before the engine started counting: a made-up number would rank above players
-- who actually earned theirs.
update public.profiles p
set self_made = case when jsonb_typeof(s.data #> '{stats,selfMade}') = 'number'
                     then greatest(0, floor((s.data #>> '{stats,selfMade}')::numeric))::bigint
                     else 0 end
from public.saves s
where s.user_id = p.user_id;

create index if not exists profiles_self_made_idx on public.profiles (self_made desc) where self_made > 0;

-- ============================================================
-- 2. THE BOARD
-- ============================================================
-- 004's leaderboard(), with 'wealth' added. Replaced whole for the same reason as the trigger:
-- one function, one place to read. Every other board in it is byte for byte 004's.

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

  -- Two boards that are one narrow column and a name. xp carries the figure; level means
  -- nothing on either, so it is null rather than a zero a page might print.
  if v_board in ('kills', 'wealth') then
    return query
      select row_number() over (order by s.n desc, s.who),
             s.who,
             null::int,
             s.n::numeric,
             null::text
      from (
        select p.username as who,
               case when v_board = 'kills' then p.kills else p.self_made end as n
        from public.profiles p
      ) s
      where s.n > 0
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

commit;
