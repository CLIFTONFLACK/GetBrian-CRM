"use server";

// Inline edits from the listing record panel. Each action changes only the
// field(s) it is given and returns a FormState, so the panel stays open. The
// column for a field comes from src/lib/panel-fields/listing.ts, never from the
// client. Anything that can move a match re-scores the listing afterwards.

import {
  patchAddressFor,
  patchOneField,
  readAgents,
  refresh,
  requireCaller,
  str,
} from "@/lib/actions/panel-edit-core";
import { refreshMatchesForListing } from "@/lib/actions/matches";
import type { FormState } from "@/lib/actions/types";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { companyBelongsToAgency, contactBelongsToAgency } from "@/lib/db/queries/requirements";
import {
  getDisposalForUpdate,
  syncDisposalAgents,
  updateDisposalLeadAgent,
} from "@/lib/db/queries/disposals";
import { patchRow } from "@/lib/db/queries/patch";
import { LISTING_FIELDS } from "@/lib/panel-fields/listing";
import { parseField, type FieldDef } from "@/lib/panel-fields/types";
import { USE_CLASS_OPTIONS, formatUseClasses, planningClassFor, sortUseClasses } from "@/lib/use-classes";

/** Fields that can change which requirements a listing matches. */
const MATCH_FIELDS = new Set([
  "status",
  "disposal_type",
  "size_sqft",
  "covers_internal",
  "rent_pa",
  "premium",
  "guide_price",
  "area",
]);

export async function patchListingField(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchOneField("disposals", LISTING_FIELDS, fd, {
    // Editing the rent or the premium drops the scraped raw text, so the PDF stops
    // preferring the old "£X pa" string over the figure just typed. The same rule
    // as the full edit form (updateDisposal in src/lib/actions/disposals.ts).
    extraValues: async ({ agencyId, id, field, value }) => {
      if (field !== "rent_pa" && field !== "premium") return {};
      const existing = await getDisposalForUpdate(agencyId, id);
      if (!existing) return { error: "This listing no longer exists." };
      if (field === "rent_pa") {
        return (existing.rent_pa ?? null) !== (value ?? null) ? { rent_raw: null, rent_period: null } : {};
      }
      return (existing.premium ?? null) !== (value ?? null) ? { premium_raw: null } : {};
    },
    after: async ({ id, field }) => {
      if (MATCH_FIELDS.has(field)) await refreshMatchesForListing(id);
    },
  });
}

/** Address, town, postcode and county together, with a fresh map pin. */
export async function patchListingAddress(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchAddressFor("disposals", fd, getDisposalForUpdate, async ({ id }) => {
    await refreshMatchesForListing(id);
  });
}

const USE_CLASS_SLUGS = USE_CLASS_OPTIONS.map(([slug]) => slug);
const USE_CLASS_DEF: FieldDef = {
  key: "use_classes",
  column: "property_type",
  label: "Use class",
  kind: "multi",
  options: USE_CLASS_SLUGS,
};

/**
 * The trade of the listing. The planning class is a function of the trade, so
 * both stored columns are derived from the ticked classes, as the full edit form
 * does. At least one class is required.
 */
export async function patchListingUseClasses(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  const parsed = parseField(USE_CLASS_DEF, fd.getAll("value"));
  if (!parsed.ok) return { error: parsed.error };
  const classes = sortUseClasses(parsed.value as string[]);
  // Scraped rows can hold free text that no box matches. The boxes then open
  // empty, and saving them empty would wipe the only value the matcher reads.
  if (classes.length === 0) {
    return { error: "Tick at least one use class. To clear it, use the full edit page." };
  }

  const values: Record<string, unknown> = {
    property_type: formatUseClasses(classes),
    use_class: planningClassFor(classes),
  };
  const done = await patchRow("disposals", caller.agencyId, id, values);
  if (!done) return { error: "This listing no longer exists." };

  await refreshMatchesForListing(id).catch((err) => console.error("refreshMatchesForListing failed", err));
  refresh("disposals", id);
  return { message: "Saved." };
}

/** The listing's company (landlord or vendor) and contact. A listing made by hand keeps a contact. */
export async function patchListingLinks(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  // The editor sends both fields, even when empty. A missing field means its
  // lists did not load: refuse, so a failed load can never clear the links.
  if (!fd.has("company_id") || !fd.has("contact_id")) {
    return { error: "The company and contact lists did not load. Close the editor and try again." };
  }
  const companyId = str(fd, "company_id") || null;
  const contactId = str(fd, "contact_id") || null;
  if (companyId && !(await companyBelongsToAgency(caller.agencyId, companyId))) {
    return { error: "That company was not found in your agency." };
  }
  if (contactId && !(await contactBelongsToAgency(caller.agencyId, contactId))) {
    return { error: "That contact was not found in your agency." };
  }

  const existing = await getDisposalForUpdate(caller.agencyId, id);
  if (!existing) return { error: "This listing no longer exists." };
  if (existing.source === "manual" && !contactId) {
    return { error: "A listing made by hand needs a contact." };
  }

  const done = await patchRow("disposals", caller.agencyId, id, { company_id: companyId, contact_id: contactId });
  if (!done) return { error: "This listing no longer exists." };
  refresh("disposals", id);
  return { message: "Saved." };
}

/** Lead agent and the additional agents. Every id must be a member of this agency. */
export async function patchListingAgents(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const a = await readAgents(caller.agencyId, fd, async (agencyId) =>
    (await getAgencyMembers(agencyId)).map((m) => m.id),
  );
  if ("error" in a) return a;

  const ok = await updateDisposalLeadAgent(caller.agencyId, id, a.lead);
  if (!ok) return { error: "This listing no longer exists." };
  await syncDisposalAgents(caller.agencyId, id, a.extra);
  refresh("disposals", id);
  return { message: "Saved." };
}
