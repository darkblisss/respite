-- Test only stand ins for what every Supabase project already provides, so
-- supabase/schema.sql can run on PGlite or plain Postgres. Never run this on a real project.
-- Loaded once, before schema.sql, by tests/sql/run.mjs.

-- Roles: Supabase creates these, so only add what is missing.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- gen_random_uuid() is core since Postgres 13, so nothing needs stubbing. Say so loudly if not.
do $$
begin
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'gen_random_uuid() is missing: the schema needs Postgres 13 or newer.';
  end if;
end $$;

-- auth schema: users and the uid() PostgREST feeds from the request JWT.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- An empty subject means signed out, the same as no setting at all.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase grants every new object in public to its API roles. Mirror that here, so the
-- tests prove schema.sql takes those grants back rather than never receiving them.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Realtime's publication exists on every project, empty until tables are added.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- The v4 saves table, with the kind of wide open policies the browser used to rely on.
-- schema.sql must drop every one of them without knowing their names.
create table if not exists public.saves (
  user_id uuid primary key,
  username text,
  data jsonb,
  updated_at timestamptz
);

alter table public.saves enable row level security;

drop policy if exists "Anyone can read saves" on public.saves;
create policy "Anyone can read saves" on public.saves
  for select using (true);

drop policy if exists "Users can insert their own save" on public.saves;
create policy "Users can insert their own save" on public.saves
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own save" on public.saves;
create policy "Users can update their own save" on public.saves
  for update to authenticated using (auth.uid() = user_id);

drop policy if exists saves_open_door on public.saves;
create policy saves_open_door on public.saves
  for all to anon, authenticated using (true) with check (true);
