"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  createCompany as createCompanyRow,
  findDuplicateCompanyByName,
  getCompanyForUpdate,
  syncCompanyAgents,
  updateCompany as updateCompanyRow,
  deleteCompany as deleteCompanyRow,
  type CompanyWriteInput,
} from "@/lib/db/queries/companies";
import { linkContactToCompany } from "@/lib/db/queries/contacts";
import { deriveCounty } from "@/lib/locations";
import { geocodeForSave } from "@/lib/maps/geocode";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const nullable = (fd: FormData, k: string) => str(fd, k) || null;
/**
 * Sector tags now come from the use-class checkboxes (repeated values), plus a
 * hidden field carrying any free-text tags the picker can't express, so an
 * older "brewery"/"landlord" tag survives a save.
 */
const sectorTags = (fd: FormData) => {
  const picked = fd.getAll("sector_tags").map((v) => String(v).trim());
  const extra = String(fd.get("sector_tags_extra") ?? "")
    .split(",")
    .map((v) => v.trim());
  return [...new Set([...picked, ...extra].filter(Boolean))];
};
// Company types are now editable data, so any custom slug is allowed.
const asType = (v: string): string => v.trim() || "other";

/** Lead agent + additional agents (de-duped, lead excluded from extras). */
const agents = (fd: FormData) => {
  const lead = nullable(fd, "lead_agent_id");
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((id) => id !== lead);
  return { lead, extra };
};

function addressFromForm(formData: FormData) {
  return {
    address_line: nullable(formData, "address_line"),
    city: nullable(formData, "city"),
    postcode: nullable(formData, "postcode"),
    county:
      nullable(formData, "county") ??
      deriveCounty({
        postcode: str(formData, "postcode"),
        city: str(formData, "city"),
      }),
  };
}

function writeInput(formData: FormData): CompanyWriteInput {
  const { lead } = agents(formData);
  const address = addressFromForm(formData);
  return {
    name: str(formData, "name"),
    type: asType(str(formData, "type")),
    sectorTags: sectorTags(formData),
    website: nullable(formData, "website"),
    phone: nullable(formData, "phone"),
    notes: nullable(formData, "notes"),
    companyNumber: nullable(formData, "company_number"),
    vatNumber: nullable(formData, "vat_number"),
    leadAgentId: lead,
    addressLine: address.address_line,
    city: address.city,
    postcode: address.postcode,
    county: address.county,
  };
}

/** Resolves the signed-in caller's user id + agency id, or an error message. */
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

export async function createCompany(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const name = str(formData, "name");
  if (!name) return { error: "Company name is required." };

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateCompanyByName(agencyId, name);
    if (dup) {
      return {
        error: `A company with this name already exists: ${dup}. Tick "Create anyway" to proceed.`,
      };
    }
  }

  const { extra } = agents(formData);
  const address = addressFromForm(formData);
  const geo = await geocodeForSave(address);
  const { id } = await createCompanyRow(agencyId, userId, writeInput(formData), geo ?? {
    lat: null,
    lng: null,
  });

  await syncCompanyAgents(agencyId, id, extra);

  // #13: optionally attach a contact chosen (or quick-created) on the form.
  const linkContact = nullable(formData, "link_contact");
  if (linkContact) {
    await linkContactToCompany(agencyId, linkContact, id);
    revalidatePath(`/contacts/${linkContact}`);
  }

  revalidatePath("/companies");
  redirect(`/companies/${id}`);
}

/**
 * Inline create used by the "+ New company" modal. The modal now carries the
 * whole company form, so this accepts every field `createCompany` does —
 * address (geocoded), CRN/VAT, agents — and simply returns the new id + name
 * for the caller to select instead of redirecting. Fields the short variant of
 * the modal omits are absent from the FormData and land as null.
 */
export async function quickCreateCompany(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const name = str(formData, "name");
  if (!name) return { error: "Company name is required." };

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateCompanyByName(agencyId, name);
    if (dup) return { error: `A company with this name already exists: ${dup}.` };
  }

  const { extra } = agents(formData);
  const address = addressFromForm(formData);
  const geo = await geocodeForSave(address);
  const { id } = await createCompanyRow(agencyId, userId, writeInput(formData), geo ?? {
    lat: null,
    lng: null,
  });

  await syncCompanyAgents(agencyId, id, extra);

  revalidatePath("/companies");
  return { created: { id, name }, message: `Added ${name}.` };
}

export async function updateCompany(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = str(formData, "id");
  if (!id) return { error: "Missing company id." };

  const name = str(formData, "name");
  if (!name) return { error: "Company name is required." };

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const { extra } = agents(formData);
  const address = addressFromForm(formData);

  const existing = await getCompanyForUpdate(agencyId, id);
  if (!existing) return { error: "This company no longer exists." };

  const geo = await geocodeForSave(address, existing);
  const updated = await updateCompanyRow(agencyId, id, existing.updated_at, writeInput(formData), geo);
  if (!updated) {
    return {
      error:
        "This company was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  await syncCompanyAgents(agencyId, id, extra);

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  redirect(`/companies/${id}`);
}

export async function deleteCompany(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (isDbConfigured && id) {
    const session = await auth();
    const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;
    if (agencyId) {
      await deleteCompanyRow(agencyId, id);
      revalidatePath("/companies");
    }
  }
  redirect("/companies");
}
