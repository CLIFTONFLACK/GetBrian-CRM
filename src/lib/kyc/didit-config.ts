import { getAgencySettings } from "@/lib/db/queries/admin";
import { DIDIT_API_KEY, DIDIT_ENV_AGENCY_ID, DIDIT_WORKFLOW_ID } from "./config";

/** True when this agency may use the DIDIT_* env credentials. Only the agency
 *  named in DIDIT_ENV_AGENCY_ID can; see config.ts for why. */
function mayUseEnvDidit(agencyId: string): boolean {
  return DIDIT_ENV_AGENCY_ID !== "" && DIDIT_ENV_AGENCY_ID === agencyId;
}

export type DiditConfig = {
  apiKey: string;
  workflowId: string;
  /** Where the credentials came from — the Admin UI says which is in use. */
  source: "agency" | "env";
};

/**
 * Resolves the Didit credentials for one agency, mirroring
 * lib/openrouter/config.ts's getAgencyOpenRouter: the agency's own row wins,
 * and the DIDIT_* env vars are the fallback for the one agency named in
 * DIDIT_ENV_AGENCY_ID. No other agency gets the env credentials.
 *
 * Returns null when either half is missing. Both are required — a key with no
 * workflow id cannot start a business check, because Didit decides KYC-vs-KYB
 * from the workflow (see db/migrations/0042_didit_kyb.sql).
 */
export async function getAgencyDidit(agencyId: string): Promise<DiditConfig | null> {
  const settings = await getAgencySettings(agencyId);
  const apiKey = settings?.didit_api_key?.trim() || "";
  const workflowId = settings?.didit_workflow_id?.trim() || "";
  if (apiKey && workflowId) return { apiKey, workflowId, source: "agency" };
  // An agency that saved its own key but no workflow yet is not configured.
  // It must not fall through to the env account and be billed there.
  if (apiKey) return null;
  if (DIDIT_API_KEY && DIDIT_WORKFLOW_ID && mayUseEnvDidit(agencyId)) {
    return { apiKey: DIDIT_API_KEY, workflowId: DIDIT_WORKFLOW_ID, source: "env" };
  }
  return null;
}

/** The API key alone — enough to list workflows on the Admin page, which is how
 *  a workflow id gets chosen in the first place. */
export async function getAgencyDiditKey(agencyId: string): Promise<string | null> {
  const settings = await getAgencySettings(agencyId);
  return (
    settings?.didit_api_key?.trim() ||
    (mayUseEnvDidit(agencyId) ? DIDIT_API_KEY : "") ||
    null
  );
}
