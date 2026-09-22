-- ============================================================
-- Respite · 015_party_room_state.sql · Reading the Room Back
-- ------------------------------------------------------------
-- 014 gave a party its seats, the ground put up for it and a
-- ready mark each, and three RPCs that write them. It did not
-- touch party_state(), which is the only thing that reads a
-- party back to a browser, so every one of those columns was
-- written and none was ever seen: Propose set the ground and the
-- room never heard, so nobody could mark ready for it.
--
-- This is party_state() as schema.sql now has it. Nothing else
-- changes. Run it after 014.
-- ============================================================

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
             'slots', coalesce(v_party.slots, 4),
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

-- Supabase caches which functions exist; a redefined one is picked up, but if a
-- call still 404s after this, the cache has not turned over yet:
--   notify pgrst, 'reload schema';
