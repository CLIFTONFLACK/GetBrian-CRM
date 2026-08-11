"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  addDisposalArea as addDisposalAreaRow,
  deleteDisposalArea as deleteDisposalAreaRow,
} from "@/lib/db/queries/disposals";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const numOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k).replace(/[, ]/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Add a row to a listing's available-area schedule (#10). */
export async function addDisposalArea(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const disposalId = str(formData, "disposal_id");
  const name = str(formData, "name");
  if (!disposalId) return { error: "Missing listing." };
  if (!name) return { error: "A floor / unit name is required." };

  await addDisposalAreaRow(agencyId, disposalId, {
    name,
    sizeSqft: numOrNull(formData, "size_sqft"),
    sizeSqm: numOrNull(formData, "size_sqm"),
    rentPa: numOrNull(formData, "rent_pa"),
    availability: str(formData, "availability") || null,
    sortOrder: numOrNull(formData, "sort_order") ?? 0,
  });

  revalidatePath(`/listings/${disposalId}`);
  return { message: "Area added." };
}

/** Delete a row from the available-area schedule. */
export async function deleteDisposalArea(formData: FormData): Promise<void> {
  if (!isDbConfigured) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  const id = str(formData, "id");
  const disposalId = str(formData, "disposal_id");
  if (!id || !agencyId) return;
  await deleteDisposalAreaRow(agencyId, id);
  if (disposalId) revalidatePath(`/listings/${disposalId}`);
}
