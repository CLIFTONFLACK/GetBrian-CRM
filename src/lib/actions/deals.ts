"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers, type AgentOption } from "@/lib/db/queries/agencies";
import {
  createDeal as createDealRow,
  deleteDeal as deleteDealRow,
  findDealByMatch,
  getDealForUpdate,
  getListingStatusFlags,
  getListingSummaryForDeal,
  getRequirementSummaryForDeal,
  reactivateRequirementIfSatisfied,
  recordDealStageEvent,
  setListingStatus,
  setRequirementStatus,
  syncDealAgents,
  updateDeal as updateDealRow,
  updateDealStageOnly,
  updateDealTitle as updateDealTitleRow,
} from "@/lib/db/queries/deals";
import { createNotifications } from "@/lib/db/queries/messages";
import { Constants, type Database } from "@/lib/database.types";
import type { FormState } from "@/lib/actions/types";

type DealStage = Database["public"]["Enums"]["deal_stage"];
type ReqStatus = Database["public"]["Enums"]["requirement_status"];

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const nullableStr = (fd: FormData, k: string) => str(fd, k) || null;
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asStage = (v: string): DealStage =>
  (Constants.public.Enums.deal_stage as readonly string[]).includes(v) ? (v as DealStage) : "lead";

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

/** Additional-agent collaborators from a form (lead is dropped from the set). */
function additionalAgentsFromForm(lead: string | null, fd: FormData): string[] {
  return Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((u) => u !== lead);
}

/**
 * Best-effort stage-history entry (deal_stage_events). Written on creation
 * (from_stage null) and on every stage change — never fails the calling
 * action if the insert errors.
 */
async function recordStageEvent(
  agencyId: string,
  dealId: string,
  fromStage: DealStage | null,
  toStage: DealStage,
  changedBy: string | null,
) {
  try {
    await recordDealStageEvent(agencyId, dealId, fromStage, toStage, changedBy);
  } catch (error) {
    console.error(
      `deal_stage_events insert failed for deal ${dealId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Close the loop: when a deal reaches `completed`, mark its linked requirement
 * `satisfied` so it stops generating matches and leaves the active brief list.
 */
async function satisfyRequirementOnClose(
  requirementId: string | null,
  stage: DealStage,
  agencyId: string,
) {
  if (stage !== "completed" || !requirementId) return;
  await setRequirementStatus(agencyId, requirementId, "satisfied" as ReqStatus);
}

/**
 * Mirror of satisfyRequirementOnClose: when a deal LEAVES `completed` (it was
 * un-closed or moved to fell_through), put the linked requirement back in play
 * — but only if it is still `satisfied` (don't stomp a manual withdraw/hold).
 */
async function reactivateRequirementOnReopen(
  requirementId: string | null,
  fromStage: DealStage,
  toStage: DealStage,
  agencyId: string,
) {
  if (fromStage !== "completed" || toStage === "completed" || !requirementId) return;
  await reactivateRequirementIfSatisfied(agencyId, requirementId);
}

/**
 * Keep the linked listing's status in step with the deal stage — forward-only,
 * never downgrading a status by hand:
 *   offer / heads_of_terms : Available → Under Offer
 *   completed              : Available / Under Offer → Let (to_let) or Sold (for_sale)
 */
async function syncListingStatusForStage(agencyId: string, listingId: string | null, stage: DealStage) {
  if (!listingId) return;
  if (stage !== "offer" && stage !== "heads_of_terms" && stage !== "completed") return;

  const listing = await getListingStatusFlags(agencyId, listingId);
  if (!listing) return;

  const current = (listing.status ?? "").trim().toLowerCase();
  let next: string | null = null;
  if (stage === "completed") {
    if (current === "available" || current === "under offer") {
      next = listing.to_let ? "Let" : listing.for_sale ? "Sold" : "Let";
    }
  } else if (current === "available") {
    next = "Under Offer";
  }
  if (!next) return;

  await setListingStatus(agencyId, listingId, next);
  revalidatePath("/listings");
  revalidatePath(`/listings/${listingId}`);
}

/**
 * Tell the new lead agent they own the deal now (skipped when they made the
 * change themselves). Mirrors the reminder-notification pattern.
 */
async function notifyLeadAssignment(
  agencyId: string,
  dealId: string,
  dealTitle: string,
  leadId: string | null,
  actorId: string | null,
) {
  if (!leadId || leadId === actorId) return;
  await createNotifications(agencyId, [leadId], {
    title: `You are now lead agent on “${dealTitle}”`,
    body: "You've been assigned as the lead agent for this deal.",
    link: `/deals/${dealId}`,
  });
}

/**
 * Create a deal from a requirement ↔ listing match. Derives the title, links
 * both records + the requirement's operator company, and seeds an indicative
 * value from the listing's guide price / premium / rent. Idempotent on the
 * (requirement, listing) pair so the same match can't spawn duplicate deals.
 */
export async function createDealFromMatch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const requirementId = str(formData, "requirement_id");
  const listingId = str(formData, "listing_id");

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  // Reuse an existing deal for this pair rather than duplicating it. A title
  // typed into the modal isn't thrown away — it renames the deal we land on,
  // so the user's input still means something.
  const existing = await findDealByMatch(agencyId, requirementId, listingId);
  if (existing) {
    const typed = str(formData, "title");
    const renamed = Boolean(typed) && typed !== existing.title;
    if (renamed) {
      await updateDealTitleRow(agencyId, existing.id, typed);
      revalidatePath(`/deals/${existing.id}`);
      revalidatePath("/deals");
    }
    redirect(`/deals/${existing.id}?existing=1${renamed ? "&renamed=1" : ""}`);
  }

  const [req, listing] = await Promise.all([
    getRequirementSummaryForDeal(agencyId, requirementId),
    getListingSummaryForDeal(agencyId, listingId),
  ]);

  // Both lookups are agency-scoped and return null for another agency's rows.
  // Reject rather than persisting an id the caller doesn't own — otherwise a
  // foreign requirement_id/listing_id would be written straight onto the new
  // deal (there's no RLS backstop; the deal-board joins are agency-scoped, but
  // this is the write-side half of that boundary — see AGENTS.md).
  if ((requirementId && !req) || (listingId && !listing)) {
    return { error: "That requirement or listing could not be found." };
  }

  const listingName = listing?.title ?? (listing?.city ? `Listing · ${listing.city}` : "Listing");
  const reqName = req?.title ?? "Requirement";
  const value = listing?.guide_price ?? listing?.premium ?? listing?.rent_pa ?? null;
  // Use the name typed in the "name the deal" popup, else derive one.
  const title = str(formData, "title") || `${listingName} ↔ ${reqName}`;
  const lead = str(formData, "lead_agent_id") || null;

  const row = await createDealRow(agencyId, userId, {
    title,
    stage: "lead",
    requirementId: requirementId || null,
    listingId: listingId || null,
    companyId: req?.company_id ?? null,
    value,
    leadAgentId: lead,
  });

  await recordStageEvent(agencyId, row.id, null, "lead", userId);
  await syncDealAgents(agencyId, row.id, additionalAgentsFromForm(lead, formData));
  await notifyLeadAssignment(agencyId, row.id, title, lead, userId);

  revalidatePath("/deals");
  redirect(`/deals/${row.id}`);
}

/**
 * Create a blank, named deal from the pipeline page's "New deal" popup. No
 * required links — the user names it and can wire up the listing/requirement later.
 */
export async function createDeal(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const title = str(formData, "title") || "Untitled deal";
  const lead = str(formData, "lead_agent_id") || null;

  const row = await createDealRow(agencyId, userId, {
    title,
    stage: "lead",
    requirementId: null,
    listingId: null,
    companyId: null,
    value: null,
    leadAgentId: lead,
  });

  await recordStageEvent(agencyId, row.id, null, "lead", userId);
  await syncDealAgents(agencyId, row.id, additionalAgentsFromForm(lead, formData));
  await notifyLeadAssignment(agencyId, row.id, title, lead, userId);

  revalidatePath("/deals");
  redirect(`/deals/${row.id}`);
}

/** Move a deal to a new stage (board column control + detail-page stepper). */
export async function updateDealStage(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const stage = asStage(str(formData, "stage"));
  if (!id || !isDbConfigured) return;

  const session = await auth();
  const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;
  if (!agencyId) return;

  const before = await getDealForUpdate(agencyId, id);
  if (!before) return;

  const ok = await updateDealStageOnly(agencyId, id, stage);
  if (!ok) return;

  if (before.stage !== stage) {
    await recordStageEvent(agencyId, id, before.stage, stage, session?.user?.id ?? null);
    await satisfyRequirementOnClose(before.requirement_id, stage, agencyId);
    await reactivateRequirementOnReopen(before.requirement_id, before.stage, stage, agencyId);
    await syncListingStatusForStage(agencyId, before.listing_id, stage);
  }

  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  if (stage === "completed" || before.stage === "completed") {
    revalidatePath("/requirements");
  }
}

/** Rename a deal — the inline pencil-icon editor used wherever a deal's title
 * is shown (board cards, detail header, linked-deal sections). */
export async function updateDealTitle(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = str(formData, "id");
  if (!id) return { error: "Missing deal id." };

  const title = str(formData, "title");
  if (!title) return { error: "A deal title is required." };

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { agencyId } = caller;

  const ok = await updateDealTitleRow(agencyId, id, title);
  if (!ok) return { error: "This deal no longer exists." };

  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  return { message: "Saved." };
}

/** Update a deal's editable fields from the detail-page form. */
export async function updateDeal(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = str(formData, "id");
  if (!id) return { error: "Missing deal id." };

  const title = str(formData, "title");
  if (!title) return { error: "A deal title is required." };
  const stage = asStage(str(formData, "stage"));

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;
  const lead = nullableStr(formData, "lead_agent_id");

  // Also drives the optimistic-concurrency check (see companies.ts's
  // `updateCompany`) — the original Supabase version of this action had no
  // such guard; AGENTS.md calls for adding it here to match disposals/
  // companies/requirements.
  const before = await getDealForUpdate(agencyId, id);
  if (!before) return { error: "Deal not found." };

  const updated = await updateDealRow(agencyId, id, before.updated_at, {
    title,
    stage,
    value: num(formData, "value"),
    hotTerms: nullableStr(formData, "hot_terms"),
    notes: nullableStr(formData, "notes"),
    leadAgentId: lead,
    expectedClose: nullableStr(formData, "expected_close"),
  });
  if (!updated) {
    return {
      error:
        "This deal was changed by someone else while you were editing. Reload the page and try again.",
    };
  }

  await syncDealAgents(agencyId, id, additionalAgentsFromForm(lead, formData));

  if (before.stage !== stage) {
    await recordStageEvent(agencyId, id, before.stage, stage, userId);
    await satisfyRequirementOnClose(before.requirement_id, stage, agencyId);
    await reactivateRequirementOnReopen(before.requirement_id, before.stage, stage, agencyId);
    await syncListingStatusForStage(agencyId, before.listing_id, stage);
  }

  // Tell the new lead they own this deal now (unless they assigned themselves).
  if (lead && lead !== before.lead_agent_id) {
    await notifyLeadAssignment(agencyId, id, title, lead, userId);
  }

  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  if (stage === "completed" || before.stage === "completed") {
    revalidatePath("/requirements");
  }
  return { message: "Saved." };
}

export async function deleteDeal(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  if (isDbConfigured && id) {
    const session = await auth();
    const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;
    if (agencyId) {
      await deleteDealRow(agencyId, id);
      revalidatePath("/deals");
    }
  }
  redirect("/deals");
}

/**
 * The agency roster + caller id for CreateDealButton's lead-agent picker.
 * Called on open (not passed as a prop by every caller) — the Neon DAO layer
 * has no client-safe equivalent of the old Supabase anon-key browser client,
 * so this small server action replaces the client-side
 * `supabase.from("agency_members")...` fetch it used to do directly.
 */
export async function getDealAgentRoster(): Promise<{ agents: AgentOption[]; meId: string | null }> {
  if (!isDbConfigured) return { agents: [], meId: null };
  const session = await auth();
  if (!session?.user) return { agents: [], meId: null };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { agents: [], meId: session.user.id };
  const agents = await getAgencyMembers(agencyId);
  return { agents, meId: session.user.id };
}
