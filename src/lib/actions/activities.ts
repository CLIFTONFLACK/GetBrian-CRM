"use server";

// Notes and to-dos on a record (db/migrations/0049). One entry is a note. Give
// it an assignee or a due date and it is a to-do. These actions replace the old
// separate task and deal-reminder actions.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers, getMemberRole } from "@/lib/db/queries/agencies";
import {
  createActivity,
  deleteActivity as deleteActivityRow,
  getActivity,
  setTodoStatus,
  updateActivity,
} from "@/lib/db/queries/activities";
import { entityExistsInAgency } from "@/lib/db/queries/entity-exists";
import { createNotifications } from "@/lib/db/queries/messages";
import { Constants, type Database } from "@/lib/database.types";
import type { FormState } from "@/lib/actions/types";
import { parseDueInput } from "@/lib/london-time";
import { fullRecordHref } from "@/lib/record-ref";
import { revalidatePanelHosts } from "@/lib/revalidate-panels";
import { parseTaskEntity } from "@/lib/task-entity";
import { sameDueMinute, staysFindable, statusFor } from "@/lib/todo";

type ActivityType = Database["public"]["Enums"]["activity_type"];

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

const PATH: Record<string, string> = {
  company: "companies",
  contact: "contacts",
  listing: "listings",
  requirement: "requirements",
  deal: "deals",
};

async function requireCaller(): Promise<{ userId: string; agencyId: string } | { error: string }> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { userId: session.user.id, agencyId };
}

/** The assignee and due fields of a form: a member of this agency, and a valid time. */
async function readAssignment(
  agencyId: string,
  fd: FormData,
): Promise<{ assigneeId: string | null; dueAt: string | null } | { error: string }> {
  const assigneeId = str(fd, "assignee_id") || null;
  if (assigneeId) {
    const members = await getAgencyMembers(agencyId);
    if (!members.some((m) => m.id === assigneeId)) return { error: "Pick an assignee from your own team." };
  }
  const dueRaw = str(fd, "due_at");
  // The form sends an absolute instant (ISO with Z), made in the browser from the
  // viewer's own zone. A zone-less value (a direct post) is read as Europe/London
  // time, because the server runs in UTC.
  const due = dueRaw ? parseDueInput(dueRaw) : null;
  if (dueRaw && !due) return { error: "That due date is not valid." };
  return { assigneeId, dueAt: due ? due.toISOString() : null };
}

function revalidateEntity(entityType: string | null, entityId: string | null) {
  if (entityType && entityId && PATH[entityType]) revalidatePath(`/${PATH[entityType]}/${entityId}`);
  revalidatePanelHosts();
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/messages");
}

async function notifyAssignee(
  agencyId: string,
  assigneeId: string,
  title: string,
  dueAt: string | null,
  entityType: string | null,
  entityId: string | null,
) {
  const link =
    entityType && entityId && PATH[entityType]
      ? fullRecordHref({ type: entityType as "company", id: entityId })
      : "/tasks";
  await createNotifications(agencyId, [assigneeId], {
    title: `New to-do assigned: “${title}”`,
    // The server has no viewer zone, so the time is stated in UTC.
    body: dueAt ? `Due ${new Date(dueAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : null,
    link,
  });
}

/** Add a note. With an assignee or a due date it is a to-do, and the assignee is told. */
export async function logActivity(_prev: FormState, formData: FormData): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const subject = str(formData, "subject");
  const body = str(formData, "body");
  if (!subject && !body) return { error: "Add a subject or a note." };

  // The record is optional (a loose to-do from the My to-dos page has none).
  // When given it is checked against the allow-list and must be in this agency:
  // the action can be posted to directly, so the form is not the boundary.
  const parsed = parseTaskEntity(formData.get("entity_type"), formData.get("entity_id"));
  if (!parsed.ok) return { error: parsed.error };
  const entity = parsed.entity;
  if (entity && !(await entityExistsInAgency(agencyId, entity.type, entity.id))) {
    return { error: "That record was not found." };
  }

  const assignment = await readAssignment(agencyId, formData);
  if ("error" in assignment) return assignment;
  // A note with no record and no assignee or due date would belong to nothing
  // and show nowhere. The My to-dos form always makes a to-do, so ask for one.
  if (!entity && !assignment.assigneeId && !assignment.dueAt) {
    return { error: "Pick an assignee or a due date, or add this from a record's Notes & to-dos tab." };
  }

  // Optional back-dating: a yyyy-mm-dd from the form maps to that day.
  const occurredOn = str(formData, "occurred_on");
  const occurredAt =
    occurredOn && /^\d{4}-\d{2}-\d{2}$/.test(occurredOn)
      ? new Date(`${occurredOn}T12:00:00`).toISOString()
      : null;

  const typeRaw = str(formData, "type");
  const type = ((Constants.public.Enums.activity_type as readonly string[]).includes(typeRaw)
    ? typeRaw
    : "note") as ActivityType;

  await createActivity(agencyId, userId, {
    type,
    subject: subject || null,
    body: body || null,
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
    occurredAt,
    assigneeId: assignment.assigneeId,
    dueAt: assignment.dueAt,
  });

  if (assignment.assigneeId && assignment.assigneeId !== userId) {
    await notifyAssignee(
      agencyId,
      assignment.assigneeId,
      subject || body.slice(0, 80),
      assignment.dueAt,
      entity?.type ?? null,
      entity?.id ?? null,
    );
  }

  revalidateEntity(entity?.type ?? null, entity?.id ?? null);
  return { message: assignment.assigneeId || assignment.dueAt ? "To-do added." : "Note added." };
}

/** Who may change or delete an entry: its author, its assignee, or an admin or manager. */
async function canChange(
  agencyId: string,
  userId: string,
  entry: { created_by: string | null; assignee_id: string | null },
): Promise<boolean> {
  if (entry.created_by === userId || entry.assignee_id === userId) return true;
  const role = await getMemberRole(agencyId, userId);
  return role === "admin" || role === "manager";
}

/**
 * Tick or un-tick a to-do by explicit intent ("mark_done" / "mark_open"): the
 * client sends the state it wants, so two people ticking at once cannot re-open it.
 */
export async function toggleTodo(formData: FormData): Promise<void> {
  const caller = await requireCaller();
  if ("error" in caller) return;
  const id = str(formData, "id");
  const intent = str(formData, "intent");
  if (!id) return;
  if (intent !== "mark_done" && intent !== "mark_open") return;

  const entry = await getActivity(caller.agencyId, id);
  if (!entry || entry.status == null) return;
  await setTodoStatus(caller.agencyId, id, intent === "mark_done" ? "done" : "open", caller.userId);
  revalidateEntity(entry.entity_type, entry.entity_id);
}

/** Edit an entry's text, assignee and due date. "plain_note" turns a to-do back into a note. */
export async function editActivity(_prev: FormState, formData: FormData): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const id = str(formData, "id");
  if (!id) return { error: "Missing entry id." };
  const entry = await getActivity(agencyId, id);
  if (!entry) return { error: "This entry no longer exists." };
  if (!(await canChange(agencyId, userId, entry))) {
    return { error: "Only the author, the assignee or an admin can change this." };
  }

  const subject = str(formData, "subject");
  const body = str(formData, "body");
  if (!subject && !body) return { error: "Add a subject or a note." };

  const plain = formData.get("plain_note") != null;
  let assigneeId: string | null = null;
  let dueAt: string | null = null;
  if (!plain) {
    const a = await readAssignment(agencyId, formData);
    if ("error" in a) return a;
    assigneeId = a.assigneeId;
    dueAt = a.dueAt;
  }
  const status = plain ? null : statusFor({ assigneeId, dueAt }, entry.status);
  // An entry with no record is found only through My to-dos, which lists to-dos.
  // Turning it into a plain note, or clearing its assignee and due date while
  // it is not a to-do, would leave it where no list shows it.
  // An old entry that was already a note with no record may still have its text
  // fixed: the check is for a to-do being turned into something no list shows.
  if (entry.status != null && !staysFindable({ entity_type: entry.entity_type, status })) {
    return { error: "An entry with no record has to stay a to-do. Delete it instead, or keep an assignee or a due date." };
  }

  const dueChanged = !sameDueMinute(entry.due_at, dueAt);
  const ok = await updateActivity(agencyId, id, {
    subject: subject || null,
    body: body || null,
    assigneeId,
    dueAt,
    status,
    dueChanged,
  });
  if (!ok) return { error: "This entry no longer exists." };

  if (assigneeId && assigneeId !== entry.assignee_id && assigneeId !== userId) {
    await notifyAssignee(
      agencyId,
      assigneeId,
      subject || body.slice(0, 80),
      dueAt,
      entry.entity_type,
      entry.entity_id,
    );
  }
  revalidateEntity(entry.entity_type, entry.entity_id);
  return { message: "Saved." };
}

export async function deleteActivity(formData: FormData): Promise<void> {
  const caller = await requireCaller();
  if ("error" in caller) return;
  const id = str(formData, "id");
  if (!id) return;
  const entry = await getActivity(caller.agencyId, id);
  if (!entry) return;
  if (!(await canChange(caller.agencyId, caller.userId, entry))) return;
  await deleteActivityRow(caller.agencyId, id);
  revalidateEntity(entry.entity_type, entry.entity_id);
}

/**
 * Record that a deal update was shared and note it on the deal. Called from the
 * client share buttons after they open the mail or WhatsApp composer.
 */
export async function logDealShare(_prev: FormState, formData: FormData): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const dealId = str(formData, "deal_id");
  const channel = str(formData, "channel");
  if (!dealId) return { error: "Missing deal." };
  if (!(await entityExistsInAgency(agencyId, "deal", dealId))) return { error: "That deal was not found." };

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
