import type { Sighting, CritterCount, ActivityReport } from './types';
import { SEED_SIGHTINGS, SEED_CRITTERS } from './seed';

// Sample/seed data stands in ONLY when running locally (no backend), so the
// gallery isn't empty during development. The deployed site never shows samples:
// an empty or unreachable result yields a real "no visitors yet" state instead
// of misleading stock photos.
const IS_LOCAL =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);

// Fetches sightings from the serverless API, optionally filtered to 'bird' (the
// main gallery) or 'critter' (the non-bird sub-page). Falls back to seed data only
// in local dev — and only for birds, so the critter page stays honestly empty.
export async function fetchSightings(
  kind?: 'bird' | 'critter',
  options: { species?: string; day?: string; limit?: number } = {},
): Promise<{ sightings: Sighting[]; usingSeed: boolean }> {
  const seedSightings = SEED_SIGHTINGS.filter(
    (s) =>
      (!options.species || s.species === options.species) &&
      (!options.day || s.capturedAt.slice(0, 10) === options.day),
  );
  const seed =
    IS_LOCAL && kind !== 'critter'
      ? { sightings: seedSightings, usingSeed: true }
      : { sightings: [], usingSeed: false };
  try {
    const params = new URLSearchParams({
      limit: String(options.limit ?? (options.species || options.day ? 500 : 120)),
    });
    if (kind) params.set('kind', kind);
    if (options.species) params.set('species', options.species);
    if (options.day) params.set('day', options.day);
    const res = await fetch(`/api/sightings?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { sightings?: Sighting[] };
    const sightings = data.sightings ?? [];
    if (sightings.length > 0) return { sightings, usingSeed: false };
    return seed;
  } catch {
    return seed;
  }
}

export async function fetchActivity(
  kind?: 'bird' | 'critter',
): Promise<{ activity: ActivityReport | null }> {
  try {
    const params = new URLSearchParams({ days: '120' });
    if (kind) params.set('kind', kind);
    const res = await fetch(`/api/activity?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const activity = (await res.json()) as Partial<ActivityReport>;
    if (!activity.totals || !Array.isArray(activity.species) || !Array.isArray(activity.days)) {
      throw new Error('invalid activity response');
    }
    return { activity: activity as ActivityReport };
  } catch {
    return { activity: null };
  }
}

// Asks the feeder camera to take a live photo now (the "take a photo now" button).
// Gated by a shared PIN. `queued` means a fresh request was accepted; `alreadyPending`
// means a shot was already on its way; `badPin` means the code was wrong.
export async function requestCapture(
  pin: string,
  camera: string,
): Promise<{ ok: boolean; queued: boolean; alreadyPending?: boolean; badPin?: boolean }> {
  try {
    const res = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, camera }),
    });
    if (res.status === 401) return { ok: false, queued: false, badPin: true };
    if (!res.ok) return { ok: false, queued: false };
    const data = (await res.json()) as { queued?: boolean; alreadyPending?: boolean };
    return { ok: true, queued: data.queued ?? false, alreadyPending: data.alreadyPending };
  } catch {
    return { ok: false, queued: false };
  }
}

// Removes a sighting (a misidentification, say) by id. Gated by the shared
// ADMIN_PIN. `badPin` flags a wrong code; `disabled` means the server has no
// ADMIN_PIN set, so deletion is turned off.
export async function deleteSighting(
  id: string,
  pin: string,
): Promise<{ ok: boolean; deleted: boolean; badPin?: boolean; disabled?: boolean }> {
  try {
    const res = await fetch('/api/sightings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pin }),
    });
    if (res.status === 401) return { ok: false, deleted: false, badPin: true };
    if (res.status === 403) return { ok: false, deleted: false, disabled: true };
    if (!res.ok) return { ok: false, deleted: false };
    const data = (await res.json()) as { deleted?: boolean };
    return { ok: true, deleted: data.deleted ?? false };
  } catch {
    return { ok: false, deleted: false };
  }
}

// Corrects a sighting's species (an admin fixing a misidentification). Gated by
// the shared ADMIN_PIN. On success the server regenerates the scientific name and
// fun facts for the new species and returns the updated sighting; `regenerated`
// is false if the AI bio couldn't refresh (e.g. no GEMINI_API_KEY), in which case
// the facts are cleared. `badPin`/`disabled` mirror the delete control.
export async function editSighting(
  id: string,
  pin: string,
  species: string,
): Promise<{
  ok: boolean;
  sighting?: Sighting;
  regenerated?: boolean;
  badPin?: boolean;
  disabled?: boolean;
}> {
  try {
    const res = await fetch('/api/sightings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pin, species }),
    });
    if (res.status === 401) return { ok: false, badPin: true };
    if (res.status === 403) return { ok: false, disabled: true };
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { sighting?: Sighting; regenerated?: boolean };
    return { ok: true, sighting: data.sighting, regenerated: data.regenerated };
  } catch {
    return { ok: false };
  }
}

// Signs a phone number up for text alerts (the /alerts page). `invalid` flags a
// bad number or missing consent.
export async function subscribe(
  phone: string,
  wantsCritters: boolean,
  consent: boolean,
): Promise<{ ok: boolean; invalid?: boolean }> {
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, wantsCritters, consent }),
    });
    if (res.status === 400) return { ok: false, invalid: true };
    if (!res.ok) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export interface UsageDay {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}
export interface UsageReport {
  estimatedUsd: number;
  totals: { calls: number; inputTokens: number; outputTokens: number };
  days: UsageDay[];
}

// Fetches the estimated Gemini spend (the /spend page). Admin-gated by ADMIN_PIN;
// `badPin` flags a wrong code, `disabled` means no ADMIN_PIN is configured.
export async function fetchUsage(
  pin: string,
): Promise<{ ok: boolean; report?: UsageReport; badPin?: boolean; disabled?: boolean }> {
  try {
    const res = await fetch(`/api/usage?pin=${encodeURIComponent(pin)}`);
    if (res.status === 401) return { ok: false, badPin: true };
    if (res.status === 403) return { ok: false, disabled: true };
    if (!res.ok) return { ok: false };
    const report = (await res.json()) as UsageReport;
    return { ok: true, report };
  } catch {
    return { ok: false };
  }
}

// Fetches critter tallies. Real (possibly empty) counts in production; seed only
// when there's no backend at all (local dev).
export async function fetchCritters(): Promise<{ critters: CritterCount[]; usingSeed: boolean }> {
  try {
    const res = await fetch('/api/critters');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { critters?: CritterCount[] };
    return { critters: data.critters ?? [], usingSeed: false };
  } catch {
    return IS_LOCAL
      ? { critters: SEED_CRITTERS, usingSeed: true }
      : { critters: [], usingSeed: false };
  }
}
