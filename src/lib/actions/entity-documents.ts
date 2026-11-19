"use server";

import { del } from "@vercel/blob";
import { revalidatePanelHosts } from "@/lib/revalidate-panels";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  addEntityDocumentRow,
  deleteEntityDocumentRow,
} from "@/lib/db/queries/entity-documents";
import { entityExistsInAgency } from "@/lib/db/queries/entity-exists";
import {
  displayFileName,
  ENTITY_DOC_CONTENT_TYPES,
  ENTITY_DOC_MAX_BYTES,
  isEntityDocType,
  isOurEntityDocUrl,
} from "@/lib/entity-docs";
import type { FormState } from "@/lib/actions/types";
import { isUuid } from "@/lib/uuid";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

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
 * Record an uploaded company or contact document. The file goes from the
 * browser straight to Vercel Blob through the shared token route
 * (src/app/api/blob/client-upload/route.ts); this inserts the metadata row.
 *
 * The action can be posted to directly, so it does not trust the form: the
 * record must exist in the caller's agency, and the URL must be a Blob URL in
 * that record's own upload folder.
 */
export async function addEntityDocument(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const entityType = str(formData, "entity_type");
  const entityId = str(formData, "entity_id").toLowerCase();
  const filePath = str(formData, "file_path");
  const fileName = displayFileName(formData.get("name"));
  if (!isEntityDocType(entityType) || !isUuid(entityId) || !filePath || !fileName) {
    return { error: "Missing file details." };
  }

  if (!isOurEntityDocUrl(filePath, entityType, entityId)) {
    return { error: "That file is not one of ours." };
  }
  if (!(await entityExistsInAgency(agencyId, entityType, entityId))) {
    return { error: "Record not found." };
  }

  const sizeRaw = str(formData, "size_bytes");
  const size = sizeRaw ? Number(sizeRaw) : null;
  const sizeBytes =
    size != null && Number.isFinite(size) && size >= 0 && size <= ENTITY_DOC_MAX_BYTES
      ? Math.trunc(size)
      : null;
  const contentTypeRaw = str(formData, "content_type");
  const contentType = ENTITY_DOC_CONTENT_TYPES.includes(contentTypeRaw) ? contentTypeRaw : null;

  await addEntityDocumentRow(agencyId, entityType, entityId, userId, {
    fileName,
    filePath,
    contentType,
    sizeBytes,
  });

  revalidatePanelHosts();
  return { message: "Document added." };
}

/** Remove a document row, then its Blob object. */
export async function deleteEntityDocument(formData: FormData): Promise<void> {
  const caller = await requireCaller();
  if ("error" in caller) return;
  const { agencyId } = caller;

  const id = str(formData, "id");
  if (!isUuid(id)) return;

  // The agency-scoped delete comes first. The Blob object goes only when a row
  // this agency owned came back, so another agency's file is never touched.
  const deleted = await deleteEntityDocumentRow(agencyId, id);
  if (deleted?.file_path) {
    await del(deleted.file_path).catch(() => {
      // Best effort: the row is already gone either way.
    });
  }
  revalidatePanelHosts();
}
