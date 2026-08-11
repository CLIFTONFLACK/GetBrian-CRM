"use client";

import { useActionState } from "react";

import { AgentFields } from "@/components/agent-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateDeal } from "@/lib/actions/deals";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";

const STAGES: { value: string; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "viewing", label: "Viewing" },
  { value: "offer", label: "Offer" },
  { value: "heads_of_terms", label: "Heads of Terms" },
  { value: "legal", label: "Legal" },
  { value: "completed", label: "Completed" },
  { value: "fell_through", label: "Fell through" },
];

type Deal = {
  id: string;
  title: string;
  stage: string;
  value: number | null;
  hot_terms: string | null;
  notes: string | null;
  lead_agent_id: string | null;
  expected_close: string | null;
};

export function DealForm({
  deal,
  agents = [],
  additionalAgentIds,
}: {
  deal: Deal;
  agents?: AgentOption[];
  additionalAgentIds?: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateDeal,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={deal.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={deal.title} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="stage">Stage</Label>
          <Select id="stage" name="stage" defaultValue={deal.stage}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="value">Value (£)</Label>
          <Input
            id="value"
            name="value"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={deal.value ?? ""}
            className="font-mono tabular-nums"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expected_close">Expected close</Label>
          <Input
            id="expected_close"
            name="expected_close"
            type="date"
            defaultValue={deal.expected_close ?? ""}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="hot_terms">Heads of Terms</Label>
          <Textarea
            id="hot_terms"
            name="hot_terms"
            defaultValue={deal.hot_terms ?? ""}
            placeholder="Rent, term, rent-free, break, repairing obligations, conditions…"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" defaultValue={deal.notes ?? ""} />
        </div>
      </div>

      <div className="border-t pt-4">
        <AgentFields
          agents={agents}
          leadAgentId={deal.lead_agent_id}
          additionalAgentIds={additionalAgentIds}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {state.error ? (
          <p className="text-xs text-destructive">{state.error}</p>
        ) : null}
        {state.message ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
