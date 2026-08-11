"use client";

import * as React from "react";
import { useActionState } from "react";
import { Handshake } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { createDealFromMatch, getDealAgentRoster } from "@/lib/actions/deals";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";

/**
 * "Create a deal" from a requirement ↔ listing match. Opens a popup to name the
 * deal and pick its lead agent (defaults to you); the form posts to the server
 * action, which de-dupes on the pair and redirects to the deal. Insert failures
 * come back as a FormState error rendered in the modal instead of a silent
 * redirect.
 */
export function CreateDealButton({
  requirementId,
  listingId,
  label = "Create deal",
  defaultTitle = "",
  agents,
  meId,
}: {
  requirementId: string;
  listingId: string;
  label?: string;
  defaultTitle?: string;
  /** Agency roster for the lead-agent picker; fetched on open when omitted. */
  agents?: AgentOption[];
  meId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createDealFromMatch,
    {},
  );

  // Roster + current user for the lead-agent select. The pages that render this
  // button don't all pass the roster down, so fetch it on open via a server
  // action — Neon has no client-safe browser SDK the way Supabase's anon-key
  // client was, so this replaces the previous direct client-side query.
  const [roster, setRoster] = React.useState<AgentOption[] | null>(agents ?? null);
  const [lead, setLead] = React.useState<string>(meId ?? "");

  React.useEffect(() => {
    if (!open || roster !== null) return;
    let cancelled = false;
    (async () => {
      const { agents: fetched, meId: fetchedMeId } = await getDealAgentRoster();
      if (cancelled) return;
      setRoster(fetched);
      setLead((prev) => prev || fetchedMeId || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, roster]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Handshake />
        {label}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Name the deal">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="requirement_id" value={requirementId} />
          <input type="hidden" name="listing_id" value={listingId} />
          <div className="space-y-1.5">
            <Label htmlFor="deal-title">Deal name</Label>
            <Input
              id="deal-title"
              name="title"
              defaultValue={defaultTitle}
              placeholder="e.g. Corner bar, Soho ↔ West End operator"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to auto-name it from the listing and requirement.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deal-lead-agent">Lead agent</Label>
            <Select
              id="deal-lead-agent"
              name="lead_agent_id"
              value={lead}
              onChange={(e) => setLead(e.target.value)}
            >
              <option value="">— Unassigned —</option>
              {(roster ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Defaults to you — they&apos;ll be notified if it&apos;s someone else.
            </p>
          </div>
          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create deal"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
