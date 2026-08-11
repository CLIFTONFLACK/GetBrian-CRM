import type { Metadata } from "next";
import Link from "next/link";
import { Check, ListTodo, Trash2 } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { NewTaskForm } from "./new-task-form";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { deleteTask, toggleTaskStatus } from "@/lib/actions/tasks";
import { auth } from "@/lib/auth";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listMyTasks } from "@/lib/db/queries/tasks";
import { isPast } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tasks" };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Where a task's optional entity link points, per entity_type. */
const ENTITY_PATHS: Record<string, string> = {
  deal: "/deals",
  listing: "/listings",
  requirement: "/requirements",
  company: "/companies",
  contact: "/contacts",
};

type TaskRow = {
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

function TaskList({
  tasks,
  nameOf,
  meId,
}: {
  tasks: TaskRow[];
  nameOf: Map<string, string>;
  meId: string;
}) {
  return (
    <ul className="space-y-2">
      {tasks.map((t) => {
        const done = t.status === "done";
        const overdue = !done && t.due_at != null && isPast(t.due_at);
        const entityPath =
          t.entity_type && t.entity_id && ENTITY_PATHS[t.entity_type]
            ? `${ENTITY_PATHS[t.entity_type]}/${t.entity_id}`
            : null;
        return (
          <li
            key={t.id}
            className="flex items-start justify-between gap-3 rounded-md border p-2.5"
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <form action={toggleTaskStatus}>
                <input type="hidden" name="id" value={t.id} />
                <input
                  type="hidden"
                  name="intent"
                  value={done ? "mark_open" : "mark_done"}
                />
                <button
                  type="submit"
                  aria-label={done ? "Mark not done" : "Mark done"}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
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
                    done
                      ? "text-muted-foreground line-through"
                      : "font-medium text-foreground",
                  )}
                >
                  {t.title}
                </p>
                {t.details ? (
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {t.details}
                  </p>
                ) : null}
                <p
                  className={cn(
                    "text-[11px]",
                    overdue ? "font-medium text-destructive" : "text-muted-foreground",
                  )}
                >
                  {t.due_at ? `Due ${fmt(t.due_at)}` : "No due date"}
                  {overdue ? " · overdue" : ""}
                  {" · "}
                  {t.assignee_id
                    ? t.assignee_id === meId
                      ? "Assigned to me"
                      : `Assigned to ${nameOf.get(t.assignee_id) ?? "a teammate"}`
                    : "Unassigned"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {entityPath ? (
                <Link
                  href={entityPath}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                >
                  Open
                </Link>
              ) : null}
              <form action={deleteTask}>
                <input type="hidden" name="id" value={t.id} />
                <ConfirmSubmitButton
                  confirmMessage={`Delete the task "${t.title}"?`}
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${t.title}`}
                  className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </ConfirmSubmitButton>
              </form>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function TasksPage() {
  const session = await auth();
  const me = session?.user?.id ?? "";

  const agencyId = me ? await currentAgencyId(me) : null;
  const teammates = agencyId ? await getAgencyMembers(agencyId) : [];
  const nameOf = new Map(teammates.map((a) => [a.id, a.name]));

  // "My tasks" — assigned to me, or created by me and not yet assigned
  // (filtered server-side in listMyTasks).
  const tasks: TaskRow[] = agencyId ? await listMyTasks(agencyId, me) : [];
  const openTasks = tasks.filter((t) => t.status === "open");
  const doneTasks = tasks.filter((t) => t.status === "done");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Tasks"
        description="Your to-dos — assigned to you, or created by you and unassigned."
      />

      <div className="space-y-4">
        {/* ── Open ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-muted-foreground" />
              Open
            </CardTitle>
            {openTasks.length > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {openTasks.length}
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            {openTasks.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                title="No open tasks"
                description="Add a task below — assign it to yourself or a teammate."
              />
            ) : (
              <TaskList tasks={openTasks} nameOf={nameOf} meId={me} />
            )}
          </CardContent>
        </Card>

        {/* ── Done ──────────────────────────────────────────────── */}
        {doneTasks.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Check className="h-4 w-4 text-muted-foreground" />
                Done
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TaskList tasks={doneTasks} nameOf={nameOf} meId={me} />
            </CardContent>
          </Card>
        ) : null}

        {/* ── Add a task (headerless form card) ─────────────────── */}
        <Card>
          <CardContent className="pt-4 sm:pt-6">
            <NewTaskForm agents={teammates} meId={me || undefined} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
