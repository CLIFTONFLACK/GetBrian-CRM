import { openRouterChat } from "@/lib/openrouter/client";
import type { OpenRouterConfig } from "@/lib/openrouter/config";
import { createDeepDiveReport } from "@/lib/db/queries/deep-dive";

export type DeepDiveCompany = {
  id: string;
  name: string;
  sector_tags: string[];
  website: string | null;
  address: string;
  company_number: string | null;
};

const SYSTEM =
  "You are a commercial-property research analyst at CDG Leisure, a UK leisure & " +
  "licensed-property agency. Produce a concise, factual, well-structured markdown " +
  "report on the target company for the agent handling the relationship. Use " +
  "headings, short paragraphs and bullet lists. Be specific and practical. If a " +
  "fact is uncertain, say so — never invent figures. Cite sources inline where you can.";

function userPrompt(c: DeepDiveCompany): string {
  const lines = [
    `Research this company and write a "Deep Dive" report.`,
    ``,
    `Company: ${c.name}`,
    c.website ? `Website: ${c.website}` : "",
    c.address ? `Address: ${c.address}` : "",
    c.sector_tags.length ? `Sectors: ${c.sector_tags.join(", ")}` : "",
    c.company_number ? `Companies House no.: ${c.company_number}` : "",
    ``,
    `Structure the report with these sections:`,
    `1. **Overview** — what they do, size, footprint, ownership.`,
    `2. **Market position & competitors** — where they sit and key rivals.`,
    `3. **Recent news & signals** — openings/closings, funding, leadership, expansion (last 12–24 months).`,
    `4. **Financial & growth indicators** — anything public (turnover, sites, trajectory).`,
    `5. **Long-term client value to CDG** — why this is (or isn't) a valuable long-term account.`,
    `6. **How to win the deal** — specific, practical insight the agent can use to open doors and close.`,
    `7. **Risks & watch-outs**.`,
    ``,
    `Keep it under ~900 words.`,
  ];
  return lines.filter((l) => l !== "").join("\n");
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
): Promise<void> {
  try {
    const markdown = await openRouterChat({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: SYSTEM,
      user: userPrompt(company),
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
