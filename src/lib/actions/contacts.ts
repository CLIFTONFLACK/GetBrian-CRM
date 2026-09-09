"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  createContact as createContactRow,
  createContactReturningName,
  deleteContact as deleteContactRow,
  findDuplicateContactByEmail,
  getContactForUpdate,
  syncContactAgents,
  updateContact as updateContactRow,
  type ContactWriteInput,
  setContactPrimary,
} from "@/lib/db/queries/contacts";
import { contactRoleSlugExists } from "@/lib/db/queries/lookups";
import { getCompanyName } from "@/lib/db/queries/companies";
import { deriveCounty } from "@/lib/locations";
import { geocodeForSave } from "@/lib/maps/geocode";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const nullable = (fd: FormData, k: string) => str(fd, k) || null;

/** Lead agent + additional agents (de-duped, lead excluded from extras). */
const agents = (fd: FormData) => {
  const lead = nullable(fd, "lead_agent_id");
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((id) => id !== lead);
  return { lead, extra };
};

function writeInput(fd: FormData, role: string): ContactWriteInput {
  return {
    firstName: str(fd, "first_name"),
    lastName: nullable(fd, "last_name"),
    email: nullable(fd, "email"),
    phone: nullable(fd, "phone"),
    role,
    companyId: nullable(fd, "company_id"),
    addressLine: nullable(fd, "address_line"),
    city: nullable(fd, "city"),
    postcode: nullable(fd, "postcode"),
    county:
      nullable(fd, "county") ??
      deriveCounty({ postcode: str(fd, "postcode"), city: str(fd, "city") }),
    notes: nullable(fd, "notes"),
    leadAgentId: nullable(fd, "lead_agent_id"),
    marketingOptIn: fd.get("marketing_opt_in") != null,
  };
}

function addressParts(input: ContactWriteInput) {
  return { address_line: input.addressLine, city: input.city, postcode: input.postcode };
}

/** Coerce a submitted role to a real contact_roles slug (defaults to "other"). */
async function validRole(value: string): Promise<string> {
  if (!value || value === "other") return "other";
  return (await contactRoleSlugExists(value)) ? value : "other";
}

/** Drop a client-supplied company_id this agency doesn't own, so a contact can't
 *  be linked to another agency's company (no RLS backstop — see AGENTS.md).
 *  getCompanyName returns the name when owned (possibly "") or null otherwise,
 *  so test `!== null`, not truthiness. */
async function ownedCompanyId(agencyId: string, companyId: string | null): Promise<string | null> {
  if (!companyId) return null;
  return (await getCompanyName(agencyId, companyId)) !== null ? companyId : null;
}

/** Resolves the signed-in caller's user id + agency id, or an error message. */
/** A contact can only be primary *of* a company. The form's checkbox is always
 *  rendered, so say why the tick was rejected rather than silently dropping it. */
function primaryFlag(fd: FormData, companyId: string | null): boolean | { error: string } {
  const ticked = fd.get("is_primary") != null;
  if (ticked && !companyId) {
    return { error: "Pick a company before marking this contact as primary." };
  }
  return ticked;
}

async function requireCaller(): Promise<
  { userId: string; agencyId: string } | { error: string }
> {
  if (!isDbConfigured) {
    return { error: "The database isn't configured yet." };
  }
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { userId: session.user.id, agencyId };
}

export async function createContact(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const role = await validRole(str(formData, "role") || "other");
  const input = writeInput(formData, role);
  if (!input.firstName) return { error: "A first name is required." };
  input.companyId = await ownedCompanyId(agencyId, input.companyId);
  const isPrimary = primaryFlag(formData, input.companyId);
  if (typeof isPrimary !== "boolean") return isPrimary;

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateContactByEmail(agencyId, input.email);
    if (dup) {
      return {
        error: `A contact with this email already exists: ${dup}. Tick "Create anyway" to proceed.`,
      };
    }
  }

  const geo = await geocodeForSave(addressParts(input));
  const { id } = await createContactRow(agencyId, userId, input, geo ?? { lat: null, lng: null });

  await syncContactAgents(agencyId, id, agents(formData).extra);
  // Runs after the insert (it needs the new id) and demotes the previous
  // primary in the same transaction — see setContactPrimary.
  await setContactPrimary(agencyId, id, input.companyId, isPrimary);

  revalidatePath("/contacts");
  revalidatePath("/companies");
  redirect(`/contacts/${id}`);
}

export async function updateContact(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = str(formData, "id");
  if (!id) return { error: "Missing contact id." };

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const role = await validRole(str(formData, "role") || "other");
  const input = writeInput(formData, role);
  if (!input.firstName) return { error: "A first name is required." };
  input.companyId = await ownedCompanyId(agencyId, input.companyId);
  const isPrimary = primaryFlag(formData, input.companyId);
  if (typeof isPrimary !== "boolean") return isPrimary;

  const existing = await getContactForUpdate(agencyId, id);
  if (!existing) return { error: "This contact no longer exists." };

  const geo = await geocodeForSave(addressParts(input), existing);
  const updated = await updateContactRow(agencyId, id, existing.updated_at, input, geo);
  if (!updated) {
    return {
      error:
        "This contact was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  await syncContactAgents(agencyId, id, agents(formData).extra);
  await setContactPrimary(agencyId, id, input.companyId, isPrimary);

  revalidatePath("/contacts");
  revalidatePath("/companies");
  revalidatePath(`/contacts/${id}`);
  redirect(`/contacts/${id}`);
}

/**
 * Inline create used by the "+ New contact" modal. The modal now carries the
 * whole contact form, so this accepts every field `createContact` does —
 * address (geocoded), role, marketing opt-in, agents — and returns the new id +
 * display name for the caller to select instead of redirecting. Fields the
 * short variant of the modal omits are absent from the FormData and land as
 * null (`role` defaults to "other" via `writeInput`).
 */
export async function quickCreateContact(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const role = await validRole(str(formData, "role") || "other");
  const input = writeInput(formData, role);
  if (!input.firstName) return { error: "A first name is required." };
  input.companyId = await ownedCompanyId(agencyId, input.companyId);

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateContactByEmail(agencyId, input.email);
    if (dup) return { error: `A contact with this email already exists: ${dup}.` };
  }

  const geo = await geocodeForSave(addressParts(input));
  const row = await createContactReturningName(
    agencyId,
    userId,
    input,
    geo ?? { lat: null, lng: null },
  );

  await syncContactAgents(agencyId, row.id, agents(formData).extra);

  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  revalidatePath("/contacts");
  return { created: { id: row.id, name }, message: `Added ${name}.` };
}

export async function deleteContact(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (isDbConfigured && id) {
    const session = await auth();
    const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;
    if (agencyId) {
      await deleteContactRow(agencyId, id);
      revalidatePath("/contacts");
    }
  }
  redirect("/contacts");
}
