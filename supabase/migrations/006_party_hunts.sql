-- Respite: party hunts. One shared fight a party, owned and ticked by the game function.
--
-- How to run: after schema.sql and 002 to 005, in the Supabase SQL Editor. Paste the whole file
-- and press Run. Safe to run again (the table and indexes use if not exists, the functions are
-- replaced, the cron job is scheduled by name). It all runs in one transaction, so a failure
-- leaves the database as it was.
--
-- Redeploy the game function with this one. src/server/handler.js gains the party hunt commands
-- (partyHuntStart, partyHuntJoin, partyHuntLeave), the settlement that pays a member their share
-- and the /tick path the cron calls; none of it works without the table below, and the table does
-- nothing without the function.
--
-- ============================================================
-- WHAT THE OPERATOR MUST SET, AND THE FIRST BILL THAT RUNS WHILE NOBODY PLAYS
-- ============================================================
-- A party fight is simulated in JavaScript, so Postgres cannot play it: the tick has to reach the
-- edge function. pg_cron wakes up, pg_net posts to the function, the function plays every live
-- session forward and writes it back. That is one invocation every pass, for as long as any party
-- is out, whether or not a single member has a tab open. It is the first thing in this codebase
-- that costs money at rest, so the job below posts NOTHING when no session is live: an idle realm
-- pays for one cheap index probe a pass and no invocation at all.
--
-- Two values have to be set by hand, in two places, and they must match:
--
--   1. The secret, in the function's environment (Supabase dashboard, Edge Functions, Secrets, or
--      `npx supabase secrets set RESPITE_TICK_SECRET=...`). Make it long and random:
--        select encode(extensions.gen_random_bytes(32), 'hex');
--      Without it the function refuses every tick, which is the safe way round: the tick path
--      carries no user token, so the secret is the only thing standing in front of it.
--
--   2. The secret and the function's URL, here, in private.settings (SQL Editor):
--        insert into private.settings (key, value) values
--          ('party_tick_url', 'https://<project-ref>.supabase.co/functions/v1/game/tick'),
--          ('party_tick_secret', '<the same secret>')
--        on conflict (key) do update set value = excluded.value, updated_at = now();
--      private.settings is readable by nobody but the owner: it is outside public, so PostgREST
--      never publishes it and no client role has a grant on it.
--
-- Also enable the two extensions (dashboard, Database, Extensions, or in the SQL Editor):
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
-- This file tries both itself and carries on with a notice where it cannot have them (PGlite and
-- plain Postgres have neither), so the rest of the migration still runs. Where they are missing,
-- party hunts still work for anybody with a tab open: a member's own request advances their
-- party's session before it settles their share. Only an unwatched party stands still.
--
-- To see what the cron is doing: select * from cron.job_run_details order by start_time desc;
-- and what pg_net made of the posts: select * from net._http_response order by created desc;
--
-- Tests: node tests/server/run.mjs loads this file (twice) and drives the real handler against it;
-- node tests/sql/run.mjs covers schema.sql alone. The dev stage (npm run dev) loads it too.

begin;

-- ============================================================
-- 1. THE TABLE
-- ============================================================
-- One row a session, not one a party, so a party can set out again the moment the last fight
-- closed while a member who was away still has a closed row to settle out of. The partial unique
-- index below is what keeps "at most one live session a party" true.
--
-- The columns, and why each is there rather than inside the blob:
--   party_id    whose hunt it is, and the cascade that takes the row with a disbanded party.
--   tier, zone  the ground, read by every query that picks work up without opening the blob.
--   members     the user ids the session still owes something to. The settlement finds a member's
--               rows through this and not through party_members, so leaving the party (or being
--               kicked) mid-hunt does not strand their share where nothing can reach it.
--   session     the blob: src/shared/partyHunt.js newSession(), stepped by stepSession(). It holds
--               the encounter's seed, the dice POSITION, every hunter's stat line and what each is
--               owed. Authoritative, and never sent anywhere.
--   view        sessionView(session): what a watcher may see. Written by the engine, read by the
--               RPC below. Section 2 says why the row is split this way.
--   clock       the world millisecond the session has been simulated to, as saves.clock is. The
--               rules run on milliseconds, so storing a timestamptz would only add a conversion
--               either side of every tick.
--   started_at  when the party set out, in the same milliseconds. The twelve hour cap is measured
--               off it, as a lone hunt's is off its own start.
--   next_due    the world millisecond of the session's next event (nextSessionDue). The tick reads
--               rows by it, so a fight that is waiting out a walk is not woken to do nothing.
--   over        closed: wiped, capped, or emptied. A closed row stops ticking but stays until
--               everyone it owes has taken their share.
--   over_at     when it closed, so a row nobody came back for can be swept.
--   rev         bumped on every write, the way saves.rev is, so a stuck row is obvious.
create table if not exists public.party_hunts (
  id bigint generated always as identity primary key,
  party_id uuid not null references public.parties (id) on delete cascade,
  tier int not null,
  zone text not null,
  members uuid[] not null default '{}',
  session jsonb not null,
  view jsonb not null default '{}'::jsonb,
  clock bigint not null,
  started_at bigint not null,
  next_due bigint,
  over boolean not null default false,
  over_at bigint,
  rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A party is out once. The handler checks before it inserts; this is what makes it true when two
-- members press the button in the same instant.
create unique index if not exists party_hunts_live_idx
  on public.party_hunts (party_id)
  where not over;

-- What the tick queries: the live sessions with something due, oldest first.
create index if not exists party_hunts_due_idx
  on public.party_hunts (next_due)
  where not over;

-- What a member's own request queries, to settle their share.
create index if not exists party_hunts_members_idx
  on public.party_hunts using gin (members);

-- Closed rows nobody came back for, swept by the tick.
create index if not exists party_hunts_over_idx
  on public.party_hunts (over_at)
  where over;

-- ============================================================
-- 2. WHO MAY READ IT, AND HOW THE DICE STAY IN
-- ============================================================
-- The session blob holds the encounter's seed and, worse, the dice position: the stream state as
-- it stands this instant. A client holding those can run partyHunt.js forward itself and know
-- every blow, every drop and every fall before they land, which is the one thing a server owned
-- fight exists to prevent. It also holds the other members' stat lines and what each of them is
-- owed, which is nobody else's business.
--
-- So the row never leaves the database. Three things in the way, in order:
--   1. No grant. anon and authenticated hold nothing on this table, as with hunt_presence, so
--      PostgREST refuses before RLS is even consulted.
--   2. RLS on with no policy at all, so a grant added here by accident later still reads nothing.
--   3. The only way in is party_hunt_view() below, which selects ONE column, `view`, and that
--      column is written by src/shared/partyHunt.js sessionView() in the game function, never
--      assembled from the blob in SQL. Filtering a blob by hand in SQL is how a seed leaks: one
--      forgotten key in one jsonb expression and the fight is readable. Letting the engine decide
--      what a watcher sees keeps that decision in one tested place (tests/engine/party.test.mjs
--      checks the view carries no seed, no dice and no stat lines).
-- The game function connects as postgres, owns the table and bypasses RLS, and it puts only
-- sessionView() in its replies.
alter table public.party_hunts enable row level security;

revoke all on table public.party_hunts from public, anon, authenticated;

-- Supabase grants new identity sequences to the API roles with the table. Clients never insert.
do $$
declare
  s text;
begin
  s := pg_get_serial_sequence('public.party_hunts', 'id');
  if s is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', s);
  end if;
end $$;

-- What the party page polls between game requests: the fight as a watcher may see it, or null
-- when the party is not out. The same shape the game function returns as `party` in its reply.
create or replace function public.party_hunt_view()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_view jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select h.view into v_view
  from public.party_hunts h
  where h.party_id = (select private.my_party_id())
    and not h.over
  limit 1;

  return v_view;
end;
$$;

revoke execute on function public.party_hunt_view() from public, anon;
grant execute on function public.party_hunt_view() to authenticated;

-- ============================================================
-- 3. WHAT THE TICK NEEDS TO KNOW
-- ============================================================
-- Outside public so PostgREST cannot publish it, and no grants, so only the owner (the SQL Editor
-- and the game function's connection) reads it. The header says what to put in it.
create schema if not exists private;

create table if not exists private.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.settings from public, anon, authenticated;

-- ============================================================
-- 4. THE TICK
-- ============================================================
-- Postgres cannot play a fight written in JavaScript, so this posts to the edge function and lets
-- it do the work. Nothing here waits for the answer: pg_net queues the request and the function
-- writes the sessions back itself. A failed post leaves its trace in net._http_response.
create or replace function private.party_hunt_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  -- The cheapest pass is the one that posts nothing. An idle realm pays for this probe and stops.
  if not exists (select 1 from public.party_hunts where not over) then
    return;
  end if;

  select s.value into v_url from private.settings s where s.key = 'party_tick_url';
  select s.value into v_secret from private.settings s where s.key = 'party_tick_secret';
  if v_url is null or v_secret is null then
    raise notice 'party_tick_url or party_tick_secret is not set in private.settings: party hunts will only move for members with a tab open.';
    return;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post'
  ) then
    raise notice 'pg_net is not installed: the party hunt tick cannot reach the game function.';
    return;
  end if;

  -- The secret is the whole door: the tick path carries no user token, and it writes every live
  -- session, so it is never sent anywhere but the function's own URL.
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('tick', true),
    headers := jsonb_build_object('content-type', 'application/json', 'x-respite-tick', v_secret),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke execute on function private.party_hunt_tick() from public, anon, authenticated;

-- ============================================================
-- 5. THE CLOCK BEHIND IT
-- ============================================================
-- Guarded every way, because this file must run on a database with neither extension (PGlite, the
-- dev stage and plain Postgres all lack them) and leave everything above it in place. Where they
-- are missing the notice says so and party hunts still move whenever a member is online.
do $$
declare
  v_schedule text := '30 seconds';
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception
    when others then
      raise notice 'pg_cron could not be installed here (%): the party hunt tick is not scheduled.', sqlerrm;
  end;

  begin
    execute 'create extension if not exists pg_net';
  exception
    when others then
      raise notice 'pg_net could not be installed here (%): the party hunt tick cannot post.', sqlerrm;
  end;

  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not available: schedule private.party_hunt_tick() by hand once it is.';
    return;
  end if;

  -- cron.schedule replaces a job of the same name, so running this file again reschedules rather
  -- than stacking a second job. Seconds level schedules want pg_cron 1.5 or newer; on anything
  -- older a minute is the floor and the tick simply lands less often.
  begin
    perform cron.schedule('respite-party-tick', v_schedule, 'select private.party_hunt_tick()');
  exception
    when others then
      begin
        perform cron.schedule('respite-party-tick', '* * * * *', 'select private.party_hunt_tick()');
        raise notice 'pg_cron would not take a % schedule (%): the tick runs once a minute instead.', v_schedule, sqlerrm;
      exception
        when others then
          raise notice 'pg_cron would not take a schedule at all (%): the tick is not scheduled.', sqlerrm;
      end;
  end;
end $$;

commit;
