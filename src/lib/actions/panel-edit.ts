"use server";

// Inline edits from the company and contact record panels. Each action changes
// only the field(s) it is given and returns a FormState: the panel stays open
// (the full-page edit actions redirect, which would close it). The column for a
// field comes from the registries in src/lib/panel-fields, never from the client.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { getCompanyTypes } from "@/lib/company-types";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
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
import { patchRow, rowExists } from "@/lib/db/queries/patch";
import type { PatchableTable } from "@/lib/db/queries/patch-sql";
import { deriveCounty } from "@/lib/locations";
import { geocodeAddress } from "@/lib/maps/geocode";
import { decideGeo, parseAddress, pinStillValid } from "@/lib/panel-fields/address";
import { COMPANY_FIELDS } from "@/lib/panel-fields/company";
import { CONTACT_FIELDS } from "@/lib/panel-fields/contact";
import { fieldFor, parseField, type Registry } from "@/lib/panel-fields/types";
import { revalidatePanelHosts } from "@/lib/revalidate-panels";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

const CHANGED =
  "This record was changed by someone else while you were editing. Close the panel, open it again and retry.";

async function requireCaller(): Promise<{ userId: string; agencyId: string } | { error: string }> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { userId: session.user.id, agencyId };
}

function refresh(kind: "companies" | "contacts", id: string) {
  revalidatePath(`/${kind}/${id}`);
  revalidatePanelHosts();
}

/** One field of one record: parse through the registry, then write that column only. */
async function patchOneField(
  table: PatchableTable,
  registry: Registry,
  fd: FormData,
  checkSelect: (field: string, value: string) => Promise<string | null>,
): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const def = fieldFor(registry, str(fd, "field"));
  if (!def) return { error: "That field cannot be edited here." };

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  const parsed = parseField(def, fd.get("value"));
  if (!parsed.ok) return { error: parsed.error };

  if (def.kind === "select" && typeof parsed.value === "string") {
    const problem = await checkSelect(def.key, parsed.value);
    if (problem) return { error: problem };
  }

  const done = await patchRow(table, caller.agencyId, id, { [def.column]: parsed.value });
  if (!done) {
    return { error: (await rowExists(table, caller.agencyId, id)) ? CHANGED : "This record no longer exists." };
  }
  refresh(table, id);
  return { message: "Saved." };
}

export async function patchCompanyField(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchOneField("companies", COMPANY_FIELDS, fd, async (field, value) => {
    if (field !== "type") return "That field cannot be edited here.";
    const types = await getCompanyTypes();
    return types.some((t) => t.slug === value) ? null : "Pick one of the listed company types.";
  });
}

export async function patchContactField(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchOneField("contacts", CONTACT_FIELDS, fd, async (field, value) => {
    if (field !== "role") return "That field cannot be edited here.";
    return (await contactRoleSlugExists(value)) ? null : "Pick one of the listed roles.";
  });
}

/** The four address fields together, with a county fill and a new map pin. */
async function patchAddress(table: "companies" | "contacts", fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  const parsed = parseAddress(
    {
      address_line: fd.get("address_line"),
      city: fd.get("city"),
      postcode: fd.get("postcode"),
      county: fd.get("county"),
    },
    deriveCounty,
  );
  if (!parsed.ok) return { error: parsed.error };
  const next = parsed.value;

  const existing =
    table === "companies"
      ? await getCompanyForUpdate(caller.agencyId, id)
      : await getContactForUpdate(caller.agencyId, id);
  if (!existing) return { error: "This record no longer exists." };

  const geocoded =
    pinStillValid(next, existing) || !(next.address_line || next.city || next.postcode)
      ? null
      : await geocodeAddress(next);
  const geo = decideGeo(next, existing, geocoded);

  // No lock: this writes only the address columns, so it cannot overwrite
  // another field, and a lock read here would only catch a change that landed
  // during the geocode call.
  const done = await patchRow(table, caller.agencyId, id, { ...next, lat: geo.lat, lng: geo.lng });
  if (!done) return { error: "This record no longer exists." };
  refresh(table, id);
  return { message: geo.note ?? "Saved." };
}

export async function patchCompanyAddress(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchAddress("companies", fd);
}

export async function patchContactAddress(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchAddress("contacts", fd);
}

/** Lead agent and the additional agents. Every id must be a member of this agency. */
async function agentsFromForm(
  agencyId: string,
  fd: FormData,
): Promise<{ lead: string | null; extra: string[] } | { error: string }> {
  const members = new Set((await getAgencyMembers(agencyId)).map((m) => m.id));
  const lead = str(fd, "lead_agent_id") || null;
  const extra = [...new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean))].filter(
    (a) => a !== lead,
  );
  if ((lead && !members.has(lead)) || extra.some((a) => !members.has(a))) {
    return { error: "Pick agents from your own team." };
  }
  return { lead, extra };
}

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
