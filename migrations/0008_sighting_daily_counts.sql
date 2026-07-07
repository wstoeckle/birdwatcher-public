-- Durable sighting history independent of photo retention.
-- Counts are grouped by feeder-local day so old common photos can be pruned
-- without making all-time totals or daily logs go backwards.

create table if not exists sighting_daily_counts (
  day date not null,
  kind text not null default 'bird' check (kind in ('bird', 'critter')),
  species text not null,
  count bigint not null default 0 check (count >= 0),
  first_seen timestamptz,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, kind, species)
);

create index if not exists sighting_daily_counts_kind_day_idx
  on sighting_daily_counts (kind, day desc);

create index if not exists sighting_daily_counts_species_idx
  on sighting_daily_counts (kind, species);

insert into sighting_daily_counts (day, kind, species, count, first_seen, last_seen)
select
  (captured_at at time zone 'America/New_York')::date as day,
  kind,
  species,
  count(*)::bigint as count,
  min(captured_at) as first_seen,
  max(captured_at) as last_seen
from sightings
where expires_at is null
group by 1, 2, 3
on conflict (day, kind, species) do update
  set count = greatest(sighting_daily_counts.count, excluded.count),
      first_seen = least(sighting_daily_counts.first_seen, excluded.first_seen),
      last_seen = greatest(sighting_daily_counts.last_seen, excluded.last_seen),
      updated_at = now();
