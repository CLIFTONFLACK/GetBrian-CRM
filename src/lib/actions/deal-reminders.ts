"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { createActivity } from "@/lib/db/queries/activities";
import {
  createDealReminder as createDealReminderRow,
  deleteDealReminder as deleteDealReminderRow,
  getDealOwnerInfo,
  setDealReminderDone,
} from "@/lib/db/queries/deals";
import { createNotifications } from "@/lib/db/queries/messages";
import type { FormState } from "@/lib/actions/types";

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

/** Add a deadline / reminder to a deal (#11) and notify the deal owner. */
export async function addDealReminder(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const dealId = str(formData, "deal_id");
  const title = str(formData, "title");
  const dueAt = str(formData, "due_at");
  if (!dealId) return { error: "Missing deal." };
  if (!title) return { error: "A reminder title is required." };
  if (!dueAt) return { error: "A due date is required." };

  const dueAtIso = new Date(dueAt).toISOString();
  await createDealReminderRow(agencyId, userId, dealId, { title, dueAt: dueAtIso });

  // Notify whoever owns the deal today — the lead agent, falling back to the
  // creator (if someone else set the reminder).
  const deal = await getDealOwnerInfo(agencyId, dealId);
  const owner = deal?.lead_agent_id ?? deal?.created_by ?? null;
  if (deal && owner && owner !== userId) {
    await createNotifications(agencyId, [owner], {
      title: `Reminder set on “${deal.title}”`,
      body: `${title} — due ${new Date(dueAtIso).toLocaleString("en-GB")}`,
      link: `/deals/${dealId}`,
    });
  }

  revalidatePath(`/deals/${dealId}`);
  return { message: "Reminder added." };
}

/**
 * Set a reminder's done state by explicit intent ("mark_done" / "mark_open").
 * The client submits the state it wants, not a negation of a possibly-stale
 * current value — so two people clicking "done" can't re-open it.
 */
export async function toggleDealReminder(formData: FormData): Promise<void> {
  if (!isDbConfigured) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  const id = str(formData, "id");
  const dealId = str(formData, "deal_id");
  const intent = str(formData, "intent");
  if (!id || !agencyId) return;
  if (intent !== "mark_done" && intent !== "mark_open") return;
  await setDealReminderDone(agencyId, id, intent === "mark_done");
  if (dealId) revalidatePath(`/deals/${dealId}`);
}

/** Delete a reminder. */
export async function deleteDealReminder(formData: FormData): Promise<void> {
  if (!isDbConfigured) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  const id = str(formData, "id");
  const dealId = str(formData, "deal_id");
  if (!id || !agencyId) return;
  await deleteDealReminderRow(agencyId, id);
  if (dealId) revalidatePath(`/deals/${dealId}`);
}

/**
 * Record that a deal update was shared (#11) and notify the deal owner. Called
 * from the client share buttons after they open the mail/WhatsApp composer.
 */
export async function logDealShare(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const dealId = str(formData, "deal_id");
  const channel = str(formData, "channel");
  if (!dealId) return { error: "Missing deal." };

  await createActivity(agencyId, userId, {
    type: "note",
    subject: `Update shared via ${channel || "link"}`,
    body: null,
    entityType: "deal",
    entityId: dealId,
    occurredAt: null,
  });

  revalidatePath(`/deals/${dealId}`);
  return { message: "Logged." };
}
