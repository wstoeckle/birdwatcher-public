import type { VercelRequest } from '@vercel/node';

// The Pi authenticates ingest with `Authorization: Bearer <BIRDCAM_INGEST_TOKEN>`.
// If no token is configured, auth is disabled (fine for local dev, not prod).
export function isAuthorized(req: VercelRequest): boolean {
  // Trim both sides: pasting a token into a dashboard field often appends a
  // stray newline/space, which would otherwise cause a baffling 401.
  const expected = process.env.BIRDCAM_INGEST_TOKEN?.trim();
  if (!expected) return true;
  const header = req.headers.authorization ?? '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : '').trim();
  return token.length > 0 && token === expected;
}
