// /api/activity
//   GET ?kind=bird&days=30 -> durable totals and daily species log

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';
import { backfillDailyCounts } from './_lib/rollups.js';
import type { ActivityReport, ActivityDay } from '../src/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method' });
    return;
  }

  const kind = req.query.kind === 'critter' ? 'critter' : 'bird';
  const days = Math.max(1, Math.min(120, parseInt(String(req.query.days ?? '30'), 10) || 30));
  const sql = db();
  if (!sql) {
    res.status(200).json(emptyReport());
    return;
  }

  await backfillDailyCounts(sql);

  const speciesRows = (await sql`
    select species, sum(count)::int as count, max(last_seen) as last_seen
      from sighting_daily_counts
     where kind = ${kind}
     group by species
     order by count desc, max(last_seen) desc, species asc
  `) as { species: string; count: number | string; last_seen: string | Date | null }[];

  const dayRows = (await sql`
    select day, species, count::int as count
      from sighting_daily_counts
     where kind = ${kind}
       and day >= ((now() at time zone 'America/New_York')::date - ${days - 1}::int)
     order by day desc, count desc, species asc
  `) as { day: string | Date; species: string; count: number | string }[];

  const report: ActivityReport = {
    totals: {
      total: speciesRows.reduce((sum, row) => sum + Number(row.count), 0),
      species: speciesRows.length,
    },
    species: speciesRows.map((row) => ({
      species: row.species,
      count: Number(row.count),
      lastSeen: row.last_seen ? toIso(row.last_seen) : '',
    })),
    days: groupDays(dayRows),
  };

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.status(200).json(report);
}

function emptyReport(): ActivityReport {
  return { totals: { total: 0, species: 0 }, species: [], days: [] };
}

function groupDays(
  rows: { day: string | Date; species: string; count: number | string }[],
): ActivityDay[] {
  const byDay = new Map<string, ActivityDay>();
  for (const row of rows) {
    const day = formatDay(row.day);
    const existing = byDay.get(day);
    if (existing) {
      existing.total += Number(row.count);
      existing.species.push({ species: row.species, count: Number(row.count) });
    } else {
      byDay.set(day, {
        day,
        total: Number(row.count),
        species: [{ species: row.species, count: Number(row.count) }],
      });
    }
  }
  return [...byDay.values()];
}

function formatDay(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
