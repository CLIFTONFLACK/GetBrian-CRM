/**
 * Validates a browser-supplied Vercel Blob URL before we store it.
 *
 * The document add actions (requirement-documents.ts / disposal-documents.ts)
 * receive `file_path` from the client after `upload()` resolves. That value is
 * later 302'd to by the signed proxy routes and passed to `del()` with the
 * server token on delete — so an arbitrary URL must never be accepted. The
 * upload-token route (src/app/api/blob/client-upload/route.ts) only mints
 * tokens for pathnames under `${ownerId}/`, so a genuine upload always lands
 * at `https://<store>.public.blob.vercel-storage.com/<ownerId>/…`.
 */
export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function isOurBlobUrl(url: string, ownerId: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(BLOB_HOST_SUFFIX) &&
    parsed.pathname.startsWith(`/${ownerId}/`)
  );
}

/** Loose host-only check — for deciding whether a stored URL is ours to `del()`
 *  (scraped rows may point at third-party hosts). */
export function isBlobHostedUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}
