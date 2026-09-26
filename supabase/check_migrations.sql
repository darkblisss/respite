-- ============================================================
-- Respite · check_migrations.sql · What Has Been Run
-- ------------------------------------------------------------
-- Migrations here are applied by hand, so there is no table
-- saying which ones went in. This asks the live schema instead:
-- every migration that leaves a mark gets a row saying whether
-- that mark is there.
--
-- Paste the whole file into the Supabase SQL editor and run it.
-- Anything reading MISSING still needs its file run, oldest
-- first, out of supabase/migrations/.
--
-- Safe to run whenever: it only reads the catalog.
-- ============================================================

with probes(ord, migration, what, present) as (
  values
    (2,  '002_server',            'market_listings_open_expiry_idx',
         to_regclass('public.market_listings_open_expiry_idx') is not null),

    (4,  '004_leaderboard_boards', 'profiles.klass',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'klass')),

    (5,  '005_wealth_board',      'profiles.self_made',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'self_made')),

    (6,  '006_party_hunts',       'table party_hunts',
         to_regclass('public.party_hunts') is not null),

    (7,  '007_market_pools',      'market_pools()',
         to_regproc('public.market_pools') is not null),

    (8,  '008_mastery_boards',    'mastery_board()',
         to_regproc('public.mastery_board') is not null),

    (9,  '009_player_profiles',   'profiles.skin',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'skin')),

    (10, '010_market_bases',      'market_bases()',
         to_regproc('public.market_bases') is not null),

    (11, '011_player_collection', 'profiles.collection',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'collection')),

    (12, '012_board_faces',       'hiscores() returns a skin',
         coalesce((select pg_get_function_result(p.oid) like '%skin text%'
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'hiscores'
                    limit 1), false)),

    (14, '014_party_room',        'parties.slots and party_set_slots()',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'parties' and column_name = 'slots')
         and to_regproc('public.party_set_slots') is not null),

    -- 014 writes the room's columns; this is the one that reads them back.
    (15, '015_party_room_state',  'party_state() answers with the room',
         coalesce((select pg_get_functiondef(p.oid) like '%proposed%'
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'party_state'
                    limit 1), false)),

    (16, '016_propose_same_ground', 'party_propose() only clears on a change',
         coalesce((select pg_get_functiondef(p.oid) like '%v_moved%'
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'party_propose'
                    limit 1), false)),

    (17, '017_mastery_saints',   'mastery_saints()',
         to_regproc('public.mastery_saints') is not null),

    (18, '018_ground_hunters',   'ground_hunters()',
         to_regproc('public.ground_hunters') is not null),

    (19, '019_party_of_three',   'a party room holds three',
         coalesce((select pg_get_functiondef(p.oid) like '%holds three%'
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'party_set_slots'
                    limit 1), false))
)
select migration,
       case when present then 'in' else 'MISSING' end as status,
       what as "the mark looked for"
from probes
order by ord;

-- 003_profiles_from_saves and 013_key_rename are one-off passes over
-- existing rows. They change no schema, so there is nothing to look for
-- and nothing breaks if they are run twice.
