-- ============================================================
-- Respite · 014_party_room.sql · The Room
-- ------------------------------------------------------------
-- A party is a room of four squares now. The leader opens and
-- closes squares, anyone can put a ground up, everyone marks
-- ready, and the leader's press sends the whole room out.
--
-- Three columns and three RPCs. Everything a room needs rides
-- on party_state(), which the page already reads every five
-- seconds, so no new poll and no new channel.
-- ============================================================

alter table public.parties add column if not exists slots smallint not null default 4;
alter table public.parties add column if not exists proposed_tier smallint;
alter table public.parties add column if not exists proposed_zone text;
alter table public.party_members add column if not exists ready boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parties_slots_range') then
    alter table public.parties add constraint parties_slots_range check (slots between 1 and 4);
  end if;
end $$;

-- ------------------------------------------------------------
-- How many squares stand open. The leader's alone, and never
-- fewer than the members already sitting in them.
-- ------------------------------------------------------------
create or replace function public.party_set_slots(p_slots int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_leader uuid;
  v_taken int;
  v_want int := coalesce(p_slots, 0);
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
  if v_leader is distinct from v_uid then
    raise exception 'Only the party leader can open and close squares.';
  end if;

  select count(*) into v_taken from public.party_members m where m.party_id = v_party_id;
  if v_want < v_taken then
    raise exception 'Somebody is sitting in that square.';
  end if;
  if v_want < 1 or v_want > 4 then
    raise exception 'A party room holds four.';
  end if;

  update public.parties set slots = v_want where id = v_party_id;
  return v_want;
end;
$$;

-- ------------------------------------------------------------
-- The ground put up for the room. Anyone may put one up, and
-- doing so stands everybody down: a ready is for one ground.
-- ------------------------------------------------------------
create or replace function public.party_propose(p_tier int, p_zone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_zone text := lower(coalesce(p_zone, ''));
  v_tier int := coalesce(p_tier, 0);
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  if v_zone not in ('outer', 'middle', 'inner', 'core') then
    raise exception 'No such ground.';
  end if;
  if v_tier < 1 or v_tier > 20 then
    raise exception 'No such region.';
  end if;

  select m.party_id into v_party_id
  from public.party_members m
  where m.user_id = v_uid;
  if not found then
    raise exception 'You are not in a party.';
  end if;

  perform 1 from public.parties p where p.id = v_party_id for update;

  update public.parties
     set proposed_tier = v_tier, proposed_zone = v_zone
   where id = v_party_id;
  -- A new ground stands the room down, the one who put it up included.
  update public.party_members set ready = false where party_id = v_party_id;

  return jsonb_build_object('tier', v_tier, 'zone', v_zone);
end;
$$;

-- ------------------------------------------------------------
-- Your own ready mark. Only for the ground currently up.
-- ------------------------------------------------------------
create or replace function public.party_ready(p_ready boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_zone text;
  v_want boolean := coalesce(p_ready, false);
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

  select p.proposed_zone into v_zone from public.parties p where p.id = v_party_id;
  if v_want and v_zone is null then
    raise exception 'Nobody has put a ground up yet.';
  end if;

  update public.party_members
     set ready = v_want
   where party_id = v_party_id and user_id = v_uid;

  return v_want;
end;
$$;

revoke execute on function public.party_set_slots(int) from public, anon;
revoke execute on function public.party_propose(int, text) from public, anon;
revoke execute on function public.party_ready(boolean) from public, anon;

grant execute on function public.party_set_slots(int) to authenticated;
grant execute on function public.party_propose(int, text) to authenticated;
grant execute on function public.party_ready(boolean) to authenticated;
