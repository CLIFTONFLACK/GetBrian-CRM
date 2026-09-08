// The Deep Dive prompts, kept in their own module with NO server-only imports.
//
// src/lib/deep-dive/report.ts pulls in the OpenRouter client and the database
// DAO; the Admin panel is a client component and needs the default brief to
// show in its editor. Importing report.ts there would bundle the DB client into
// the browser. Constants only, so both sides can import it freely.

export const DEEP_DIVE_SYSTEM_PROMPT =
  "You are a commercial-property research analyst at CDG Leisure, a UK leisure & " +
  "licensed-property agency. Produce a concise, factual, well-structured markdown " +
  "report on the target company for the agent handling the relationship. Use " +
  "headings, short paragraphs and bullet lists. Be specific and practical. If a " +
  "fact is uncertain, say so — never invent figures. Cite sources inline where you can.";

/**
 * The default research brief — the instructions half of the user prompt.
 *
 * Exported so Admin can show it as the starting point for an edit, and so
 * "Reset to default" has something to reset to. An agency's override lives in
 * agency_settings.deep_dive_prompt (db/migrations/0040); NULL means this text.
 *
 * Note what is NOT in here: the company's own name, website, address and CRN.
 * Those are appended by `userPrompt` below, so however badly this is edited the
 * model is still told which company it is researching.
 */
export const DEFAULT_DEEP_DIVE_PROMPT = [
  `Research this company and write a "Deep Dive" report.`,
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
].join("\n");
