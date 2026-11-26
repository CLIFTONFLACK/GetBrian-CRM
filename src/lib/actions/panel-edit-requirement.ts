"use server";

// Inline edits from the requirement record panel. Each action changes only the
// field(s) it is given and returns a FormState, so the panel stays open. The
// column for a field comes from src/lib/panel-fields/requirement.ts, never from
// the client. Every change re-scores the brief against live stock.

import {
  patchOneField,
  readAgents,
  refresh,
  requireCaller,
  str,
} from "@/lib/actions/panel-edit-core";
import { refreshMatchesForRequirement } from "@/lib/actions/matches";
import type { FormState } from "@/lib/actions/types";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { listContactOptions } from "@/lib/db/queries/contacts";
import { patchRow } from "@/lib/db/queries/patch";
import {
  companyBelongsToAgency,
  contactBelongsToAgency,
  getRequirementForUpdate,
  getRequirementTitle,
  syncRequirementAgents,
} from "@/lib/db/queries/requirements";
import { geocodeAddress } from "@/lib/maps/geocode";
import { REQUIREMENT_CHOICES, REQUIREMENT_FIELDS } from "@/lib/panel-fields/requirement";
import type { FieldValue } from "@/lib/panel-fields/types";
import { notifyRequirementAgents } from "@/lib/requirement-notify";
import { resolveAnchor } from "@/lib/requirement-anchor";
import { requirementLinkError } from "@/lib/requirement-rules";

const rescore = async ({ id }: { id: string }) => {
  await refreshMatchesForRequirement(id);
};

/** Postcode districts are stored in capitals, as the full form does. */
const upperDistricts = (field: string, value: FieldValue): FieldValue =>
  field === "target_postcode_districts" && Array.isArray(value) ? value.map((v) => v.toUpperCase()) : value;

export async function patchRequirementField(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchOneField("requirements", REQUIREMENT_FIELDS, fd, { transform: upperDistricts, after: rescore });
}

/** Use classes and tenure: a list of choices, posted as a checkbox group. */
export async function patchRequirementChoices(_prev: FormState, fd: FormData): Promise<FormState> {
  return patchOneField("requirements", REQUIREMENT_CHOICES, fd, { after: rescore });
}

/**
 * "Within N miles of a place". Cleared text clears the lot. A place that cannot
 * be found is saved without coordinates, so it is not scored, and the user is
 * told. The place keeps its coordinates when its text did not change.
 */
export async function patchRequirementAnchor(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  const existing = await getRequirementForUpdate(caller.agencyId, id);
  if (!existing) return { error: "This requirement no longer exists." };

  const milesRaw = str(fd, "location_radius_miles");
  const miles = milesRaw === "" ? null : Number(milesRaw);
  const out = await resolveAnchor(
    {
      text: str(fd, "location_anchor_text") || null,
      miles: miles !== null && Number.isFinite(miles) ? miles : null,
      milesRaw,
    },
    {
      text: existing.location_anchor_text,
      lat: existing.location_anchor_lat,
      lng: existing.location_anchor_lng,
    },
    (text) => geocodeAddress({ address_line: text }),
  );
  if (!out.ok) return { error: out.error };

  const done = await patchRow("requirements", caller.agencyId, id, {
    location_anchor_text: out.fields.locationAnchorText,
    location_anchor_lat: out.fields.locationAnchorLat,
    location_anchor_lng: out.fields.locationAnchorLng,
    location_radius_miles: out.fields.locationRadiusMiles,
  });
  if (!done) return { error: "This requirement no longer exists." };
  await rescore({ id }).catch((err) => console.error("refreshMatchesForRequirement failed", err));
  refresh("requirements", id);
  return { message: out.warning ?? "Saved." };
}

/** Lead agent and additional agents. Each must be a member of this agency; new agents are told. */
export async function patchRequirementAgents(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const a = await readAgents(caller.agencyId, fd, async (agencyId) =>
    (await getAgencyMembers(agencyId)).map((m) => m.id),
  );
  if ("error" in a) return a;

  const existing = await getRequirementForUpdate(caller.agencyId, id);
  if (!existing) return { error: "This requirement no longer exists." };

  const done = await patchRow("requirements", caller.agencyId, id, { lead_agent_id: a.lead });
  if (!done) return { error: "This requirement no longer exists." };
  const sync = await syncRequirementAgents(caller.agencyId, id, a.extra);

  const title = (await getRequirementTitle(caller.agencyId, id)) ?? "a requirement";
  await notifyRequirementAgents(caller.agencyId, id, title, sync.added, caller.userId, "agent");
  if (a.lead && a.lead !== (existing.lead_agent_id ?? null)) {
    await notifyRequirementAgents(caller.agencyId, id, title, [a.lead], caller.userId, "lead agent");
  }
  refresh("requirements", id);
  return { message: "Saved." };
}

/** The requirement's company and contact. At least one is required. */
export async function patchRequirementLinks(_prev: FormState, fd: FormData): Promise<FormState> {
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
  const rule = requirementLinkError({ title: "x", companyId, contactId });
  if (rule) return { error: rule };

  const done = await patchRow("requirements", caller.agencyId, id, { company_id: companyId, contact_id: contactId });
  if (!done) return { error: "This requirement no longer exists." };
  refresh("requirements", id);
  return { message: "Saved." };
}

/** The agency's contacts for the link editors, loaded when an editor opens. */
export async function listContactOptionsForEditor(): Promise<
  { options: { id: string; name: string }[] } | { error: string }
> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  return { options: await listContactOptions(caller.agencyId) };
}
