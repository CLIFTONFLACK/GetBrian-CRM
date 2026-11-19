import { Check } from "lucide-react";

import { EmptyNote, PanelSection } from "@/components/record-panel/fields";
import { EntityTaskForm } from "@/components/record-panel/tabs/entity-task-form";
import { toggleTaskStatus } from "@/lib/actions/tasks";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { listTasksForEntity, type Task } from "@/lib/db/queries/tasks";
import { formatLondonDateTime } from "@/lib/format-date";
import { isPast } from "@/lib/time";
import { cn } from "@/lib/utils";

import type { RecordTabProps } from "./placeholder";

/**
 * Tasks attached to this record: open first, then done. Each has a complete or
 * reopen control, and a compact form adds a new one. Uses the same actions and
 * fields as the /tasks page.
 */
export async function TodoTab({
  entityType,
  entityId,
  agencyId,
  userId,
}: RecordTabProps & { userId: string }) {
  const [tasks, members] = await Promise.all([
    listTasksForEntity(agencyId, entityType, entityId),
    getAgencyMembers(agencyId),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <>
      <PanelSection title={`Open${open.length ? ` (${open.length})` : ""}`}>
        {open.length === 0 ? (
          <EmptyNote>No open tasks for this record.</EmptyNote>
        ) : (
          <TaskItems tasks={open} nameOf={nameOf} meId={userId} />
        )}
      </PanelSection>
      <PanelSection title="Add task" className="border-t">
        <EntityTaskForm
          entityType={entityType}
          entityId={entityId}
          agents={members}
          meId={userId}
        />
      </PanelSection>
      {done.length > 0 ? (
        <PanelSection title={`Done (${done.length})`} className="border-t">
          <TaskItems tasks={done} nameOf={nameOf} meId={userId} />
        </PanelSection>
      ) : null}
    </>
  );
}

function TaskItems({
  tasks,
  nameOf,
  meId,
}: {
  tasks: Task[];
  nameOf: Map<string, string>;
  meId: string;
}) {
  return (
    <ul className="space-y-2">
      {tasks.map((t) => {
        const done = t.status === "done";
        const overdue = !done && t.due_at != null && isPast(t.due_at);
        return (
          <li key={t.id} className="flex items-start gap-2.5 rounded-md border p-2.5">
            <form action={toggleTaskStatus}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="intent" value={done ? "mark_open" : "mark_done"} />
              <button
                type="submit"
                aria-label={done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:bg-muted",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            </form>
            <div className="min-w-0 space-y-0.5">
              <p
                className={cn(
                  "text-sm",
                  done ? "text-muted-foreground line-through" : "font-medium text-foreground",
                )}
              >
                {t.title}
              </p>
              {t.details ? (
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{t.details}</p>
              ) : null}
              <p
                className={cn(
                  "text-[11px]",
                  overdue ? "font-medium text-destructive" : "text-muted-foreground",
                )}
              >
                {t.due_at ? `Due ${formatLondonDateTime(t.due_at)}` : "No due date"}
                {overdue ? " · overdue" : ""}
                {" · "}
                {t.assignee_id
                  ? t.assignee_id === meId
                    ? "Assigned to me"
                    : `Assigned to ${nameOf.get(t.assignee_id) ?? "a teammate"}`
                  : "Unassigned"}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
