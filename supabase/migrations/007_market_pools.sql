-- Respite: an anonymous market, with materials sold out of a pool.
--
-- How to run: after schema.sql and 002 to 006, in the Supabase SQL Editor. Paste the whole file
-- and press Run. Safe to run again (the column uses if not exists, the policies are dropped
-- before they are made, the functions are replaced). It all runs in one transaction, so a
-- failure leaves the database as it was.
--
-- Required, and it must go out WITH the game function and the browser bundle, not before or
-- after either of them. What changes at once:
--
--   1. Nobody's name reaches anybody. Until now market_listings was readable by every signed in
--      player while it was open, seller_name and all, and market_sales was readable by both
--      sides of a sale, which handed a seller the buyer's user_id and profiles will hand anyone
--      a user_id's name. After this the tables answer a player about their OWN rows and nothing
--      else, and what a market page draws comes from the three functions below, which carry no
--      seller_id, no seller_name and no buyer_id. The columns stay in the tables: the server
--      still writes both sides of every sale, because moderation needs to know who traded with
--      whom and a traders board will need to count distinct counterparties.
--   2. Materials are bought from a pool, not from a person. market_pools() aggregates every open
--      material listing into one row an item with its price bands ("40 at 12g, 15 at 13g"), and
--      the game function's marketBuyPool command fills a buy cheapest first, oldest first among
--      equal prices, across as many sellers as it takes. Gear and tools stay itemised, one row
--      each, and market_browse() answers for them.
--   3. The fee is taken off both legs (src/shared/config.js): the buyer pays the asking price
--      plus it, the seller receives the asking price less it. market_sales gains buyer_fee so a
--      sale row carries both halves and a player's own ledger adds up.
--
-- An older browser will not break loudly against this: it will read no open listings at all
-- (its market page goes quiet) and its Recent sales card will say the realm did not answer.
-- Deploy the static client with the function, or bump ENGINE_VERSION first so every open tab is
-- turned away with 409 and reloads.
--
-- If schema.sql is ever run again after this file, run this file again after it: schema.sql
-- recreates the two policies this one narrows.
--
-- Tests: node tests/server/run.mjs loads this file (twice) and drives the real handler and the
-- real fill against it; node tests/sql/run.mjs covers schema.sql alone. The dev stage
-- (npm run dev) loads it too, so the local realm trades exactly as the live one does.

begin;

-- ============================================================
-- 1. BOTH HALVES OF THE FEE, ON THE SALE ROW
-- ============================================================
-- fee is what was kept from the seller's payout, as it always was. buyer_fee is what the buyer
-- paid on top for this row: one purchase is charged once on its whole basket, and the charge is
-- shared out over the listings it filled (src/shared/market.js splitFee), so the rows of one
-- purchase add up to exactly what left the buyer's purse. Old rows predate the second leg and
-- default to 0, which is what they cost.
alter table public.market_sales add column if not exists buyer_fee bigint not null default 0;

-- ============================================================
-- 2. WHAT A PLAYER MAY READ
-- ============================================================
-- The market is anonymous by default, for materials and for gear alike, so neither table
-- answers a question about somebody else's row any more. A seller still sees their own
-- listings (the Market page's own card, and the Remove button on them), and a player still
-- sees their own sales, through the function in section 4.
--
-- RLS stays on, and the grant is taken back first: a policy is only half of it, and
-- market_sales now has no policy at all, the way party_hunts has none.
alter table public.market_listings enable row level security;
alter table public.market_sales enable row level security;

revoke all on table public.market_listings, public.market_sales from public, anon, authenticated;
grant select on table public.market_listings to authenticated;

do $$
declare
  t text;
  s text;
begin
  foreach t in array array['public.market_listings', 'public.market_sales'] loop
    s := pg_get_serial_sequence(t, 'id');
    if s is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', s);
    end if;
  end loop;
end $$;

drop policy if exists market_listings_select_open_or_own on public.market_listings;
drop policy if exists market_listings_select_own on public.market_listings;
create policy market_listings_select_own on public.market_listings
  for select to authenticated
  using (seller_id = (select auth.uid()));

-- No policy: market_sales is read through market_sales_mine() and nowhere else.
drop policy if exists market_sales_select_party_to_sale on public.market_sales;

-- ============================================================
-- 3. WHAT THE POOL READS
-- ============================================================
-- Every open listing of one material, cheapest first and oldest first among equal prices: the
-- aggregate a buyer is shown and the walk a buy fills in are the same order, so the index that
-- serves one serves the other. Partial, because a sold or cancelled row is never in either.
create index if not exists market_listings_pool_idx
  on public.market_listings (item_key, price_each, created_at, id)
  where status = 'open';

-- ============================================================
-- 4. THE THREE DOORS
-- ============================================================
-- Every one of them is security definer and reads the table as the owner, so RLS does not
-- narrow them; each decides for itself what a caller may see. None of them selects seller_id,
-- seller_name or buyer_id, and the market page asks for nothing else.

-- Gear and tools, one row a listing, as they have always been drawn. `mine` is the only thing
-- here that says whose a listing is, and it can only ever say "yours": the page tints those rows
-- and puts Remove on them, which is a player learning about their own listing and nobody else's.
create or replace function public.market_browse(
  p_q text default '',
  p_kind text default null,
  p_tier int default null,
  p_sort text default 'price',
  p_limit int default 50,
  p_offset int default 0
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
  v_q text := btrim(coalesce(p_q, ''));
  v_kind text := nullif(btrim(lower(coalesce(p_kind, ''))), '');
  v_newest boolean := lower(coalesce(p_sort, '')) = 'newest';
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
  v_offset int := greatest(0, coalesce(p_offset, 0));
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  -- Materials have no listings to show: they are a pool, and market_pools answers for them.
  if v_kind = 'material' then
    return;
  end if;

  return query
  select o.id, o.item_key, o.item_base, o.item_name, o.item_kind, o.item_tier, o.rarity,
         o.qty_left, o.price_each, o.created_at, o.expires_at, o.mine
  from (
    select l.id, l.item_key, l.item_base, l.item_name, l.item_kind, l.item_tier, l.rarity,
           l.qty_left, l.price_each, l.created_at, l.expires_at, (l.seller_id = v_uid) as mine
    from public.market_listings l
    where l.status = 'open'
      and l.expires_at > now()
      and l.qty_left > 0
      and l.item_kind <> 'material'
      and (v_kind is null or l.item_kind = v_kind)
      and (p_tier is null or l.item_tier = p_tier)
      and (v_q = '' or l.item_name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ) o
  -- One query, two orders: an unasked-for key is a constant, so it decides nothing.
  order by (case when v_newest then 0::bigint else o.price_each end) asc,
           (case when v_newest then o.created_at end) desc nulls last,
           o.created_at asc,
           o.id asc
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function public.market_browse(text, text, int, text, int, int) from public, anon;
grant execute on function public.market_browse(text, text, int, text, int, int) to authenticated;

-- Materials, as pools. One row an item: how many are to be had in total, the cheapest price, and
-- the cheapest price bands behind it, which is all a buyer needs to know what a quantity will
-- cost and all anybody is allowed to know about who is selling it.
--
-- A caller's own listings are left out of their pool, because the pool is what they can buy: a
-- buyer may not buy their own listing, and a pool that counted it would promise stock that the
-- fill then walked straight past. Their own are on the page's own card, with Remove.
create or replace function public.market_pools(
  p_q text default '',
  p_tier int default null,
  p_limit int default 50,
  p_bands int default 8
)
returns table (
  item_key text,
  item_base text,
  item_name text,
  item_kind text,
  item_tier int,
  qty_left bigint,
  price_min bigint,
  bands jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_q, ''));
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
  v_bands int := greatest(1, least(20, coalesce(p_bands, 8)));
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  return query
  with open as (
    select l.item_key, l.item_base, l.item_name, l.item_kind, l.item_tier, l.price_each, l.qty_left
    from public.market_listings l
    where l.status = 'open'
      and l.expires_at > now()
      and l.qty_left > 0
      and l.item_kind = 'material'
      and l.seller_id <> v_uid
      and (p_tier is null or l.item_tier = p_tier)
      and (v_q = '' or l.item_name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), band as (
    select o.item_key, o.price_each, sum(o.qty_left)::bigint as qty
    from open o
    group by o.item_key, o.price_each
  ), ranked as (
    select b.item_key, b.price_each, b.qty,
           row_number() over (partition by b.item_key order by b.price_each) as rn
    from band b
  ), pool as (
    select o.item_key,
           min(o.item_base) as item_base,
           min(o.item_name) as item_name,
           min(o.item_kind) as item_kind,
           min(o.item_tier) as item_tier,
           sum(o.qty_left)::bigint as qty_left,
           min(o.price_each)::bigint as price_min
    from open o
    group by o.item_key
  )
  select p.item_key, p.item_base, p.item_name, p.item_kind, p.item_tier, p.qty_left, p.price_min,
         coalesce((
           select jsonb_agg(jsonb_build_object('each', r.price_each, 'qty', r.qty) order by r.price_each)
           from ranked r
           where r.item_key = p.item_key and r.rn <= v_bands
         ), '[]'::jsonb) as bands
  from pool p
  order by p.price_min asc, p.item_name asc
  limit v_limit;
end;
$$;

revoke execute on function public.market_pools(text, int, int, int) from public, anon;
grant execute on function public.market_pools(text, int, int, int) to authenticated;

-- A player's own ledger: what they sold and what they bought, with the fee they paid for it and
-- not a word about who was on the other end. side is 'sold' or 'bought'.
create or replace function public.market_sales_mine(p_limit int default 50)
returns table (
  id bigint,
  side text,
  item_key text,
  item_name text,
  qty int,
  price_each bigint,
  fee bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(100, coalesce(p_limit, 50)));
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  return query
  select s.id,
         case when s.buyer_id = v_uid then 'bought' else 'sold' end,
         s.item_key,
         s.item_name,
         s.qty,
         s.price_each,
         case when s.buyer_id = v_uid then coalesce(s.buyer_fee, 0) else coalesce(s.fee, 0) end,
         s.created_at
  from public.market_sales s
  where s.buyer_id = v_uid or s.seller_id = v_uid
  order by s.created_at desc, s.id desc
  limit v_limit;
end;
$$;

revoke execute on function public.market_sales_mine(int) from public, anon;
grant execute on function public.market_sales_mine(int) to authenticated;

commit;
