-- Run once against your Neon database:
--   psql $DATABASE_URL -f migrations/0001_init.sql

create table if not exists sightings (
  id bigserial primary key,
  captured_at timestamptz not null,
  species text not null,
  scientific_name text,
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  fun_facts jsonb not null default '[]'::jsonb,
  image_url text not null,
  device text,
  created_at timestamptz not null default now()
);

create index if not exists sightings_recent_idx on sightings (captured_at desc);
create index if not exists sightings_species_idx on sightings (species, captured_at desc);
