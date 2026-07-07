import type { neon } from '@neondatabase/serverless';

type Sql = ReturnType<typeof neon>;
type SightingKind = 'bird' | 'critter';

export interface CorrectionHint {
  originalSpecies: string;
  correctedSpecies: string;
  count: number;
  latestAt: string;
}

let ensured = false;

export async function ensureSightingCorrections(sql: Sql): Promise<void> {
  if (ensured) return;
  await sql`
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
    )
  `;
  await sql`
    create index if not exists sighting_corrections_kind_idx
      on sighting_corrections (kind, created_at desc)
  `;
  await sql`
    create index if not exists sighting_corrections_pair_idx
      on sighting_corrections (kind, original_species, corrected_species)
  `;
  ensured = true;
}

export async function recordSightingCorrection(
  sql: Sql,
  correction: {
    // Deletions pass null — the sighting row is already gone by the time we
    // record the correction, and inserting a dangling id would violate the
    // `references sightings(id)` constraint.
    sightingId: string | null;
    kind: SightingKind;
    originalSpecies: string;
    correctedSpecies: string;
    confidence: number | null;
    device: string | null;
    capturedAt: string;
    imageUrl: string | null;
    box: unknown;
  },
): Promise<void> {
  const original = correction.originalSpecies.trim();
  const corrected = correction.correctedSpecies.trim();
  if (!original || !corrected || original.toLowerCase() === corrected.toLowerCase()) return;

  await ensureSightingCorrections(sql);
  await sql`
    insert into sighting_corrections
      (sighting_id, kind, original_species, corrected_species, confidence,
       device, captured_at, image_url, box)
    values
      (${correction.sightingId}, ${correction.kind}, ${original}, ${corrected},
       ${correction.confidence}, ${correction.device}, ${correction.capturedAt},
       ${correction.imageUrl}, ${JSON.stringify(correction.box ?? null)}::jsonb)
  `;
}

export async function listCorrectionHints(
  sql: Sql,
  kind: SightingKind,
  limit: number,
): Promise<CorrectionHint[]> {
  await ensureSightingCorrections(sql);
  const rows = (await sql`
    select original_species, corrected_species, count(*)::int as count, max(created_at) as latest_at
      from sighting_corrections
     where kind = ${kind}
     group by original_species, corrected_species
     order by count(*) desc, max(created_at) desc, corrected_species asc
     limit ${limit}
  `) as {
    original_species: string;
    corrected_species: string;
    count: number | string;
    latest_at: string | Date;
  }[];

  return rows.map((row) => ({
    originalSpecies: row.original_species,
    correctedSpecies: row.corrected_species,
    count: Number(row.count),
    latestAt:
      row.latest_at instanceof Date
        ? row.latest_at.toISOString()
        : new Date(row.latest_at).toISOString(),
  }));
}
