// /api/archive
//   GET  (Vercel Cron, Bearer CRON_SECRET)       -> prune old excess bird photos
//   POST (admin pin, dryRun defaults to true)    -> preview or run the same prune

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';
import { deletePhoto } from './_lib/blob.js';
import { backfillDailyCounts } from './_lib/rollups.js';

interface ArchiveBody {
  pin?: unknown;
  dryRun?: unknown;
  kind?: unknown;
  minAgeDays?: unknown;
  keepPerSpecies?: unknown;
  minSpeciesPhotos?: unknown;
  batchSize?: unknown;
}

interface ArchiveCandidate {
  id: string | number;
  image_url: string;
  species: string;
  kind: string;
  captured_at: string | Date;
  species_photos: number | string;
  recent_rank: number | string;
}

const DEFAULT_MIN_AGE_DAYS = 30;
const DEFAULT_KEEP_PER_SPECIES = 50;
const DEFAULT_MIN_SPECIES_PHOTOS = 75;
const DEFAULT_BATCH_SIZE = 100;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method' });
    return;
  }

  const body = (req.body ?? {}) as ArchiveBody;
  const cron = req.method === 'GET';
  if (cron) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  } else if (!hasAdminPin(body)) {
    res.status(process.env.ADMIN_PIN ? 401 : 403).json({ error: 'bad pin' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, persisted: false, deleted: 0, candidates: [] });
    return;
  }

  const kind = body.kind === 'critter' || req.query.kind === 'critter' ? 'critter' : 'bird';
  const dryRun = cron ? req.query.dryRun === 'true' : body.dryRun !== false;
  const minAgeDays = intParam(body.minAgeDays, req.query.minAgeDays, DEFAULT_MIN_AGE_DAYS, 1, 3650);
  const keepPerSpecies = intParam(
    body.keepPerSpecies,
    req.query.keepPerSpecies,
    DEFAULT_KEEP_PER_SPECIES,
    1,
    500,
  );
  const minSpeciesPhotos = intParam(
    body.minSpeciesPhotos,
    req.query.minSpeciesPhotos,
    DEFAULT_MIN_SPECIES_PHOTOS,
    keepPerSpecies + 1,
    10_000,
  );
  const batchSize = intParam(body.batchSize, req.query.batchSize, DEFAULT_BATCH_SIZE, 1, 250);

  // This is the guardrail: make sure every existing photo has been summarized
  // before any old rows/blobs are pruned.
  await backfillDailyCounts(sql);

  const candidates = (await sql`
    with ranked as (
      select
        id,
        image_url,
        species,
        kind,
        captured_at,
        count(*) over (partition by kind, species) as species_photos,
        row_number() over (partition by kind, species order by captured_at desc, id desc) as recent_rank
      from sightings
      where expires_at is null
        and manual = false
        and kind = ${kind}
    )
    select id, image_url, species, kind, captured_at, species_photos, recent_rank
      from ranked
     where species_photos >= ${minSpeciesPhotos}
       and recent_rank > ${keepPerSpecies}
       and captured_at < now() - (${minAgeDays}::int * interval '1 day')
     order by captured_at asc
     limit ${batchSize}
  `) as ArchiveCandidate[];

  const preview = candidates.slice(0, 20).map((row) => ({
    id: String(row.id),
    species: row.species,
    capturedAt: toIso(row.captured_at),
    speciesPhotos: Number(row.species_photos),
    recentRank: Number(row.recent_rank),
  }));

  if (dryRun || candidates.length === 0) {
    res.status(200).json({
      ok: true,
      dryRun,
      kind,
      deleted: 0,
      candidateCount: candidates.length,
      candidates: preview,
      policy: { minAgeDays, keepPerSpecies, minSpeciesPhotos, batchSize },
    });
    return;
  }

  let deleted = 0;
  for (const row of candidates) {
    const removed = (await sql`
      delete from sightings
       where id = ${row.id}
      returning image_url
    `) as { image_url: string }[];
    if (removed.length > 0) {
      deleted += 1;
      await deletePhoto(removed[0].image_url);
    }
  }

  res.status(200).json({
    ok: true,
    dryRun: false,
    kind,
    deleted,
    candidateCount: candidates.length,
    candidates: preview,
    policy: { minAgeDays, keepPerSpecies, minSpeciesPhotos, batchSize },
  });
}

function hasAdminPin(body: ArchiveBody): boolean {
  const adminPin = process.env.ADMIN_PIN?.trim();
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  return Boolean(adminPin && pin && pin === adminPin);
}

function intParam(
  bodyValue: unknown,
  queryValue: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = bodyValue ?? (typeof queryValue === 'string' ? queryValue : undefined);
  const parsed = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
