"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { isAnyAgencyAdmin } from "@/lib/db/queries/agencies";
import {
  contactRoleInUseCount,
  contactRoleSlugsAndMaxSort,
  deleteContactRoleById,
  getContactRoleById,
  insertContactRole,
  renameContactRole as renameContactRoleRow,
} from "@/lib/db/queries/lookups";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** slugify a label into a stable key: lowercase, non-alphanumeric → "_". */
function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "role";
}

function revalidate() {
  revalidatePath("/admin");
  revalidatePath("/contacts");
}

/**
 * Every mutation here used to be RLS-gated to agency admins
 * (is_any_agency_admin() — see db/migrations/0023_contact_roles.sql's header
 * note). That RLS is gone, so the same check is made explicitly here before
 * any write — contact_roles is a system-wide list, so this deliberately
 * checks "admin of ANY agency", not a specific one.
 */
async function requireAdmin(): Promise<string | null> {
  if (!isDbConfigured) return "The database isn't configured yet.";
  const session = await auth();
  if (!session?.user) return "You must be signed in.";
  const isAdmin = await isAnyAgencyAdmin(session.user.id);
  if (!isAdmin) return "Only an agency admin can edit contact roles.";
  return null;
}

/** Add a new contact role. */
export async function createContactRole(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const label = str(formData, "label");
  if (!label) return { error: "A role name is required." };

  const { slugs, maxSort } = await contactRoleSlugsAndMaxSort();
  let slug = slugify(label);
  if (slugs.has(slug)) {
    let n = 2;
    while (slugs.has(`${slug}_${n}`)) n++;
    slug = `${slug}_${n}`;
  }

  await insertContactRole(slug, label, maxSort + 1);

  revalidate();
  return { message: `Added “${label}”.` };
}

/** Rename a role — updates the display label only; the stored slug stays stable
 * so existing contacts keep their association. */
export async function renameContactRole(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const id = str(formData, "id");
  const label = str(formData, "label");
  if (!id) return { error: "Missing role." };
  if (!label) return { error: "A role name is required." };

  await renameContactRoleRow(id, label);

  revalidate();
  return { message: "Saved." };
}

/** Delete a role. Refuses the protected "Other" fallback and any role still in
 * use by a contact (counted across all agencies via a SQL helper). */
export async function deleteContactRole(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };

  const id = str(formData, "id");
  if (!id) return { error: "Missing role." };

  const role = await getContactRoleById(id);
  if (!role) return { error: "Role not found." };
  if (role.is_system) return { error: "The “Other” role can’t be deleted." };

  const count = await contactRoleInUseCount(role.slug);
  if (count > 0) {
    return {
      error: `“${role.label}” is used by ${count} contact${
        count === 1 ? "" : "s"
      } — reassign them before deleting.`,
    };
  }

  await deleteContactRoleById(id);

  revalidate();
  return { message: `Deleted “${role.label}”.` };
}
