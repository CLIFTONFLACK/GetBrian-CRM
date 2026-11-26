import { ActivityTimeline } from "@/components/activity-timeline";
import { EmptyNote, PanelSection } from "@/components/record-panel/fields";
import { EditableField } from "@/components/record-panel/inline-edit";
import { LogActivityForm } from "@/components/log-activity-form";
import type { FormState } from "@/lib/actions/types";
import { listActivitiesForEntity } from "@/lib/db/queries/activities";
import { getAgencyMembers } from "@/lib/db/queries/agencies";

import type { RecordTabProps } from "./placeholder";

/**
 * Summary note, the log-activity form and the timeline. Shared by the company,
 * contact and requirement panels. Pass `summaryEdit` to make the summary note
 * editable in place; without it the note is read-only.
 */
export async function NotesActivityTab({
  entityType,
  entityId,
  agencyId,
  notes,
  summaryEdit,
}: RecordTabProps & {
  notes: string | null;
  summaryEdit?: { action: (prev: FormState, fd: FormData) => Promise<FormState> };
}) {
  const [activities, members] = await Promise.all([
    listActivitiesForEntity(agencyId, entityType, entityId, 20),
    getAgencyMembers(agencyId),
  ]);
  const actorNames = Object.fromEntries(members.map((m) => [m.id, m.name]));

  return (
    <>
      <PanelSection title="Summary note">
        {summaryEdit ? (
          <EditableField
            action={summaryEdit.action}
            recordId={entityId}
            field="notes"
            label="Summary note"
            kind="textarea"
            value={notes ?? ""}
            display={
              notes ? undefined : (
                <span className="text-muted-foreground">No summary note yet. Use the pencil to add one.</span>
              )
            }
          />
        ) : notes ? (
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
