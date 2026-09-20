-- Respite: database schema (Supabase Postgres).
--
-- How to run: Supabase dashboard, SQL Editor, New query. Paste this whole file and press Run.
-- The editor may warn about destructive statements: the only drops are policies, recreated below.
-- Safe to run again: tables and indexes use if not exists, functions use create or replace,
-- and every policy is dropped before it is created. It all runs in one transaction, so a
-- failure leaves the database as it was.
--
-- Expects what a Supabase project already has: auth.users, auth.uid(), the roles anon,
-- authenticated and service_role, the supabase_realtime publication, and public.saves.
--
-- Tests: node tests/sql/run.mjs (PGlite, with tests/sql/stubs.sql standing in for Supabase).
--
-- Writers: the game function connects as postgres (owner of these tables, so RLS does not
-- apply to it). Browsers only read through the policies below and change parties through RPCs.

begin;

-- ============================================================
-- 1. TABLES
-- ============================================================

-- Only a fresh project lacks saves; on a live one this is a no op.
create table if not exists public.saves (
  user_id uuid primary key,
  username text,
  data jsonb,
  updated_at timestamptz
);

alter table public.saves add column if not exists rev bigint not null default 0;
alter table public.saves add column if not exists engine int;
alter table public.saves add column if not exists clock bigint;

create table if not exists public.profiles (
  user_id uuid primary key,
  username text unique not null,
  -- The face a party square and a board row draw. Migration 009 adds it to a realm
  -- that predates it and fills it; here it is so a fresh one needs no migration to
  -- run party_state, which reads it.
  skin text,
  total_level int not null default 0,
  levels jsonb not null default '{}',
  skills jsonb not null default '{}',
  last_seen timestamptz,
  activity jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists profiles_last_seen_idx on public.profiles (last_seen);
-- party_invite looks names up case insensitively.
create index if not exists profiles_username_lower_idx on public.profiles (lower(username));

create table if not exists public.hunt_presence (
  user_id uuid primary key,
  tier int not null,
  zone text not null,
  started_at timestamptz not null,
  ends_by timestamptz not null,
  ended_at timestamptz,
  updated_at timestamptz default now()
);

-- item_kind and qty_left <= qty are checked here too, so a bad write from the game function
-- fails instead of minting stock.
create table if not exists public.market_listings (
  id bigint generated always as identity primary key,
  seller_id uuid not null,
  seller_name text not null,
  item_key text not null,
  item_base text not null,
  item_name text not null,
  item_kind text not null constraint market_listings_item_kind_check check (item_kind in ('material', 'gear', 'tool')),
  item_tier int,
  rarity text,
  qty int not null check (qty > 0),
  qty_left int not null check (qty_left >= 0),
  price_each bigint not null check (price_each between 1 and 1000000000),
  status text not null default 'open' check (status in ('open', 'sold', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint market_listings_qty_left_within_qty check (qty_left <= qty)
);

create index if not exists market_listings_status_item_name_idx on public.market_listings (status, item_name);
create index if not exists market_listings_status_price_each_idx on public.market_listings (status, price_each);
create index if not exists market_listings_seller_status_idx on public.market_listings (seller_id, status);

create table if not exists public.market_sales (
  id bigint generated always as identity primary key,
  listing_id bigint,
  seller_id uuid,
  buyer_id uuid,
  item_key text,
  item_name text,
  qty int,
  price_each bigint,
  fee bigint,
  created_at timestamptz default now()
);

-- The select policy filters on both sides of a sale.
create index if not exists market_sales_seller_idx on public.market_sales (seller_id, created_at desc);
create index if not exists market_sales_buyer_idx on public.market_sales (buyer_id, created_at desc);

-- Mail is claimed straight into a save, so nothing negative or keyless may sit in it.
create table if not exists public.mail (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null constraint mail_kind_check check (kind in ('gold', 'item')),
  gold bigint not null default 0 constraint mail_gold_check check (gold >= 0),
  item_key text,
  qty int not null default 0 constraint mail_qty_check check (qty >= 0),
  note text not null default '',
  created_at timestamptz default now(),
  claimed_at timestamptz,
  constraint mail_item_has_key check (kind <> 'item' or (item_key is not null and qty > 0))
);

create index if not exists mail_unclaimed_idx on public.mail (user_id) where claimed_at is null;

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  leader_id uuid not null,
  created_at timestamptz default now()
);

create table if not exists public.party_members (
  party_id uuid references public.parties (id) on delete cascade,
  user_id uuid not null unique,
  username text not null,
  joined_at timestamptz default now(),
  primary key (party_id, user_id)
);

create table if not exists public.party_invites (
  id bigint generated always as identity primary key,
  party_id uuid references public.parties (id) on delete cascade,
  from_id uuid,
  from_name text,
  to_id uuid,
  to_name text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz default now()
);

-- Backs up the duplicate check in party_invite, even if two calls ever slip past the lock.
create unique index if not exists party_invites_one_pending_idx on public.party_invites (party_id, to_id) where status = 'pending';
create index if not exists party_invites_party_idx on public.party_invites (party_id, status);
create index if not exists party_invites_to_idx on public.party_invites (to_id, status);
create index if not exists party_invites_from_idx on public.party_invites (from_id);

create table if not exists public.party_messages (
  id bigint generated always as identity primary key,
  party_id uuid references public.parties (id) on delete cascade,
  user_id uuid not null,
  username text not null,
  body text not null check (char_length(body) between 1 and 240),
  created_at timestamptz default now()
);

create index if not exists party_messages_party_created_idx on public.party_messages (party_id, created_at desc, id desc);

-- ============================================================
-- 2. ROW LEVEL SECURITY AND GRANTS
-- ============================================================

alter table public.saves enable row level security;
alter table public.profiles enable row level security;
alter table public.hunt_presence enable row level security;
alter table public.market_listings enable row level security;
alter table public.market_sales enable row level security;
alter table public.mail enable row level security;
alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.party_invites enable row level security;
alter table public.party_messages enable row level security;

-- Supabase grants every new table in public to anon and authenticated. Take all of it back
-- (TRUNCATE ignores RLS), then hand authenticated SELECT only where a policy allows reads.
-- hunt_presence gets nothing: clients see it through party_state().
revoke all on table
  public.saves, public.profiles, public.hunt_presence, public.market_listings, public.market_sales,
  public.mail, public.parties, public.party_members, public.party_invites, public.party_messages
from public, anon, authenticated;

grant select on table
  public.saves, public.profiles, public.market_listings, public.market_sales,
  public.mail, public.parties, public.party_members, public.party_invites, public.party_messages
to authenticated;

-- The identity sequences come with the same default grants. Clients never insert.
do $$
declare
  t text;
  s text;
begin
  foreach t in array array['market_listings', 'market_sales', 'mail', 'party_invites', 'party_messages'] loop
    s := pg_get_serial_sequence(format('public.%I', t), 'id');
    if s is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', s);
    end if;
  end loop;
end $$;

-- A policy on party_members that reads party_members recurses, so the party policies ask
-- this helper instead. It sits outside public so the API does not publish it as an RPC, and
-- it returns null rather than raising, because it runs inside policies (Realtime included).
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.my_party_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.party_id from public.party_members m where m.user_id = auth.uid()
$$;

revoke execute on function private.my_party_id() from public, anon;
grant execute on function private.my_party_id() to authenticated;

-- Old policies on saves have unknown names, and a stray permissive policy on any of these
-- tables would widen access, so every policy on them goes before the listed ones return.
do $$
declare
  r record;
begin
  for r in
    select p.schemaname, p.tablename, p.policyname
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('saves', 'profiles', 'hunt_presence', 'market_listings', 'market_sales',
                          'mail', 'parties', 'party_members', 'party_invites', 'party_messages')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

drop policy if exists saves_select_own on public.saves;
create policy saves_select_own on public.saves
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to authenticated
  using (true);

drop policy if exists market_listings_select_open_or_own on public.market_listings;
create policy market_listings_select_open_or_own on public.market_listings
  for select to authenticated
  using (status = 'open' or seller_id = (select auth.uid()));

drop policy if exists market_sales_select_party_to_sale on public.market_sales;
create policy market_sales_select_party_to_sale on public.market_sales
  for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

drop policy if exists mail_select_own on public.mail;
create policy mail_select_own on public.mail
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists parties_select_member on public.parties;
create policy parties_select_member on public.parties
  for select to authenticated
  using (id = (select private.my_party_id()));

drop policy if exists party_members_select_same_party on public.party_members;
create policy party_members_select_same_party on public.party_members
  for select to authenticated
  using (party_id = (select private.my_party_id()));

drop policy if exists party_invites_select_sender_or_recipient on public.party_invites;
create policy party_invites_select_sender_or_recipient on public.party_invites
  for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

drop policy if exists party_messages_select_member on public.party_messages;
create policy party_messages_select_member on public.party_messages
  for select to authenticated
  using (party_id = (select private.my_party_id()));

-- ============================================================
-- 3. PRESENCE AND HISCORES
-- ============================================================
-- Every function names its tables with public. so a temp table can never stand in for one.

create or replace function public.heartbeat(p_activity jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  -- Every signed in player can read activity, so it stays a small object. JSON null means none.
  if jsonb_typeof(p_activity) = 'null' then
    p_activity := null;
  end if;
  if p_activity is not null then
    if jsonb_typeof(p_activity) <> 'object' then
      raise exception 'Activity must be an object.';
    end if;
    if octet_length(p_activity::text) > 2048 then
      raise exception 'Activity is too large.';
    end if;
  end if;

  update public.profiles
  set last_seen = now(),
      activity = coalesce(p_activity, activity)
  where user_id = v_uid;
end;
$$;

create or replace function public.online_count()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  return (
    select count(*)::int
    from public.profiles p
    where p.last_seen > now() - interval '3 minutes'
  );
end;
$$;

-- Levels come from profiles.levels as the game function wrote them; the XP curve lives in JS.
-- A skill board lists only players with xp in that skill. Ties fall back to username so pages
-- are stable. Values that are not JSON numbers are skipped rather than failing the board.
create or replace function public.hiscores(p_skill text default 'total', p_limit int default 50)
returns table (rank bigint, username text, level int, xp numeric)
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
             s.xp
      from (
        select p.username,
               p.total_level,
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
             s.xp
      from (
        select p.username,
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

-- ============================================================
-- 4. PARTIES
-- ============================================================
-- Lock order, everywhere: the caller's profile row, then the party row, then invite, member
-- and message rows. The profile lock keeps one player's create, accept and leave from
-- interleaving; the party row lock serialises size checks, joins and leader changes.
-- Names and chat are trimmed of surrounding whitespace (tabs and newlines too).

create or replace function public.party_create(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := regexp_replace(coalesce(p_name, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_username text;
  v_party_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  if char_length(v_name) not between 1 and 24 then
    raise exception 'Party names are 1 to 24 characters.';
  end if;

  select p.username into v_username
  from public.profiles p
  where p.user_id = v_uid
  for update;
  if not found then
    raise exception 'No profile found.';
  end if;

  if exists (select 1 from public.party_members m where m.user_id = v_uid) then
    raise exception 'You are already in a party.';
  end if;

  insert into public.parties (name, leader_id)
  values (v_name, v_uid)
  returning id into v_party_id;

  insert into public.party_members (party_id, user_id, username)
  values (v_party_id, v_uid, v_username);

  return v_party_id;
end;
$$;

create or replace function public.party_invite(p_username text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := lower(btrim(coalesce(p_username, '')));
  v_party_id uuid;
  v_from_name text;
  v_leader uuid;
  v_to_id uuid;
  v_to_name text;
  v_taken bigint;
  v_invite_id bigint;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select m.party_id, m.username into v_party_id, v_from_name
  from public.party_members m
  where m.user_id = v_uid;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  select p.leader_id into v_leader
  from public.parties p
  where p.id = v_party_id
  for update;
  if not found then
    raise exception 'You are not in a party.';
  end if;
  if v_leader is distinct from v_uid then
    raise exception 'Only the party leader can invite.';
  end if;

  -- Usernames are stored lowercase; an exact match wins if an old save ever broke that.
  select p.user_id, p.username into v_to_id, v_to_name
  from public.profiles p
  where lower(p.username) = v_name
  order by (p.username = v_name) desc, p.user_id
  limit 1;
  if not found then
    raise exception 'No player by that name.';
  end if;
  if v_to_id = v_uid then
    raise exception 'You cannot invite yourself.';
  end if;
  if exists (select 1 from public.party_members m where m.user_id = v_to_id) then
    raise exception 'That player is already in a party.';
  end if;
  if exists (
    select 1 from public.party_invites i
    where i.party_id = v_party_id and i.to_id = v_to_id and i.status = 'pending'
  ) then
    raise exception 'That player already has an invite.';
  end if;

  -- Pending invites hold seats, so accepting one can never overfill the party.
  select (select count(*) from public.party_members m where m.party_id = v_party_id)
       + (select count(*) from public.party_invites i where i.party_id = v_party_id and i.status = 'pending')
  into v_taken;
  if v_taken >= 4 then
    raise exception 'The party is full.';
  end if;

  insert into public.party_invites (party_id, from_id, from_name, to_id, to_name)
  values (v_party_id, v_uid, v_from_name, v_to_id, v_to_name)
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

create or replace function public.party_cancel_invite(p_invite_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_leader uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select i.party_id into v_party_id
  from public.party_invites i
  where i.id = p_invite_id;
  -- Players outside the party learn nothing about its invites.
  if v_party_id is null
     or not exists (select 1 from public.party_members m where m.party_id = v_party_id and m.user_id = v_uid) then
    raise exception 'Invite not found.';
  end if;

  select p.leader_id into v_leader
  from public.parties p
  where p.id = v_party_id
  for update;
  if not found then
    raise exception 'Invite not found.';
  end if;
  if v_leader is distinct from v_uid then
    raise exception 'Only the party leader can cancel invites.';
  end if;

  select i.status into v_status
  from public.party_invites i
  where i.id = p_invite_id
  for update;
  if not found then
    raise exception 'Invite not found.';
  end if;
  if v_status <> 'pending' then
    raise exception 'That invite is no longer open.';
  end if;

  update public.party_invites
  set status = 'cancelled'
  where id = p_invite_id;
end;
$$;

create or replace function public.party_respond(p_invite_id bigint, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_party_id uuid;
  v_to_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  -- A missing answer must not quietly decline.
  if p_accept is null then
    raise exception 'Choose to accept or decline.';
  end if;

  select p.username into v_username
  from public.profiles p
  where p.user_id = v_uid
  for update;

  select i.party_id, i.to_id into v_party_id, v_to_id
  from public.party_invites i
  where i.id = p_invite_id;
  if not found or v_to_id is distinct from v_uid then
    raise exception 'Invite not found.';
  end if;

  -- The party row before the invite row, the same order party_cancel_invite takes.
  perform 1
  from public.parties p
  where p.id = v_party_id
  for update;
  if not found then
    raise exception 'That party no longer exists.';
  end if;

  select i.status into v_status
  from public.party_invites i
  where i.id = p_invite_id
  for update;
  if not found then
    raise exception 'Invite not found.';
  end if;
  if v_status <> 'pending' then
    raise exception 'That invite is no longer open.';
  end if;

  if not p_accept then
    update public.party_invites
    set status = 'declined'
    where id = p_invite_id;
    return;
  end if;

  if v_username is null then
    raise exception 'No profile found.';
  end if;
  if exists (select 1 from public.party_members m where m.user_id = v_uid) then
    raise exception 'You are already in a party.';
  end if;
  if (select count(*) from public.party_members m where m.party_id = v_party_id) >= 4 then
    raise exception 'The party is full.';
  end if;

  -- A second accept that raced this one past the check above meets its row in the unique index.
  -- Say what happened, not which index said it.
  begin
    insert into public.party_members (party_id, user_id, username)
    values (v_party_id, v_uid, v_username);
  exception
    when unique_violation then
      raise exception 'You are already in a party.';
  end;

  update public.party_invites
  set status = 'accepted'
  where id = p_invite_id;

  -- Every other party holding a seat for this player gets it back.
  update public.party_invites
  set status = 'cancelled'
  where to_id = v_uid
    and status = 'pending'
    and id <> p_invite_id;
end;
$$;

create or replace function public.party_leave()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_leader uuid;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  perform 1
  from public.profiles p
  where p.user_id = v_uid
  for update;

  select m.party_id into v_party_id
  from public.party_members m
  where m.user_id = v_uid;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  select p.leader_id into v_leader
  from public.parties p
  where p.id = v_party_id
  for update;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  -- A kick may have landed while this call waited for the lock.
  delete from public.party_members
  where party_id = v_party_id
    and user_id = v_uid;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  select m.user_id into v_next
  from public.party_members m
  where m.party_id = v_party_id
  order by m.joined_at nulls last, m.user_id
  limit 1;

  if v_next is null then
    -- Invites and messages go with it (on delete cascade).
    delete from public.parties where id = v_party_id;
  elsif not exists (
    select 1 from public.party_members m
    where m.party_id = v_party_id and m.user_id = v_leader
  ) then
    -- The leader left (or was never a member): the oldest remaining member leads.
    update public.parties
    set leader_id = v_next
    where id = v_party_id;
  end if;
end;
$$;

create or replace function public.party_kick(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_leader uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select m.party_id into v_party_id
  from public.party_members m
  where m.user_id = v_uid;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  select p.leader_id into v_leader
  from public.parties p
  where p.id = v_party_id
  for update;
  if not found then
    raise exception 'You are not in a party.';
  end if;
  if v_leader is distinct from v_uid then
    raise exception 'Only the party leader can kick.';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot kick yourself.';
  end if;

  delete from public.party_members
  where party_id = v_party_id
    and user_id = p_user_id;
  if not found then
    raise exception 'That player is not in your party.';
  end if;
end;
$$;

create or replace function public.party_say(p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_party_id uuid;
  v_username text;
  v_message_id bigint;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  if v_body = '' then
    raise exception 'Message is empty.';
  end if;
  if char_length(v_body) > 240 then
    raise exception 'Messages are 240 characters at most.';
  end if;

  select m.party_id into v_party_id
  from public.party_members m
  where m.user_id = v_uid;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  -- One writer per party at a time, so the rate check and the prune cannot interleave.
  perform 1
  from public.parties p
  where p.id = v_party_id
  for update;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  select m.username into v_username
  from public.party_members m
  where m.party_id = v_party_id
    and m.user_id = v_uid;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  if exists (
    select 1 from public.party_messages pm
    where pm.party_id = v_party_id
      and pm.user_id = v_uid
      and pm.created_at > now() - interval '1.5 seconds'
  ) then
    raise exception 'You are sending messages too quickly.';
  end if;

  insert into public.party_messages (party_id, user_id, username, body)
  values (v_party_id, v_uid, v_username, v_body)
  returning id into v_message_id;

  delete from public.party_messages pm
  where pm.party_id = v_party_id
    and pm.id not in (
      select k.id
      from public.party_messages k
      where k.party_id = v_party_id
      order by k.created_at desc, k.id desc
      limit 200
    );

  return v_message_id;
end;
$$;

-- invites_out lists the party's pending invites for every member, not only the sender:
-- they hold seats everyone can see, and a new leader must be able to cancel them.
create or replace function public.party_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_party public.parties%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select p.* into v_party
  from public.party_members m
  join public.parties p on p.id = m.party_id
  where m.user_id = v_uid;

  return jsonb_build_object(
    'party',
      case when v_party.id is null then null
           else jsonb_build_object('id', v_party.id, 'name', v_party.name, 'leader_id', v_party.leader_id)
      end,
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'user_id', m.user_id,
                 'username', m.username,
                 -- The face a party square draws. Null until they have picked one.
                 'skin', pr.skin,
                 'joined_at', m.joined_at,
                 'last_seen', pr.last_seen,
                 'activity', coalesce(pr.activity, '{}'::jsonb),
                 'total_level', coalesce(pr.total_level, 0),
                 'levels', coalesce(pr.levels, '{}'::jsonb),
                 'hunt',
                   case when h.user_id is null then null
                        else jsonb_build_object(
                          'tier', h.tier,
                          'zone', h.zone,
                          'started_at', h.started_at,
                          'ends_by', h.ends_by,
                          'ended_at', h.ended_at
                        )
                   end
               )
               order by m.joined_at nulls last, m.user_id
             )
      from public.party_members m
      left join public.profiles pr on pr.user_id = m.user_id
      left join public.hunt_presence h on h.user_id = m.user_id
      where m.party_id = v_party.id
    ), '[]'::jsonb),
    'invites_in', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'party_id', i.party_id,
                 'party_name', p.name,
                 'from_name', i.from_name,
                 'created_at', i.created_at
               )
               order by i.created_at, i.id
             )
      from public.party_invites i
      join public.parties p on p.id = i.party_id
      where i.to_id = v_uid
        and i.status = 'pending'
    ), '[]'::jsonb),
    'invites_out', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', i.id, 'to_name', i.to_name, 'created_at', i.created_at)
               order by i.created_at, i.id
             )
      from public.party_invites i
      where i.party_id = v_party.id
        and i.status = 'pending'
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', x.id,
                 'user_id', x.user_id,
                 'username', x.username,
                 'body', x.body,
                 'created_at', x.created_at
               )
               order by x.created_at, x.id
             )
      from (
        select pm.id, pm.user_id, pm.username, pm.body, pm.created_at
        from public.party_messages pm
        where pm.party_id = v_party.id
        order by pm.created_at desc, pm.id desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================
-- 5. EXECUTE GRANTS
-- ============================================================
-- Supabase grants new functions to anon as well as PUBLIC, so both are revoked by name.

revoke execute on function public.heartbeat(jsonb) from public, anon;
revoke execute on function public.online_count() from public, anon;
revoke execute on function public.hiscores(text, int) from public, anon;
revoke execute on function public.party_create(text) from public, anon;
revoke execute on function public.party_invite(text) from public, anon;
revoke execute on function public.party_cancel_invite(bigint) from public, anon;
revoke execute on function public.party_respond(bigint, boolean) from public, anon;
revoke execute on function public.party_leave() from public, anon;
revoke execute on function public.party_kick(uuid) from public, anon;
revoke execute on function public.party_say(text) from public, anon;
revoke execute on function public.party_state() from public, anon;

grant execute on function public.heartbeat(jsonb) to authenticated;
grant execute on function public.online_count() to authenticated;
grant execute on function public.hiscores(text, int) to authenticated;
grant execute on function public.party_create(text) to authenticated;
grant execute on function public.party_invite(text) to authenticated;
grant execute on function public.party_cancel_invite(bigint) to authenticated;
grant execute on function public.party_respond(bigint, boolean) to authenticated;
grant execute on function public.party_leave() to authenticated;
grant execute on function public.party_kick(uuid) to authenticated;
grant execute on function public.party_say(text) to authenticated;
grant execute on function public.party_state() to authenticated;

-- ============================================================
-- 6. REALTIME
-- ============================================================
-- Party chat, rosters and invites stream to clients, still filtered by the policies above.
-- Guarded three ways so the same script runs on Supabase, plain Postgres and PGlite: skip when
-- the publication is missing, skip tables it already publishes (a second run, or a FOR ALL
-- TABLES publication), and skip builds without logical replication (feature_not_supported).
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication; realtime setup skipped.';
    return;
  end if;

  foreach t in array array['party_messages', 'party_members', 'party_invites'] loop
    if not exists (
      select 1
      from pg_publication_tables pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = t
    ) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception
        when feature_not_supported then
          raise notice 'Publications are not supported here; % not added to realtime.', t;
      end;
    end if;
  end loop;
end $$;

commit;
