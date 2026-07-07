// /api/usage
//   POST (Bearer auth)  → the camera records one Gemini call's token usage
//   GET  (?pin=ADMIN_PIN) → the /spend page reads the rolled-up estimate
//
// "Self-tracked estimate": we count the tokens the camera actually spent and
// multiply by published per-token prices. It's a budgeting aid, NOT the real bill.
// Like the other handlers, both methods degrade gracefully without a database.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';
import { isAuthorized } from './_lib/auth.js';

// Estimated USD per 1M tokens by model (Google list prices). Update if they change.
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
};
const DEFAULT_PRICE = { input: 0.3, output: 2.5 };

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? DEFAULT_PRICE;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'POST') return await recordUsage(req, res);
    if (req.method === 'GET') return await getUsage(req, res);
    res.status(405).json({ error: 'method' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/usage] handler error:', detail);
    res.status(500).json({ error: 'server', detail });
  }
}

// Camera-only (Bearer auth): add one call's tokens to today's running total.
async function recordUsage(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as {
    model?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };
  const model =
    typeof body.model === 'string' && body.model.trim()
      ? body.model.trim().slice(0, 80)
      : 'unknown';
  const inputTokens = Math.max(0, Math.floor(Number(body.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.floor(Number(body.outputTokens) || 0));

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, persisted: false });
    return;
  }

  await sql`
    insert into api_usage (day, model, calls, input_tokens, output_tokens)
    values (current_date, ${model}, 1, ${inputTokens}, ${outputTokens})
    on conflict (day, model) do update set
      calls = api_usage.calls + 1,
      input_tokens = api_usage.input_tokens + ${inputTokens},
      output_tokens = api_usage.output_tokens + ${outputTokens}
  `;
  res.status(200).json({ ok: true, persisted: true });
}

// Admin-only (shared ADMIN_PIN): the estimated spend report for the /spend page.
async function getUsage(req: VercelRequest, res: VercelResponse) {
  const adminPin = process.env.ADMIN_PIN?.trim();
  if (!adminPin) {
    res.status(403).json({ error: 'spend tracker disabled (set ADMIN_PIN)' });
    return;
  }
  const pin = (typeof req.query.pin === 'string' ? req.query.pin : '').trim();
  if (!pin || pin !== adminPin) {
    res.status(401).json({ error: 'bad pin' });
    return;
  }

  const sql = db();
  const empty = {
    estimatedUsd: 0,
    totals: { calls: 0, inputTokens: 0, outputTokens: 0 },
    days: [],
  };
  if (!sql) {
    res.status(200).json(empty);
    return;
  }

  const rows = (await sql`
    select day, model, calls, input_tokens, output_tokens
    from api_usage order by day desc limit 400
  `) as Record<string, unknown>[];

  // Roll the per-model rows up to one entry per day, with an estimated cost.
  const byDay = new Map<
    string,
    { calls: number; inputTokens: number; outputTokens: number; usd: number }
  >();
  const totals = { calls: 0, inputTokens: 0, outputTokens: 0 };
  let estimatedUsd = 0;

  for (const r of rows) {
    const day = String(r.day).slice(0, 10);
    const model = String(r.model);
    const calls = Number(r.calls) || 0;
    const inputTokens = Number(r.input_tokens) || 0;
    const outputTokens = Number(r.output_tokens) || 0;
    const usd = costUsd(model, inputTokens, outputTokens);

    const d = byDay.get(day) ?? { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    d.calls += calls;
    d.inputTokens += inputTokens;
    d.outputTokens += outputTokens;
    d.usd += usd;
    byDay.set(day, d);

    totals.calls += calls;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    estimatedUsd += usd;
  }

  const days = [...byDay.entries()].map(([day, d]) => ({ day, ...d }));
  res.status(200).json({ estimatedUsd, totals, days });
}
