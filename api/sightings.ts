// /api/sightings
//   GET  ?limit=120&species=Blue%20Jay  → { sightings: Sighting[] }
//   POST (Bearer auth)                   → ingest one sighting from the camera
//
// Both methods no-op gracefully when the database isn't configured: GET returns
// an empty list (the client then shows seed data) and POST reports persisted:false.

// NOTE: relative imports use explicit .js extensions because this app is an ESM
// package ("type": "module"), and Vercel runs the compiled function as ESM —
// Node's ESM loader requires the extension or it throws ERR_MODULE_NOT_FOUND.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/db.js';
import { isAuthorized } from './_lib/auth.js';
import { uploadPhoto, deletePhoto } from './_lib/blob.js';
import { notifySighting } from './_lib/notify.js';
import { regenerateSpeciesInfo, geminiConfigured } from './_lib/genai.js';
import { moveDailySighting, recordDailySighting, removeDailySighting } from './_lib/rollups.js';
import { recordSightingCorrection } from './_lib/corrections.js';
import type { Sighting, SightingInput } from '../src/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') return await getSightings(req, res);
    if (req.method === 'POST') return await postSighting(req, res);
    if (req.method === 'PATCH') return await editSighting(req, res);
    if (req.method === 'DELETE') return await deleteSighting(req, res);
    res.status(405).json({ error: 'method' });
  } catch (err) {
    // Surface the real reason instead of a generic FUNCTION_INVOCATION_FAILED —
    // e.g. a missing `sightings` table or a Blob misconfiguration.
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/sightings] handler error:', detail);
    res.status(500).json({ error: 'server', detail });
  }
}

async function getSightings(req: VercelRequest, res: VercelResponse) {
  const limit = Math.max(
    1,
    Math.min(500, parseInt((req.query.limit as string) ?? '120', 10) || 120),
  );
  const species = typeof req.query.species === 'string' ? req.query.species : null;
  const day =
    typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day)
      ? req.query.day
      : null;
  // 'bird' (main gallery) or 'critter' (the non-bird sub-page); null = everything.
  const kind = typeof req.query.kind === 'string' ? req.query.kind : null;

  const sql = db();
  if (!sql) {
    res.status(200).json({ sightings: [] });
    return;
  }

  // Sweep out expired manual snapshots (the "we'll take this down shortly" ones)
  // before listing, so they vanish on their own without a cron job.
  await sql`delete from sightings where expires_at is not null and expires_at < now()`;

  // One query handles every filter combo — a NULL bind means "don't filter on it".
  // The species match is case-insensitive: the camera calls this endpoint to count
  // prior sightings for its rare-species gate, and Gemini's capitalization varies
  // run to run ("American Goldfinch" vs "American goldfinch"), which was splitting
  // the count across the two spellings.
  const rows = (await sql`
    select id, captured_at, species, scientific_name, confidence, fun_facts,
           image_url, device, manual, expires_at, kind, box
    from sightings
    where (${kind}::text is null or kind = ${kind})
      and (${species}::text is null or lower(species) = lower(${species}))
      and (${day}::text is null or (captured_at at time zone 'America/New_York')::date = ${day}::date)
    order by captured_at desc limit ${limit}`) as Record<string, unknown>[];

  const sightings: Sighting[] = rows.map(rowToSighting);

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.status(200).json({ sightings });
}

// Maps a sightings row (the standard column set selected above and by the PATCH
// edit below) into the shared Sighting shape the website renders.
function rowToSighting(r: Record<string, unknown>): Sighting {
  return {
    id: String(r.id),
    capturedAt: new Date(r.captured_at as string).toISOString(),
    species: r.species as string,
    scientificName: (r.scientific_name as string | null) ?? undefined,
    confidence: r.confidence == null ? undefined : Number(r.confidence),
    funFacts: (r.fun_facts as string[] | null) ?? [],
    imageUrl: r.image_url as string,
    device: (r.device as string | null) ?? undefined,
    manual: r.manual === true ? true : undefined,
    expiresAt: r.expires_at ? new Date(r.expires_at as string).toISOString() : undefined,
    kind: r.kind === 'critter' ? 'critter' : 'bird',
    box: parseBox(r.box) ?? undefined,
  };
}

async function postSighting(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as SightingInput;
  const species = typeof body.species === 'string' ? body.species.trim() : '';
  if (!species) {
    res.status(400).json({ error: 'species required' });
    return;
  }

  const capturedAt =
    typeof body.capturedAt === 'string' ? body.capturedAt : new Date().toISOString();
  const funFacts = Array.isArray(body.funFacts)
    ? body.funFacts.filter((f): f is string => typeof f === 'string').slice(0, 6)
    : [];
  const manual = body.manual === true;
  const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null;
  const kind = body.kind === 'critter' ? 'critter' : 'bird';
  const box = parseBox(body.box);

  // Resolve the photo URL: upload inline base64 to Blob, else accept a URL.
  let imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  if (body.imageBase64) {
    const uploaded = await uploadPhoto(body.imageBase64, slug(species));
    if (uploaded) imageUrl = uploaded;
  }
  if (!imageUrl) {
    res.status(400).json({ error: 'imageBase64 (with Blob configured) or imageUrl required' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, persisted: false, imageUrl });
    return;
  }

  const inserted = (await sql`
    insert into sightings
      (captured_at, species, scientific_name, confidence, fun_facts, image_url, device,
       manual, expires_at, kind, box)
    values
      (${capturedAt}, ${species}, ${body.scientificName ?? null}, ${body.confidence ?? null},
       ${JSON.stringify(funFacts)}::jsonb, ${imageUrl}, ${body.device ?? null},
       ${manual}, ${expiresAt}, ${kind}, ${box ? JSON.stringify(box) : null}::jsonb)
    returning id`) as { id: string | number }[];

  if (!expiresAt) await recordDailySighting(sql, { capturedAt, species, kind });

  // Alert only on a NET-NEW species — the first time we've ever logged it — so the
  // regulars don't blast dozens of texts a day. Daily rollups keep this correct
  // even after old common-photo rows are archived out of the gallery.
  // Manual "take a photo now" snapshots never alert. No-ops unless Twilio is set.
  if (!manual) {
    const prior = (await sql`
      select coalesce(sum(count), 0)::int as n
        from sighting_daily_counts
       where lower(species) = lower(${species})
         and kind = ${kind}
    `) as { n: number }[];
    if ((prior[0]?.n ?? 0) <= 1) {
      await notifySighting({ kind, species, imageUrl, funFacts }).catch(() => {});
    }
  }

  res.status(200).json({ ok: true, persisted: true, id: String(inserted[0]?.id), imageUrl });
}

// PATCH a sighting's species — the admin "edit which bird this is" control, for
// correcting a misidentification without deleting the photo. Gated by the same
// ADMIN_PIN as delete (no PIN set → closed). Changing the species kicks off a
// refresh loop: we re-derive the scientific name + fun facts from Gemini (so the
// bio matches the corrected bird), and because the website fetches the Wikipedia
// reference photo live by species, that updates on its own once this returns.
async function editSighting(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as {
    pin?: unknown;
    id?: unknown;
    species?: unknown;
    imageUrl?: unknown;
  };

  const rawId = body.id ?? req.query.id;
  const id =
    typeof rawId === 'string' ? rawId.trim() : typeof rawId === 'number' ? String(rawId) : '';
  const species = typeof body.species === 'string' ? body.species.trim() : '';
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  if (!species && imageUrl && isAuthorized(req)) {
    return await replaceSightingImage(res, id, imageUrl);
  }

  const adminPin = process.env.ADMIN_PIN?.trim();
  if (!adminPin) {
    res.status(403).json({ error: 'editing disabled (set ADMIN_PIN)' });
    return;
  }

  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!pin || pin !== adminPin) {
    res.status(401).json({ error: 'bad pin' });
    return;
  }

  if (!species && imageUrl) {
    return await replaceSightingImage(res, id, imageUrl);
  }
  if (!species) {
    res.status(400).json({ error: 'species required' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, updated: false });
    return;
  }

  // What kind of subject this is decides how we prompt Gemini for the new facts.
  const existing = (await sql`
    select captured_at, species, kind, expires_at, confidence, image_url, device, box
      from sightings
     where id = ${id}
  `) as {
    captured_at: string | Date;
    species: string;
    kind: string;
    expires_at: string | null;
    confidence: number | string | null;
    image_url: string | null;
    device: string | null;
    box: unknown;
  }[];
  if (existing.length === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const kind: 'bird' | 'critter' = existing[0]?.kind === 'critter' ? 'critter' : 'bird';

  // Regenerate the scientific name + facts for the corrected species. If Gemini
  // isn't configured (or the call fails), clear them rather than keep facts that
  // describe the old, wrong bird — the species and reference photo still update.
  const info = await regenerateSpeciesInfo(species, kind);
  const scientificName = info?.scientificName ?? null;
  const funFacts = info?.funFacts ?? [];

  const rows = (await sql`
    update sightings
       set species = ${species},
           scientific_name = ${scientificName},
           fun_facts = ${JSON.stringify(funFacts)}::jsonb
     where id = ${id}
    returning id, captured_at, species, scientific_name, confidence, fun_facts,
              image_url, device, manual, expires_at, kind, box
  `) as Record<string, unknown>[];

  if (rows.length === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const capturedAt = toIso(existing[0]!.captured_at);
  try {
    await recordSightingCorrection(sql, {
      sightingId: id,
      kind,
      originalSpecies: existing[0]!.species,
      correctedSpecies: species,
      confidence:
        existing[0]!.confidence == null
          ? null
          : Math.max(0, Math.min(1, Number(existing[0]!.confidence))),
      device: existing[0]!.device,
      capturedAt,
      imageUrl: existing[0]!.image_url,
      box: existing[0]!.box,
    });
  } catch (err) {
    console.error(
      '[/api/sightings] correction feedback save failed:',
      err instanceof Error ? err.message : err,
    );
  }

  if (!existing[0]?.expires_at) {
    await moveDailySighting(
      sql,
      { capturedAt, species: existing[0]!.species, kind },
      { capturedAt, species, kind },
    );
  }

  res.status(200).json({
    ok: true,
    updated: true,
    // Tells the admin whether the AI bio actually refreshed, so a missing
    // GEMINI_API_KEY shows up as "facts couldn't refresh" rather than silently
    // wiping them.
    regenerated: info !== null,
    geminiConfigured: geminiConfigured(),
    sighting: rowToSighting(rows[0] as Record<string, unknown>),
  });
}

async function replaceSightingImage(res: VercelResponse, id: string, imageUrl: string) {
  if (!isSightingsBlobUrl(imageUrl)) {
    res.status(400).json({ error: 'imageUrl must be a sightings Blob URL' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, updated: false });
    return;
  }

  const rows = (await sql`
    update sightings
       set image_url = ${imageUrl}
     where id = ${id}
    returning id, captured_at, species, scientific_name, confidence, fun_facts,
              image_url, device, manual, expires_at, kind, box
  `) as Record<string, unknown>[];

  if (rows.length === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  res.status(200).json({
    ok: true,
    updated: true,
    sighting: rowToSighting(rows[0] as Record<string, unknown>),
  });
}

function isSightingsBlobUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.public.blob.vercel-storage.com') &&
      url.pathname.startsWith('/sightings/')
    );
  } catch {
    return false;
  }
}

// DELETE a sighting by id — the "remove this photo" control on the site, used to
// clear out the occasional misidentification. Gated by a shared ADMIN_PIN. Unlike
// the (harmless) capture button, deletion is destructive, so there is NO default
// PIN: if ADMIN_PIN isn't set the endpoint stays closed.
async function deleteSighting(req: VercelRequest, res: VercelResponse) {
  const adminPin = process.env.ADMIN_PIN?.trim();
  if (!adminPin) {
    res.status(403).json({ error: 'delete disabled (set ADMIN_PIN)' });
    return;
  }

  const body = (req.body ?? {}) as { pin?: unknown; id?: unknown };
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!pin || pin !== adminPin) {
    res.status(401).json({ error: 'bad pin' });
    return;
  }

  // id may arrive in the body or as ?id= for convenience.
  const rawId = body.id ?? req.query.id;
  const id =
    typeof rawId === 'string' ? rawId.trim() : typeof rawId === 'number' ? String(rawId) : '';
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  const sql = db();
  if (!sql) {
    res.status(200).json({ ok: true, deleted: false });
    return;
  }

  const rows = (await sql`
    delete from sightings
     where id = ${id}
    returning image_url, captured_at, species, kind, expires_at, confidence, device, box, manual
  `) as {
    image_url: string;
    captured_at: string | Date;
    species: string;
    kind: string;
    expires_at: string | null;
    confidence: number | string | null;
    device: string | null;
    box: unknown;
    manual: boolean | null;
  }[];

  // Tidy up the orphaned photo (best-effort; only our own Blob uploads).
  if (rows[0]?.image_url) await deletePhoto(rows[0].image_url);
  if (rows[0] && !rows[0].expires_at) {
    await removeDailySighting(sql, {
      capturedAt: toIso(rows[0].captured_at),
      species: rows[0].species,
      kind: rows[0].kind === 'critter' ? 'critter' : 'bird',
    });
  }

  // Record the deletion as "corrected to none" feedback — the false-positive path
  // (e.g. a phantom "squirrel" posted from an empty frame) — so the camera learns
  // that past posts of this species here were removed as false detections. Skip
  // expiring manual snapshots (not an identification) and manual captures in
  // general (not the motion pipeline's call), and skip person/human photos (those
  // get deleted for privacy, not because the ID was wrong).
  const deleted = rows[0];
  const lowerSpecies = deleted?.species.trim().toLowerCase();
  if (
    deleted &&
    !deleted.expires_at &&
    deleted.manual !== true &&
    lowerSpecies !== 'person' &&
    lowerSpecies !== 'human'
  ) {
    try {
      await recordSightingCorrection(sql, {
        sightingId: null,
        kind: deleted.kind === 'critter' ? 'critter' : 'bird',
        originalSpecies: deleted.species,
        correctedSpecies: 'none',
        confidence:
          deleted.confidence == null ? null : Math.max(0, Math.min(1, Number(deleted.confidence))),
        device: deleted.device,
        capturedAt: toIso(deleted.captured_at),
        imageUrl: deleted.image_url,
        box: deleted.box,
      });
    } catch (err) {
      console.error(
        '[/api/sightings] correction feedback save failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  res.status(200).json({ ok: true, deleted: rows.length > 0 });
}

// A valid bounding box is four finite numbers, each clamped to 0–1. Anything else
// (missing, wrong length, NaN) → null, so the column stays empty and the website
// simply doesn't offer a "show me" highlight.
function parseBox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = nums.map((n) => Math.min(1, Math.max(0, n)));
  return [x, y, w, h];
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'bird'
  );
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
