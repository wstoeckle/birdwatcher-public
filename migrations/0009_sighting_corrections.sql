-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f migrations/0009_sighting_corrections.sql
--
-- Stores admin species corrections as a small feedback set. The camera can read
-- aggregated before/after pairs and use them as prompt hints for future IDs.

create table if not exists sighting_corrections (
  id bigserial primary key,
  sighting_id bigint references sightings(id) on delete set null,
  kind text not null default 'bird' check (kind in ('bird', 'critter')),
  original_species text not null,
  corrected_species text not null,
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  device text,
  captured_at timestamptz,
  image_url text,
  box jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sighting_corrections_kind_idx
  on sighting_corrections (kind, created_at desc);

create index if not exists sighting_corrections_pair_idx
  on sighting_corrections (kind, original_species, corrected_species);
