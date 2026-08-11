"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTask } from "@/lib/actions/tasks";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";

/** Inline "Add a task" form — title, details, due date and an assignee picker. */
export function NewTaskForm({
  agents,
  meId,
}: {
  agents: AgentOption[];
  meId?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createTask,
    {},
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state.message) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="task-title">Title *</Label>
        <Input
          id="task-title"
          name="title"
          required
          placeholder="e.g. Chase heads of terms"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-details">Details</Label>
        <Textarea
          id="task-details"
          name="details"
          placeholder="Optional context for the task…"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="task-due">Due</Label>
          <Input id="task-due" name="due_at" type="datetime-local" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-assignee">Assignee</Label>
          <Select id="task-assignee" name="assignee_id" defaultValue={meId ?? ""}>
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
        <Button type="submit" disabled={pending}>
          <Plus />
          {pending ? "Adding…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
