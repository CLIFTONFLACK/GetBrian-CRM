"use server";

import { del } from "@vercel/blob";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  addRequirementDocumentRow,
  deleteRequirementDocumentRow,
  requirementBelongsToAgency,
} from "@/lib/db/queries/requirements";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Must match the CHECK constraint in db/migrations/0039. */
const DOC_TYPES = ["landlord_pack", "heads_of_terms", "brief", "other"];

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
 * Record an uploaded requirement document (a landlord pack, typically). The
 * file itself is uploaded client-side straight to Vercel Blob via the shared
 * token route (src/app/api/blob/client-upload/route.ts); this only inserts the
 * metadata row.
 *
 * The document stays effectively private: nothing renders its Blob URL —
 * downloads go through the signed proxy (src/lib/requirement-docs.ts).
 *
 * The requirement's ownership is re-checked here and not merely trusted from
 * the upload step: this action is separately POST-reachable, and a row stamped
 * with someone else's requirement_id would surface their document on our page.
 */
export async function addRequirementDocument(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const requirementId = str(formData, "requirement_id");
  const filePath = str(formData, "file_path"); // the uploaded blob's URL
  const name = str(formData, "name");
  if (!requirementId || !filePath || !name) return { error: "Missing file details." };

  if (!(await requirementBelongsToAgency(agencyId, requirementId))) {
    return { error: "Requirement not found." };
  }

  const docType = str(formData, "doc_type");
  const sizeRaw = str(formData, "size_bytes");
  const size = sizeRaw ? Number(sizeRaw) : null;

  await addRequirementDocumentRow(agencyId, requirementId, userId, {
    name,
    docType: DOC_TYPES.includes(docType) ? docType : "other",
    filePath,
    sizeBytes: Number.isFinite(size) ? size : null,
  });

  revalidatePath(`/requirements/${requirementId}`);
  return { message: "Document added." };
}

/** Remove a document row and its underlying Blob object. */
export async function deleteRequirementDocument(formData: FormData): Promise<void> {
  const caller = await requireCaller();
  if ("error" in caller) return;
  const { agencyId } = caller;

  const id = str(formData, "id");
  const requirementId = str(formData, "requirement_id");
  if (!id) return;

  // Delete the metadata row scoped to our agency FIRST, then only remove the
  // Blob object if a row we actually own was deleted — never touch another
  // agency's file.
  const deleted = await deleteRequirementDocumentRow(agencyId, id);
  if (deleted?.file_path) {
    await del(deleted.file_path).catch(() => {
      // Best-effort: the metadata row is already gone either way.
    });
  }
  if (requirementId) revalidatePath(`/requirements/${requirementId}`);
}
