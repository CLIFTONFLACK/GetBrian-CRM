"use client";

import * as React from "react";
import { useActionState } from "react";
import { Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createTask } from "@/lib/actions/tasks";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";
import { withIsoDueAt } from "@/lib/local-datetime";

/**
 * Compact "Add task" form for the To-do tab. Posts the same createTask action
 * as the /tasks page, plus the record the panel is open on. The action checks
 * that record again on the server. The panel stays open: the action
 * revalidates the list pages and the tab's server list re-renders.
 */
export function EntityTaskForm({
  entityType,
  entityId,
  agents,
  meId,
}: {
  entityType: string;
  entityId: string;
  agents: AgentOption[];
  meId: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createTask, {});
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state.message) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={(fd) => formAction(withIsoDueAt(fd))}
      className="space-y-3 rounded-md border bg-muted/30 p-3"
    >
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <div className="space-y-1">
        <Label htmlFor="panel-task-title" className="text-xs text-muted-foreground">
          Task
        </Label>
        <Input
          id="panel-task-title"
          name="title"
          required
          placeholder="e.g. Chase heads of terms"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="panel-task-due" className="text-xs text-muted-foreground">
            Due
          </Label>
          <Input id="panel-task-due" name="due_at" type="datetime-local" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="panel-task-assignee" className="text-xs text-muted-foreground">
            Assignee
          </Label>
          <Select id="panel-task-assignee" name="assignee_id" defaultValue={meId}>
            <option value="">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === meId ? " (me)" : ""}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          <Plus />
          {pending ? "Adding…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
