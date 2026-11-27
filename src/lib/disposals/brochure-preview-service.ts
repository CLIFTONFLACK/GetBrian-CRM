// Makes and stores the page 1 preview of a listing's brochure.
//
// The brochure link is typed by a user, and this runs on the server, so the
// fetch is guarded: https only, no internal addresses (checked on the resolved
// address, and again on every redirect), a size cap and a time cap. The link
// itself is read from the database, never taken from the client.

import { lookup } from "node:dns/promises";
import { del, put } from "@vercel/blob";

import { getBrochurePreview, getBrochureUrl, saveBrochurePreview } from "@/lib/db/queries/disposals";
import { isBlobHostedUrl } from "@/lib/blob-url";
import { renderFirstPageJpeg } from "@/lib/disposals/brochure-render";
import { previewIsCurrent } from "@/lib/disposals/brochure-preview-state";
import { isPrivateAddress, publicHttpsUrl } from "@/lib/disposals/public-url";

const MAX_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
export type PreviewResult =
  | { status: "ready"; url: string }
  | { status: "none"; reason: string }
  | { status: "missing" };

async function assertResolvesPublic(host: string): Promise<void> {
  const answers = await lookup(host, { all: true });
  if (answers.length === 0 || answers.some((a) => isPrivateAddress(a.address))) {
    throw new Error("The brochure link points at a private address.");
  }
}

/** Fetch the PDF with the guards above. Throws with a short reason on any refusal. */
async function fetchPdf(link: string): Promise<Uint8Array> {
  let current = link;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = publicHttpsUrl(current);
    if (!url) throw new Error("The brochure link is not a public https address.");
    await assertResolvesPublic(url.hostname.replace(/^\[|\]$/g, ""));

    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CRMBrochurePreview/1.0)", Accept: "application/pdf,*/*" },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error("The brochure link redirects nowhere.");
      current = new URL(next, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The brochure host answered ${res.status}.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error("The brochure file is too large.");
    if (!res.body) throw new Error("The brochure file is empty.");

    // Read with a running cap: a host can omit or understate content-length.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error("The brochure file is too large.");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  throw new Error("The brochure link redirects too many times.");
}

/** Delete an image that a new save replaced, when it is ours and not the new one. */
async function deleteReplacedBlob(replaced: string | null, keep: string | null): Promise<void> {
  if (replaced && replaced !== keep && isBlobHostedUrl(replaced)) {
    await del(replaced).catch(() => {});
  }
}

/**
 * Ensure a current preview exists for one listing of one agency. Reuses a good
 * preview, skips a recent failure, otherwise draws and stores a new one.
 */
export async function ensureBrochurePreview(agencyId: string, disposalId: string): Promise<PreviewResult> {
  const listing = await getBrochureUrl(agencyId, disposalId);
  if (!listing) return { status: "missing" };
  // The link is used exactly as stored: the stored preview and the panel compare against it.
  const link = listing.brochure_url?.trim() ? listing.brochure_url : null;
  if (!link) return { status: "none", reason: "This listing has no brochure link." };

  const stored = await getBrochurePreview(agencyId, disposalId);
  const state = previewIsCurrent(stored, link);
  if (state === "ready" && stored?.preview_url) return { status: "ready", url: stored.preview_url };
  if (state === "recent-failure") return { status: "none", reason: "A preview could not be made for this brochure." };

  let reason = "";
  try {
    const jpeg = renderFirstPageJpeg(await fetchPdf(link));
    const blob = await put(`brochure-previews/${disposalId}.jpg`, Buffer.from(jpeg), {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: true,
    });
    const { saved, replaced } = await saveBrochurePreview(agencyId, disposalId, link, blob.url);
    if (!saved) {
      // The link changed while the image was drawn: drop the new image, keep nothing.
      await del(blob.url).catch(() => {});
      return { status: "none", reason: "The brochure link changed. Open the panel again." };
    }
    await deleteReplacedBlob(replaced, blob.url);
    return { status: "ready", url: blob.url };
  } catch (err) {
    reason = err instanceof Error ? err.message : "The preview could not be made.";
  }
  // Record the failed try so it is not repeated on every panel open.
  const failed = await saveBrochurePreview(agencyId, disposalId, link, null).catch(() => null);
  if (failed) await deleteReplacedBlob(failed.replaced, null);
  return { status: "none", reason };
}
