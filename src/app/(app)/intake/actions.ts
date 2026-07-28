"use server";

import { revalidatePath } from "next/cache";

import { escapeLike } from "@/lib/search";
import { classifyLocation, type LocationKind } from "@/lib/locations/options";
import { currentAgencyId, getAgencyMembers } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { FormState } from "@/lib/actions/types";

type UseClass = Database["public"]["Enums"]["use_class"];

// Same env var (and fallback) the public form resolves the owning agent with —
// approved requirements are handed to that agent as lead.
const defaultAgentEmail = () =>
  (process.env.INTAKE_DEFAULT_AGENT_EMAIL || "morris@cdgleisure.com").toLowerCase();

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Split the submitted comma-joined locations into the requirement's target arrays. */
function partitionLocations(raw: string | null) {
  const buckets: Record<LocationKind, string[]> = {
    town: [],
    county: [],
    region: [],
    district: [],
    neighbourhood: [],
    zone: [],
  };
  for (const value of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    // Unrecognised free text is filed as a town — the same fallback the
    // locations picker uses for values outside the dataset.
    const kind = classifyLocation(value) ?? "town";
    buckets[kind].push(kind === "district" ? value.toUpperCase() : value);
  }
  return buckets;
}

/**
 * The public form's "Property type" list in the operator's own words → the
 * requirement's use classes, which is what the matcher actually reads.
 * Anything unrecognised (or blank) leaves the brief open on use class rather
 * than guessing.
 */
const INTAKE_USE_CLASSES: Record<string, UseClass[]> = {
  restaurant: ["restaurant"],
  bar: ["bar"],
  pub: ["pub"],
  "café / coffee": ["cafe"],
  nightclub: ["sui_generis_nightclub"],
  takeaway: ["sui_generis_hot_food"],
  hotel: ["other"],
  "health & fitness": ["gym"],
  "other leisure": ["leisure"],
};

const intakeUseClasses = (propertyType: string | null): UseClass[] =>
  INTAKE_USE_CLASSES[(propertyType ?? "").trim().toLowerCase()] ?? [];

/**
 * Approve a pending intake submission: find-or-create the operator company and
 * the submitting contact (exact, wildcard-escaped name/email lookups), create
 * the requirement, then stamp the submission approved and link the record it
 * produced. Nothing here runs until an agent has read the submission — the
 * public form only ever writes `intake_submissions`.
 */
export async function approveSubmission(
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

  const id = str(formData, "id");
  if (!id) return { error: "Missing submission id." };

  const { data: sub } = await supabase
    .from("intake_submissions")
    .select(
      "id, status, company_name, first_name, last_name, email, phone, property_type, target_locations, min_sqft, max_sqft, min_covers, max_covers, max_rent, max_premium, notes",
    )
    .eq("id", id)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!sub) return { error: "Submission not found." };
  if (sub.status !== "pending") {
    return { error: "That submission has already been reviewed." };
  }
  // The public form marks these required, but the columns are nullable — a
  // submission missing either can't become a company/contact, so say so rather
  // than creating a nameless record.
  const companyName = (sub.company_name ?? "").trim();
  const contactEmail = (sub.email ?? "").trim();
  const firstName = (sub.first_name ?? "").trim();
  if (!companyName || !contactEmail || !firstName) {
    return {
      error:
        "This submission is missing a company name, contact name or email — reject it, or add the record by hand.",
    };
  }

  // Lead agent = the configured intake owner, falling back to the reviewer.
  const members = await getAgencyMembers(supabase, agencyId);
  const leadAgentId =
    members.find((m) => (m.email ?? "").toLowerCase() === defaultAgentEmail())?.id ??
    user.id;

  // ── Find-or-create the operator company (exact name, wildcards escaped) ────
  const { data: existingCompany } = await supabase
    .from("companies")
    .select("id")
    .eq("agency_id", agencyId)
    .ilike("name", escapeLike(companyName))
    .limit(1)
    .maybeSingle();
  let companyId = existingCompany?.id ?? null;
  if (!companyId) {
    const { data: newCompany, error: companyError } = await supabase
      .from("companies")
      .insert({
        agency_id: agencyId,
        name: companyName,
        type: "operator",
        created_by: leadAgentId,
      })
      .select("id")
      .single();
    if (companyError) return { error: `Company create failed: ${companyError.message}` };
    companyId = newCompany.id;
  }

  // ── Find-or-create the submitting contact (exact email, wildcards escaped) ─
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id")
    .eq("agency_id", agencyId)
    .ilike("email", escapeLike(contactEmail))
    .limit(1)
    .maybeSingle();
  let contactId = existingContact?.id ?? null;
  if (!contactId) {
    const { data: newContact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        agency_id: agencyId,
        company_id: companyId,
        first_name: firstName,
        last_name: sub.last_name || null,
        email: contactEmail,
        phone: sub.phone || null,
      })
      .select("id")
      .single();
    if (contactError) return { error: `Contact create failed: ${contactError.message}` };
    contactId = newContact.id;
  }

  // ── Create the requirement ────────────────────────────────────────────────
  const locations = partitionLocations(sub.target_locations);
  const who = [sub.first_name, sub.last_name].filter(Boolean).join(" ");
  const title = `${sub.company_name} — ${sub.property_type || "property"} requirement`;

  const { data: requirement, error: reqError } = await supabase
    .from("requirements")
    .insert({
      agency_id: agencyId,
      created_by: user.id,
      lead_agent_id: leadAgentId,
      company_id: companyId,
      contact_id: contactId,
      title,
      status: "active",
      target_towns: locations.town,
      target_counties: locations.county,
      target_regions: locations.region,
      target_postcode_districts: locations.district,
      target_neighbourhoods: locations.neighbourhood,
      target_london_zones: locations.zone,
      use_classes: intakeUseClasses(sub.property_type),
      min_sqft: sub.min_sqft,
      max_sqft: sub.max_sqft,
      min_covers: sub.min_covers,
      max_covers: sub.max_covers,
      max_rent: sub.max_rent,
      max_premium: sub.max_premium,
      notes: [
        sub.notes || null,
        `Submitted via the public requirement form by ${who}` +
          ` (${sub.email}${sub.phone ? `, ${sub.phone}` : ""}).`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    })
    .select("id")
    .single();
  if (reqError) return { error: `Requirement create failed: ${reqError.message}` };

  const { error: stampError } = await supabase
    .from("intake_submissions")
    .update({
      status: "approved",
      created_requirement_id: requirement.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("agency_id", agencyId);
  if (stampError) {
    return {
      message: `Requirement created, but the submission couldn't be marked approved (${stampError.message}).`,
    };
  }

  revalidatePath("/intake");
  revalidatePath("/requirements");
  return { message: `Approved — “${title}” created.` };
}

/** Reject a pending submission — nothing is written to the CRM. */
export async function rejectSubmission(
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

  const id = str(formData, "id");
  if (!id) return { error: "Missing submission id." };

  const { error } = await supabase
    .from("intake_submissions")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("agency_id", agencyId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/intake");
  return { message: "Submission rejected." };
}
