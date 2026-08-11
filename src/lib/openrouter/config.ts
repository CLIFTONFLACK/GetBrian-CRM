import { getAgencySettings } from "@/lib/db/queries/admin";

export type OpenRouterConfig = { apiKey: string; model: string };

/**
 * Fetch the caller's agency OpenRouter config (agency_settings, set in
 * Admin). Any agency member can call this, not just admins — read access was
 * never the security boundary here; writing the key is (see
 * db/migrations/0019_agency_settings.sql). Returns null when no key has been
 * set.
 *
 * ADAPTED FROM SUPABASE: this used to go through a SECURITY DEFINER RPC
 * (current_agency_openrouter()) that resolved the caller's agency via
 * auth.uid() so non-admins could read the row without a direct table grant.
 * There's no RLS/auth.uid() equivalent outside Supabase (see AGENTS.md), so
 * the "resolve agency, then read agency_settings" logic now lives in the
 * caller (which already has agencyId from currentAgencyId()) — this just
 * reads the row via the Neon DAO.
 */
export async function getAgencyOpenRouter(agencyId: string): Promise<OpenRouterConfig | null> {
  const settings = await getAgencySettings(agencyId);
  if (!settings?.openrouter_api_key) return null;
  return { apiKey: settings.openrouter_api_key, model: settings.openrouter_model || "perplexity/sonar" };
}
