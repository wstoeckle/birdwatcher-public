-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f migrations/0005_subscribers.sql
--
-- People who signed up for text alerts at /alerts (the website opt-in form). Bird
-- alerts go to everyone here; critter alerts only to those who also opted into the
-- non-bird stream. This is the consent record carriers want for A2P 10DLC.

create table if not exists subscribers (
  id bigserial primary key,
  phone text not null unique,
  wants_critters boolean not null default false,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
