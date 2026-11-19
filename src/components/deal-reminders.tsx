"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2 } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addDealReminder,
  deleteDealReminder,
  toggleDealReminder,
} from "@/lib/actions/deal-reminders";
import { LocalDateTime } from "@/components/local-date-time";
import { withIsoDueAt } from "@/lib/local-datetime";
import type { FormState } from "@/lib/actions/types";
import { cn } from "@/lib/utils";

export type Reminder = {
  id: string;
  title: string;
  due_at: string;
  done: boolean;
  overdue: boolean;
};

export function DealReminders({
  dealId,
  reminders,
}: {
  dealId: string;
  reminders: Reminder[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(
    addDealReminder,
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
    <div className="space-y-4">
      {reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reminders or deadlines yet.</p>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => {
            const overdue = r.overdue && !r.done;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-md border p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <form action={toggleDealReminder}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="deal_id" value={dealId} />
                    <input
                      type="hidden"
                      name="intent"
                      value={r.done ? "mark_open" : "mark_done"}
                    />
                    <button
                      type="submit"
                      aria-label={r.done ? "Mark not done" : "Mark done"}
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        r.done
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input hover:bg-muted",
                      )}
                    >
                      {r.done ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>
                  </form>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-sm",
                        r.done ? "text-muted-foreground line-through" : "font-medium text-foreground",
                      )}
                    >
                      {r.title}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        overdue ? "font-medium text-destructive" : "text-muted-foreground",
                      )}
                    >
                      <LocalDateTime iso={r.due_at} />
                      {overdue ? " · overdue" : ""}
                    </p>
                  </div>
                </div>
                <form action={deleteDealReminder}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="deal_id" value={dealId} />
                  <ConfirmSubmitButton
                    confirmMessage={`Delete the reminder "${r.title}"?`}
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${r.title}`}
                    className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </ConfirmSubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <form
        ref={formRef}
        action={(fd) => action(withIsoDueAt(fd))}
        className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="deal_id" value={dealId} />
        <Input
          name="title"
          placeholder="Reminder / deadline *"
          aria-label="Reminder title"
          className="min-w-[12rem] flex-1"
          required
        />
        <Input name="due_at" type="datetime-local" aria-label="Due date" required />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          <Plus />
          {pending ? "Adding…" : "Add"}
        </Button>
        {state.error ? (
          <p className="w-full text-xs text-destructive">{state.error}</p>
        ) : null}
      </form>
    </div>
  );
}
