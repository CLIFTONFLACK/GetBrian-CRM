import { sql } from "@/lib/db/client";
import type { Database } from "@/lib/database.types";

// DAO for public.activities — the polymorphic timeline (entity_type/entity_id)
// attached to companies, contacts, listings, requirements and deals. Every
// function takes the caller's agencyId as a mandatory first parameter and
// filters on it explicitly — see the same note in companies.ts.
//
// Only the deal detail page (this batch) reads through this DAO today —
// companies/contacts/disposals/requirements detail pages still read
// activities via the Supabase client (that project no longer exists, so those
// reads already return nothing; out of scope for this batch, see AGENTS.md).

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
};

/** The most recent activity rows logged against one record (company, deal, …). */
export async function listActivitiesForEntity(
  agencyId: string,
  entityType: EntityType,
  entityId: string,
  limit = 30,
): Promise<Activity[]> {
  return (await sql`
    select id, type, subject, body, entity_type, entity_id,
           occurred_at::text as occurred_at, created_by, created_at::text as created_at
    from public.activities
    where agency_id = ${agencyId} and entity_type = ${entityType} and entity_id = ${entityId}
    order by occurred_at desc
    limit ${limit}
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
};

/** Logs one timeline entry. `occurredAt: null` takes the column default (insert time). */
export async function createActivity(
  agencyId: string,
  createdBy: string,
  input: ActivityWriteInput,
): Promise<{ id: string }> {
  const rows = input.occurredAt
    ? await sql`
        insert into public.activities (
          agency_id, created_by, type, subject, body, entity_type, entity_id, occurred_at
        ) values (
          ${agencyId}, ${createdBy}, ${input.type}, ${input.subject}, ${input.body},
          ${input.entityType}, ${input.entityId}, ${input.occurredAt}
        )
        returning id
      `
    : await sql`
        insert into public.activities (
          agency_id, created_by, type, subject, body, entity_type, entity_id
        ) values (
          ${agencyId}, ${createdBy}, ${input.type}, ${input.subject}, ${input.body},
          ${input.entityType}, ${input.entityId}
        )
        returning id
      `;
  return rows[0] as { id: string };
}
