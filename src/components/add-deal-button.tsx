"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { addDealToListing, getDealAgentRoster } from "@/lib/actions/deals";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";

export type DealRequirementOption = {
  id: string;
  title: string;
  /** Match score for this listing, 0 to 100. */
  score: number;
  /** A deal for this listing and requirement already exists. */
  hasDeal: boolean;
};

/** Placeholder in `openHref` that is replaced by the new deal id. */
export const DEAL_ID_TOKEN = "__DEAL_ID__";

/**
 * "Add deal" on a listing. The deal needs a requirement, so the popup asks for
 * one (best match first), a name and a lead agent. After saving, the panel
 * opens the new deal instead of leaving the page.
 */
export function AddDealButton({
  listingId,
  requirements,
  openHref,
}: {
  listingId: string;
  requirements: DealRequirementOption[];
  /** The panel link for a deal, with DEAL_ID_TOKEN where the id goes. */
  openHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(addDealToListing, {});
  const [roster, setRoster] = React.useState<AgentOption[] | null>(null);
  const [lead, setLead] = React.useState("");
  // Controlled, because React 19 clears uncontrolled fields after an action, even on an error.
  const [requirementId, setRequirementId] = React.useState("");
  const [title, setTitle] = React.useState("");

  React.useEffect(() => {
    if (!open || roster !== null) return;
    let cancelled = false;
    (async () => {
      const { agents, meId } = await getDealAgentRoster();
      if (cancelled) return;
      setRoster(agents);
      setLead((prev) => prev || meId || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, roster]);

  // Open the new deal in the panel once it is saved.
  React.useEffect(() => {
    const id = state.created?.id;
    if (!id) return;
    router.replace(openHref.replace(DEAL_ID_TOKEN, encodeURIComponent(id)), { scroll: false });
  }, [state.created?.id, openHref, router]);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus />
        Add deal
      </Button>

      <Modal open={open && !state.created} onClose={() => setOpen(false)} title="Add a deal">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="listing_id" value={listingId} />
          <div className="space-y-1.5">
            <Label htmlFor="add-deal-requirement">Requirement</Label>
            <Select id="add-deal-requirement" name="requirement_id"
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              required
            >
              <option value="" disabled>
                {requirements.length === 0 ? "No active requirements" : "Pick a requirement…"}
              </option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id} disabled={r.hasDeal}>
                  {r.title}
                  {r.hasDeal ? " (deal exists)" : r.score > 0 ? ` (${r.score}% match)` : ""}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Best matches are first. A deal links one listing to one requirement.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-deal-title">Deal name</Label>
            <Input
              id="add-deal-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave blank to name it automatically" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-deal-lead">Lead agent</Label>
            <Select id="add-deal-lead" name="lead_agent_id" value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">— Unassigned —</option>
              {(roster ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || requirements.length === 0}>
              {pending ? "Adding…" : "Add deal"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
