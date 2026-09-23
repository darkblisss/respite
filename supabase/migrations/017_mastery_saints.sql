-- ============================================================
-- Respite · 017_mastery_saints.sql · Who Holds the Lines
-- ------------------------------------------------------------
-- mastery_ranks() tells a commander where they stand on each
-- line, which is enough for their own page and no use at all for
-- anybody else's. A title has to be readable on a board row and
-- on a party square, so the realm answers with the whole set:
-- one holder a line, five rows at most.
--
-- Purely a name. Nothing in the rules reads it.
-- ============================================================

create or replace function public.mastery_saints()
returns table (line text, username text, points numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  /* One row a line: whoever stands first on it. Ties break on the name, so the
     realm agrees with itself between calls rather than handing the title back
     and forth. A line nobody has touched simply has no row. */
  return query
    with everyone as (
      select k.key as line, p.username as who, (k.value #>> '{}')::numeric as n
      from public.profiles p
      cross join lateral jsonb_each(p.mastery) k
      where jsonb_typeof(k.value) = 'number'
        and (k.value #>> '{}')::numeric > 0
        and p.username is not null
    )
    select distinct on (e.line) e.line, e.who, e.n
    from everyone e
    order by e.line, e.n desc, e.who asc;
end;
$$;

revoke execute on function public.mastery_saints() from public, anon;
grant execute on function public.mastery_saints() to authenticated;
