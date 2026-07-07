// /api/corrections
//   GET (Bearer auth) -> aggregate admin correction pairs for the camera prompt.
//
// The camera uses this as a lightweight feedback loop: "when the AI used to call
// a crop X, the admin corrected it to Y." It returns no per-user admin data and
// degrades to an empty list without a database.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';
import { isAuthorized } from './_lib/auth.js';
import { listCorrectionHints } from './_lib/corrections.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method' });
      return;
    }
    if (!isAuthorized(req)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const kind = req.query.kind === 'critter' ? 'critter' : 'bird';
    const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit ?? '12'), 10) || 12));
    const sql = db();
    if (!sql) {
      res.status(200).json({ corrections: [] });
      return;
    }

    const corrections = await listCorrectionHints(sql, kind, limit);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ corrections });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/corrections] handler error:', detail);
    res.status(500).json({ error: 'server', detail });
  }
}
