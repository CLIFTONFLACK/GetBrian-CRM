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

/** Lead agent + additional agents (de-duped, lead excluded from extras). */
const agents = (fd: FormData) => {
  const lead = nullable(fd, "lead_agent_id");
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((id) => id !== lead);
  return { lead, extra };
};

function payload(fd: FormData) {
  return {
    first_name: str(fd, "first_name"),
    last_name: nullable(fd, "last_name"),
    email: nullable(fd, "email"),
    phone: nullable(fd, "phone"),
    role: str(fd, "role") || "other",
    company_id: nullable(fd, "company_id"),
    address_line: nullable(fd, "address_line"),
    city: nullable(fd, "city"),
    postcode: nullable(fd, "postcode"),
    county:
      nullable(fd, "county") ??
      deriveCounty({ postcode: str(fd, "postcode"), city: str(fd, "city") }),
    notes: nullable(fd, "notes"),
    lead_agent_id: nullable(fd, "lead_agent_id"),
    marketing_opt_in: fd.get("marketing_opt_in") != null,
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Coerce a submitted role to a real contact_roles slug (defaults to "other"). */
async function validRole(supabase: Supabase, value: string): Promise<string> {
  if (!value || value === "other") return "other";
  const { data } = await supabase
    .from("contact_roles")
    .select("slug")
    .eq("slug", value)
    .maybeSingle();
  return data ? value : "other";
}

/**
 * Case-insensitive pre-insert duplicate lookup on email. Returns the existing
 * contact's display name, or null when there is no duplicate (or no email).
 */
async function findDuplicateContact(
  supabase: Supabase,
  agencyId: string,
  email: string | null,
): Promise<string | null> {
  if (!email) return null;
  const { data } = await supabase
    .from("contacts")
    .select("first_name, last_name")
    .eq("agency_id", agencyId)
    .ilike("email", escapeLike(email))
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return [data.first_name, data.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

/** Replace a contact's additional-agent rows. */
async function syncContactAgents(
  supabase: Supabase,
  contactId: string,
  agencyId: string,
  extra: string[],
) {
  await supabase
    .from("contact_agents")
    .delete()
    .eq("contact_id", contactId)
    .eq("agency_id", agencyId);
  if (extra.length > 0) {
    await supabase.from("contact_agents").insert(
      extra.map((user_id) => ({
        agency_id: agencyId,
        contact_id: contactId,
        user_id,
      })),
    );
  }
}

export async function createContact(
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

  const data = payload(formData);
  if (!data.first_name) return { error: "A first name is required." };
  data.role = await validRole(supabase, data.role);

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateContact(supabase, agencyId, data.email);
    if (dup) {
      return {
        error: `A contact with this email already exists: ${dup}. Tick "Create anyway" to proceed.`,
      };
    }
  }

  const geo = await geocodeForSave(data);
  const { data: row, error } = await supabase
    .from("contacts")
    .insert({ agency_id: agencyId, created_by: user.id, ...data, ...(geo ?? {}) })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await syncContactAgents(supabase, row.id, agencyId, agents(formData).extra);

  revalidatePath("/contacts");
  redirect(`/contacts/${row.id}`);
}

export async function updateContact(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const id = str(formData, "id");
  if (!id) return { error: "Missing contact id." };

  const data = payload(formData);
  if (!data.first_name) return { error: "A first name is required." };
  data.role = await validRole(supabase, data.role);

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const { data: existing } = await supabase
    .from("contacts")
    .select("address_line, city, postcode, lat, lng, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { error: "This contact no longer exists." };

  const geo = await geocodeForSave(data, existing);
  const { data: updated, error } = await supabase
    .from("contacts")
    .update({ ...data, ...(geo ?? {}) })
    .eq("id", id)
    .eq("agency_id", agencyId)
    .eq("updated_at", existing.updated_at)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return {
      error:
        "This contact was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  await syncContactAgents(supabase, id, agencyId, agents(formData).extra);

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  redirect(`/contacts/${id}`);
}

/**
 * Inline create used by the "+ New contact" modal. The modal now carries the
 * whole contact form, so this accepts every field `createContact` does —
 * address (geocoded), role, marketing opt-in, agents — and returns the new id +
 * display name for the caller to select instead of redirecting. Fields the
 * short variant of the modal omits are absent from the FormData and land as
 * null (`role` defaults to "other" via `payload`).
 */
export async function quickCreateContact(
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

  const data = payload(formData);
  if (!data.first_name) return { error: "A first name is required." };
  data.role = await validRole(supabase, data.role);

  if (formData.get("allow_duplicate") == null) {
    const dup = await findDuplicateContact(supabase, agencyId, data.email);
    if (dup) return { error: `A contact with this email already exists: ${dup}.` };
  }

  const geo = await geocodeForSave(data);
  const { data: row, error } = await supabase
    .from("contacts")
    .insert({ agency_id: agencyId, created_by: user.id, ...data, ...(geo ?? {}) })
    .select("id, first_name, last_name")
    .single();
  if (error || !row) return { error: error?.message ?? "Could not create contact." };

  await syncContactAgents(supabase, row.id, agencyId, agents(formData).extra);

  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  revalidatePath("/contacts");
  return { created: { id: row.id, name }, message: `Added ${name}.` };
}

export async function deleteContact(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const agencyId = user ? await currentAgencyId(supabase) : null;
  const id = String(formData.get("id") ?? "");
  if (id && agencyId) {
    await supabase
      .from("contacts")
      .delete()
      .eq("id", id)
      .eq("agency_id", agencyId);
    revalidatePath("/contacts");
  }
  redirect("/contacts");
}
