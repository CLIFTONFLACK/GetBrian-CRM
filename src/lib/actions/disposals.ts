"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  bulkAssignDisposalLead as bulkAssignDisposalLeadRows,
  bulkUpdateDisposalStatus as bulkUpdateDisposalStatusRows,
  createDisposal as createDisposalRow,
  deleteDisposal as deleteDisposalRow,
  getDisposalForUpdate,
  isAgencyMember,
  syncDisposalAgents,
  updateDisposal as updateDisposalRow,
  updateDisposalLeadAgent,
  updateDisposalStatusOnly,
  type DisposalWriteInput,
} from "@/lib/db/queries/disposals";
import { deriveCounty } from "@/lib/locations";
import { geocodeForSave } from "@/lib/maps/geocode";
import {
  planningClassFor,
  sortUseClasses,
  formatUseClasses,
} from "@/lib/use-classes";
import { refreshMatchesForListing, refreshMatchesForListings } from "@/lib/actions/matches";
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

/** Map the disposal form fields onto a write payload (shared by create + edit). */
function disposalFieldsFromForm(fd: FormData): DisposalWriteInput {
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
    listingType: LISTING_TYPES.includes(listingType) ? listingType : "cdg",
    status: textOrNull(fd, "status"),
    disposalType: DISPOSAL_TYPES.includes(disposalType) ? disposalType : "unknown",
    toLet: boolOf(fd, "to_let"),
    forSale: boolOf(fd, "for_sale"),
    addressLine: textOrNull(fd, "address_line"),
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
    propertyType: useClasses.length > 0 ? formatUseClasses(useClasses) : null,
    useClass:
      useClasses.length > 0
        ? planningClassFor(useClasses)
        : textOrNull(fd, "use_class_carried"),
    sizeSqft: numOrNull(fd, "size_sqft"),
    sizeSqm: numOrNull(fd, "size_sqm"),
    coversInternal: numOrNull(fd, "covers_internal"),
    coversExternal: numOrNull(fd, "covers_external"),
    fitOutState: FIT_OUT_STATES.includes(fitOut) ? fitOut : null,
    epcRating: textOrNull(fd, "epc_rating"),
    tenureRaw: textOrNull(fd, "tenure_raw"),
    rentPa: numOrNull(fd, "rent_pa"),
    premium: numOrNull(fd, "premium"),
    guidePrice: numOrNull(fd, "guide_price"),
    rateableValue: numOrNull(fd, "rateable_value"),
    serviceCharge: numOrNull(fd, "service_charge"),
    keyFeatures: features,
    description: textOrNull(fd, "description"),
    leadAgentId: textOrNull(fd, "lead_agent_id"),
    // #1/#4: optional links to a Company (landlord/vendor) and a point-of-contact.
    companyId: textOrNull(fd, "company_id"),
    contactId: textOrNull(fd, "contact_id"),
    // "Lease & statutory" section — previously unreachable DB columns.
    summary: textOrNull(fd, "summary"),
    locationDescription: textOrNull(fd, "location_description"),
    licensingNotes: textOrNull(fd, "licensing_notes"),
    vatApplicable: boolOf(fd, "vat_applicable"),
    businessRates: numOrNull(fd, "business_rates"),
    estateCharge: numOrNull(fd, "estate_charge"),
    parkingCharge: numOrNull(fd, "parking_charge"),
    leaseTermYears: numOrNull(fd, "lease_term_years"),
    leaseExpiry: textOrNull(fd, "lease_expiry"),
    rentReviewBasis: textOrNull(fd, "rent_review_basis"),
    nextRentReview: numOrNull(fd, "next_rent_review"),
    inside1954Act: boolOf(fd, "inside_1954_act"),
    rentPeriod: textOrNull(fd, "rent_period"),
    priceQualifier: PRICE_QUALIFIERS.includes(str(fd, "price_qualifier"))
      ? str(fd, "price_qualifier")
      : null,
    brochureUrl: textOrNull(fd, "brochure_url"),
  };
}

/** Lead agent + additional agents (de-duped, lead excluded from extras). */
function agentsFromForm(fd: FormData) {
  const lead = textOrNull(fd, "lead_agent_id");
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((u) => u !== lead);
  return { lead, extra };
}

/** Resolves the signed-in caller's user id + agency id, or an error message. */
async function requireCaller(): Promise<
  { userId: string; agencyId: string } | { error: string }
> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { userId: session.user.id, agencyId };
}

/** Create a manually-entered listing (#15). */
export async function createDisposal(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  if (!str(formData, "title")) return { error: "Title is required." };
  if (!str(formData, "contact_id"))
    return { error: "A contact is required for every listing." };

  const fields = disposalFieldsFromForm(formData);
  // Geocode the address → lat/lng (no-op when no address or no server key).
  const geo = await geocodeForSave({
    address_line: fields.addressLine,
    city: fields.city,
    postcode: fields.postcode,
  });
  const { id } = await createDisposalRow(agencyId, userId, fields, geo ?? { lat: null, lng: null });

  const { extra } = agentsFromForm(formData);
  await syncDisposalAgents(agencyId, id, extra);
  await refreshMatchesForListing(id);

  revalidatePath("/listings");
  redirect(`/listings/${id}`);
}

/** Update an existing listing (#1). */
export async function updateDisposal(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const id = str(formData, "id");
  if (!id) return { error: "Missing listing id." };
  if (!str(formData, "title")) return { error: "Title is required." };

  const fields = disposalFieldsFromForm(formData);
  // Existing row: drives re-geocoding, the manual-only contact rule and the
  // stale-scrape-text cleanup below.
  const existing = await getDisposalForUpdate(agencyId, id);
  if (!existing) return { error: "This listing no longer exists." };

  // A contact is only mandatory for CDG's own manual entries — scraped/intel
  // rows must stay editable without attaching an irrelevant CRM contact.
  if (existing.source === "manual" && !str(formData, "contact_id"))
    return { error: "A contact is required for every listing." };

  // When the numeric commercials change, drop the raw scraped text so the PDF
  // stops preferring the stale "£X pa" string over the edited figure.
  const clearRentRaw = (fields.rentPa ?? null) !== (existing.rent_pa ?? null);
  const clearPremiumRaw = (fields.premium ?? null) !== (existing.premium ?? null);
  // Keep a rent_period the user deliberately changed in this same edit.
  if (clearRentRaw && (fields.rentPeriod ?? null) === (existing.rent_period ?? null)) {
    fields.rentPeriod = null;
  }

  const geo = await geocodeForSave(
    { address_line: fields.addressLine, city: fields.city, postcode: fields.postcode },
    existing,
  );
  const updated = await updateDisposalRow(
    agencyId,
    id,
    existing.updated_at,
    fields,
    { clearRentRaw, clearPremiumRaw },
    geo,
  );
  if (!updated) {
    return {
      error:
        "This listing was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  const { extra } = agentsFromForm(formData);
  await syncDisposalAgents(agencyId, id, extra);
  await refreshMatchesForListing(id);

  revalidatePath("/listings");
  revalidatePath(`/listings/${id}`);
  redirect(`/listings/${id}`);
}

/** Delete a disposal (agency-scoped — the tenant boundary, see AGENTS.md). */
export async function deleteDisposal(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (isDbConfigured && id) {
    const session = await auth();
    const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;
    if (agencyId) {
      await deleteDisposalRow(agencyId, id);
      revalidatePath("/listings");
    }
  }
  redirect("/listings");
}

/** Set a disposal's lead agent + additional agents. */
export async function updateDisposalAssignment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing disposal id." };

  const { lead, extra } = agentsFromForm(formData);

  const ok = await updateDisposalLeadAgent(agencyId, id, lead);
  if (!ok) return { error: "This listing no longer exists." };

  await syncDisposalAgents(agencyId, id, extra);

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
  if (!isDbConfigured) return;

  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return;

  await updateDisposalStatusOnly(agencyId, id, status);

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
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const targets = cleanIds(ids);
  if (targets.length === 0) return { error: "No listings selected." };
  if (!CANONICAL_LISTING_STATUSES.includes(status))
    return { error: "Unknown listing status." };

  const count = await bulkUpdateDisposalStatusRows(agencyId, targets, status);

  await refreshMatchesForListings(targets);

  revalidatePath("/listings");
  return {
    message: `Set ${count} listing${count === 1 ? "" : "s"} to ${status}.`,
  };
}

/** Bulk lead-agent assignment from the listings table's floating select bar. */
export async function bulkAssignDisposalLead(
  ids: string[],
  leadAgentId: string,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const targets = cleanIds(ids);
  if (targets.length === 0) return { error: "No listings selected." };

  const lead = String(leadAgentId ?? "").trim();
  if (!lead) return { error: "Pick an agent to assign." };

  // The new lead must be a member of the caller's agency.
  const isMember = await isAgencyMember(agencyId, lead);
  if (!isMember) return { error: "That agent isn't a member of your agency." };

  const count = await bulkAssignDisposalLeadRows(agencyId, targets, lead);

  revalidatePath("/listings");
  return {
    message: `Assigned ${count} listing${count === 1 ? "" : "s"}.`,
  };
}
