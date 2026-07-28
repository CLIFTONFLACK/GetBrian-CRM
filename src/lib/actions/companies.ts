"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentAgencyId } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import { deriveCounty } from "@/lib/locations";
import { geocodeForSave } from "@/lib/maps/geocode";
import { escapeLike } from "@/lib/search";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const nullable = (fd: FormData, k: string) => str(fd, k) || null;
const tags = (fd: FormData, k: string) =>
  str(fd, k)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Case-insensitive pre-insert duplicate lookup on exact company name. Returns
 * the existing company's name, or null when there is no duplicate.
 */
async function findDuplicateCompany(
  supabase: Supabase,
  agencyId: string,
  name: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("companies")
    .select("name")
    .eq("agency_id", agencyId)
    .ilike("name", escapeLike(name))
    .limit(1)
    .maybeSingle();
  return data?.name ?? null;
}

/** Replace a company's additional-agent rows. */
async function syncCompanyAgents(
  supabase: Supabase,
  companyId: string,
  agencyId: string,
  extra: string[],
) {
  await supabase
    .from("company_agents")
    .delete()
    .eq("company_id", companyId)
    .eq("agency_id", agencyId);
  if (extra.length > 0) {
    await supabase.from("company_agents").insert(
      extra.map((user_id) => ({
        agency_id: agencyId,
        company_id: companyId,
        user_id,
      })),
    );
  }
}

export async function createCompany(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const name = str(formData, "name");
  if (!name) return { error: "Company name is required." };

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateCompany(supabase, agencyId, name);
    if (dup) {
      return {
        error: `A company with this name already exists: ${dup}. Tick "Create anyway" to proceed.`,
      };
    }
  }

  const { lead, extra } = agents(formData);
  const address = {
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
  const geo = await geocodeForSave(address);
  const { data, error } = await supabase
    .from("companies")
    .insert({
      agency_id: agencyId,
      created_by: user.id,
      name,
      type: asType(str(formData, "type")),
      sector_tags: tags(formData, "sector_tags"),
      website: nullable(formData, "website"),
      phone: nullable(formData, "phone"),
      notes: nullable(formData, "notes"),
      company_number: nullable(formData, "company_number"),
      vat_number: nullable(formData, "vat_number"),
      lead_agent_id: lead,
      ...address,
      ...(geo ?? {}),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await syncCompanyAgents(supabase, data.id, agencyId, extra);

  // #13: optionally attach a contact chosen (or quick-created) on the form.
  const linkContact = nullable(formData, "link_contact");
  if (linkContact) {
    await supabase
      .from("contacts")
      .update({ company_id: data.id })
      .eq("id", linkContact)
      .eq("agency_id", agencyId);
    revalidatePath(`/contacts/${linkContact}`);
  }

  revalidatePath("/companies");
  redirect(`/companies/${data.id}`);
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const name = str(formData, "name");
  if (!name) return { error: "Company name is required." };

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateCompany(supabase, agencyId, name);
    if (dup) return { error: `A company with this name already exists: ${dup}.` };
  }

  const { lead, extra } = agents(formData);
  const address = {
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
  const geo = await geocodeForSave(address);
  const { data, error } = await supabase
    .from("companies")
    .insert({
      agency_id: agencyId,
      created_by: user.id,
      name,
      type: asType(str(formData, "type")),
      sector_tags: tags(formData, "sector_tags"),
      website: nullable(formData, "website"),
      phone: nullable(formData, "phone"),
      notes: nullable(formData, "notes"),
      company_number: nullable(formData, "company_number"),
      vat_number: nullable(formData, "vat_number"),
      lead_agent_id: lead,
      ...address,
      ...(geo ?? {}),
    })
    .select("id, name")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create company." };

  await syncCompanyAgents(supabase, data.id, agencyId, extra);

  revalidatePath("/companies");
  return { created: { id: data.id, name: data.name }, message: `Added ${data.name}.` };
}

export async function updateCompany(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const id = str(formData, "id");
  if (!id) return { error: "Missing company id." };

  const name = str(formData, "name");
  if (!name) return { error: "Company name is required." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const { lead, extra } = agents(formData);
  const address = {
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
  const { data: existing } = await supabase
    .from("companies")
    .select("address_line, city, postcode, lat, lng, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { error: "This company no longer exists." };

  const geo = await geocodeForSave(address, existing);
  const { data: updated, error } = await supabase
    .from("companies")
    .update({
      name,
      type: asType(str(formData, "type")),
      sector_tags: tags(formData, "sector_tags"),
      website: nullable(formData, "website"),
      phone: nullable(formData, "phone"),
      notes: nullable(formData, "notes"),
      company_number: nullable(formData, "company_number"),
      vat_number: nullable(formData, "vat_number"),
      lead_agent_id: lead,
      ...address,
      ...(geo ?? {}),
    })
    .eq("id", id)
    .eq("agency_id", agencyId)
    .eq("updated_at", existing.updated_at)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return {
      error:
        "This company was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  await syncCompanyAgents(supabase, id, agencyId, extra);

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  redirect(`/companies/${id}`);
}

export async function deleteCompany(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const agencyId = user ? await currentAgencyId(supabase) : null;
  const id = String(formData.get("id") ?? "");
  if (id && agencyId) {
    await supabase
      .from("companies")
      .delete()
      .eq("id", id)
      .eq("agency_id", agencyId);
    revalidatePath("/companies");
  }
  redirect("/companies");
}
