"use server";

import { del } from "@vercel/blob";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isOurBlobUrl } from "@/lib/blob-url";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  addDisposalDocumentRow,
  deleteDisposalDocumentRow,
} from "@/lib/db/queries/disposals";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const DOC_TYPES = ["floor_plan", "vendor", "brochure", "epc", "other"];

/** Resolves the signed-in caller's user + agency id, or an error message. */
async function requireCaller(): Promise<
  { userId: string; agencyId: string } | { error: string }
> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { userId: session.user.id, agencyId };
}

/**
 * Record an uploaded document. The file itself is uploaded client-side
 * straight to Vercel Blob (see disposal-documents.tsx and the shared token
 * route, src/app/api/blob/client-upload/route.ts); this just inserts the
 * metadata row. The document stays effectively private: nothing renders its
 * Blob URL directly — downloads go through the signed proxy route (see
 * src/lib/disposal-docs.ts).
 */
export async function addDisposalDocument(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const disposalId = str(formData, "disposal_id");
  const filePath = str(formData, "file_path"); // the uploaded blob's URL
  const name = str(formData, "name");
  if (!disposalId || !filePath || !name) return { error: "Missing file details." };

  // The URL comes from the browser; the proxy route redirects to it and delete
  // passes it to `del()` with the server token, so it must be one of ours —
  // hosted on Vercel Blob, under this listing's upload folder.
  if (!isOurBlobUrl(filePath, disposalId)) {
    return { error: "That file is not one of ours." };
  }

  const docType = str(formData, "doc_type");
  const sizeRaw = str(formData, "size_bytes");
  const size = sizeRaw ? Number(sizeRaw) : null;

  await addDisposalDocumentRow(agencyId, disposalId, userId, {
    name,
    docType: DOC_TYPES.includes(docType) ? docType : "other",
    filePath,
    sizeBytes: Number.isFinite(size) ? size : null,
  });

  revalidatePath(`/listings/${disposalId}`);
  return { message: "Document added." };
}

/** Remove a document row and its underlying Blob object. */
export async function deleteDisposalDocument(formData: FormData): Promise<void> {
  const caller = await requireCaller();
  if ("error" in caller) return;
  const { agencyId } = caller;

  const id = str(formData, "id");
  const disposalId = str(formData, "disposal_id");
  if (!id) return;

  // Delete the metadata row scoped to our agency FIRST, then only remove the
  // Blob object if a row we actually own was deleted — never touch another
  // agency's file.
  const deleted = await deleteDisposalDocumentRow(agencyId, id);
  if (deleted?.file_path) {
    await del(deleted.file_path).catch(() => {
      // Best-effort: the metadata row is already gone either way.
    });
  }
  if (disposalId) revalidatePath(`/listings/${disposalId}`);
}
