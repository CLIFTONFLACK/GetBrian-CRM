import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { AgentOption } from "@/lib/db/queries/agencies";

/**
 * Lead agent (single owner) + additional agents (collaborators) inputs, shared
 * by the company and contact forms. The lead is submitted as `lead_agent_id`;
 * additional agents as repeated `additional_agents` checkbox values. The action
 * drops the lead from the additional set, so ticking the lead here is harmless.
 */
export function AgentFields({
  agents,
  leadAgentId,
  additionalAgentIds,
  idPrefix = "",
}: {
  agents: AgentOption[];
  leadAgentId?: string | null;
  additionalAgentIds?: string[];
  /** Keeps ids unique when these fields render in a modal over another form. */
  idPrefix?: string;
}) {
  const selected = new Set(additionalAgentIds ?? []);
  const leadId = `${idPrefix}lead_agent_id`;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={leadId}>Lead agent</Label>
        <Select id={leadId} name="lead_agent_id" defaultValue={leadAgentId ?? ""}>
          <option value="">— Unassigned —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Additional agents</legend>
        {agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No team members yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {agents.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="additional_agents"
                  value={a.id}
                  defaultChecked={selected.has(a.id)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                {a.name}
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          The lead agent is included automatically.
        </p>
      </fieldset>
    </div>
  );
}
