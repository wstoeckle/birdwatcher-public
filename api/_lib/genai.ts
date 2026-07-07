// Server-side Gemini call used to (re)generate a species' scientific name and a
// couple of family-friendly fun facts. The Pi does this at capture time from the
// photo; here we do it from just the corrected species name, after an admin fixes
// a misidentification on the website.
//
// Degrades gracefully: with no GEMINI_API_KEY configured (or on any error) it
// returns null, and the caller falls back to clearing the stale facts rather than
// keeping ones that describe the wrong bird.

export interface SpeciesInfo {
  scientificName: string | null;
  funFacts: string[];
}

// Vercel uses GEMINI_API_KEY; accept the Pi's BIRDCAM_GEMINI_API_KEY too so a
// single key can serve both if someone reuses it.
function apiKey(): string | undefined {
  return (process.env.GEMINI_API_KEY ?? process.env.BIRDCAM_GEMINI_API_KEY)?.trim() || undefined;
}

export function geminiConfigured(): boolean {
  return apiKey() !== undefined;
}

const MODEL = (process.env.GEMINI_MODEL ?? 'gemini-2.5-flash').trim();

export async function regenerateSpeciesInfo(
  species: string,
  kind: 'bird' | 'critter',
): Promise<SpeciesInfo | null> {
  const key = apiKey();
  if (!key) return null;

  const subject = kind === 'critter' ? 'animal (or person)' : 'bird';
  const prompt = `A wildlife feeder camera in coastal Rhode Island photographed a ${subject} that a person has identified as "${species}".

Give the accepted scientific name and 2-3 short, delightful, accurate fun facts a family would enjoy. If "${species}" is a person or has no meaningful scientific name, use "" for the scientific name. Keep each fact to one sentence.

Respond ONLY with JSON matching exactly:
{
  "scientific_name": string,   // "" if unknown / not applicable
  "fun_facts": string[]        // 2-3 short facts
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        MODEL,
      )}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) {
      console.error('[genai] Gemini HTTP', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text) as { scientific_name?: unknown; fun_facts?: unknown };
    const scientificName =
      typeof parsed.scientific_name === 'string' && parsed.scientific_name.trim()
        ? parsed.scientific_name.trim()
        : null;
    const funFacts = Array.isArray(parsed.fun_facts)
      ? parsed.fun_facts
          .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
          .slice(0, 6)
      : [];
    return { scientificName, funFacts };
  } catch (err) {
    console.error(
      '[genai] regenerateSpeciesInfo failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
