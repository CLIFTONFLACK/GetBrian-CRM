"use server";


import { auth } from "@/lib/auth";
import { revalidatePanelHosts } from "@/lib/revalidate-panels";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { entityExistsInAgency } from "@/lib/db/queries/entity-exists";
import { createNotifications } from "@/lib/db/queries/messages";
import {
  createTask as createTaskRow,
  deleteTask as deleteTaskRow,
  setTaskStatus,
} from "@/lib/db/queries/tasks";
import type { FormState } from "@/lib/actions/types";
import { parseDueInput } from "@/lib/london-time";
import { parseTaskEntity } from "@/lib/task-entity";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Create a task and notify the assignee (if someone else was assigned). */
export async function createTask(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const title = str(formData, "title");
  if (!title) return { error: "A task title is required." };
  const details = str(formData, "details") || null;
  const dueAtRaw = str(formData, "due_at");
  // The form sends a wall-clock time with no zone. It means Europe/London time,
  // which is also how the task is shown, so read it that way (the server is UTC).
  const dueDate = dueAtRaw ? parseDueInput(dueAtRaw) : null;
  if (dueAtRaw && !dueDate) return { error: "That due date is not valid." };
  const dueAt = dueDate ? dueDate.toISOString() : null;
  const assigneeId = str(formData, "assignee_id") || null;

  // Optional record. Both fields are checked against the allow-list, and the
  // record must exist in the caller's agency: the action can be posted to
  // directly, so the form is not the boundary.
  const parsed = parseTaskEntity(formData.get("entity_type"), formData.get("entity_id"));
  if (!parsed.ok) return { error: parsed.error };
  const entity = parsed.entity;
  if (entity && !(await entityExistsInAgency(agencyId, entity.type, entity.id))) {
    return { error: "That record was not found." };
  }

  await createTaskRow(agencyId, session.user.id, { title, details, dueAt, assigneeId, entity });

  // Notify the assignee (if someone else was given the task) — reuses
  // messages.ts's bulk-insert notifications helper rather than duplicating
  // the insert here.
  if (assigneeId && assigneeId !== session.user.id) {
    await createNotifications(agencyId, [assigneeId], {
      title: `New task assigned: “${title}”`,
      body: dueAt ? `Due ${new Date(dueAt).toLocaleString("en-GB")}` : details,
      link: "/tasks",
    });
  }

  revalidatePanelHosts();
  return { message: "Task added." };
}

/**
 * Set a task's status by explicit intent ("mark_done" / "mark_open") — the
 * client submits the state it wants, never a negation of a stale current value.
 */
export async function toggleTaskStatus(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);

  const id = str(formData, "id");
  const intent = str(formData, "intent");
  if (!id || !agencyId) return;
  if (intent !== "mark_done" && intent !== "mark_open") return;

  await setTaskStatus(agencyId, id, intent === "mark_done" ? "done" : "open");
  revalidatePanelHosts();
}

/** Delete a task. */
export async function deleteTask(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const agencyId = await currentAgencyId(session.user.id);

  const id = str(formData, "id");
  if (!id || !agencyId) return;

  await deleteTaskRow(agencyId, id);
  revalidatePanelHosts();
}
