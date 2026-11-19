import { ActivityTimeline } from "@/components/activity-timeline";
import { EmptyNote, PanelSection } from "@/components/record-panel/fields";
import { LogActivityForm } from "@/components/log-activity-form";
import { listActivitiesForEntity } from "@/lib/db/queries/activities";
import { getAgencyMembers } from "@/lib/db/queries/agencies";

import type { RecordTabProps } from "./placeholder";

/**
 * Notes field, the log-activity form and the timeline. Shared by all three
 * record types: activities support company, contact and requirement.
 */
export async function NotesActivityTab({
  entityType,
  entityId,
  agencyId,
  notes,
}: RecordTabProps & { notes: string | null }) {
  const [activities, members] = await Promise.all([
    listActivitiesForEntity(agencyId, entityType, entityId, 20),
    getAgencyMembers(agencyId),
  ]);
  const actorNames = Object.fromEntries(members.map((m) => [m.id, m.name]));

  return (
    <>
      <PanelSection title="Notes">
        {notes ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">{notes}</p>
        ) : (
          <EmptyNote>No notes yet.</EmptyNote>
        )}
      </PanelSection>
      <PanelSection title="Activity" className="border-t">
        <LogActivityForm entityType={entityType} entityId={entityId} />
        <ActivityTimeline activities={activities} actorNames={actorNames} />
      </PanelSection>
    </>
  );
}
