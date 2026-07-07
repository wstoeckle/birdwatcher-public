-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f migrations/0004_sighting_kind.sql
--
-- Splits the gallery into birds (the main page) and non-bird visitors (a
-- sub-page). Every sighting now carries a `kind`: 'bird' (the default) or
-- 'critter'. The camera posts the animals/people it sees as kind='critter' so
-- they get their own photo page, while the main gallery stays birds-only.

alter table sightings add column if not exists kind text not null default 'bird';
create index if not exists sightings_kind_idx on sightings (kind, captured_at desc);
