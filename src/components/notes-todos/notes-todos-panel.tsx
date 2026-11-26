"use client";

// One list of notes and to-dos for a record (db/migrations/0049). A note is an
// entry with no status. Give it an assignee or a due date and it is a to-do,
// with a tick box. The same panel serves the record panels, the full deal,
// company and contact pages, and the My to-dos page.

import * as React from "react";
import { useActionState, useTransition } from "react";
import {
  CalendarClock,
  Check,
  CheckSquare,
  Eye,
  FileText,
  Mail,
  Pencil,
  Phone,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LocalDateTime } from "@/components/local-date-time";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteActivity, editActivity, logActivity, toggleTodo } from "@/lib/actions/activities";
import type { FormState } from "@/lib/actions/types";
import { pgTimestampToIso } from "@/lib/format-date";
import { withIsoDueAt } from "@/lib/local-datetime";
import {
  filterEntries,
  isOverdueNow,
  isTodo,
  sortEntries,
  type EntryFilter,
} from "@/lib/todo";
import { cn } from "@/lib/utils";

export type EntryView = {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  occurred_at: string;
  created_by: string | null;
  assignee_id: string | null;
  due_at: string | null;
  status: string | null;
};

export type AgentView = { id: string; name: string };

const ICONS: Record<string, LucideIcon> = {
  call: Phone,
  email: Mail,
  viewing: Eye,
  note: FileText,
  meeting: CalendarClock,
  task: CheckSquare,
};

const TYPES = [
  ["note", "Note"],
  ["call", "Call"],
  ["email", "Email"],
  ["viewing", "Viewing"],
  ["meeting", "Meeting"],
] as const;

const FILTERS: { value: EntryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "notes", label: "Notes" },
  { value: "open", label: "Open to-dos" },
  { value: "done", label: "Done" },
];

/** A datetime-local value ("2026-11-27T14:30") in the viewer's own zone, from a stored instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(pgTimestampToIso(iso));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Calls the action from script, so React does not reset the form after a failed save. */
function useScriptSubmit(formAction: (fd: FormData) => void) {
  const [, startTransition] = useTransition();
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = withIsoDueAt(new FormData(e.currentTarget));
    startTransition(() => formAction(fd));
  };
}

export function NotesTodosPanel({
  entityType,
  entityId,
  entries,
  agents,
  meId,
  isAdmin,
  idPrefix = "nt",
}: {
  /** Omit both to add a to-do that belongs to no record (the My to-dos page). */
  entityType?: string;
  entityId?: string;
  entries: EntryView[];
  agents: AgentView[];
  meId: string;
  /** Admins and managers may change anyone's entry. */
  isAdmin: boolean;
  idPrefix?: string;
}) {
  const [filter, setFilter] = React.useState<EntryFilter>("all");
  const nameOf = React.useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
  const visible = React.useMemo(() => sortEntries(filterEntries(entries, filter)), [entries, filter]);
  const counts = React.useMemo(
    () => ({
      all: entries.length,
      notes: filterEntries(entries, "notes").length,
      open: filterEntries(entries, "open").length,
      done: filterEntries(entries, "done").length,
    }),
    [entries],
  );

  return (
    <div className="space-y-4">
      <Composer
        entityType={entityType}
        entityId={entityId}
        agents={agents}
        meId={meId}
        idPrefix={idPrefix}
      />

      <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {entries.length === 0
            ? "Nothing here yet. Add a note above. Give it an assignee or a due date to make it a to-do."
            : "Nothing matches this filter."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((e) => (
            <Entry
              key={e.id}
              entry={e}
              nameOf={nameOf}
              agents={agents}
              meId={meId}
              canChange={isAdmin || e.created_by === meId || e.assignee_id === meId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Composer({
  entityType,
  entityId,
  agents,
  meId,
  idPrefix,
}: {
  entityType?: string;
  entityId?: string;
  agents: AgentView[];
  meId: string;
  idPrefix: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(logActivity, {});
  const onSubmit = useScriptSubmit(formAction);
  const formRef = React.useRef<HTMLFormElement>(null);

  // Clear the form after a save, not after a failed save.
  React.useEffect(() => {
    if (state.message && !state.error) formRef.current?.reset();
  }, [state]);

  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3 rounded-md border bg-muted/30 p-3">
      {entityType && entityId ? (
        <>
          <input type="hidden" name="entity_type" value={entityType} />
          <input type="hidden" name="entity_id" value={entityId} />
        </>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1">
          <Label htmlFor={id("type")} className="text-xs text-muted-foreground">
            Type
          </Label>
          <Select id={id("type")} name="type" defaultValue="note">
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("subject")} className="text-xs text-muted-foreground">
            Subject
          </Label>
          <Input id={id("subject")} name="subject" placeholder="e.g. Chase heads of terms" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id("body")} className="text-xs text-muted-foreground">
          Note
        </Label>
        <Textarea id={id("body")} name="body" rows={2} placeholder="Add a note…" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id("assignee")} className="text-xs text-muted-foreground">
            Assign to
          </Label>
          <Select id={id("assignee")} name="assignee_id" defaultValue="">
            <option value="">Nobody (a note)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === meId ? " (me)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("due")} className="text-xs text-muted-foreground">
            Due
          </Label>
          <Input id={id("due")} name="due_at" type="datetime-local" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Pick an assignee or a due date and this becomes a to-do with a tick box. The assignee is told.
      </p>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message && !state.error ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          <Plus />
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}

function Entry({
  entry,
  nameOf,
  agents,
  meId,
  canChange,
}: {
  entry: EntryView;
  nameOf: Map<string, string>;
  agents: AgentView[];
  meId: string;
  canChange: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const todo = isTodo(entry);
  const done = entry.status === "done";
  const overdue = isOverdueNow(entry);
  const Icon = ICONS[entry.type] ?? FileText;
  const title = entry.subject ?? (entry.body ? entry.body.slice(0, 60) : entry.type);

  if (editing) {
    return (
      <li className="rounded-md border p-3">
        <EditForm entry={entry} agents={agents} meId={meId} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className={cn("flex items-start gap-2.5 rounded-md border p-2.5", done && "bg-muted/30")}>
      {todo ? (
        <form action={toggleTodo}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="intent" value={done ? "mark_open" : "mark_done"} />
          <button
            type="submit"
            aria-label={done ? `Reopen ${title}` : `Mark ${title} done`}
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              done ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted",
            )}
          >
            {done ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        </form>
      ) : (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      )}

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p
            className={cn(
              "text-sm",
              done ? "text-muted-foreground line-through" : "font-medium text-foreground",
            )}
          >
            {title}
          </p>
          {todo ? (
            <Badge suppressHydrationWarning tone={done ? "slate" : overdue ? "red" : "amber"}>
              {done ? "Done" : overdue ? "Overdue" : "To-do"}
            </Badge>
          ) : null}
        </div>
        {entry.body ? (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{entry.body}</p>
        ) : null}
        <p
          suppressHydrationWarning
          className={cn("text-[11px]", overdue ? "font-medium text-destructive" : "text-muted-foreground")}
        >
          {todo ? (
            <>
              {entry.due_at ? (
                <>
                  Due <LocalDateTime iso={entry.due_at} />
                </>
              ) : (
                "No due date"
              )}
              {" · "}
              {entry.assignee_id
                ? entry.assignee_id === meId
                  ? "Assigned to me"
                  : `Assigned to ${nameOf.get(entry.assignee_id) ?? "a teammate"}`
                : "Unassigned"}
              {" · "}
            </>
          ) : null}
          {entry.created_by ? `${nameOf.get(entry.created_by) ?? "A teammate"} · ` : ""}
          <LocalDateTime iso={entry.occurred_at} />
        </p>
      </div>

      {canChange ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`Edit ${title}`}
            onClick={() => setEditing(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <form action={deleteActivity}>
            <input type="hidden" name="id" value={entry.id} />
            <ConfirmSubmitButton
              variant="ghost"
              size="sm"
              aria-label={`Delete ${title}`}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              confirmMessage={todo ? "Delete this to-do? This cannot be undone." : "Delete this note? This cannot be undone."}
            >
              <X className="h-3.5 w-3.5" />
            </ConfirmSubmitButton>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function EditForm({
  entry,
  agents,
  meId,
  onDone,
}: {
  entry: EntryView;
  agents: AgentView[];
  meId: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(editActivity, {});
  const onSubmit = useScriptSubmit(formAction);

  // Close after a save, not after a failed save. In an effect: closing calls the
  // parent's setter, which must not happen while this component renders.
  React.useEffect(() => {
    if (state.message && !state.error) onDone();
  }, [state, onDone]);

  const id = (n: string) => `nt-edit-${entry.id}-${n}`;
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="id" value={entry.id} />
      <div className="space-y-1">
        <Label htmlFor={id("subject")} className="text-xs text-muted-foreground">
          Subject
        </Label>
        <Input id={id("subject")} name="subject" defaultValue={entry.subject ?? ""} className="h-8" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id("body")} className="text-xs text-muted-foreground">
          Note
        </Label>
        <Textarea id={id("body")} name="body" rows={2} defaultValue={entry.body ?? ""} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id("assignee")} className="text-xs text-muted-foreground">
            Assign to
          </Label>
          <Select id={id("assignee")} name="assignee_id" defaultValue={entry.assignee_id ?? ""} className="h-8">
            <option value="">Nobody</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === meId ? " (me)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("due")} className="text-xs text-muted-foreground">
            Due
          </Label>
          <Input id={id("due")} name="due_at" type="datetime-local" defaultValue={toLocalInput(entry.due_at)} className="h-8" />
        </div>
      </div>
      {isTodo(entry) ? (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            name="plain_note"
            className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
          />
          Make this a plain note again (removes the assignee, the due date and the tick box)
        </label>
      ) : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
