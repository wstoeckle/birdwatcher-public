// Sends SMS/MMS alerts via Twilio's REST API (no SDK — just a single POST). No-ops
// unless the Twilio env vars are set, so the site runs perfectly fine without it.
//
// Env vars (set in the Vercel project, NEVER in the repo — they hold secrets/PII):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  — Twilio API credentials
//   TWILIO_FROM        — the Twilio phone number to send from (e.g. +1508…)
//   ALERT_SMS_TO       — comma-separated numbers that get every BIRD alert
//   ALERT_SMS_CRITTERS — comma-separated numbers that ALSO opt in to non-bird alerts
// Recipients also include anyone who signed up at /alerts (the `subscribers` table).

import { db } from './db.js';

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM;
// Public URL of the gallery, appended to alert texts (e.g. https://your-domain.example).
const SITE_URL = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');

function numbers(envValue: string | undefined): string[] {
  return (envValue ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendOne(to: string, body: string, mediaUrl?: string): Promise<void> {
  const form = new URLSearchParams({ To: to, From: FROM as string, Body: body });
  if (mediaUrl) form.set('MediaUrl', mediaUrl);
  const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) {
    console.error('[notify] Twilio send failed:', res.status, (await res.text()).slice(0, 200));
  }
}

export interface AlertSighting {
  kind: 'bird' | 'critter';
  species: string;
  imageUrl: string;
  funFacts: string[];
}

// Public sign-ups from the /alerts page. Birds go to everyone; critters only to
// those who also opted into the non-bird stream.
async function subscriberNumbers(kind: 'bird' | 'critter'): Promise<string[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = (kind === 'bird'
      ? await sql`select phone from subscribers`
      : await sql`select phone from subscribers where wants_critters = true`) as {
      phone: string;
    }[];
    return rows.map((r) => r.phone);
  } catch {
    return [];
  }
}

// Fire SMS/MMS alerts for a freshly-stored sighting. Never throws — a notification
// failure must not fail the ingest. No-ops when Twilio isn't configured or when no
// recipients are listed for this kind of sighting.
export async function notifySighting(s: AlertSighting): Promise<void> {
  if (!SID || !TOKEN || !FROM) return;

  // Recipients = configured owner/family numbers + anyone who signed up online.
  const env =
    s.kind === 'bird' ? numbers(process.env.ALERT_SMS_TO) : numbers(process.env.ALERT_SMS_CRITTERS);
  const to = [...new Set([...env, ...(await subscriberNumbers(s.kind))])];
  if (to.length === 0) return;

  const fact = s.funFacts[0] ? ` ${s.funFacts[0]}` : '';
  const body =
    s.kind === 'bird'
      ? `🐦 ${s.species} just visited the feeder!${fact}${SITE_URL ? `\n${SITE_URL}` : ''}`
      : `🐾 ${s.species} spotted at the feeder.${SITE_URL ? `\n${SITE_URL}/critters` : ''}`;

  // Twilio fetches MediaUrl itself, so the image must be publicly reachable
  // (Vercel Blob URLs are). Each send guards its own errors so one bad number
  // can't drop the others.
  await Promise.all(to.map((n) => sendOne(n, body, s.imageUrl).catch(() => {})));
}
