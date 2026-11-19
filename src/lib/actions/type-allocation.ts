"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import {
  applyTypeAllocation,
  planTypeAllocation,
  previewOf,
  type TypeAllocationPreview,
} from "@/lib/db/queries/type-allocation";

export type PreviewResult = { error?: string; preview?: TypeAllocationPreview };
export type ApplyResult = { error?: string; message?: string; companies?: number; contacts?: number };

/** Session, agency and admin check. Runs on the server before any read or write. */
async function requireAdmin(): Promise<{ agencyId: string } | { error: string }> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const userId = session.user.id;
  const agencyId = await currentAgencyId(userId);
  if (!agencyId) return { error: "No agency is linked to your account." };
  if (!(await isAgencyAdmin(userId, agencyId))) {
    return { error: "Only an agency admin can do that." };
  }
  return { agencyId };
}

/** Shows what would change. Writes nothing. */
export async function previewTypeAllocationAction(): Promise<PreviewResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error };
  try {
    return { preview: previewOf(await planTypeAllocation(gate.agencyId)) };
  } catch (error) {
    console.error("previewTypeAllocationAction failed", error);
    return { error: "Could not prepare the preview. Try again." };
  }
}

/** Applies the allocation. The plan is recomputed here; nothing comes from the browser. */
export async function applyTypeAllocationAction(): Promise<ApplyResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error };
  try {
    const done = await applyTypeAllocation(gate.agencyId);
    revalidatePath("/admin");
    return {
      message: `Changed ${done.companies} companies and ${done.contacts} contacts.`,
      companies: done.companies,
      contacts: done.contacts,
    };
  } catch (error) {
    console.error("applyTypeAllocationAction failed", error);
    return { error: "Could not apply the changes. Some rows may already be changed. Run the preview again." };
  }
}
