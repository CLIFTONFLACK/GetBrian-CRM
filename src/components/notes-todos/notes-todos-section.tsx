import { NotesTodosPanel } from "@/components/notes-todos/notes-todos-panel";
import type { Database } from "@/lib/database.types";
import { listActivitiesForEntity } from "@/lib/db/queries/activities";
import { getAgencyMembers, getMemberRole } from "@/lib/db/queries/agencies";

type EntityType = Database["public"]["Enums"]["entity_type"];

/**
 * The notes and to-dos of one record, loaded on the server. Used by the record
 * panels and by the full deal, company and contact pages.
 */
export async function NotesTodosSection({
  entityType,
  entityId,
  agencyId,
  userId,
  idPrefix,
}: {
  entityType: EntityType;
  entityId: string;
  agencyId: string;
  userId: string;
  /** Keeps field ids unique when a page shows two lists. */
  idPrefix?: string;
}) {
  const [entries, members, role] = await Promise.all([
    listActivitiesForEntity(agencyId, entityType, entityId, 100),
    getAgencyMembers(agencyId),
    getMemberRole(agencyId, userId),
  ]);
  return (
    <NotesTodosPanel
      entityType={entityType}
      entityId={entityId}
      idPrefix={idPrefix}
      meId={userId}
      isAdmin={role === "admin" || role === "manager"}
      agents={members.map((m) => ({ id: m.id, name: m.name }))}
      entries={entries.map((a) => ({
        id: a.id,
        type: a.type,
        subject: a.subject,
        body: a.body,
        occurred_at: a.occurred_at,
        created_by: a.created_by,
        assignee_id: a.assignee_id,
        due_at: a.due_at,
        status: a.status,
      }))}
    />
  );
}
