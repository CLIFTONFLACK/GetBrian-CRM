import { sql } from "@/lib/db/client";
import type { Database } from "@/lib/database.types";

// Aggregate reads specific to /dashboard that don't cleanly belong to any
// single per-entity DAO file (see AGENTS.md) — everything else the
// dashboard needs (company/requirement counts, deal rows, task/message
// counts, map layers) already lives in companies.ts/requirements.ts/
// deals.ts/tasks.ts/messages.ts/map-points.ts and is reused directly.

type ActivityType = Database["public"]["Enums"]["activity_type"];
type EntityType = Database["public"]["Enums"]["entity_type"];

export type RecentActivity = {
  id: string;
  type: ActivityType;
  subject: string | null;
  entity_type: EntityType | null;
  entity_id: string | null;
  created_by: string | null;
  occurred_at: string;
};

/** The agency's N most recent activity-timeline rows, across every entity —
 *  feeds the dashboard's "Recent activity" feed. Unlike
 *  activities.ts's listActivitiesForEntity (one record's history), this is
 *  agency-wide, which is why it lives here rather than there. */
export async function listRecentActivitiesForAgency(
  agencyId: string,
  limit = 10,
): Promise<RecentActivity[]> {
  return (await sql`
    select id, type, subject, entity_type, entity_id, created_by, occurred_at::text as occurred_at
    from public.activities
    where agency_id = ${agencyId}
    order by occurred_at desc
    limit ${limit}
  `) as RecentActivity[];
}
