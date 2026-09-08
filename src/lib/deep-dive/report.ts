import { openRouterChat } from "@/lib/openrouter/client";
import {
  DEEP_DIVE_SYSTEM_PROMPT,
  DEFAULT_DEEP_DIVE_PROMPT,
} from "@/lib/deep-dive/prompt";
import type { OpenRouterConfig } from "@/lib/openrouter/config";
import { createDeepDiveReport } from "@/lib/db/queries/deep-dive";

export { DEEP_DIVE_SYSTEM_PROMPT, DEFAULT_DEEP_DIVE_PROMPT };

export type DeepDiveCompany = {
  id: string;
  name: string;
  sector_tags: string[];
  website: string | null;
  address: string;
  company_number: string | null;
};

/** The company's own facts, always prepended to whatever brief is in force. */
function companyFacts(c: DeepDiveCompany): string {
  return [
    `Company: ${c.name}`,
    c.website ? `Website: ${c.website}` : "",
    c.address ? `Address: ${c.address}` : "",
    c.sector_tags.length ? `Sectors: ${c.sector_tags.join(", ")}` : "",
    c.company_number ? `Companies House no.: ${c.company_number}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function userPrompt(c: DeepDiveCompany, prompt?: string | null): string {
  const brief = (prompt ?? "").trim() || DEFAULT_DEEP_DIVE_PROMPT;
  return [companyFacts(c), ``, brief].join("\n");
}

/**
 * Generate a Deep Dive report via OpenRouter and store it. Throws on failure so
 * the calling server action can surface the message; the thrown error is also
 * saved as a `failed` row for the audit trail.
 */
export async function runDeepDiveReport(
  company: DeepDiveCompany,
  agencyId: string,
  userId: string,
  cfg: OpenRouterConfig,
  /** Agency override for the research brief; null or blank uses the default. */
  prompt?: string | null,
): Promise<void> {
  try {
    const markdown = await openRouterChat({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: DEEP_DIVE_SYSTEM_PROMPT,
      user: userPrompt(company, prompt),
    });
    await createDeepDiveReport(agencyId, {
      companyId: company.id,
      status: "complete",
      model: cfg.model,
      markdown,
      createdBy: userId,
    });
  } catch (err) {
    await createDeepDiveReport(agencyId, {
      companyId: company.id,
      status: "failed",
      model: cfg.model,
      error: (err as Error).message,
      createdBy: userId,
    });
    throw err;
  }
}
