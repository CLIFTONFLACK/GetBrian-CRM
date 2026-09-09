"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { quickCreateRequirement } from "@/lib/actions/requirements";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUSES: [string, string][] = [
  ["active", "Active"],
  ["on_hold", "On hold"],
  ["satisfied", "Satisfied"],
  ["withdrawn", "Withdrawn"],
];

/**
 * "+ New requirement" for the company and contact pages (#c2/#ct2).
 *
 * Opens a short quick-create in the shared Modal — title, status, notes — with
 * the company/contact link inherited from the page, so a brief can be logged
 * mid-call without leaving the record. The full form stays one click away for
 * anything more detailed. On success the modal closes and the page refreshes
 * so the new brief appears in the card.
 */
export function QuickRequirementModal({
  companyId,
  contactId,
  fullFormHref,
}: {
  companyId?: string | null;
  contactId?: string | null;
  /** The pre-filled /requirements/new link, for briefs that need every field. */
  fullFormHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState(quickCreateRequirement, {});
  const lastCreated = React.useRef<string | null>(null);

  React.useEffect(() => {
    const c = state.created;
    if (c && c.id !== lastCreated.current) {
      lastCreated.current = c.id;
      setOpen(false);
      router.refresh();
    }
  }, [state.created, router]);

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus />
        Add requirement
      </Button>
      <Modal open={open} onClose={close} title="New requirement">
        <form action={formAction} className="space-y-4">
          {companyId ? <input type="hidden" name="company_id" value={companyId} /> : null}
          {contactId ? <input type="hidden" name="contact_id" value={contactId} /> : null}

          <div className="space-y-2">
            <Label htmlFor="qr-title">
              Title<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="qr-title"
              name="title"
              required
              autoFocus
              placeholder="e.g. Central London bar, 2,000–3,500 sq ft"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qr-status">Status</Label>
            <Select id="qr-status" name="status" defaultValue="active">
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qr-notes">Notes</Label>
            <Textarea
              id="qr-notes"
              name="notes"
              rows={3}
              placeholder="Anything worth capturing now. Locations, size and budget can be added on the brief."
            />
          </div>

          {state.error ? <Alert tone="error">{state.error}</Alert> : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Link
              href={fullFormHref}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open the full form instead
            </Link>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Create requirement"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
