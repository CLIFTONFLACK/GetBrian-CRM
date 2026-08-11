"use server";

import { del } from "@vercel/blob";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getDisposalImages, updateDisposalImages } from "@/lib/db/queries/disposals";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

type ImageItem = { url: string; alt?: string | null; source_url?: string | null };

const rowImages = (raw: unknown): ImageItem[] =>
  (Array.isArray(raw) ? raw : []).filter(
    (i): i is ImageItem => !!i && typeof (i as ImageItem).url === "string",
  );

/** True for a URL we host ourselves in Vercel Blob — only those are ever
 *  deleted from storage; scraped rows may reference third-party URLs we
 *  must not touch. Blob's public URLs are always `<store>.public.blob.
 *  vercel-storage.com`, regardless of which store/project. */
function isOurBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Resolves the signed-in caller's agency id, or an error message. */
async function requireCaller(): Promise<{ agencyId: string } | { error: string }> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { agencyId };
}

/**
 * Append an uploaded photo to `disposals.images`. The file itself is
 * uploaded client-side straight to Vercel Blob (see disposal-images.tsx and
 * the shared token route, src/app/api/blob/client-upload/route.ts); this
 * records the metadata entry the gallery and the PDF hero already read
 * (`{ url, alt, source_url }`).
 */
export async function addDisposalImage(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const disposalId = str(formData, "disposal_id");
  const url = str(formData, "url");
  if (!disposalId || !url) return { error: "Missing image details." };
  if (!/^https?:\/\//i.test(url)) return { error: "Invalid image URL." };

  const current = await getDisposalImages(agencyId, disposalId);
  if (current === undefined) return { error: "This listing no longer exists." };

  const images = rowImages(current);
  if (images.some((i) => i.url === url)) return { message: "Image added." };

  await updateDisposalImages(agencyId, disposalId, [
    ...images,
    { url, alt: null, source_url: null },
  ]);

  revalidatePath(`/listings/${disposalId}`);
  return { message: "Image added." };
}

/** Remove an image entry (and its Blob object when we host it). */
export async function deleteDisposalImage(formData: FormData): Promise<void> {
  const caller = await requireCaller();
  if ("error" in caller) return;
  const { agencyId } = caller;

  const disposalId = str(formData, "disposal_id");
  const url = str(formData, "url");
  if (!disposalId || !url) return;

  const current = await getDisposalImages(agencyId, disposalId);
  if (current === undefined) return;

  const images = rowImages(current);
  const remaining = images.filter((i) => i.url !== url);
  if (remaining.length === images.length) return;

  await updateDisposalImages(agencyId, disposalId, remaining);

  // Only delete files from our own Blob store — never a third-party URL,
  // and only AFTER the row no longer references it.
  if (isOurBlobUrl(url)) {
    await del(url).catch(() => {
      // Best-effort: the metadata row is already gone either way.
    });
  }

  revalidatePath(`/listings/${disposalId}`);
}
