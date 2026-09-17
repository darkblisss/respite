-- Respite: indexes the game function needs on top of supabase/schema.sql.
--
-- How to run: after schema.sql, in the Supabase SQL Editor. Safe to run again. Required.
--
-- Every request of every player sweeps up to 50 expired listings (src/server/handler.js,
-- expireListings). No index in schema.sql serves "open and past expires_at, oldest first", so
-- without this one each sweep reads every listing ever made.

create index if not exists market_listings_open_expiry_idx
  on public.market_listings (expires_at, id)
  where status = 'open';

-- marketList counts the listings a seller made in the last hour (60 at most). A seller's rows
-- only ever grow, so the count reads just the recent ones.
create index if not exists market_listings_seller_created_idx
  on public.market_listings (seller_id, created_at);
