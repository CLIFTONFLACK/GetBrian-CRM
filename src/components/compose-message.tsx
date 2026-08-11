"use client";

import * as React from "react";
import { useActionState } from "react";
import { PenSquare, Reply } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendMessage } from "@/lib/actions/messages";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";

/** The message a composer is replying to (threads via parent_id). */
export type ReplyTarget = {
  messageId: string;
  senderId: string;
  subject: string | null;
};

const reSubject = (subject: string | null) => {
  if (!subject) return "Re: your message";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
};

/**
 * "New message" — compose a standalone message to one or more teammates straight
 * from My Messages. Reuses the `sendMessage` action (no `link`, so the recipient's
 * notification points back at /messages).
 *
 * With `replyTo` set it becomes a "Reply" button: the original sender is
 * pre-selected, the subject is prefilled with "Re: …" and the send is threaded
 * under the original via a hidden parent_id.
 */
export function ComposeMessage({
  agents,
  meId,
  replyTo,
}: {
  agents: AgentOption[];
  meId?: string;
  replyTo?: ReplyTarget;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    sendMessage,
    {},
  );
  const recipients = agents.filter((a) => a.id !== meId);

  // Auto-close shortly after a successful send.
  React.useEffect(() => {
    if (!state.message) return;
    const t = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(t);
  }, [state.message]);

  return (
    <>
      {replyTo ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Reply />
          Reply
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <PenSquare />
          New message
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={replyTo ? "Reply" : "New message"}
      >
        {recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No teammates to message yet — add agents in Admin.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            {replyTo ? (
              <input type="hidden" name="parent_id" value={replyTo.messageId} />
            ) : null}

            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {recipients.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      name="recipients"
                      value={a.id}
                      defaultChecked={replyTo?.senderId === a.id}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="truncate">{a.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="compose-subject">Subject</Label>
              <Input
                id="compose-subject"
                name="subject"
                placeholder="Optional subject"
                defaultValue={replyTo ? reSubject(replyTo.subject) : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="compose-body">Message</Label>
              <Textarea
                id="compose-body"
                name="body"
                required
                placeholder={
                  replyTo ? "Write your reply…" : "Write a message to your team…"
                }
              />
            </div>

            {state.error ? <Alert tone="error">{state.error}</Alert> : null}
            {state.message ? <Alert tone="success">{state.message}</Alert> : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
