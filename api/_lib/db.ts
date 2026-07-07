// Lazy Neon client. Returns null if DATABASE_URL is missing so handlers can
// degrade gracefully (the site serves seed data and deploys before the
// database is wired up).

import { neon } from '@neondatabase/serverless';

type Sql = ReturnType<typeof neon> | null;

let cached: Sql | undefined;

export function db(): Sql {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return null;
  }
  cached = neon(url);
  return cached;
}
