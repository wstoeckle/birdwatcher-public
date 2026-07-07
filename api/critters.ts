// /api/critters
//   GET                 → { critters: CritterCount[] }  (photo counts, highest first)
//   POST (Bearer auth)  → increment one category's tally by one
//
// GET is derived from the actual critter photos in `sightings`, so deleting a bad
// photo immediately fixes the displayed tally. POST remains for older Pi clients
// that still send the legacy per-category counter, but the website no longer
// trusts that table for display.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';
import { isAuthorized } from './_lib/auth.js';
import type { CritterCount, CritterInput } from '../src/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') return await getCritters(req, res);
    if (req.method === 'POST') return await postCritter(req, res);
    res.status(405).json({ error: 'method' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/critters] handler error:', detail);
    res.status(500).json({ error: 'server', detail });
  }
}

async function getCritters(_req: VercelRequest, res: VercelResponse) {
  const sql = db();
  if (!sql) {
    res.status(200).json({ critters: [] });
    return;
  }
  const rows = (await sql`
    select species, count(*)::int as count, max(captured_at) as last_seen
      from sightings
     where kind = 'critter'
       and expires_at is null
     group by species
     order by count desc, last_seen desc
  `) as Record<string, unknown>[];

  const critters: CritterCount[] = rows.map((r) => ({
    species: r.species as string,
    count: Number(r.count),
    lastSeen: new Date(r.last_seen as string).toISOString(),
  }));

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.status(200).json({ critters });
}

async function postCritter(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as CritterInput;
  // Normalize to a short, lowercase label so "Squirrel" and "squirrel" tally together.
  const species =
    typeof body.species === 'string' ? body.species.trim().toLowerCase().slice(0, 40) : '';
  if (!species) {
    res.status(400).json({ error: 'species required' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, persisted: false, species });
    return;
  }

  const rows = (await sql`
    insert into critter_counts (species, count, last_seen)
    values (${species}, 1, now())
    on conflict (species) do update
      set count = critter_counts.count + 1, last_seen = now()
    returning count
  `) as { count: number | string }[];

  res.status(200).json({ ok: true, persisted: true, species, count: Number(rows[0]?.count) });
}
