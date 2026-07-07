// Shared shape of a bird sighting, used by both the website (src/) and the
// serverless API (api/). The Raspberry Pi produces these; the gallery renders
// them.

export interface Sighting {
  /** Stable unique id (database id, or a generated one for seed data). */
  id: string;
  /** ISO 8601 timestamp of when the photo was taken (UTC). */
  capturedAt: string;
  /** Common name, e.g. "Northern Cardinal". */
  species: string;
  /** Latin/scientific name, e.g. "Cardinalis cardinalis". */
  scientificName?: string;
  /** Model confidence 0–1 that the identification is correct. */
  confidence?: number;
  /** A few short, friendly facts about the species. */
  funFacts: string[];
  /** Public URL of the captured photo. */
  imageUrl: string;
  /** Which camera/feeder this came from, e.g. "backyard-feeder". */
  device?: string;
  /** True if a person triggered this shot from the website "take a photo now"
   *  button, rather than the camera's motion detector. */
  manual?: boolean;
  /** ISO 8601 time after which this sighting auto-disappears. Set only for manual
   *  snapshots that weren't a confident bird — shown briefly, then removed. */
  expiresAt?: string;
  /** "bird" (default) shows on the main gallery; "critter" (a non-bird animal or
   *  person) shows on the separate visitor sub-page. */
  kind?: 'bird' | 'critter';
  /** Bounding box around the identified subject, for the "show me" highlight:
   *  [x, y, width, height] as fractions 0–1 with (x, y) at the top-left corner. */
  box?: [number, number, number, number];
}

/** A photo-backed tally of non-bird visitor sightings. */
export interface CritterCount {
  /** Display species from the actual critter photos, e.g. "Eastern Gray Squirrel". */
  species: string;
  count: number;
  /** ISO 8601 timestamp of the most recent sighting. */
  lastSeen: string;
}

export interface ActivitySpecies {
  species: string;
  count: number;
  lastSeen: string;
}

export interface ActivityDay {
  day: string;
  total: number;
  species: { species: string; count: number }[];
}

export interface ActivityReport {
  totals: { total: number; species: number };
  species: ActivitySpecies[];
  days: ActivityDay[];
}

/** What the Pi POSTs to /api/critters to add one to a category's tally. */
export interface CritterInput {
  species: string;
}

/** What the Pi POSTs to /api/sightings. Image may be inline base64 or a URL. */
export interface SightingInput {
  capturedAt?: string;
  species: string;
  scientificName?: string;
  confidence?: number;
  funFacts?: string[];
  /** Base64-encoded JPEG (no data: prefix). Uploaded to Blob by the server. */
  imageBase64?: string;
  /** Alternatively, a photo already hosted somewhere public. */
  imageUrl?: string;
  device?: string;
  /** True if this came from the website capture button (vs. motion detection). */
  manual?: boolean;
  /** ISO 8601 expiry — set for a manual snapshot that should auto-delete. */
  expiresAt?: string;
  /** "bird" (default) or "critter" (a non-bird animal/person → the visitor sub-page). */
  kind?: 'bird' | 'critter';
  /** Optional bounding box [x, y, width, height], fractions 0–1, top-left origin. */
  box?: [number, number, number, number];
}
