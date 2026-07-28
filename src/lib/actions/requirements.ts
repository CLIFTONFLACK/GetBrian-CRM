"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { refreshMatchesForRequirement } from "@/lib/actions/matches";
import { currentAgencyId } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import { Constants, type Database } from "@/lib/database.types";
import type { FormState } from "@/lib/actions/types";

type UseClass = Database["public"]["Enums"]["use_class"];
type Tenure = Database["public"]["Enums"]["tenure_type"];
type ReqStatus = Database["public"]["Enums"]["requirement_status"];

// `property_types` and `fit_out_prefs` left the form in the 0033/0034 batch:
// use class absorbed the first and the second was never used in briefing. The
// columns are deliberately absent from `payload()`, so existing values are
// preserved rather than blanked on the next save.

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

function payload(fd: FormData) {
  const status = str(fd, "status");
  return {
    title: str(fd, "title"),
    company_id: nullableStr(fd, "company_id"),
    contact_id: nullableStr(fd, "contact_id"),
    status: (
      (Constants.public.Enums.requirement_status as readonly string[]).includes(status)
        ? status
        : "active"
    ) as ReqStatus,
    target_towns: commaArr(fd, "target_towns"),
    target_regions: commaArr(fd, "target_regions"),
    target_counties: commaArr(fd, "target_counties"),
    target_postcode_districts: commaArr(fd, "target_postcode_districts").map((s) =>
      s.toUpperCase(),
    ),
    target_neighbourhoods: commaArr(fd, "target_neighbourhoods"),
    target_london_zones: commaArr(fd, "target_london_zones"),
    use_classes: pickEnum<UseClass>(fd, "use_classes", Constants.public.Enums.use_class),
    tenure_prefs: pickEnum<Tenure>(fd, "tenure_prefs", Constants.public.Enums.tenure_type),
    min_sqft: num(fd, "min_sqft"),
    max_sqft: num(fd, "max_sqft"),
    min_covers: num(fd, "min_covers"),
    max_covers: num(fd, "max_covers"),
    max_rent: num(fd, "max_rent"),
    max_premium: num(fd, "max_premium"),
    max_guide_price: num(fd, "max_guide_price"),
    notes: nullableStr(fd, "notes"),
    lead_agent_id: nullableStr(fd, "lead_agent_id"),
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Lead agent + additional agents (de-duped, lead excluded from extras). */
const agents = (fd: FormData) => {
  const lead = nullableStr(fd, "lead_agent_id");
  const extra = Array.from(
    new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean)),
  ).filter((id) => id !== lead);
  return { lead, extra };
};

/**
 * Replace a requirement's additional-agent rows. Returns the agents that were
 * NOT already on the brief (so the caller can notify them) plus any error —
 * previously both were dropped on the floor, so a failed sync looked identical
 * to a successful one.
 */
async function syncRequirementAgents(
  supabase: Supabase,
  requirementId: string,
  agencyId: string,
  extra: string[],
): Promise<{ added: string[]; error: string | null }> {
  const { data: before, error: readError } = await supabase
    .from("requirement_agents")
    .select("user_id")
    .eq("requirement_id", requirementId)
    .eq("agency_id", agencyId);
  if (readError) return { added: [], error: readError.message };
  const had = new Set((before ?? []).map((r) => r.user_id));

  const { error: deleteError } = await supabase
    .from("requirement_agents")
    .delete()
    .eq("requirement_id", requirementId)
    .eq("agency_id", agencyId);
  if (deleteError) return { added: [], error: deleteError.message };

  if (extra.length > 0) {
    const { error: insertError } = await supabase.from("requirement_agents").insert(
      extra.map((user_id) => ({
        agency_id: agencyId,
        requirement_id: requirementId,
        user_id,
      })),
    );
    if (insertError) return { added: [], error: insertError.message };
  }
  return { added: extra.filter((id) => !had.has(id)), error: null };
}

/**
 * Tell agents they've been put on a brief (same pattern as deal reminders:
 * in-app notification row per recipient, never to yourself).
 */
async function notifyRequirementAgents(
  supabase: Supabase,
  agencyId: string,
  requirementId: string,
  title: string,
  recipients: string[],
  actorId: string | null,
  role: "lead agent" | "agent",
) {
  const users = [...new Set(recipients.filter((id) => id && id !== actorId))];
  if (users.length === 0) return;
  const { error } = await supabase.from("notifications").insert(
    users.map((user_id) => ({
      agency_id: agencyId,
      user_id,
      title: `You're now ${role === "lead agent" ? "the lead agent" : "an agent"} on “${title}”`,
      body: "Open the requirement to see its criteria and current matches.",
      link: `/requirements/${requirementId}`,
    })),
  );
  if (error) {
    console.error(
      `requirement ${requirementId}: agent notification insert failed:`,
      error.message,
    );
  }
}

export async function createRequirement(
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
  if (!data.title) return { error: "A requirement title is required." };
  if (!data.contact_id)
    return { error: "A contact is required for every requirement." };

  const { data: row, error } = await supabase
    .from("requirements")
    .insert({ agency_id: agencyId, created_by: user.id, ...data })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const sync = await syncRequirementAgents(
    supabase,
    row.id,
    agencyId,
    agents(formData).extra,
  );
  if (sync.error) {
    return {
      error: `The requirement was saved, but its agent assignments could not be updated: ${sync.error}`,
    };
  }
  await notifyRequirementAgents(
    supabase,
    agencyId,
    row.id,
    data.title,
    sync.added,
    user.id,
    "agent",
  );
  if (data.lead_agent_id) {
    await notifyRequirementAgents(
      supabase,
      agencyId,
      row.id,
      data.title,
      [data.lead_agent_id],
      user.id,
      "lead agent",
    );
  }

  // New brief → score it against live stock now, so its agents hear about
  // matching listings without having to remember to open /matches.
  await refreshMatchesForRequirement(row.id);

  revalidatePath("/requirements");
  redirect(`/requirements/${row.id}`);
}

export async function updateRequirement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const id = str(formData, "id");
  if (!id) return { error: "Missing requirement id." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const data = payload(formData);
  if (!data.title) return { error: "A requirement title is required." };
  if (!data.contact_id)
    return { error: "A contact is required for every requirement." };

  // Previous lead agent: a hand-off should ping the incoming agent.
  const { data: before } = await supabase
    .from("requirements")
    .select("lead_agent_id")
    .eq("id", id)
    .eq("agency_id", agencyId)
    .maybeSingle();

  const { error } = await supabase
    .from("requirements")
    .update(data)
    .eq("id", id)
    .eq("agency_id", agencyId);
  if (error) return { error: error.message };

  const sync = await syncRequirementAgents(supabase, id, agencyId, agents(formData).extra);
  if (sync.error) {
    return {
      error: `The requirement was saved, but its agent assignments could not be updated: ${sync.error}`,
    };
  }
  await notifyRequirementAgents(
    supabase,
    agencyId,
    id,
    data.title,
    sync.added,
    user?.id ?? null,
    "agent",
  );
  if (data.lead_agent_id && data.lead_agent_id !== (before?.lead_agent_id ?? null)) {
    await notifyRequirementAgents(
      supabase,
      agencyId,
      id,
      data.title,
      [data.lead_agent_id],
      user?.id ?? null,
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
 * like a successful one — the record simply reappeared. Now the failure is
 * carried back to the detail page as `?error=…` and rendered there.
 */
export async function deleteRequirement(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const agencyId = await currentAgencyId(supabase);
  const id = String(formData.get("id") ?? "");
  if (id && agencyId) {
    const { error } = await supabase
      .from("requirements")
      .delete()
      .eq("id", id)
      .eq("agency_id", agencyId);
    if (error) {
      redirect(`/requirements/${id}?error=${encodeURIComponent(error.message)}`);
    }
    revalidatePath("/requirements");
  }
  redirect("/requirements");
}
