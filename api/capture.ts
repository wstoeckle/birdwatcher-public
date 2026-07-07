// /api/capture — the "take a photo now" button.
//   POST { pin, camera } → a website visitor asks one feeder camera for a live shot.
//                          Gated by a friendly shared PIN (CAPTURE_PIN env var,
//                          default "4434"). Queues one request for that camera.
//   GET  (Bearer auth)  → the Raspberry Pi polls this, claims the oldest pending
//                          request, and gets { pending: true, camera } so it knows
//                          which source to shoot now. The Pi sits behind a home
//                          router and only makes OUTBOUND calls, so it must poll —
//                          the site can't reach in.
//
// Like the other handlers, this degrades gracefully without a database: POST
// reports queued:false and GET pending:false.

// NOTE: relative imports use explicit .js extensions because this app is an ESM
// package ("type": "module") and Vercel runs the compiled function as ESM.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';
import { isAuthorized } from './_lib/auth.js';

// Reject a new request if one is already pending, or was claimed within this many
// seconds — so mashing the button (or a bot) can't pile up dozens of captures.
const DEDUPE_SECONDS = 90;
// Cameras the button can target — keep in sync with each camera's `device_name`
// in camera/config.toml and the CAMERAS list in src/components/CaptureButton.tsx.
const CAMERA_TARGETS = new Set(['feeder-pi', 'yard-reolink']);

function pendingStatus(camera: string) {
  return camera ? `pending:${camera}` : 'pending';
}

function targetFromStatus(status: string | undefined) {
  if (!status?.startsWith('claimed:')) return null;
  return status.slice('claimed:'.length) || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'POST') return await requestCapture(req, res);
    if (req.method === 'GET') return await claimCapture(req, res);
    res.status(405).json({ error: 'method' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/capture] handler error:', detail);
    res.status(500).json({ error: 'server', detail });
  }
}

// Public (PIN-gated): a visitor on the website asks the camera to take a photo now.
async function requestCapture(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as { pin?: unknown; camera?: unknown };
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  const camera = typeof body.camera === 'string' ? body.camera.trim() : '';
  if (camera && !CAMERA_TARGETS.has(camera)) {
    res.status(400).json({ error: 'bad camera' });
    return;
  }
  // Default PIN keeps the button working before the env var is set; override with
  // CAPTURE_PIN in the Vercel project to change it without a code change.
  const expected = (process.env.CAPTURE_PIN ?? '4434').trim();
  if (!pin || pin !== expected) {
    res.status(401).json({ error: 'bad pin' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, queued: false });
    return;
  }

  // If a shot is already on the way for this camera, don't queue another. A
  // legacy all-camera request (plain "pending"/"claimed") blocks both buttons.
  const inFlight = (await sql`
    select id from capture_requests
    where (
      status = 'pending'
      or status like 'pending:%'
      or (status = 'claimed' and claimed_at > now() - ${DEDUPE_SECONDS} * interval '1 second')
      or (status like 'claimed:%' and claimed_at > now() - ${DEDUPE_SECONDS} * interval '1 second')
    )
    and (
      ${camera || null}::text is null
      or status in ('pending', 'claimed')
      or status = ${`pending:${camera}`}
      or status = ${`claimed:${camera}`}
    )
    limit 1
  `) as { id: string | number }[];
  if (inFlight.length > 0) {
    res.status(200).json({ ok: true, queued: false, alreadyPending: true });
    return;
  }

  await sql`insert into capture_requests (status) values (${pendingStatus(camera)})`;
  res.status(200).json({ ok: true, queued: true });
}

// Pi-only (Bearer auth): atomically claim the oldest pending request, if any.
async function claimCapture(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ pending: false });
    return;
  }

  // Claim in a single statement so two polls can't grab the same request.
  const claimed = (await sql`
    with next_request as (
      select id, status
        from capture_requests
       where status = 'pending' or status like 'pending:%'
       order by requested_at asc
       limit 1
       for update skip locked
    )
    update capture_requests
       set status = case
         when next_request.status like 'pending:%'
           then 'claimed:' || split_part(next_request.status, ':', 2)
         else 'claimed'
       end,
       claimed_at = now()
      from next_request
     where capture_requests.id = next_request.id
    returning capture_requests.id, capture_requests.status
  `) as { id: string | number; status?: string }[];

  // Housekeeping: drop rows older than a day so the queue can't grow forever.
  await sql`delete from capture_requests where requested_at < now() - interval '1 day'`;

  res.status(200).json({
    pending: claimed.length > 0,
    camera: targetFromStatus(claimed[0]?.status),
  });
}
