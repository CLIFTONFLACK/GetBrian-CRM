"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { refreshMatchesForRequirement } from "@/lib/actions/matches";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  createRequirement as createRequirementRow,
  deleteRequirement as deleteRequirementRow,
  getRequirementForUpdate,
  syncRequirementAgents,
  updateRequirement as updateRequirementRow,
  type RequirementWriteInput,
} from "@/lib/db/queries/requirements";
import { createNotifications } from "@/lib/db/queries/messages";
import { Constants, type Database } from "@/lib/database.types";
import { requirementLinkError } from "@/lib/requirement-rules";
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
  };
}

/** Lead agent + additional agents (de-duped, lead excluded from extras). */
const agentsFromForm = (fd: FormData) => {
  const lead = nullableStr(fd, "lead_agent_id");
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((id) => id !== lead);
  return { lead, extra };
};

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
  const invalid = requirementLinkError(data);
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
  const invalid = requirementLinkError(data);
  if (invalid) return { error: invalid };

  // Previous lead agent: a hand-off should ping the incoming agent. Also
  // drives the optimistic-concurrency check (see companies.ts's
  // `updateCompany`) — the original Supabase version of this action had no
  // such guard; AGENTS.md calls for adding it here to match disposals/companies.
  const existing = await getRequirementForUpdate(agencyId, id);
  if (!existing) return { error: "This requirement no longer exists." };

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
      try {
        await deleteRequirementRow(agencyId, id);
      } catch (err) {
        redirect(`/requirements/${id}?error=${encodeURIComponent((err as Error).message)}`);
      }
      revalidatePath("/requirements");
    }
  }
  redirect("/requirements");
}
