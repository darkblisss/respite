-- Respite: gear and tools, shown one row a base.
--
-- How to run: after schema.sql and 002 to 009, in the Supabase SQL Editor. Paste the whole file
-- and press Run. Safe to run again. It all runs in one transaction, so a failure leaves the
-- database as it was.
--
-- Why. Materials already pool (007): one row an item, the cheapest price, the bands behind it.
-- Gear could not pool, because two Slag Swords are not one pile -- one is Rare and worked to +7
-- and the other is a plain Common -- so the page listed every piece, and a market with forty
-- swords on it read as forty rows of the same word. This file splits the difference the way a
-- real stall does: the shelf shows the sword once, at the cheapest it can be had for, and you
-- pick it up to see what is actually on the shelf.
--
--   market_bases()         one row an item_base: how many lots, how many pieces, the cheapest
--                          price, and a rarity breakdown. Nothing here is fungible, so it is a
--                          summary of what to look at, never a thing to buy.
--   market_base_listings() the shelf itself: every open lot of one base, itemised exactly as
--                          market_browse() answers, which is what the buy still goes through.
--
-- Both are security definer and carry no seller_id, seller_name or buyer_id, the same as the
-- three doors in 007. A caller's own lots ARE included (unlike a material pool, which leaves
-- them out because a pool is what you can buy): gear is bought one piece at a time, so a base
-- you are selling into should still show you the rest of the shelf, and `mine` marks your own
-- rows in the sheet so they get Remove instead of Buy.
--
-- Rarity floor. p_rarity is the LEAST rarity to show ('uncommon' means uncommon and up), and it
-- reads on both functions so the cheapest price on the shelf is the cheapest price that passes
-- the filter. An unknown word is no filter at all rather than an error.
--
-- Tests: node tests/server/run.mjs loads this file (twice); node tests/sql/run.mjs covers
-- schema.sql alone. The dev stage (npm run dev) loads it too.

begin;

-- ============================================================
-- 1. READING A SHELF
-- ============================================================
-- Grouping by base wants the base, then the price: the 007 pool index leads with item_key, which
-- is the whole key (rarity, uid and all) and so is one row a piece for gear. Partial, for the
-- same reason that one is.
create index if not exists market_listings_base_idx
  on public.market_listings (item_base, price_each, id)
  where status = 'open';

-- ============================================================
-- 2. RARITY, AS AN ORDER
-- ============================================================
-- The one place the ladder is written down on this side of the wire. It matches
-- GameData.RARITIES (src/shared/registry.js); a rarity the database has never heard of sorts
-- last and passes no floor, which is what an unreadable row deserves.
create or replace function public.market_rarity_rank(p_rarity text)
returns int
language sql
immutable
set search_path = public
as $$
  select coalesce(
    array_position(array['common', 'uncommon', 'rare', 'epic', 'legendary', 'relic'],
                   lower(btrim(coalesce(p_rarity, '')))),
    0);
$$;

revoke execute on function public.market_rarity_rank(text) from public, anon;
grant execute on function public.market_rarity_rank(text) to authenticated;

-- ============================================================
-- 3. THE SHELF
-- ============================================================
-- One row an item_base. lots is how many separate listings stand behind it, qty_left how many
-- pieces in total (a Common stacks, so a lot can be more than one), price_min the cheapest ask
-- that passes the filter. rarities is the breakdown a row draws under the name:
-- [{"rarity": "rare", "lots": 2, "qty": 2, "min": 900}, ...], least rarity first.
--
-- item_name is a fallback only: the browser knows the base and names it properly itself. What
-- comes back is the plainest name on the shelf (lowest rarity, then shortest), so a shelf that
-- happens to hold one prefixed Relic is still called Slag Sword and not Echoing Slag Sword.
create or replace function public.market_bases(
  p_q text default '',
  p_kind text default null,
  p_tier int default null,
  p_rarity text default null,
  p_sort text default 'price',
  p_limit int default 50
)
returns table (
  item_base text,
  item_name text,
  item_kind text,
  item_tier int,
  lots int,
  mine_lots int,
  qty_left bigint,
  price_min bigint,
  price_max bigint,
  newest timestamptz,
  rarities jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_q, ''));
  v_kind text := nullif(btrim(lower(coalesce(p_kind, ''))), '');
  v_floor int := public.market_rarity_rank(p_rarity);
  v_newest boolean := lower(coalesce(p_sort, '')) = 'newest';
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  -- Materials are a pool, not a shelf: market_pools answers for them and always has.
  if v_kind = 'material' then
    return;
  end if;

  return query
  with open as (
    select l.item_base, l.item_name, l.item_kind, l.item_tier, l.rarity,
           l.qty_left, l.price_each, l.created_at, (l.seller_id = v_uid) as mine
    from public.market_listings l
    where l.status = 'open'
      and l.expires_at > now()
      and l.qty_left > 0
      and l.item_kind <> 'material'
      and (v_kind is null or l.item_kind = v_kind)
      and (p_tier is null or l.item_tier = p_tier)
      and (v_floor = 0 or public.market_rarity_rank(l.rarity) >= v_floor)
      and (v_q = '' or l.item_name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), rar as (
    select o.item_base, o.rarity,
           count(*)::int as lots,
           sum(o.qty_left)::bigint as qty,
           min(o.price_each)::bigint as price_min
    from open o
    group by o.item_base, o.rarity
  ), shelf as (
    select o.item_base,
           (array_agg(o.item_name order by public.market_rarity_rank(o.rarity), length(o.item_name), o.item_name))[1] as item_name,
           min(o.item_kind) as item_kind,
           min(o.item_tier) as item_tier,
           count(*)::int as lots,
           count(*) filter (where o.mine)::int as mine_lots,
           sum(o.qty_left)::bigint as qty_left,
           min(o.price_each)::bigint as price_min,
           max(o.price_each)::bigint as price_max,
           max(o.created_at) as newest
    from open o
    group by o.item_base
  )
  select s.item_base, s.item_name, s.item_kind, s.item_tier, s.lots, s.mine_lots,
         s.qty_left, s.price_min, s.price_max, s.newest,
         coalesce((
           select jsonb_agg(jsonb_build_object('rarity', r.rarity, 'lots', r.lots, 'qty', r.qty, 'min', r.price_min)
                            order by public.market_rarity_rank(r.rarity), r.rarity)
           from rar r
           where r.item_base = s.item_base
         ), '[]'::jsonb) as rarities
  from shelf s
  -- One query, two orders: an unasked-for key is a constant, so it decides nothing.
  order by (case when v_newest then 0::bigint else s.price_min end) asc,
           (case when v_newest then s.newest end) desc nulls last,
           s.item_name asc,
           s.item_base asc
  limit v_limit;
end;
$$;

revoke execute on function public.market_bases(text, text, int, text, text, int) from public, anon;
grant execute on function public.market_bases(text, text, int, text, text, int) to authenticated;

-- ============================================================
-- 4. WHAT IS ACTUALLY ON IT
-- ============================================================
-- Every open lot of one base, in the shape market_browse() answers so the sheet and the page
-- read the same row and the same buy runs against it. Cheapest first, then oldest, which is the
-- order a buyer would pick in anyway.
create or replace function public.market_base_listings(
  p_base text,
  p_rarity text default null,
  p_limit int default 50
)
returns table (
  id bigint,
  item_key text,
  item_base text,
  item_name text,
  item_kind text,
  item_tier int,
  rarity text,
  qty_left int,
  price_each bigint,
  created_at timestamptz,
  expires_at timestamptz,
  mine boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_base text := nullif(btrim(coalesce(p_base, '')), '');
  v_floor int := public.market_rarity_rank(p_rarity);
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  if v_base is null then
    return;
  end if;

  return query
  select l.id, l.item_key, l.item_base, l.item_name, l.item_kind, l.item_tier, l.rarity,
         l.qty_left, l.price_each, l.created_at, l.expires_at, (l.seller_id = v_uid) as mine
  from public.market_listings l
  where l.status = 'open'
    and l.expires_at > now()
    and l.qty_left > 0
    and l.item_kind <> 'material'
    and l.item_base = v_base
    and (v_floor = 0 or public.market_rarity_rank(l.rarity) >= v_floor)
  order by l.price_each asc, l.created_at asc, l.id asc
  limit v_limit;
end;
$$;

revoke execute on function public.market_base_listings(text, text, int) from public, anon;
grant execute on function public.market_base_listings(text, text, int) to authenticated;

commit;
