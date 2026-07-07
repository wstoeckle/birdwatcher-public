-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f migrations/0006_sighting_box.sql
--
-- Stores an optional bounding box around the identified subject so the website
-- can offer a "show me the bird" highlight. Format: a JSON array [x, y, w, h] of
-- fractions 0–1 with (x, y) at the top-left corner. NULL when the camera couldn't
-- localize the subject (or for older rows captured before this existed).

alter table sightings add column if not exists box jsonb;
