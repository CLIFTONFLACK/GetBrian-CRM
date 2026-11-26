import { sql } from "@/lib/db/client";
import type { Database } from "@/lib/database.types";
import { touchDateUpdated } from "@/lib/db/queries/date-updated";

// DAO for public.activities: notes and to-dos on one list per record
// (db/migrations/0049). An entry with `status` null is a note. An entry with
// status 'open' or 'done' is a to-do, and may have an assignee and a due date.
// entity_type / entity_id point at a company, contact, listing, requirement or
// deal. Every function takes the caller's agencyId as a mandatory first
// parameter and filters on it explicitly: there is no RLS backstop on this
// schema (see AGENTS.md).

type ActivityType = Database["public"]["Enums"]["activity_type"];
type EntityType = Database["public"]["Enums"]["entity_type"];

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  entity_type: EntityType | null;
  entity_id: string | null;
  occurred_at: string;
  created_by: string | null;
  created_at: string;
  assignee_id: string | null;
  due_at: string | null;
  /** null = a note; 'open' | 'done' = a to-do. */
  status: string | null;
  completed_at: string | null;
};

/**
 * The entries of one record: every open to-do, plus the newest `limit` of the
 * rest (notes and done to-dos). An open to-do must never fall off the list
 * because the record has many notes. The caller orders them for display
 * (src/lib/todo.ts).
 */
export async function listActivitiesForEntity(
  agencyId: string,
  entityType: EntityType,
  entityId: string,
  limit = 100,
): Promise<Activity[]> {
  // ORDER BY names an output column first, and occurred_at is output as text, so
  // the inner sort names the table column and the outer sort casts it back.
  return (await sql`
    select * from (
      (
        select id, type, subject, body, entity_type, entity_id,
               occurred_at::text as occurred_at, created_by, created_at::text as created_at,
               assignee_id, due_at::text as due_at, status, completed_at::text as completed_at
        from public.activities
        where agency_id = ${agencyId} and entity_type = ${entityType} and entity_id = ${entityId}
          and status = 'open'
      )
      union all
      (
        select id, type, subject, body, entity_type, entity_id,
               occurred_at::text as occurred_at, created_by, created_at::text as created_at,
               assignee_id, due_at::text as due_at, status, completed_at::text as completed_at
        from public.activities
        where agency_id = ${agencyId} and entity_type = ${entityType} and entity_id = ${entityId}
          and status is distinct from 'open'
        order by public.activities.occurred_at desc
        limit ${limit}
      )
    ) as entries
    order by entries.occurred_at::timestamptz desc
  `) as Activity[];
}

export type ActivityWriteInput = {
  type: ActivityType;
  subject: string | null;
  body: string | null;
  entityType: EntityType | null;
  entityId: string | null;
  /** ISO timestamp to back-date `occurred_at`; omitted means "now" (column default). */
  occurredAt: string | null;
  /** Set any of these and the entry is a to-do (status 'open'). */
  assigneeId?: string | null;
  dueAt?: string | null;
};

/** Logs one entry. `occurredAt: null` takes the column default (insert time). */
export async function createActivity(
  agencyId: string,
  createdBy: string,
  input: ActivityWriteInput,
): Promise<{ id: string }> {
  const assigneeId = input.assigneeId ?? null;
  const dueAt = input.dueAt ?? null;
  const status = assigneeId || dueAt ? "open" : null;
  const rows = input.occurredAt
    ? await sql`
        insert into public.activities (
          agency_id, created_by, type, subject, body, entity_type, entity_id, occurred_at,
          assignee_id, due_at, status
        ) values (
          ${agencyId}, ${createdBy}, ${input.type}, ${input.subject}, ${input.body},
          ${input.entityType}, ${input.entityId}, ${input.occurredAt},
          ${assigneeId}, ${dueAt}, ${status}
        )
        returning id
      `
    : await sql`
        insert into public.activities (
          agency_id, created_by, type, subject, body, entity_type, entity_id,
          assignee_id, due_at, status
        ) values (
          ${agencyId}, ${createdBy}, ${input.type}, ${input.subject}, ${input.body},
          ${input.entityType}, ${input.entityId},
          ${assigneeId}, ${dueAt}, ${status}
        )
        returning id
      `;
  // A logged entry counts as work on the record (company/contact/requirement
  // only; other entity types are ignored). Best effort.
  await touchDateUpdated(input.entityType, input.entityId, agencyId);
  return rows[0] as { id: string };
}

/** One entry, for permission checks and edits. Null when it is not in this agency. */
export async function getActivity(agencyId: string, id: string): Promise<Activity | null> {
  const rows = await sql`
    select id, type, subject, body, entity_type, entity_id,
           occurred_at::text as occurred_at, created_by, created_at::text as created_at,
           assignee_id, due_at::text as due_at, status, completed_at::text as completed_at
    from public.activities
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as Activity | undefined) ?? null;
}

export type ActivityEditInput = {
  subject: string | null;
  body: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  /** The status after the edit: null keeps a note a note. See statusFor in src/lib/todo.ts. */
  status: "open" | "done" | null;
  /** True when the due time changed, so the reminder fires again for the new time. */
  dueChanged: boolean;
};

/** Edits the text, the assignee and the due date of an entry. Returns false when it is not in this agency. */
export async function updateActivity(
  agencyId: string,
  id: string,
  input: ActivityEditInput,
): Promise<boolean> {
  const rows = await sql`
    update public.activities set
      subject = ${input.subject},
      body = ${input.body},
      assignee_id = ${input.assigneeId},
      due_at = ${input.dueAt},
      status = ${input.status},
      completed_at = case when ${input.status}::text = 'done' then completed_at else null end,
      completed_by = case when ${input.status}::text = 'done' then completed_by else null end,
      notified_at = case when ${input.dueChanged} then null else notified_at end
    where id = ${id} and agency_id = ${agencyId}
    returning entity_type, entity_id
  `;
  const row = rows[0] as { entity_type: EntityType | null; entity_id: string | null } | undefined;
  if (row) await touchDateUpdated(row.entity_type, row.entity_id, agencyId);
  return Boolean(row);
}

/**
 * Ticks or un-ticks a to-do by explicit intent (the client sends the state it
 * wants, never a negation of a stale value). A note (status null) is never
 * changed by this: the WHERE needs a status.
 */
export async function setTodoStatus(
  agencyId: string,
  id: string,
  status: "open" | "done",
  userId: string,
): Promise<boolean> {
  const rows = await sql`
    update public.activities set
      status = ${status},
      completed_at = case when ${status} = 'done' then now() else null end,
      completed_by = case when ${status} = 'done' then ${userId}::uuid else null end
    where id = ${id} and agency_id = ${agencyId} and status is not null
    returning entity_type, entity_id
  `;
  const row = rows[0] as { entity_type: EntityType | null; entity_id: string | null } | undefined;
  if (row) await touchDateUpdated(row.entity_type, row.entity_id, agencyId);
  return Boolean(row);
}

export async function deleteActivity(agencyId: string, id: string): Promise<boolean> {
  const rows = await sql`
    delete from public.activities where id = ${id} and agency_id = ${agencyId}
    returning entity_type, entity_id
  `;
  const row = rows[0] as { entity_type: EntityType | null; entity_id: string | null } | undefined;
  if (row) await touchDateUpdated(row.entity_type, row.entity_id, agencyId);
  return Boolean(row);
}

export type TodoRow = Activity;

/**
 * "My to-dos": assigned to me, or created by me and still unassigned. Open
 * first (soonest due first, none last), then done (most recently changed first).
 */
export async function listMyTodos(
  agencyId: string,
  userId: string,
  limit = 200,
): Promise<TodoRow[]> {
  return (await sql`
    select id, type, subject, body, entity_type, entity_id,
           occurred_at::text as occurred_at, created_by, created_at::text as created_at,
           assignee_id, due_at::text as due_at, status, completed_at::text as completed_at
    from public.activities
    where agency_id = ${agencyId} and status is not null
      and (assignee_id = ${userId} or (created_by = ${userId} and assignee_id is null))
    order by (status = 'done'),
             case when status = 'open' then due_at end asc nulls last,
             case when status = 'done' then updated_at end desc
    limit ${limit}
  `) as TodoRow[];
}

/** The caller's open assigned to-dos: the dashboard's "My open tasks". */
export async function countOpenAssignedTodos(agencyId: string, userId: string): Promise<number> {
  const rows = await sql`
    select count(*)::int as count from public.activities
    where agency_id = ${agencyId} and assignee_id = ${userId} and status = 'open'
  `;
  return (rows[0] as { count: number }).count;
}

/** The caller's open assigned to-dos past due: the dashboard's "Overdue". */
export async function countOverdueAssignedTodos(
  agencyId: string,
  userId: string,
  nowIso: string,
): Promise<number> {
  const rows = await sql`
    select count(*)::int as count from public.activities
    where agency_id = ${agencyId} and assignee_id = ${userId} and status = 'open'
      and due_at < ${nowIso}
  `;
  return (rows[0] as { count: number }).count;
}

export type DueTodo = {
  id: string;
  agency_id: string;
  subject: string | null;
  body: string | null;
  due_at: string | null;
  assignee_id: string | null;
  created_by: string | null;
  entity_type: string | null;
  entity_id: string | null;
};

/**
 * Open to-dos past due and not yet notified: the cron job's feed
 * (src/app/api/cron/due/route.ts). Optional filters: one agency, and only items
 * due at or after notBefore (the agency's enabled_since). Null skips a filter.
 * Each returned row carries its own agency_id, which the caller uses to scope
 * every downstream write.
 */
export async function listDueTodos(
  limit = 100,
  scope: { agencyId?: string; notBefore?: string } = {},
): Promise<DueTodo[]> {
  const nowIso = new Date().toISOString();
  const agencyId = scope.agencyId ?? null;
  const notBefore = scope.notBefore ?? null;
  return (await sql`
    select id, agency_id, subject, body, due_at::text as due_at, assignee_id, created_by,
           entity_type::text as entity_type, entity_id
    from public.activities
    where status = 'open' and notified_at is null and due_at is not null and due_at <= ${nowIso}
      and (${agencyId}::uuid is null or agency_id = ${agencyId}::uuid)
      and (${notBefore}::timestamptz is null or due_at >= ${notBefore}::timestamptz)
    order by due_at
    limit ${limit}
  `) as DueTodo[];
}

/** Stamps notified_at so the cron fires once per due to-do. Re-asserts the row's own agency on write. */
export async function markTodoNotified(
  agencyId: string,
  id: string,
  notifiedAt: string,
): Promise<void> {
  await sql`
    update public.activities set notified_at = ${notifiedAt}
    where id = ${id} and agency_id = ${agencyId}
  `;
}

