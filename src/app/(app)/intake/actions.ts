"use server";

import { revalidatePath } from "next/cache";

import { classifyLocation, type LocationKind } from "@/lib/locations/options";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { createCompany } from "@/lib/db/queries/companies";
import { createContact } from "@/lib/db/queries/contacts";
import {
  approveIntakeSubmission,
  findCompanyIdByExactName,
  findContactIdByExactEmail,
  getPendingIntakeSubmission,
  rejectIntakeSubmission,
} from "@/lib/db/queries/intake";
import { createRequirement } from "@/lib/db/queries/requirements";
import type { Database } from "@/lib/database.types";
import type { FormState } from "@/lib/actions/types";

type UseClass = Database["public"]["Enums"]["use_class"];

// Same env var (and fallback) the public form resolves the owning agent with —
// approved requirements are handed to that agent as lead.
const defaultAgentEmail = () =>
  (process.env.INTAKE_DEFAULT_AGENT_EMAIL || "morris@cdgleisure.com").toLowerCase();

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

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
 * public form only ever writes `intake_submissions`
 * (src/lib/actions/public-intake.ts).
 */
export async function approveSubmission(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const id = str(formData, "id");
  if (!id) return { error: "Missing submission id." };

  const sub = await getPendingIntakeSubmission(agencyId, id);
  if (!sub) return { error: "Submission not found, or it's already been reviewed." };

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
  const members = await getAgencyMembers(agencyId);
  const leadAgentId =
    members.find((m) => (m.email ?? "").toLowerCase() === defaultAgentEmail())?.id ??
    userId;

  // ── Find-or-create the operator company (exact name, wildcards escaped) ────
  let companyId = await findCompanyIdByExactName(agencyId, companyName);
  if (!companyId) {
    const created = await createCompany(
      agencyId,
      leadAgentId,
      {
        name: companyName,
        type: "operator",
        sectorTags: [],
        website: null,
        phone: null,
        notes: null,
        companyNumber: null,
        vatNumber: null,
        leadAgentId: null,
        addressLine: null,
        city: null,
        postcode: null,
        county: null,
      },
      { lat: null, lng: null },
    );
    companyId = created.id;
  }

  // ── Find-or-create the submitting contact (exact email, wildcards escaped) ─
  let contactId = await findContactIdByExactEmail(agencyId, contactEmail);
  if (!contactId) {
    const created = await createContact(
      agencyId,
      leadAgentId,
      {
        firstName,
        lastName: sub.last_name || null,
        email: contactEmail,
        phone: sub.phone || null,
        role: "other",
        companyId,
        county: null,
        notes: null,
        leadAgentId: null,
        marketingOptIn: false,
        addressLine: null,
        city: null,
        postcode: null,
      },
      { lat: null, lng: null },
    );
    contactId = created.id;
  }

  // ── Create the requirement ────────────────────────────────────────────────
  const locations = partitionLocations(sub.target_locations);
  const who = [sub.first_name, sub.last_name].filter(Boolean).join(" ");
  const title = `${sub.company_name} — ${sub.property_type || "property"} requirement`;

  const requirement = await createRequirement(agencyId, userId, {
    title,
    companyId,
    contactId,
    status: "active",
    targetTowns: locations.town,
    targetRegions: locations.region,
    targetCounties: locations.county,
    targetPostcodeDistricts: locations.district,
    targetNeighbourhoods: locations.neighbourhood,
    targetLondonZones: locations.zone,
    useClasses: intakeUseClasses(sub.property_type),
    tenurePrefs: [],
    minSqft: sub.min_sqft,
    maxSqft: sub.max_sqft,
    minCovers: sub.min_covers,
    maxCovers: sub.max_covers,
    maxRent: sub.max_rent,
    maxPremium: sub.max_premium,
    maxGuidePrice: null,
    notes: [
      sub.notes || null,
      `Submitted via the public requirement form by ${who}` +
        ` (${sub.email}${sub.phone ? `, ${sub.phone}` : ""}).`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    leadAgentId,
  });

  const stamped = await approveIntakeSubmission(agencyId, id, requirement.id, userId);
  if (!stamped) {
    return {
      message: `Requirement created, but the submission couldn't be marked approved — it may have already been reviewed by someone else.`,
    };
  }

  revalidatePath("/intake");
  revalidatePath("/requirements");
  return { message: `Approved — "${title}" created.` };
}

/** Reject a pending submission — nothing is written to the CRM. */
export async function rejectSubmission(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const id = str(formData, "id");
  if (!id) return { error: "Missing submission id." };

  const ok = await rejectIntakeSubmission(agencyId, id, userId);
  if (!ok) return { error: "Submission not found, or it's already been reviewed." };

  revalidatePath("/intake");
  return { message: "Submission rejected." };
}
