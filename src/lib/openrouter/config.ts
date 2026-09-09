import { getAgencySettings } from "@/lib/db/queries/admin";
import { DEFAULT_DEEP_DIVE_PROMPT } from "@/lib/deep-dive/prompt";

export type OpenRouterConfig = {
  apiKey: string;
  model: string;
  /** Agency override for the Deep Dive research brief; null = built-in default. */
  deepDivePrompt: string | null;
};

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
  return {
    apiKey: settings.openrouter_api_key,
    model: settings.openrouter_model || "perplexity/sonar",
    deepDivePrompt: normaliseDeepDivePrompt(settings.deep_dive_prompt),
  };
}

/** A stored prompt that is blank, or is the built-in default verbatim, is not
 *  an override — Admin's save path writes the default back as text when the
 *  editor is left untouched, and this keeps that reading as "unset" so the
 *  default can later change in code without stale copies pinning agencies to
 *  the old wording. */
function normaliseDeepDivePrompt(stored: string | null): string | null {
  const trimmed = (stored ?? "").trim();
  if (!trimmed || trimmed === DEFAULT_DEEP_DIVE_PROMPT.trim()) return null;
  return stored;
}
