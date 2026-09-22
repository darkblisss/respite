-- ============================================================
-- Respite · 016_propose_same_ground.sql · Agreeing Is Not Changing
-- ------------------------------------------------------------
-- party_propose() stood the whole room down every time it ran,
-- including when the ground put up was the ground already up. So
-- a second press on the same ground, from anyone, took away the
-- marks people had just given it: agreeing with a plan undid it.
--
-- Now only a change of ground clears the marks. The answer says
-- which it was, in `moved`.
-- ============================================================

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
  v_moved boolean;
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

  /* Only a CHANGE of ground stands the room down. Putting up the ground already
     up is somebody agreeing with it, and taking everyone's mark away for that
     turns a second press into a reason to start over. */
  select (p.proposed_tier is distinct from v_tier or p.proposed_zone is distinct from v_zone)
    into v_moved
  from public.parties p
  where p.id = v_party_id;

  update public.parties
     set proposed_tier = v_tier, proposed_zone = v_zone
   where id = v_party_id;
  if v_moved then
    update public.party_members set ready = false where party_id = v_party_id;
  end if;

  return jsonb_build_object('tier', v_tier, 'zone', v_zone, 'moved', coalesce(v_moved, true));
end;
$$;
