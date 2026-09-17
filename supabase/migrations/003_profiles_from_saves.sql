-- Respite: a profile for every v4 player, before anyone can sign up under their name.
--
-- How to run: after schema.sql and 002, in the Supabase SQL Editor, before the v5 client goes
-- live. Safe to run again (it only adds what is missing). Required.
--
-- The game function names a new player after their email's local part. A v4 player who has not
-- played since the cutover has no profile yet, so without this anyone could sign up as
-- victim@anything.example and take their name. Each saves row with a valid username gets a bare
-- profile (levels and last_seen fill in on the player's first request).
--
-- v4 browsers could write their own row's username, so two rows may claim one name. The account
-- whose email is <name>@... wins; after that the lower user id, so every run picks the same one.

insert into public.profiles (user_id, username)
select distinct on (s.username) s.user_id, s.username
from public.saves s
left join auth.users u on u.id = s.user_id
where s.username ~ '^[a-z0-9_]{3,20}$'
order by s.username,
         (lower(split_part(coalesce(u.email, ''), '@', 1)) = s.username) desc,
         s.user_id
on conflict do nothing;
