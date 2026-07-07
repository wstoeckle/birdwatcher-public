-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f migrations/0002_critters.sql
--
-- Non-bird visitors (squirrels, chipmunks, …) aren't photographed — they just
-- tick a per-category counter shown on the site. One row per category.

create table if not exists critter_counts (
  species text primary key,
  count bigint not null default 0,
  last_seen timestamptz not null default now()
);

create index if not exists critter_counts_rank_idx on critter_counts (count desc);
