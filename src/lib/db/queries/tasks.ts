import { sql } from "@/lib/db/client";

// DAO for public.tasks (db/migrations/0029_tasks.sql — standalone to-dos with
// an optional assignee, due date and a polymorphic entity link). Every
// function takes the caller's agencyId as a mandatory first parameter and
// filters on it explicitly — see the same note in companies.ts. There is no
// RLS backstop on this schema (see AGENTS.md). Task-assignment notifications
// reuse messages.ts's createNotifications rather than duplicating the
// notifications insert here (see src/lib/actions/tasks.ts).

export type Task = {
  id: string;
  title: string;
  details: string | null;
  due_at: string | null;
  assignee_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  created_by: string | null;
};

export type TaskWriteInput = {
  title: string;
  details: string | null;
  /** ISO timestamp, or null for "no due date". */
  dueAt: string | null;
  assigneeId: string | null;
};

export async function createTask(
  agencyId: string,
  createdBy: string,
  input: TaskWriteInput,
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.tasks (agency_id, title, details, due_at, assignee_id, created_by)
    values (${agencyId}, ${input.title}, ${input.details}, ${input.dueAt}, ${input.assigneeId}, ${createdBy})
    returning id
  `;
  return rows[0] as { id: string };
}

/** "My tasks" — assigned to me, or created by me and still unassigned.
 *  Mirrors the original's `.or("assignee_id.eq.me,and(created_by.eq.me,
 *  assignee_id.is.null)")` filter. */
export async function listMyTasks(
  agencyId: string,
  userId: string,
  limit = 200,
): Promise<Task[]> {
  return (await sql`
    select id, title, details, due_at::text as due_at, assignee_id,
           entity_type, entity_id, status, created_by
    from public.tasks
    where agency_id = ${agencyId}
      and (assignee_id = ${userId} or (created_by = ${userId} and assignee_id is null))
    order by due_at asc nulls last
    limit ${limit}
  `) as Task[];
}

/** Count of the caller's open assigned tasks — feeds the dashboard's "My
 *  open tasks" KPI. */
export async function countOpenAssignedTasks(agencyId: string, userId: string): Promise<number> {
  const rows = await sql`
    select count(*)::int as count from public.tasks
    where agency_id = ${agencyId} and assignee_id = ${userId} and status = 'open'
  `;
  return (rows[0] as { count: number }).count;
}

/** Count of the caller's open assigned tasks now past due — feeds the
 *  dashboard's "Overdue" KPI (combined with overdue deal reminders by the
 *  caller). */
export async function countOverdueAssignedTasks(
  agencyId: string,
  userId: string,
  nowIso: string,
): Promise<number> {
  const rows = await sql`
    select count(*)::int as count from public.tasks
    where agency_id = ${agencyId} and assignee_id = ${userId} and status = 'open'
      and due_at < ${nowIso}
  `;
  return (rows[0] as { count: number }).count;
}

/**
 * Open tasks past due, NOT yet notified, across every agency — the cron
 * job's due-tasks feed (src/app/api/cron/due/route.ts). This is a
 * system-wide scheduled job with no single caller agency, so unlike every
 * other function in this file it is deliberately unscoped by agencyId; the
 * agency_id on each returned row is used by the caller to scope every
 * downstream write (notification insert) back to that row's own agency.
 */
export async function listDueTasks(
  limit = 100,
): Promise<
  {
    id: string;
    agency_id: string;
    title: string;
    due_at: string | null;
    assignee_id: string | null;
    created_by: string | null;
    entity_type: string | null;
    entity_id: string | null;
  }[]
> {
  const nowIso = new Date().toISOString();
  return (await sql`
    select id, agency_id, title, due_at::text as due_at, assignee_id, created_by, entity_type, entity_id
    from public.tasks
    where status = 'open' and notified_at is null and due_at is not null and due_at <= ${nowIso}
    limit ${limit}
  `) as {
    id: string;
    agency_id: string;
    title: string;
    due_at: string | null;
    assignee_id: string | null;
    created_by: string | null;
    entity_type: string | null;
    entity_id: string | null;
  }[];
}

/** Stamps a task's notified_at so the cron job fires exactly once per due
 *  task. Scoped by agencyId — the id alone comes from a cross-agency cron
 *  read (listDueTasks), so this re-asserts the row's own agency on write. */
export async function markTaskNotified(
  agencyId: string,
  id: string,
  notifiedAt: string,
): Promise<void> {
  await sql`
    update public.tasks set notified_at = ${notifiedAt}
    where id = ${id} and agency_id = ${agencyId}
  `;
}

/** Sets a task's status by explicit intent — see the action layer for why
 *  this takes the target state rather than toggling a stale current value. */
export async function setTaskStatus(
  agencyId: string,
  id: string,
  status: "open" | "done",
): Promise<boolean> {
  const rows = await sql`
    update public.tasks set status = ${status}
    where id = ${id} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteTask(agencyId: string, id: string): Promise<void> {
  await sql`delete from public.tasks where id = ${id} and agency_id = ${agencyId}`;
}
