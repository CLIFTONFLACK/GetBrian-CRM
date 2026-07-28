"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentAgencyId } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import { deriveCounty } from "@/lib/locations";
import { geocodeForSave } from "@/lib/maps/geocode";
import {
  planningClassFor,
  sortUseClasses,
  formatUseClasses,
} from "@/lib/use-classes";
import { refreshMatchesForListing, refreshMatchesForListings } from "@/lib/actions/matches";
import type { TablesInsert } from "@/lib/database.types";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const numOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k).replace(/[, ]/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const boolOf = (fd: FormData, k: string) => fd.get(k) != null;
const textOrNull = (fd: FormData, k: string) => str(fd, k) || null;

const DISPOSAL_TYPES = ["freehold", "new_lease", "lease_assignment", "sublease", "unknown"];
const FIT_OUT_STATES = ["fully_fitted", "part_fitted", "shell"];
const LISTING_TYPES = ["cdg", "intel"];
// Must match the disposals.price_qualifier check constraint (migration 0004).
const PRICE_QUALIFIERS = ["fixed", "offers_in_region", "offers_in_excess", "on_application"];
// The five canonical listing statuses the UI drives (scrapes may carry others).
// Not exported: a "use server" module may only export async functions — client
// components keep their own copy (see listing-status-select.tsx).
const CANONICAL_LISTING_STATUSES = [
  "Available",
  "Under Offer",
  "Let",
  "Sold",
  "Withdrawn",
];

/** Map the disposal form fields onto an insert/update payload (shared by create + edit). */
function disposalFieldsFromForm(fd: FormData): Omit<TablesInsert<"disposals">, "agency_id"> {
  const disposalType = str(fd, "disposal_type");
  const fitOut = str(fd, "fit_out_state");
  const useClasses = sortUseClasses(
    fd.getAll("use_classes").map(String).filter(Boolean),
  );
  const listingType = str(fd, "listing_type");
  const features = str(fd, "key_features")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    title: str(fd, "title") || "Untitled listing",
    listing_type: LISTING_TYPES.includes(listingType) ? listingType : "cdg",
    status: textOrNull(fd, "status"),
    disposal_type: DISPOSAL_TYPES.includes(disposalType)
      ? (disposalType as TablesInsert<"disposals">["disposal_type"])
      : "unknown",
    to_let: boolOf(fd, "to_let"),
    for_sale: boolOf(fd, "for_sale"),
    address_line: textOrNull(fd, "address_line"),
    area: textOrNull(fd, "area"),
    city: textOrNull(fd, "city"),
    postcode: textOrNull(fd, "postcode"),
    county:
      textOrNull(fd, "county") ??
      deriveCounty({ postcode: str(fd, "postcode"), city: str(fd, "city") }),
    // The form asks once, in trading terms. `property_type` keeps the concept
    // list the matcher reads ("Bar / Restaurant") and `use_class` is derived —
    // the planning class is a function of the trade, so asking for both was
    // asking the same question twice. Scraped free text still parses back into
    // the picker (see parseUseClasses).
    //
    // Some scraped rows carry a bare planning class and no concept ("Class E",
    // no property_type). There's nothing to tick for those, so the form carries
    // the original through: saving one untouched must not cost it the
    // planning-only credit it earns in the matcher.
    property_type: useClasses.length > 0 ? formatUseClasses(useClasses) : null,
    use_class:
      useClasses.length > 0
        ? planningClassFor(useClasses)
        : textOrNull(fd, "use_class_carried"),
    size_sqft: numOrNull(fd, "size_sqft"),
    size_sqm: numOrNull(fd, "size_sqm"),
    covers_internal: numOrNull(fd, "covers_internal"),
    covers_external: numOrNull(fd, "covers_external"),
    fit_out_state: FIT_OUT_STATES.includes(fitOut) ? fitOut : null,
    epc_rating: textOrNull(fd, "epc_rating"),
    tenure_raw: textOrNull(fd, "tenure_raw"),
    rent_pa: numOrNull(fd, "rent_pa"),
    premium: numOrNull(fd, "premium"),
    guide_price: numOrNull(fd, "guide_price"),
    rateable_value: numOrNull(fd, "rateable_value"),
    service_charge: numOrNull(fd, "service_charge"),
    key_features: features,
    description: textOrNull(fd, "description"),
    lead_agent_id: textOrNull(fd, "lead_agent_id"),
    // #1/#4: optional links to a Company (landlord/vendor) and a point-of-contact.
    company_id: textOrNull(fd, "company_id"),
    contact_id: textOrNull(fd, "contact_id"),
    // "Lease & statutory" section — previously unreachable DB columns.
    summary: textOrNull(fd, "summary"),
    location_description: textOrNull(fd, "location_description"),
    licensing_notes: textOrNull(fd, "licensing_notes"),
    vat_applicable: boolOf(fd, "vat_applicable"),
    business_rates: numOrNull(fd, "business_rates"),
    estate_charge: numOrNull(fd, "estate_charge"),
    parking_charge: numOrNull(fd, "parking_charge"),
    lease_term_years: numOrNull(fd, "lease_term_years"),
    lease_expiry: textOrNull(fd, "lease_expiry"),
    rent_review_basis: textOrNull(fd, "rent_review_basis"),
    next_rent_review: numOrNull(fd, "next_rent_review"),
    inside_1954_act: boolOf(fd, "inside_1954_act"),
    rent_period: textOrNull(fd, "rent_period"),
    price_qualifier: PRICE_QUALIFIERS.includes(str(fd, "price_qualifier"))
      ? str(fd, "price_qualifier")
      : null,
    brochure_url: textOrNull(fd, "brochure_url"),
  };
}

/** Replace a disposal's additional-agent collaborators (lead is dropped from the set). */
async function syncDisposalAgents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  disposalId: string,
  lead: string | null,
  fd: FormData,
) {
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((u) => u !== lead);
  await supabase
    .from("disposal_agents")
    .delete()
    .eq("disposal_id", disposalId)
    .eq("agency_id", agencyId);
  if (extra.length > 0) {
    await supabase.from("disposal_agents").insert(
      extra.map((user_id) => ({ agency_id: agencyId, disposal_id: disposalId, user_id })),
    );
  }
}

/** Create a manually-entered listing (#15). */
export async function createDisposal(
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

  if (!str(formData, "title")) return { error: "Title is required." };
  if (!str(formData, "contact_id"))
    return { error: "A contact is required for every listing." };

  const fields = disposalFieldsFromForm(formData);
  // Geocode the address → lat/lng (no-op when no address or no server key).
  const geo = await geocodeForSave(fields);
  const { data, error } = await supabase
    .from("disposals")
    .insert({
      ...fields,
      ...(geo ?? {}),
      agency_id: agencyId,
      source: "manual",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the listing." };

  await syncDisposalAgents(supabase, agencyId, data.id, fields.lead_agent_id ?? null, formData);
  await refreshMatchesForListing(data.id);

  revalidatePath("/listings");
  redirect(`/listings/${data.id}`);
}

/** Update an existing listing (#1). */
export async function updateDisposal(
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
  if (!id) return { error: "Missing listing id." };
  if (!str(formData, "title")) return { error: "Title is required." };

  const fields = disposalFieldsFromForm(formData);
  // Existing row: drives re-geocoding, the manual-only contact rule and the
  // stale-scrape-text cleanup below.
  const { data: existing } = await supabase
    .from("disposals")
    .select(
      "address_line, city, postcode, lat, lng, updated_at, source, rent_pa, rent_period, premium",
    )
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { error: "This listing no longer exists." };

  // A contact is only mandatory for CDG's own manual entries — scraped/intel
  // rows must stay editable without attaching an irrelevant CRM contact.
  if (existing.source === "manual" && !str(formData, "contact_id"))
    return { error: "A contact is required for every listing." };

  // When the numeric commercials change, drop the raw scraped text so the PDF
  // stops preferring the stale "£X pa" string over the edited figure.
  const clearRaw: { rent_raw?: null; rent_period?: null; premium_raw?: null } = {};
  if ((fields.rent_pa ?? null) !== (existing.rent_pa ?? null)) {
    clearRaw.rent_raw = null;
    // Keep a rent_period the user deliberately changed in this same edit.
    if ((fields.rent_period ?? null) === (existing.rent_period ?? null)) {
      clearRaw.rent_period = null;
    }
  }
  if ((fields.premium ?? null) !== (existing.premium ?? null)) {
    clearRaw.premium_raw = null;
  }

  const geo = await geocodeForSave(fields, existing);
  const { data: updated, error } = await supabase
    .from("disposals")
    .update({ ...fields, ...clearRaw, ...(geo ?? {}) })
    .eq("id", id)
    .eq("agency_id", agencyId)
    .eq("updated_at", existing.updated_at)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return {
      error:
        "This listing was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  await syncDisposalAgents(supabase, agencyId, id, fields.lead_agent_id ?? null, formData);
  await refreshMatchesForListing(id);

  revalidatePath("/listings");
  revalidatePath(`/listings/${id}`);
  redirect(`/listings/${id}`);
}

/** Delete a disposal (agency-scoped, with RLS as a second layer). */
export async function deleteDisposal(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const agencyId = await currentAgencyId(supabase);
  const id = String(formData.get("id") ?? "");
  if (id && agencyId) {
    await supabase
      .from("disposals")
      .delete()
      .eq("id", id)
      .eq("agency_id", agencyId);
    revalidatePath("/listings");
  }
  redirect("/listings");
}

/** Set a disposal's lead agent + additional agents. */
export async function updateDisposalAssignment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing disposal id." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const lead = String(formData.get("lead_agent_id") ?? "").trim() || null;
  const extra = Array.from(
    new Set(formData.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((u) => u !== lead);

  const { error } = await supabase
    .from("disposals")
    .update({ lead_agent_id: lead })
    .eq("id", id)
    .eq("agency_id", agencyId);
  if (error) return { error: error.message };

  await supabase
    .from("disposal_agents")
    .delete()
    .eq("disposal_id", id)
    .eq("agency_id", agencyId);
  if (extra.length > 0) {
    await supabase.from("disposal_agents").insert(
      extra.map((user_id) => ({ agency_id: agencyId, disposal_id: id, user_id })),
    );
  }

  revalidatePath("/listings");
  revalidatePath(`/listings/${id}`);
  return { message: "Assignment saved." };
}

/**
 * Narrow one-click status mover for the listing status popover — no full edit
 * form round-trip. Mirrors `updateDealStage` (deals.ts).
 */
export async function updateDisposalStatus(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !CANONICAL_LISTING_STATUSES.includes(status)) return;

  const supabase = await createClient();
  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return;

  await supabase
    .from("disposals")
    .update({ status })
    .eq("id", id)
    .eq("agency_id", agencyId);

  // Stock coming back to market re-enters matching (and leaving it prunes the
  // suggestions) — refresh is best-effort and never blocks the status change.
  await refreshMatchesForListing(id);

  revalidatePath("/listings");
  revalidatePath(`/listings/${id}`);
}

const cleanIds = (ids: unknown): string[] =>
  Array.isArray(ids)
    ? [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))].slice(
        0,
        500,
      )
    : [];

/** Bulk status change from the listings table's floating select bar. */
export async function bulkUpdateDisposalStatus(
  ids: string[],
  status: string,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const targets = cleanIds(ids);
  if (targets.length === 0) return { error: "No listings selected." };
  if (!CANONICAL_LISTING_STATUSES.includes(status))
    return { error: "Unknown listing status." };

  const { error, count } = await supabase
    .from("disposals")
    .update({ status }, { count: "exact" })
    .in("id", targets)
    .eq("agency_id", agencyId);
  if (error) return { error: error.message };

  await refreshMatchesForListings(targets);

  revalidatePath("/listings");
  return {
    message: `Set ${count ?? targets.length} listing${(count ?? targets.length) === 1 ? "" : "s"} to ${status}.`,
  };
}

/** Bulk lead-agent assignment from the listings table's floating select bar. */
export async function bulkAssignDisposalLead(
  ids: string[],
  leadAgentId: string,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const targets = cleanIds(ids);
  if (targets.length === 0) return { error: "No listings selected." };

  const lead = String(leadAgentId ?? "").trim();
  if (!lead) return { error: "Pick an agent to assign." };

  // The new lead must be a member of the caller's agency.
  const { data: member } = await supabase
    .from("agency_members")
    .select("user_id")
    .eq("agency_id", agencyId)
    .eq("user_id", lead)
    .maybeSingle();
  if (!member) return { error: "That agent isn't a member of your agency." };

  const { error, count } = await supabase
    .from("disposals")
    .update({ lead_agent_id: lead }, { count: "exact" })
    .in("id", targets)
    .eq("agency_id", agencyId);
  if (error) return { error: error.message };

  revalidatePath("/listings");
  return {
    message: `Assigned ${count ?? targets.length} listing${(count ?? targets.length) === 1 ? "" : "s"}.`,
  };
}
