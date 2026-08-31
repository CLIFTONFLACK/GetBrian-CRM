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
 *
 * Re-runnable as a *sweep*, matching what the Market Intel resync already does
 * for partner books:
 *
 *   - rows whose `source_ref` the fresh scrape no longer returns are marked
 *     Withdrawn, never deleted, so deals and send history keep pointing at a
 *     real row;
 *   - the lead agent is only assigned when a row hasn't got one. The first load
 *     seeds it from the agent named on CDG's site, but after that the
 *     assignment belongs to the agency and a re-run must not undo it.
 *
 * Pass `--dry-run` to report what would change without writing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { sql } from "@/lib/db/client";
import { upsertDisposalFromSource, updateDisposalLeadAgent } from "@/lib/db/queries/disposals";
import { markDisposalsWithdrawn } from "@/lib/db/queries/intel";
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

const dryRun = process.argv.includes("--dry-run");

// The book as the CRM currently holds it, so the sweep can report what is new
// and work out which refs have disappeared from CDG's site.
const existing = (await sql`
  select id, source_ref, title, status, lead_agent_id
  from public.disposals
  where agency_id = ${agencyId} and source = 'cdg'
`) as {
  id: string;
  source_ref: string | null;
  title: string | null;
  status: string | null;
  lead_agent_id: string | null;
}[];

const existingByRef = new Map(
  existing.filter((r) => r.source_ref).map((r) => [r.source_ref as string, r]),
);
const freshRefs = new Set(rows.map((r) => r.source_ref).filter(Boolean) as string[]);
const added = rows.filter((r) => r.source_ref && !existingByRef.has(r.source_ref));
const gone = existing.filter(
  (r) => r.source_ref != null && !freshRefs.has(r.source_ref) && r.status !== "Withdrawn",
);

console.log(`Scraped ${rows.length} live listings; CRM holds ${existing.length}.`);
console.log(`  ${added.length} new, ${rows.length - added.length} updated in place.`);
console.log(`  ${gone.length} no longer on the site -> Withdrawn.`);
for (const g of gone) console.log(`    - ${g.source_ref} (${g.status}) ${g.title ?? ""}`);
if (dryRun) {
  console.log("\nDry run: nothing written.");
  process.exit(0);
}

let processed = 0;
for (const row of rows) {
  const { id } = await upsertDisposalFromSource(agencyId, createdBy, "cdg", row);

  // Seed the lead agent only when the row hasn't got one. CDG's site names the
  // handling agent, which is the right starting point, but a reassignment made
  // in the CRM must survive the next sweep.
  const prior = row.source_ref ? existingByRef.get(row.source_ref) : undefined;
  if (!prior?.lead_agent_id) {
    const leadAgentId =
      (row.agent_name && idByName.get(row.agent_name)) ||
      memberRows[processed % memberRows.length].id;
    await updateDisposalLeadAgent(agencyId, id, leadAgentId);
  }

  processed++;
  if (processed % 20 === 0 || processed === rows.length) {
    console.log(`Upserted ${processed}/${rows.length}…`);
  }
}

const withdrawn = await markDisposalsWithdrawn(
  agencyId,
  gone.map((g) => g.id),
);

console.log(`\nDone. ${processed} CDG listings loaded into "${AGENCY_NAME}".`);
console.log(`${withdrawn} marked Withdrawn.`);
process.exit(0);
