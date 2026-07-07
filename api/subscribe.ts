// /api/subscribe — public sign-up for text alerts (the website /alerts form).
//   POST { phone, wantsCritters?, consent } → store the subscriber.
//
// No auth — it's a public opt-in form. The `consent` checkbox must be true. Stores
// the number in the `subscribers` table; the alert sender (api/_lib/notify) reads
// from there. No-ops gracefully when the database isn't configured.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';

// Normalize a US number to E.164 (+1XXXXXXXXXX), or null if it doesn't look valid.
function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[^\d]/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method' });
      return;
    }
    const body = (req.body ?? {}) as {
      phone?: unknown;
      wantsCritters?: unknown;
      consent?: unknown;
    };
    if (body.consent !== true) {
      res.status(400).json({ error: 'consent required' });
      return;
    }
    const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
    if (!phone) {
      res.status(400).json({ error: 'invalid phone' });
      return;
    }
    const wantsCritters = body.wantsCritters === true;

    const sql = db();
    if (!sql) {
      res.status(200).json({ ok: true, persisted: false });
      return;
    }
    // Upsert so re-signing-up just refreshes preferences / the consent timestamp.
    await sql`
      insert into subscribers (phone, wants_critters)
      values (${phone}, ${wantsCritters})
      on conflict (phone) do update
        set wants_critters = ${wantsCritters}, consented_at = now()
    `;
    res.status(200).json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/subscribe] handler error:', detail);
    res.status(500).json({ error: 'server', detail });
  }
}
