import type { neon } from '@neondatabase/serverless';

type Sql = ReturnType<typeof neon>;
type SightingKind = 'bird' | 'critter';

const FEEDER_TIME_ZONE = 'America/New_York';

let ensured = false;

export async function ensureDailyCounts(sql: Sql): Promise<void> {
  if (ensured) return;
  await sql`
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
    )
  `;
  await sql`
    create index if not exists sighting_daily_counts_kind_day_idx
      on sighting_daily_counts (kind, day desc)
  `;
  await sql`
    create index if not exists sighting_daily_counts_species_idx
      on sighting_daily_counts (kind, species)
  `;
  ensured = true;
}

export async function backfillDailyCounts(sql: Sql): Promise<void> {
  await ensureDailyCounts(sql);
  await sql`
    insert into sighting_daily_counts (day, kind, species, count, first_seen, last_seen)
    select
      (captured_at at time zone ${FEEDER_TIME_ZONE})::date as day,
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
          updated_at = now()
  `;
}

export async function recordDailySighting(
  sql: Sql,
  sighting: { capturedAt: string; species: string; kind: SightingKind },
): Promise<void> {
  await ensureDailyCounts(sql);
  await sql`
    insert into sighting_daily_counts (day, kind, species, count, first_seen, last_seen)
    values (
      (${sighting.capturedAt}::timestamptz at time zone ${FEEDER_TIME_ZONE})::date,
      ${sighting.kind},
      ${sighting.species},
      1,
      ${sighting.capturedAt},
      ${sighting.capturedAt}
    )
    on conflict (day, kind, species) do update
      set count = sighting_daily_counts.count + 1,
          first_seen = least(sighting_daily_counts.first_seen, excluded.first_seen),
          last_seen = greatest(sighting_daily_counts.last_seen, excluded.last_seen),
          updated_at = now()
  `;
}

export async function removeDailySighting(
  sql: Sql,
  sighting: { capturedAt: string; species: string; kind: SightingKind },
): Promise<void> {
  await ensureDailyCounts(sql);
  await sql`
    update sighting_daily_counts
       set count = greatest(0, count - 1),
           updated_at = now()
     where day = (${sighting.capturedAt}::timestamptz at time zone ${FEEDER_TIME_ZONE})::date
       and kind = ${sighting.kind}
       and species = ${sighting.species}
  `;
  await sql`delete from sighting_daily_counts where count = 0`;
}

export async function moveDailySighting(
  sql: Sql,
  from: { capturedAt: string; species: string; kind: SightingKind },
  to: { capturedAt: string; species: string; kind: SightingKind },
): Promise<void> {
  if (from.kind === to.kind && from.species === to.species) return;
  await removeDailySighting(sql, from);
  await recordDailySighting(sql, to);
}
