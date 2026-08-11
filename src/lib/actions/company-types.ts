"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { isAnyAgencyAdmin } from "@/lib/db/queries/agencies";
import {
  companyTypeInUseCount,
  companyTypeSlugsAndMaxSort,
  deleteCompanyTypeById,
  getCompanyTypeById,
  insertCompanyType,
  renameCompanyType as renameCompanyTypeRow,
} from "@/lib/db/queries/lookups";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** slugify a label into a stable key: lowercase, non-alphanumeric → "_". */
function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "type";
}

function revalidate() {
  revalidatePath("/admin");
  revalidatePath("/companies");
}

/**
 * Every mutation here used to be RLS-gated to agency admins
 * (is_any_agency_admin() — see db/migrations/0026_company_types.sql's header
 * note). That RLS is gone, so the same check is made explicitly here before
 * any write — company_types is a system-wide list, so this deliberately
 * checks "admin of ANY agency", not a specific one.
 */
async function requireAdmin(): Promise<string | null> {
  if (!isDbConfigured) return "The database isn't configured yet.";
  const session = await auth();
  if (!session?.user) return "You must be signed in.";
  const isAdmin = await isAnyAgencyAdmin(session.user.id);
  if (!isAdmin) return "Only an agency admin can edit company types.";
  return null;
}

/** Add a new company type. */
export async function createCompanyType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const label = str(formData, "label");
  if (!label) return { error: "A type name is required." };

  const { slugs, maxSort } = await companyTypeSlugsAndMaxSort();
  let slug = slugify(label);
  if (slugs.has(slug)) {
    let n = 2;
    while (slugs.has(`${slug}_${n}`)) n++;
    slug = `${slug}_${n}`;
  }

  await insertCompanyType(slug, label, maxSort + 1);

  revalidate();
  return { message: `Added “${label}”.` };
}

/** Rename a type — updates the display label only; the stored slug stays stable
 * so existing companies keep their association. */
export async function renameCompanyType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const id = str(formData, "id");
  const label = str(formData, "label");
  if (!id) return { error: "Missing type." };
  if (!label) return { error: "A type name is required." };

  await renameCompanyTypeRow(id, label);

  revalidate();
  return { message: "Saved." };
}

/** Delete a type. Refuses the protected "Other" fallback and any type still in
 * use by a company (counted across all agencies via a SQL helper). */
export async function deleteCompanyType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const id = str(formData, "id");
  if (!id) return { error: "Missing type." };

  const type = await getCompanyTypeById(id);
  if (!type) return { error: "Type not found." };
  if (type.is_system) return { error: "The “Other” type can’t be deleted." };

  const count = await companyTypeInUseCount(type.slug);
  if (count > 0) {
    return {
      error: `“${type.label}” is used by ${count} compan${
        count === 1 ? "y" : "ies"
      } — reassign them before deleting.`,
    };
  }

  await deleteCompanyTypeById(id);

  revalidate();
  return { message: `Deleted “${type.label}”.` };
}
