-- ============================================================
-- Respite · 019_party_of_three.sql · Three to a Party
-- ------------------------------------------------------------
-- A party holds three now: three squares to the room, three to
-- a hunt. The game function says the same (CONFIG.party.maxSize)
-- and refuses a fourth on the ground; this is the realm's half:
-- the squares, the invites and the accepts.
--
-- Nobody already sitting in a party of four is put out of it.
-- Its room shows three squares' worth of openings and takes
-- nobody new until it is under three.
--
-- Safe to run again.
-- ============================================================

update public.parties set slots = 3 where slots > 3;
alter table public.parties alter column slots set default 3;
alter table public.parties drop constraint if exists parties_slots_check;
alter table public.parties drop constraint if exists parties_slots_range;
alter table public.parties add constraint parties_slots_range check (slots between 1 and 3);

-- ------------------------------------------------------------
-- The four places a room was four: an invite, an accept, what
-- the room says it holds, and how many squares the leader can
-- open. The same bodies as schema.sql, with three for four.
-- ------------------------------------------------------------

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
  if v_taken >= 3 then
    raise exception 'The party is full.';
  end if;

  insert into public.party_invites (party_id, from_id, from_name, to_id, to_name)
  values (v_party_id, v_uid, v_from_name, v_to_id, v_to_name)
  returning id into v_invite_id;

  return v_invite_id;
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
  if (select count(*) from public.party_members m where m.party_id = v_party_id) >= 3 then
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
           else jsonb_build_object(
             'id', v_party.id,
             'name', v_party.name,
             'leader_id', v_party.leader_id,
             'slots', coalesce(v_party.slots, 3),
             'proposed',
               case when v_party.proposed_zone is null then null
                    else jsonb_build_object('tier', v_party.proposed_tier, 'zone', v_party.proposed_zone)
               end
           )
      end,
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'user_id', m.user_id,
                 'username', m.username,
                 -- The face a party square draws. Null until they have picked one.
                 'skin', pr.skin,
                 'ready', coalesce(m.ready, false),
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
  if v_want < 1 or v_want > 3 then
    raise exception 'A party room holds three.';
  end if;

  update public.parties set slots = v_want where id = v_party_id;
  return v_want;
end;
$$;

revoke execute on function public.party_invite(text) from public, anon;
revoke execute on function public.party_respond(bigint, boolean) from public, anon;
revoke execute on function public.party_state() from public, anon;
revoke execute on function public.party_set_slots(int) from public, anon;

grant execute on function public.party_invite(text) to authenticated;
grant execute on function public.party_respond(bigint, boolean) to authenticated;
grant execute on function public.party_state() to authenticated;
grant execute on function public.party_set_slots(int) to authenticated;
