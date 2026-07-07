import type { ActivityReport, ActivitySpecies, Sighting } from './types';

export interface SpeciesSummary {
  species: string;
  count: number;
  lastSeen: string;
  /** Most recent photo for this species, for the chip thumbnail. */
  imageUrl?: string;
}

export interface CameraSummary {
  device: string;
  label: string;
  count: number;
  lastSeen: string;
}

// Friendly gallery labels, keyed by each camera's `device_name` from
// camera/config.toml. Add an entry per camera you deploy.
const DEVICE_LABELS: Record<string, string> = {
  'feeder-pi': 'Pi camera',
  'yard-reolink': 'Reolink',
};

// If you ever rename a camera, map its old device_name to the new one here so
// existing sightings still group under the same filter chip.
const DEVICE_ALIASES: Record<string, string> = {
  'feeder-cam': 'feeder-pi',
};

const SPECIES_RECENCY_DAYS = 30;
const BEST_OLDER_SPECIES_PHOTOS = 5;
// The feeder's local timezone — daily activity rolls up on this clock.
const FEEDER_TIME_ZONE = 'America/New_York';
const FEEDER_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: FEEDER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function normalizeDevice(device: string): string {
  return DEVICE_ALIASES[device] ?? device;
}

export function cameraLabel(device: string): string {
  const normalized = normalizeDevice(device);
  return DEVICE_LABELS[normalized] ?? normalized;
}

/** Roll sightings up into a per-species "life list", most recent first. */
export function summarizeSpecies(sightings: Sighting[]): SpeciesSummary[] {
  const byName = new Map<string, SpeciesSummary>();
  for (const s of sightings) {
    // Temporary manual snapshots (a person's "take a photo now" shot that wasn't a
    // bird) aren't part of the life list — skip them so they don't add filter chips.
    if (s.expiresAt) continue;
    const existing = byName.get(s.species);
    if (!existing) {
      byName.set(s.species, {
        species: s.species,
        count: 1,
        lastSeen: s.capturedAt,
        imageUrl: s.imageUrl,
      });
    } else {
      existing.count += 1;
      if (s.capturedAt > existing.lastSeen) {
        existing.lastSeen = s.capturedAt;
        existing.imageUrl = s.imageUrl;
      }
    }
  }
  return [...byName.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function mergeSightings(existing: Sighting[], incoming: Sighting[]): Sighting[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const sighting of incoming) byId.set(sighting.id, sighting);
  return [...byId.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function curateSpeciesSightings(
  sightings: Sighting[],
  historyTotal: number,
  now = new Date(),
): Sighting[] {
  const ordered = [...sightings].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (historyTotal <= BEST_OLDER_SPECIES_PHOTOS) return ordered;

  const cutoff = now.getTime() - SPECIES_RECENCY_DAYS * DAY;
  const recent = ordered.filter((s) => new Date(s.capturedAt).getTime() >= cutoff);
  const older = ordered.filter((s) => new Date(s.capturedAt).getTime() < cutoff);
  const bestOlder = older
    .sort((a, b) => photoScore(b) - photoScore(a) || b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, BEST_OLDER_SPECIES_PHOTOS);

  return mergeSightings(recent, bestOlder);
}

export function archivedPhotoCount(historyTotal: number, retainedPhotos: number): number {
  return Math.max(0, historyTotal - retainedPhotos);
}

export function feederDay(iso: string): string {
  const parts = FEEDER_DAY_FORMATTER.formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  return `${year}-${month}-${day}`;
}

function photoScore(s: Sighting): number {
  const confidence = s.confidence ?? 0;
  const boxed = s.box ? 0.1 : 0;
  const manual = s.manual ? -0.2 : 0;
  return confidence + boxed + manual;
}

export function mergeSpeciesHistory(
  history: ActivitySpecies[] | undefined,
  sightings: Sighting[],
): SpeciesSummary[] {
  if (!history || history.length === 0) return summarizeSpecies(sightings);

  const photos = new Map(summarizeSpecies(sightings).map((row) => [row.species, row]));
  return history
    .map((row) => {
      const photo = photos.get(row.species);
      return {
        species: row.species,
        count: row.count,
        lastSeen: row.lastSeen || photo?.lastSeen || '',
        imageUrl: photo?.imageUrl,
      };
    })
    .sort((a, b) => b.count - a.count || a.species.localeCompare(b.species));
}

/** Roll sightings up by camera so the gallery can be filtered by source. */
export function summarizeCameras(sightings: Sighting[]): CameraSummary[] {
  const byDevice = new Map<string, CameraSummary>();
  for (const s of sightings) {
    if (s.expiresAt || !s.device) continue;
    const device = normalizeDevice(s.device);
    const existing = byDevice.get(device);
    if (!existing) {
      byDevice.set(device, {
        device,
        label: cameraLabel(device),
        count: 1,
        lastSeen: s.capturedAt,
      });
    } else {
      existing.count += 1;
      if (s.capturedAt > existing.lastSeen) existing.lastSeen = s.capturedAt;
    }
  }
  return [...byDevice.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** Headline numbers for a gallery (birds or critters): how many photos, and how
 *  many distinct species. Temporary manual snapshots (which auto-expire) don't
 *  count toward either. */
export function sightingTotals(sightings: Sighting[]): { total: number; species: number } {
  const kept = sightings.filter((s) => !s.expiresAt);
  return { total: kept.length, species: new Set(kept.map((s) => s.species)).size };
}

export function activityTotals(
  activity: ActivityReport | null | undefined,
  sightings: Sighting[],
): { total: number; species: number } {
  if (activity) return activity.totals;
  return sightingTotals(sightings);
}

/** Given a list of sightings in display order and the id currently open, return
 *  the ids of the previous and next photos (or null at the ends) — used to flip
 *  through the gallery with the left/right arrow keys from inside the modal. */
export function adjacentSightingIds(
  ordered: Sighting[],
  currentId: string | null,
): { prevId: string | null; nextId: string | null } {
  if (currentId == null) return { prevId: null, nextId: null };
  const i = ordered.findIndex((s) => s.id === currentId);
  if (i === -1) return { prevId: null, nextId: null };
  return {
    prevId: i > 0 ? (ordered[i - 1]?.id ?? null) : null,
    nextId: i < ordered.length - 1 ? (ordered[i + 1]?.id ?? null) : null,
  };
}

const IRREGULAR_PLURALS: Record<string, string> = {
  deer: 'deer',
  mouse: 'mice',
  person: 'people',
  human: 'people',
  goose: 'geese',
  fox: 'foxes',
};

/** Pluralize a critter label for display: "squirrel" + 2 → "squirrels". */
export function pluralize(word: string, n: number): string {
  if (n === 1) return word;
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

const DAY = 86_400_000;

/** Friendly relative-ish date, e.g. "Today at 2:14 PM" or "Mar 3 at 9:01 AM". */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - DAY).toDateString() === d.toDateString();
  if (sameDay) return `Today at ${time}`;
  if (yesterday) return `Yesterday at ${time}`;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date} at ${time}`;
}
