"use server";

import { del } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { revalidatePanelHosts } from "@/lib/revalidate-panels";
import { redirect } from "next/navigation";

import { refreshMatchesForRequirement } from "@/lib/actions/matches";
import { auth } from "@/lib/auth";
import { isBlobHostedUrl } from "@/lib/blob-url";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers, isAgencyAdmin } from "@/lib/db/queries/agencies";
import { geocodeAddress } from "@/lib/maps/geocode";
import { rentPsfError, resolveAnchor } from "@/lib/requirement-anchor";
import {
  companyBelongsToAgency,
  contactBelongsToAgency,
  createRequirement as createRequirementRow,
  deleteRequirement as deleteRequirementRow,
  getRequirementForUpdate,
  getRequirementRatingContext,
  setRequirementListingRating,
  syncRequirementAgents,
  updateRequirement as updateRequirementRow,
  type RequirementWriteInput,
} from "@/lib/db/queries/requirements";
import { createNotifications } from "@/lib/db/queries/messages";
import { Constants, type Database } from "@/lib/database.types";
import { requirementLinkError } from "@/lib/requirement-rules";
import { canEditRating, parseRatingInput, RATING_NOT_ALLOWED } from "@/lib/listing-rating";
import type { FormState } from "@/lib/actions/types";

type UseClass = Database["public"]["Enums"]["use_class"];
type Tenure = Database["public"]["Enums"]["tenure_type"];
type ReqStatus = Database["public"]["Enums"]["requirement_status"];

// `property_types` and `fit_out_prefs` left the form in the 0033/0034 batch:
// use class absorbed the first and the second was never used in briefing. The
// columns are deliberately absent from `payload()`, so existing values are
// preserved rather than blanked on the next save (the DAO's update omits
// them too — see requirements.ts's `updateRequirement`).

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const nullableStr = (fd: FormData, k: string) => str(fd, k) || null;
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const commaArr = (fd: FormData, k: string) =>
  str(fd, k)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const pickEnum = <T extends string>(
  fd: FormData,
  k: string,
  allowed: readonly T[],
): T[] =>
  fd
    .getAll(k)
    .map(String)
    .filter((v): v is T => (allowed as readonly string[]).includes(v));

function payload(fd: FormData): RequirementWriteInput {
  const status = str(fd, "status");
  return {
    title: str(fd, "title"),
    companyId: nullableStr(fd, "company_id"),
    contactId: nullableStr(fd, "contact_id"),
    status: (
      (Constants.public.Enums.requirement_status as readonly string[]).includes(status)
        ? status
        : "active"
    ) as ReqStatus,
    targetTowns: commaArr(fd, "target_towns"),
    targetRegions: commaArr(fd, "target_regions"),
    targetCounties: commaArr(fd, "target_counties"),
    targetPostcodeDistricts: commaArr(fd, "target_postcode_districts").map((s) =>
      s.toUpperCase(),
    ),
    targetNeighbourhoods: commaArr(fd, "target_neighbourhoods"),
    targetLondonZones: commaArr(fd, "target_london_zones"),
    useClasses: pickEnum<UseClass>(fd, "use_classes", Constants.public.Enums.use_class),
    tenurePrefs: pickEnum<Tenure>(fd, "tenure_prefs", Constants.public.Enums.tenure_type),
    minSqft: num(fd, "min_sqft"),
    maxSqft: num(fd, "max_sqft"),
    minCovers: num(fd, "min_covers"),
    maxCovers: num(fd, "max_covers"),
    maxRent: num(fd, "max_rent"),
    maxPremium: num(fd, "max_premium"),
    maxGuidePrice: num(fd, "max_guide_price"),
    notes: nullableStr(fd, "notes"),
    leadAgentId: nullableStr(fd, "lead_agent_id"),
    // The place and radius are resolved by applyAnchor(), which needs the
    // database and the geocoder; the quick-create form has no such fields.
    locationAnchorText: null,
    locationAnchorLat: null,
    locationAnchorLng: null,
    locationRadiusMiles: null,
    maxRentPsf: num(fd, "max_rent_psf"),
  };
}

/**
 * Read "Near (place)" and "Within (miles)" from the form into `data`, finding
 * the place's coordinates (see src/lib/requirement-anchor.ts). Returns an error
 * to show, or null. A place that cannot be found is NOT an error: the text and
 * radius are saved without coordinates (the brief's location is not scored)
 * and the requirement page shows a warning.
 */
async function applyAnchor(
  fd: FormData,
  data: RequirementWriteInput,
  stored: { text: string | null; lat: number | null; lng: number | null } | null,
): Promise<string | null> {
  const out = await resolveAnchor(
    {
      text: nullableStr(fd, "location_anchor_text"),
      miles: num(fd, "location_radius_miles"),
      milesRaw: str(fd, "location_radius_miles"),
    },
    stored,
    (text) => geocodeAddress({ address_line: text }),
  );
  if (!out.ok) return out.error;
  Object.assign(data, out.fields);
  return null;
}

/** Lead agent + additional agents (de-duped, lead excluded from extras). */
const agentsFromForm = (fd: FormData) => {
  const lead = nullableStr(fd, "lead_agent_id");
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((id) => id !== lead);
  return { lead, extra };
};

/**
 * The company/contact ids arrive from the form and were never checked against
 * the caller's agency — a crafted POST could link a brief to another tenant's
 * record. Ownership is confirmed here before the shape rules run.
 */
async function requirementPayloadError(
  agencyId: string,
  data: RequirementWriteInput,
): Promise<string | null> {
  if (data.companyId && !(await companyBelongsToAgency(agencyId, data.companyId))) {
    return "That company was not found in your agency.";
  }
  if (data.contactId && !(await contactBelongsToAgency(agencyId, data.contactId))) {
    return "That contact was not found in your agency.";
  }
  const psf = rentPsfError(data.maxRentPsf);
  if (psf) return psf;
  return requirementLinkError(data);
}

/**
 * The lead agent and the additional agents arrive from the form as bare ids.
 * Each must be a member of the CALLER's agency, or a crafted POST could put
 * someone from another tenant on the brief (and send them a notification).
 * Any member of the agency may change the lead: there is no role rule here.
 */
async function agentMembershipError(
  agencyId: string,
  fd: FormData,
): Promise<string | null> {
  const { lead, extra } = agentsFromForm(fd);
  const wanted = [...(lead ? [lead] : []), ...extra];
  if (wanted.length === 0) return null;
  const members = new Set((await getAgencyMembers(agencyId)).map((m) => m.id));
  if (lead && !members.has(lead)) return "The lead agent is not a member of your agency.";
  if (extra.some((id) => !members.has(id))) {
    return "An additional agent is not a member of your agency.";
  }
  return null;
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

/**
 * Tell agents they've been put on a brief (same pattern as deal reminders:
 * in-app notification row per recipient, never to yourself).
 *
 * The `notifications` table isn't part of this migration batch (see
 * AGENTS.md) — kept on the Supabase client until its own batch lands, exactly
 * like the still-unmigrated-domain reads on src/app/(app)/companies/[id]/page.tsx.
 */
async function notifyRequirementAgents(
  agencyId: string,
  requirementId: string,
  title: string,
  recipients: string[],
  actorId: string | null,
  role: "lead agent" | "agent",
) {
  const users = [...new Set(recipients.filter((id) => id && id !== actorId))];
  if (users.length === 0) return;
  try {
    await createNotifications(agencyId, users, {
      title: `You're now ${role === "lead agent" ? "the lead agent" : "an agent"} on “${title}”`,
      body: "Open the requirement to see its criteria and current matches.",
      link: `/requirements/${requirementId}`,
    });
  } catch (err) {
    console.error(`requirement ${requirementId}: agent notification insert failed:`, err);
  }
}

export async function createRequirement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const data = payload(formData);
  const invalid =
    (await requirementPayloadError(agencyId, data)) ??
    (await agentMembershipError(agencyId, formData)) ??
    (await applyAnchor(formData, data, null));
  if (invalid) return { error: invalid };

  const { id } = await createRequirementRow(agencyId, userId, data);

  const { extra } = agentsFromForm(formData);
  const sync = await syncRequirementAgents(agencyId, id, extra);
  await notifyRequirementAgents(agencyId, id, data.title, sync.added, userId, "agent");
  if (data.leadAgentId) {
    await notifyRequirementAgents(
      agencyId,
      id,
      data.title,
      [data.leadAgentId],
      userId,
      "lead agent",
    );
  }

  // New brief → score it against live stock now, so its agents hear about
  // matching listings without having to remember to open /matches.
  await refreshMatchesForRequirement(id);

  revalidatePath("/requirements");
  redirect(`/requirements/${id}`);
}

/**
 * Quick-create from the company or contact page (#c2/#ct2): title, status and
 * notes only, with the company/contact link inherited from the page. Returns
 * `created` instead of redirecting so the modal can close and the page refresh
 * in place. Anything beyond the basics is edited on the brief afterwards.
 *
 * Tenure defaults to Leasehold, the same pre-selection the full form makes for
 * a new brief; the column default stays '{}' for the intake form and importer.
 */
export async function quickCreateRequirement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const data: RequirementWriteInput = {
    ...payload(formData),
    tenurePrefs: ["leasehold"] as Tenure[],
  };
  const invalid = await requirementPayloadError(agencyId, data);
  if (invalid) return { error: invalid };

  const { id } = await createRequirementRow(agencyId, userId, data);
  await refreshMatchesForRequirement(id);

  revalidatePath("/requirements");
  revalidatePanelHosts();
  if (data.companyId) revalidatePath(`/companies/${data.companyId}`);
  if (data.contactId) revalidatePath(`/contacts/${data.contactId}`);
  return { created: { id, name: data.title }, message: `Added ${data.title}.` };
}

export async function updateRequirement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = str(formData, "id");
  if (!id) return { error: "Missing requirement id." };

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const data = payload(formData);
  const invalid =
    (await requirementPayloadError(agencyId, data)) ??
    (await agentMembershipError(agencyId, formData));
  if (invalid) return { error: invalid };

  // Previous lead agent: a hand-off should ping the incoming agent. Also
  // drives the optimistic-concurrency check (see companies.ts's
  // `updateCompany`) — the original Supabase version of this action had no
  // such guard; AGENTS.md calls for adding it here to match disposals/companies.
  const existing = await getRequirementForUpdate(agencyId, id);
  if (!existing) return { error: "This requirement no longer exists." };

  // The place keeps its stored coordinates when the text did not change.
  const anchorError = await applyAnchor(formData, data, {
    text: existing.location_anchor_text,
    lat: existing.location_anchor_lat,
    lng: existing.location_anchor_lng,
  });
  if (anchorError) return { error: anchorError };

  const updated = await updateRequirementRow(agencyId, id, existing.updated_at, data);
  if (!updated) {
    return {
      error:
        "This requirement was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  const { extra } = agentsFromForm(formData);
  const sync = await syncRequirementAgents(agencyId, id, extra);
  await notifyRequirementAgents(agencyId, id, data.title, sync.added, userId, "agent");
  if (data.leadAgentId && data.leadAgentId !== (existing.lead_agent_id ?? null)) {
    await notifyRequirementAgents(
      agencyId,
      id,
      data.title,
      [data.leadAgentId],
      userId,
      "lead agent",
    );
  }

  // Criteria may have moved — re-score against live stock.
  await refreshMatchesForRequirement(id);

  revalidatePath("/requirements");
  revalidatePath(`/requirements/${id}`);
  revalidatePanelHosts();
  redirect(`/requirements/${id}`);
}

/**
 * Delete a requirement. A failed delete used to redirect to the list exactly
 * like a successful one — the record simply reappeared. Now a thrown DB error
 * is carried back to the detail page as `?error=…` and rendered there instead
 * of failing silently.
 */
export async function deleteRequirement(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (isDbConfigured && id) {
    const session = await auth();
    const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;
    if (agencyId) {
      let blobUrls: string[];
      try {
        blobUrls = await deleteRequirementRow(agencyId, id);
      } catch (err) {
        redirect(`/requirements/${id}?error=${encodeURIComponent((err as Error).message)}`);
      }
      // Remove the landlord-pack Blob objects the FK cascade left behind — only
      // ones we host. Best-effort: the DB rows are already gone regardless
      // (mirrors deleteDisposal in disposals.ts).
      const ours = blobUrls.filter(isBlobHostedUrl);
      if (ours.length > 0) await del(ours).catch(() => {});
      revalidatePath("/requirements");
    }
  }
  redirect("/requirements");
}

/**
 * Sets or clears a requirement's Listing Rating (1 to 5, or null = not rated).
 *
 * THE permission check for the rating lives here: only the requirement's lead
 * agent or an agency admin may write it. Managers and additional agents may
 * not. The requirement is loaded by id AND the caller's agency, so one in
 * another agency gives the same answer as one that does not exist.
 * updateRequirement (the edit form) never writes this column.
 */
export async function setRequirementRating(
  requirementId: string,
  rating: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseRatingInput(rating);
  if (!parsed.ok) return { ok: false, error: "Choose a rating from 1 to 5 stars." };
  if (typeof requirementId !== "string" || requirementId.length === 0) {
    return { ok: false, error: "Requirement not found." };
  }

  const caller = await requireCaller();
  if ("error" in caller) return { ok: false, error: caller.error };

  const current = await getRequirementRatingContext(caller.agencyId, requirementId);
  if (!current) return { ok: false, error: "Requirement not found." };

  const admin = await isAgencyAdmin(caller.userId, caller.agencyId);
  if (
    !canEditRating({ userId: caller.userId, leadAgentId: current.lead_agent_id, isAdmin: admin })
  ) {
    return { ok: false, error: `${RATING_NOT_ALLOWED}.` };
  }

  const saved = await setRequirementListingRating(
    caller.agencyId,
    requirementId,
    parsed.value,
  );
  if (!saved) return { ok: false, error: "Requirement not found." };

  revalidatePath(`/requirements/${requirementId}`);
  revalidatePanelHosts();
  return { ok: true };
}
