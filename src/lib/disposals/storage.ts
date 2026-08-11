/**
 * Re-host CDG property media into our own Vercel Blob store.
 *
 * Why: the extractor returns imgix/S3 URLs that (a) carry CDG's watermark and
 * (b) live on a third party's CDN that can rotate or expire. For the CRM we
 * download the clean original and upload it to Blob, then point the row's
 * `images[].url` at our own URL — keeping `source_url` for provenance.
 *
 * `put()` needs only `BLOB_READ_WRITE_TOKEN` from `process.env` — no client
 * object to thread through (see AGENTS.md's note on this function's old
 * Supabase-client parameter, dropped here).
 */
import { put } from "@vercel/blob";

import type { DisposalInsert } from "./cdg";
import { cleanImageUrl, contentTypeFromName, filenameFromUrl } from "./image";

export interface RehostOptions {
  /** Strip the imgix watermark before downloading (default true). */
  clean?: boolean;
  /** Also re-host the marketing brochure PDF (default false). */
  includeBrochure?: boolean;
  userAgent?: string;
  signal?: AbortSignal;
}

export interface RehostResult {
  row: DisposalInsert;
  uploaded: number;
  failures: { url: string; error: string }[];
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120 Safari/537.36";

/**
 * Downloads each property image (and optionally the brochure) and uploads it to
 * Blob, returning a new row whose media URLs point at our own store. Individual
 * download/upload failures are collected, not thrown — the original URL is kept for
 * any asset that fails so the import still succeeds with partial media.
 */
export async function rehostMedia(
  row: DisposalInsert,
  opts: RehostOptions = {},
): Promise<RehostResult> {
  const clean = opts.clean ?? true;
  const ua = opts.userAgent ?? DEFAULT_UA;
  const failures: { url: string; error: string }[] = [];
  let uploaded = 0;

  // Group everything under a stable per-listing prefix.
  const ref = row.source_ref ?? "unknown";
  const prefix = `${row.source}/${ref}`;

  const uploadFrom = async (
    originalUrl: string,
    objectName: string,
  ): Promise<string | null> => {
    const fetchUrl = clean ? cleanImageUrl(originalUrl) : originalUrl;
    try {
      const res = await fetch(fetchUrl, {
        headers: { "User-Agent": ua },
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const path = `${prefix}/${objectName}`;
      // Deterministic path + upsert semantics (mirrors the old bucket's
      // `upsert: true`): no random suffix, and overwriting the same path on
      // a re-import is expected, not an error.
      const blob = await put(path, bytes, {
        access: "public",
        contentType: contentTypeFromName(objectName),
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      uploaded++;
      return blob.url;
    } catch (err) {
      failures.push({ url: fetchUrl, error: (err as Error).message });
      return null;
    }
  };

  const images = await Promise.all(
    row.images.map(async (img, i) => {
      const name = `${String(i + 1).padStart(2, "0")}-${filenameFromUrl(img.url, `image-${i + 1}`)}`;
      const publicUrl = await uploadFrom(img.url, name);
      return publicUrl
        ? { ...img, url: publicUrl, source_url: img.source_url ?? img.url }
        : img; // keep original on failure
    }),
  );

  let brochure_url = row.brochure_url;
  if (opts.includeBrochure && row.brochure_url) {
    const name = filenameFromUrl(row.brochure_url, "brochure.pdf");
    const publicUrl = await uploadFrom(row.brochure_url, name);
    if (publicUrl) brochure_url = publicUrl;
  }

  return { row: { ...row, images, brochure_url }, uploaded, failures };
}
