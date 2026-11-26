import { EmptyNote, PanelSection } from "@/components/record-panel/fields";
import { EditableField } from "@/components/record-panel/inline-edit";
import { NotesTodosSection } from "@/components/notes-todos/notes-todos-section";
import type { FormState } from "@/lib/actions/types";

import type { RecordTabProps } from "./placeholder";

/**
 * The "Notes & to-dos" tab, shared by every record panel. A note belongs to the
 * record. Give it an assignee or a due date and it is a to-do. The summary note
 * (the old free-text notes column) sits above the list. Pass `summaryEdit` to
 * make it editable in place, or leave `notes` out of the props to hide it (a
 * listing or a deal has no such column).
 */
export async function NotesActivityTab({
  entityType,
  entityId,
  agencyId,
  userId,
  notes,
  summaryEdit,
}: RecordTabProps & {
  userId: string;
  notes?: string | null;
  summaryEdit?: { action: (prev: FormState, fd: FormData) => Promise<FormState> };
}) {
  const showSummary = notes !== undefined;
  return (
    <>
      {showSummary ? (
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
      ) : null}
      <PanelSection title="Notes & to-dos" className={showSummary ? "border-t" : undefined}>
        <NotesTodosSection
          entityType={entityType}
          entityId={entityId}
          agencyId={agencyId}
          userId={userId}
        />
      </PanelSection>
    </>
  );
}
