-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f migrations/0003_manual_capture.sql
--
-- Adds the "take a photo now" button (a website visitor can ask the feeder camera
-- to grab a live shot):
--   * sightings.manual      — true when a person triggered the shot from the site
--                             (vs. the camera's own motion detector).
--   * sightings.expires_at  — if set, the row auto-disappears after this time. Used
--                             for a manual snapshot that turned out NOT to be a bird:
--                             we still show the live photo, labelled "we'll take this
--                             down shortly", then drop it.
--   * capture_requests      — a tiny queue. The website inserts a 'pending' row when
--                             someone presses the button; the Pi (behind a home router,
--                             only makes outbound calls) polls, claims it, takes a
--                             photo, and posts it like any other sighting.

alter table sightings add column if not exists manual boolean not null default false;
alter table sightings add column if not exists expires_at timestamptz;

create index if not exists sightings_expires_idx
  on sightings (expires_at) where expires_at is not null;

create table if not exists capture_requests (
  id bigserial primary key,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  -- 'pending' → waiting for the camera to poll; 'claimed' → camera is taking the shot.
  status text not null default 'pending'
);

create index if not exists capture_requests_pending_idx
  on capture_requests (requested_at) where status = 'pending';
