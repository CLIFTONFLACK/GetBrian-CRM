"use server";

// Inline edits from the company and contact record panels. Each action changes
// only the field(s) it is given and returns a FormState: the panel stays open
// (the full-page edit actions redirect, which would close it). The column for a
// field comes from the registries in src/lib/panel-fields, never from the client.

import { revalidatePath } from "next/cache";

import {
  patchAddressFor,
  patchOneField,
  readAgents,
  refresh,
  requireCaller,
  str,
} from "@/lib/actions/panel-edit-core";
import { getCompanyTypes } from "@/lib/company-types";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import {
  getCompanyForUpdate,
  getCompanyName,
  listCompanyOptions,
  syncCompanyAgents,
} from "@/lib/db/queries/companies";
import {
  getContactForUpdate,
  setContactPrimary,
  syncContactAgents,
} from "@/lib/db/queries/contacts";
import { contactRoleSlugExists } from "@/lib/db/queries/lookups";
import { patchRow } from "@/lib/db/queries/patch";
import { COMPANY_FIELDS } from "@/lib/panel-fields/company";
import { CONTACT_FIELDS } from "@/lib/panel-fields/contact";
import type { FormState } from "@/lib/actions/types";

export async function patchCompanyField(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchOneField("companies", COMPANY_FIELDS, fd, {
    checkSelect: async (field, value) => {
      if (field !== "type") return "That field cannot be edited here.";
      const types = await getCompanyTypes();
      return types.some((t) => t.slug === value) ? null : "Pick one of the listed company types.";
    },
  });
}

export async function patchContactField(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchOneField("contacts", CONTACT_FIELDS, fd, {
    checkSelect: async (field, value) => {
      if (field !== "role") return "That field cannot be edited here.";
      return (await contactRoleSlugExists(value)) ? null : "Pick one of the listed roles.";
    },
  });
}

/** The four address fields together, with a county fill and a new map pin. */
async function patchAddress(table: "companies" | "contacts", fd: FormData): Promise<FormState> {
  return patchAddressFor(table, fd, (agencyId, id) =>
    table === "companies" ? getCompanyForUpdate(agencyId, id) : getContactForUpdate(agencyId, id),
  );
}

export async function patchCompanyAddress(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchAddress("companies", fd);
}

export async function patchContactAddress(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchAddress("contacts", fd);
}

/** Lead agent and the additional agents. Every id must be a member of this agency. */
const agentsFromForm = (agencyId: string, fd: FormData) =>
  readAgents(agencyId, fd, async (id) => (await getAgencyMembers(id)).map((m) => m.id));

export async function patchCompanyAgents(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const a = await agentsFromForm(caller.agencyId, fd);
  if ("error" in a) return a;

  const done = await patchRow("companies", caller.agencyId, id, { lead_agent_id: a.lead });
  if (!done) return { error: "This record no longer exists." };
  await syncCompanyAgents(caller.agencyId, id, a.extra);
  refresh("companies", id);
  return { message: "Saved." };
}

export async function patchContactAgents(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const a = await agentsFromForm(caller.agencyId, fd);
  if ("error" in a) return a;

  const done = await patchRow("contacts", caller.agencyId, id, { lead_agent_id: a.lead });
  if (!done) return { error: "This record no longer exists." };
  await syncContactAgents(caller.agencyId, id, a.extra);
  refresh("contacts", id);
  return { message: "Saved." };
}

/** A contact's company and whether the contact is the primary one of that company. */
export async function patchContactCompany(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  // The editor sends company_id even for no company (an empty value). A
  // missing field means the form did not load its company list: refuse, so a
  // failed load can never detach the contact.
  if (!fd.has("company_id")) {
    return { error: "The company list did not load. Close the editor and try again." };
  }
  const companyId = str(fd, "company_id") || null;
  if (companyId && (await getCompanyName(caller.agencyId, companyId)) === null) {
    return { error: "Pick a company from your own agency." };
  }
  const wantsPrimary = fd.get("is_primary") != null;
  if (wantsPrimary && !companyId) {
    return { error: "Pick a company before marking this contact as primary." };
  }

  // is_primary is cleared in the same write: a primary contact that moves into
  // a company that already has one would break the one-primary-per-company
  // index. setContactPrimary then applies the choice made in the form.
  const done = await patchRow("contacts", caller.agencyId, id, {
    company_id: companyId,
    is_primary: false,
  });
  if (!done) return { error: "This record no longer exists." };
  try {
    await setContactPrimary(caller.agencyId, id, companyId, wantsPrimary);
  } catch (err) {
    console.error("patchContactCompany: setContactPrimary failed", err);
    revalidatePath("/companies");
    refresh("contacts", id);
    return { error: "The company was saved, but the primary flag could not be set. Check it and try again." };
  }
  revalidatePath("/companies");
  refresh("contacts", id);
  return { message: "Saved." };
}

/** The agency's companies for the contact company editor, loaded when the editor opens. */
export async function listCompanyOptionsForEditor(): Promise<
  { options: { id: string; name: string }[] } | { error: string }
> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const options = await listCompanyOptions(caller.agencyId);
  return { options: options.map((o) => ({ id: o.id, name: o.name })) };
}
