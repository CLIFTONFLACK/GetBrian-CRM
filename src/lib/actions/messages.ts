"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  createMessages,
  createNotifications,
  deleteMessageForParty,
  getVisibleMessageId,
  listNotifications as listNotificationsRows,
  markAllNotificationsRead as markAllNotificationsReadRows,
  markMessageRead as markMessageReadRow,
  markNotificationRead as markNotificationReadRow,
  type Notification,
} from "@/lib/db/queries/messages";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * Allowlist for message/notification links: app-relative paths into known
 * sections only. Anything else (external URLs, protocol-relative //host,
 * javascript: …) is dropped so a member can't send teammates a button that
 * leaves the app.
 */
const APP_LINK_RE =
  /^\/(deals|listings|requirements|companies|contacts|messages|kyc|matches|tasks)(\/|$)/;

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
 * "Send to team" — deliver an internal message to one or more agency members and
 * ping each recipient's notification bell. `link` points back at the record the
 * message is about. Optionally threads under `parent_id` (a reply).
 */
export async function sendMessage(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;
  const session = await auth();

  const recipients = Array.from(
    new Set(formData.getAll("recipients").map((v) => String(v)).filter(Boolean)),
  ).filter((id) => id !== userId);
  if (recipients.length === 0) return { error: "Pick at least one teammate." };

  const body = str(formData, "body");
  if (!body) return { error: "Write a short message." };
  const subject = str(formData, "subject") || null;
  const rawLink = str(formData, "link");
  const link = rawLink && APP_LINK_RE.test(rawLink) ? rawLink : null;

  // Optional threading: only accept a parent the sender can actually see (see
  // getVisibleMessageId's note — there's no RLS to lean on here).
  const rawParentId = str(formData, "parent_id");
  const parentId = rawParentId ? await getVisibleMessageId(agencyId, rawParentId, userId) : null;

  const senderName = session?.user?.name ?? session?.user?.email ?? "A teammate";

  await createMessages(agencyId, userId, recipients, { subject, body, link, parentId });

  // Ping the existing notification bell for each recipient.
  await createNotifications(agencyId, recipients, {
    title: `New message from ${senderName}`,
    body: subject ?? body.slice(0, 120),
    link: link ?? "/messages",
  });

  revalidatePath("/messages");
  return {
    message: `Sent to ${recipients.length} teammate${recipients.length === 1 ? "" : "s"}.`,
  };
}

/** Mark one received message as read. */
export async function markMessageRead(formData: FormData): Promise<void> {
  if (!isDbConfigured) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  const id = str(formData, "id");
  if (id && agencyId) {
    await markMessageReadRow(agencyId, id, session.user.id);
    revalidatePath("/messages");
  }
}

/** Delete one message from your own view. Either party may delete (migration
 *  0020), which removes the row for both — matching how the inbox presents it
 *  as "delete this message", not "hide it from me". */
export async function deleteMessage(formData: FormData): Promise<void> {
  if (!isDbConfigured) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  const id = str(formData, "id");
  if (id && agencyId) {
    await deleteMessageForParty(agencyId, id, session.user.id);
    revalidatePath("/messages");
  }
}

// ── Notifications ────────────────────────────────────────────────────────

export type Note = Notification;

/** Mark one notification as read (form-based — used by the My Messages page). */
export async function markNotificationRead(formData: FormData): Promise<void> {
  if (!isDbConfigured) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  const id = str(formData, "id");
  if (id && agencyId) {
    await markNotificationReadRow(agencyId, id, session.user.id);
    revalidatePath("/messages");
  }
}

/** The signed-in caller's most recent notifications — called directly (not via
 *  a `<form>`) by the notifications bell whenever it opens. Auth.js JWT
 *  sessions need no live subscription to stay fresh (see notifications-bell.tsx). */
export async function listNotifications(): Promise<Note[]> {
  if (!isDbConfigured) return [];
  const session = await auth();
  if (!session?.user) return [];
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return [];
  return listNotificationsRows(agencyId, session.user.id);
}

/** Marks one notification read — the bell's per-item click handler. */
export async function markNotificationReadById(id: string): Promise<void> {
  if (!isDbConfigured || !id) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return;
  await markNotificationReadRow(agencyId, id, session.user.id);
}

/** Marks every unread notification read — the bell's "Mark all read". */
export async function markAllNotificationsRead(): Promise<void> {
  if (!isDbConfigured) return;
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return;
  await markAllNotificationsReadRows(agencyId, session.user.id);
}
