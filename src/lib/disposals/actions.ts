"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";

import { importDisposalFromUrl, isCdgPropertyUrl, type DisposalImportState } from "./import";

const NOT_CONFIGURED = "The database isn't configured yet. Set STORAGE_CRM_DATABASE_URL.";

/**
 * Server Action: import a CDG property URL into `disposals`.
 *
 * Next 16: Server Functions are reachable via direct POST, so we verify auth here
 * (not just in the UI). Auth/tenancy and the media re-host step (Vercel Blob's
 * `put()`, see storage.ts) are both Neon/Blob-backed now — no client object to
 * thread through `importDisposalFromUrl` any more.
 */
export async function importDisposal(
  _prev: DisposalImportState,
  formData: FormData,
): Promise<DisposalImportState> {
  if (!isDbConfigured) return { error: NOT_CONFIGURED };

  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: "Paste a CDG property URL." };
  if (!isCdgPropertyUrl(url)) {
    return { error: "Not a CDG Leisure property URL (cdgleisure.com/find-a-property/properties/…)." };
  }

  const session = await auth();
  if (!session?.user) return { error: "You must be signed in to import." };
  const user = session.user;

  const agencyId = await currentAgencyId(user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  try {
    const { id, rehost } = await importDisposalFromUrl(url, agencyId, {
      createdBy: user.id,
    });
    revalidatePath("/listings");
    const warnings = rehost?.failures.map((f) => `Media skipped: ${f.url} (${f.error})`);
    return {
      id,
      message: `Imported. ${rehost ? `${rehost.uploaded} image(s) re-hosted.` : ""}`.trim(),
      ...(warnings && warnings.length ? { warnings } : {}),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
