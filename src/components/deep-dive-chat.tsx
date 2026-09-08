"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { askDeepDive } from "@/lib/actions/deep-dive";
import type { FormState } from "@/lib/actions/types";

export type DeepDiveMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

/**
 * "Ask a question" about a company's Deep Dive report.
 *
 * The thread is stored against the company (db/migrations/0040), so it is a
 * record on the company profile rather than a scratchpad — it is rendered from
 * the server on every load, and this component only adds to it.
 *
 * There is no streaming anywhere in this app, so an answer arrives in one go,
 * the same way the report itself does.
 */
export function DeepDiveChat({
  companyId,
  messages,
  disabled,
}: {
  companyId: string;
  messages: DeepDiveMessage[];
  /** No report yet — there is nothing to ask about. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    askDeepDive,
    {},
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  // A successful answer is already persisted server-side; refresh so the thread
  // below re-renders from the database rather than being duplicated in state.
  const lastAnswer = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!state.message || state.message === lastAnswer.current) return;
    lastAnswer.current = state.message;
    formRef.current?.reset();
    router.refresh();
  }, [state.message, router]);

  return (
    <div className="space-y-4">
      {messages.length > 0 ? (
        <ol className="space-y-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={
                m.role === "user"
                  ? "rounded-md border bg-muted/40 p-3"
                  : "rounded-md border p-3"
              }
            >
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {m.role === "user" ? "Question" : "Answer"}
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {new Date(m.created_at).toLocaleString("en-GB")}
                </span>
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{m.content}</p>
            </li>
          ))}
        </ol>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <MessageCircleQuestion />
        Ask a question
      </Button>
      {disabled ? (
        <p className="text-xs text-muted-foreground">
          Run a Deep Dive first — there&rsquo;s no report to ask about yet.
        </p>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="Ask about this company">
        <form ref={formRef} action={formAction} className="space-y-4">
          <input type="hidden" name="company_id" value={companyId} />
          <div className="space-y-2">
            <Label htmlFor="dd-question">Question</Label>
            <Textarea
              id="dd-question"
              name="question"
              required
              rows={3}
              placeholder="e.g. Who signs off on new sites, and what's their expansion budget?"
            />
            <p className="text-xs text-muted-foreground">
              Answered from the report and the questions before it. Saved to this
              company&rsquo;s profile.
            </p>
          </div>

          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          {state.message ? (
            <div className="rounded-md border p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Answer
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {state.message}
              </p>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Asking…" : "Ask"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
