"use client";

import { useActionState } from "react";

import { AgentFields } from "@/components/agent-fields";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { updateDisposalAssignment } from "@/lib/actions/disposals";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";

export function DisposalAssignmentForm({
  disposalId,
  agents,
  leadAgentId,
  additionalAgentIds,
}: {
  disposalId: string;
  agents: AgentOption[];
  leadAgentId: string | null;
  additionalAgentIds: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateDisposalAssignment,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={disposalId} />
      <AgentFields
        agents={agents}
        leadAgentId={leadAgentId}
        additionalAgentIds={additionalAgentIds}
      />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save assignment"}
      </Button>
    </form>
  );
}
