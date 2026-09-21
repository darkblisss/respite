-- Respite: the face that is already on a profile, on the board that lists it.
--
-- How to run: after schema.sql and 002-011, in the Supabase SQL Editor. Paste the whole file
-- and press Run. Safe to run again. One transaction, so a failure leaves the database as it was.
--
-- Optional, not required: without this file every board still ranks exactly as it does now and
-- every row simply wears the default bust, which is what they all wear today.
--
-- WHY
-- profiles.skin has been published since 009, and mastery_board() has returned it since. The
-- other two boards were written before it existed and never went back for it, so hiscores()
-- and leaderboard() answer without a skin and the page falls back to the default bust for
-- everyone -- a board of four commanders wearing one face. Nothing is being made public here
-- that was not already: a profile page shows the same skin to the same signed-in callers.
--
-- A function's return type cannot be widened in place, so each one is dropped and recreated.
-- The bodies are 005's and schema.sql's, unchanged apart from carrying p.skin through.

begin;

-- ============================================================
-- 1. hiscores(): total level and the per-skill boards
-- ============================================================

drop function if exists public.hiscores(text, int);

create or replace function public.hiscores(p_skill text default 'total', p_limit int default 50)
returns table (rank bigint, username text, level int, xp numeric, skin text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_skill text := lower(btrim(coalesce(p_skill, 'total')));
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if v_skill !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'Unknown skill.';
  end if;

  if v_skill = 'total' then
    return query
      select row_number() over (order by s.total_level desc, s.xp desc, s.username),
             s.username,
             s.total_level,
             s.xp,
             s.sk
      from (
        select p.username,
               p.total_level,
               p.skin as sk,
               (
                 select coalesce(sum((e.value #>> '{}')::numeric), 0)
                 from jsonb_each(case when jsonb_typeof(p.skills) = 'object' then p.skills else '{}'::jsonb end) e
                 where jsonb_typeof(e.value) = 'number'
               ) as xp
        from public.profiles p
      ) s
      order by 1
      limit v_limit;
  else
    return query
      select row_number() over (order by s.xp desc, s.username),
             s.username,
             s.level,
             s.xp,
             s.sk
      from (
        select p.username,
               p.skin as sk,
               case when jsonb_typeof(p.skills -> v_skill) = 'number'
                    then (p.skills ->> v_skill)::numeric end as xp,
               case when jsonb_typeof(p.levels -> v_skill) = 'number'
                    then floor((p.levels ->> v_skill)::numeric)::int end as level
        from public.profiles p
      ) s
      where s.xp > 0
      order by 1
      limit v_limit;
  end if;
end;
$$;

revoke execute on function public.hiscores(text, int) from public, anon;
grant execute on function public.hiscores(text, int) to authenticated;

-- ============================================================
-- 2. leaderboard(): kills, wealth and the three Hunt boards
-- ============================================================

drop function if exists public.leaderboard(text, int);

create or replace function public.leaderboard(p_board text default 'kills', p_limit int default 50)
returns table (rank bigint, username text, level int, xp numeric, discipline text, skin text)
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
             null::text,
             s.sk
      from (
        select p.username as who,
               p.skin as sk,
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
           s.kl,
           s.sk
    from (
      select p.username as who,
             p.klass as kl,
             p.skin as sk,
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
