"use client";

import * as React from "react";
import { useActionState } from "react";
import { Send } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendMessage } from "@/lib/actions/messages";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";

/**
 * "Send to team" — opens a modal to message one or more teammates about the
 * current record. The message links back here and pings each recipient's bell.
 * `link` must be an app-relative path into a known section — `sendMessage`
 * drops anything that fails its allowlist (see APP_LINK_RE in actions/messages).
 */
export function SendToTeam({
  link,
  subject,
  agents,
  meId,
  size = "sm",
}: {
  link: string;
  subject?: string;
  agents: AgentOption[];
  meId?: string;
  size?: "sm" | "default";
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
      <Button type="button" variant="secondary" size={size} onClick={() => setOpen(true)}>
        <Send />
        Send to team
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Send to team">
        {recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No teammates to send to yet — add agents in Admin.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="link" value={link} />
            {subject ? <input type="hidden" name="subject" value={subject} /> : null}

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
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="truncate">{a.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stt-body">Message</Label>
              <Textarea
                id="stt-body"
                name="body"
                required
                placeholder="Add a note…"
                defaultValue={subject ? `Take a look at ${subject}.` : ""}
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
