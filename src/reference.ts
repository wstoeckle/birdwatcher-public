// Canonical "this is what a <species> looks like" reference photos, pulled live
// from Wikipedia for any non-human sighting. Shown only in the detail modal — not
// on the gallery card — so the real captured photo stays the star.
//
// People are deliberately excluded: a stock photo of some random human would
// dilute the charm of catching an actual person (a family member!) at the feeder.

export interface ReferenceImage {
  imageUrl: string;
  pageUrl: string;
  title: string;
  sourceName: string;
  variantLabel?: string;
}

// Per-session cache so reopening the same species doesn't re-hit Wikipedia. A
// cached `null` means "looked it up, found nothing" — don't try again.
const cache = new Map<string, ReferenceImage | null>();

function isHuman(species: string, scientificName?: string): boolean {
  const s = species.trim().toLowerCase();
  return (
    s === 'person' ||
    s === 'human' ||
    (scientificName ?? '').trim().toLowerCase() === 'homo sapiens'
  );
}

export async function fetchReferenceImage(
  species: string,
  scientificName?: string,
  funFacts: string[] = [],
): Promise<ReferenceImage | null> {
  if (!species || isHuman(species, scientificName)) return null;

  // Prefer the scientific name (binomials resolve cleanly on Wikipedia, usually
  // via redirect), then fall back to the common name.
  const candidates = [scientificName, species].map((c) => c?.trim()).filter(Boolean) as string[];
  const variant = referenceSearchVariant(species, funFacts);
  const key = [...candidates, variant?.label ?? 'generic'].join('|');
  if (cache.has(key)) return cache.get(key) ?? null;

  if (variant) {
    for (const query of variant.queries) {
      const hit = await lookupCommons(query, variant.label);
      if (hit) {
        cache.set(key, hit);
        return hit;
      }
    }
  }

  for (const title of candidates) {
    const hit = await lookup(title);
    if (hit) {
      cache.set(key, hit);
      return hit;
    }
  }
  cache.set(key, null);
  return null;
}

export function referenceSearchVariant(
  species: string,
  funFacts: string[] = [],
): { label: string; queries: string[] } | null {
  const facts = funFacts.join(' ').toLowerCase();
  if (!facts) return null;

  const hasFemale = /\bfemales?\b/.test(facts);
  const hasImmature = /\b(immature|juvenile|young|first[-\s]?year)\b/.test(facts);
  const hasMale = /\bmales?\b/.test(facts);

  if (hasFemale && hasImmature) {
    return {
      label: 'female or immature',
      queries: [`female ${species}`, `immature ${species}`, `juvenile ${species}`],
    };
  }
  if (hasFemale) return { label: 'female', queries: [`female ${species}`] };
  if (hasImmature) {
    return { label: 'immature', queries: [`immature ${species}`, `juvenile ${species}`] };
  }
  if (hasMale) return { label: 'male', queries: [`male ${species}`] };
  return null;
}

async function lookupCommons(query: string, variantLabel: string): Promise<ReferenceImage | null> {
  try {
    const params = new URLSearchParams({
      origin: '*',
      action: 'query',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: query,
      gsrlimit: '8',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '900',
      format: 'json',
    });
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: { url?: string; thumburl?: string }[];
          }
        >;
      };
    };
    const pages = Object.values(data.query?.pages ?? {})
      .map((page) => {
        const title = page.title ?? '';
        const imageUrl = page.imageinfo?.[0]?.thumburl ?? page.imageinfo?.[0]?.url;
        return imageUrl ? { title, imageUrl, score: commonsScore(title, query, variantLabel) } : null;
      })
      .filter((page): page is { title: string; imageUrl: string; score: number } => Boolean(page))
      .filter((page) => page.score >= 0)
      .sort((a, b) => b.score - a.score);

    const best = pages[0];
    if (!best) return null;
    return {
      imageUrl: best.imageUrl,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURI(best.title.replace(/ /g, '_'))}`,
      title: best.title.replace(/^File:/, ''),
      sourceName: 'Wikimedia Commons',
      variantLabel,
    };
  } catch {
    return null;
  }
}

function commonsScore(title: string, query: string, variantLabel: string): number {
  const t = title.toLowerCase();
  let score = 0;
  for (const word of query.toLowerCase().split(/\s+/)) {
    if (word.length > 2 && t.includes(word)) score += 1;
  }
  if (/\b(range|map|diagram|egg|nest|sound|sonogram)\b/.test(t)) score -= 5;
  if (variantLabel.includes('female') && t.includes('female')) score += 5;
  if (variantLabel.includes('female') && t.includes('male') && !t.includes('female')) score -= 3;
  if (variantLabel.includes('immature') && /\b(immature|juvenile|young|first[-_\s]?year)\b/.test(t)) {
    score += 5;
  }
  if (variantLabel === 'male' && t.includes('male')) score += 5;
  return score;
}

async function lookup(title: string): Promise<ReferenceImage | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
      title?: string;
    };
    const src = data.thumbnail?.source ?? data.originalimage?.source;
    if (!src) return null;
    return {
      imageUrl: src,
      pageUrl:
        data.content_urls?.desktop?.page ??
        `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      title: data.title ?? title,
      sourceName: 'Wikipedia',
    };
  } catch {
    return null;
  }
}
