/**
 * Load the scraped CDG property book into the live demo agency's `disposals`,
 * replacing whatever supply is there (dummy seed rows or a prior CDG load).
 *
 *   node --env-file=.env.local --import ./scripts/_alias-register.mjs scripts/load-cdg-listings.ts
 *
 * ADAPTED FROM SUPABASE: the original signed in as a demo agent via the
 * Supabase anon key and wrote through `disposals`' RLS policy, exactly like
 * the app. There is no anon key or RLS anymore — this is a maintainer-run
 * script talking directly and trustedly to Neon (STORAGE_CRM_DATABASE_URL),
 * the same `sql` client the app itself uses (src/lib/db/client.ts). Writes go
 * through the disposals DAO's `upsertDisposalFromSource` (src/lib/db/queries/
 * disposals.ts) rather than hand-rolled INSERTs, so the column list/JSON
 * encoding stay in one place shared with the app's CDG single-URL importer
 * and the Market Intel resync. `--import ./scripts/_alias-register.mjs` is
 * what lets a plain `node` script resolve the app's own "@/lib/..." imports
 * (see _alias-hooks.mjs) — Node has no tsconfig "paths" support on its own.
 *
 * Idempotent: `upsertDisposalFromSource` keys on the disposal's own
 * (agency_id, source, source_ref) unique index, so a re-run updates existing
 * rows in place (preserving their id, and anything hanging off it — deals,
 * documents, images) rather than deleting and recreating. Input is
 * supabase/seeds/cdg_listings.json (from scrape-cdg-all.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { sql } from "@/lib/db/client";
import { upsertDisposalFromSource, updateDisposalLeadAgent } from "@/lib/db/queries/disposals";
import type { DisposalInsert } from "@/lib/disposals/cdg";

const AGENCY_NAME = "CDG demo";
// Morris Greenberg — the demo agency's admin (agent1-equivalent); see dummy_data.sql.
const CREATED_BY_EMAIL = "morris@cdgleisure.com";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(
  readFileSync(join(__dirname, "..", "supabase", "seeds", "cdg_listings.json"), "utf8"),
) as DisposalInsert[];

const agencyRows = (await sql`
  select id from public.agencies where name = ${AGENCY_NAME} limit 1
`) as { id: string }[];
if (agencyRows.length === 0) {
  throw new Error(`Agency "${AGENCY_NAME}" not found — run dummy_data.sql first.`);
}
const agencyId = agencyRows[0].id;

const memberRows = (await sql`
  select u.id, u.full_name, u.email
  from public.agency_members m
  join public.users u on u.id = m.user_id
  where m.agency_id = ${agencyId}
  order by u.id
`) as { id: string; full_name: string | null; email: string }[];
if (memberRows.length === 0) {
  throw new Error(`Agency "${AGENCY_NAME}" has no members — run dummy_data.sql first.`);
}

const createdBy = memberRows.find((m) => m.email === CREATED_BY_EMAIL)?.id ?? memberRows[0].id;

// Map each real CDG agent's display name → demo account, so a listing's lead
// agent is the agent who actually handles it on CDG (falls back to round-robin).
const idByName = new Map(
  memberRows.filter((m) => m.full_name).map((m) => [m.full_name as string, m.id]),
);

let processed = 0;
for (const row of rows) {
  const leadAgentId =
    (row.agent_name && idByName.get(row.agent_name)) || memberRows[processed % memberRows.length].id;

  const { id } = await upsertDisposalFromSource(agencyId, createdBy, "cdg", row);
  await updateDisposalLeadAgent(agencyId, id, leadAgentId);

  processed++;
  if (processed % 20 === 0 || processed === rows.length) {
    console.log(`Upserted ${processed}/${rows.length}…`);
  }
}

console.log(`\nDone. ${processed} CDG listings loaded into "${AGENCY_NAME}".`);
process.exit(0);
