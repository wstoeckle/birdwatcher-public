import { put, del } from '@vercel/blob';

// Uploads a base64 JPEG to Vercel Blob and returns its public URL. Returns null
// if Blob isn't configured, so the caller can fall back to a provided imageUrl.
export async function uploadPhoto(base64: string, keyHint: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const buffer = Buffer.from(base64, 'base64');
  const key = `sightings/${keyHint}-${Date.now()}.jpg`;
  const { url } = await put(key, buffer, {
    access: 'public',
    contentType: 'image/jpeg',
  });
  return url;
}

// Best-effort delete of a previously uploaded photo, so removing a sighting
// doesn't leave the JPEG orphaned in Blob. Never throws: a Blob hiccup must not
// fail the row deletion, and externally hosted imageUrls simply aren't ours to
// remove. No-ops when Blob isn't configured.
export async function deletePhoto(url: string): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !url) return;
  try {
    await del(url);
  } catch (err) {
    console.error('[blob] delete failed:', err instanceof Error ? err.message : String(err));
  }
}
