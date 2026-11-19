// Maintainer script: requirements that have no company get one, when it is
// clear which. The September import linked requirements to a contact only, so
// the company screen ("Requirements" tab, which lists by company_id) showed
// none of them.
//
//   node scripts/link-requirement-companies.mjs --env .env.local            # dry run (default)
//   node scripts/link-requirement-companies.mjs --env .env.local --apply    # write
//   ... [--agency <agency uuid>]                                             # one agency only
//
// --env is required, with or without --apply (the script always reads the
// database). Prints the host, never the user name or password. COUNTS ONLY.
//
// The rule, per requirement with no company:
//   A. the company of its linked contact (same agency);
//   B. the company named before the bracket in the title, "Company (Person)"
//      (parseTenant, the importer's own reader), only if exactly ONE company in
//      the agency has that name (case-insensitive).
//   A only: A.  B only: B.  Both and equal: that company.
//   Both and DIFFERENT: skipped (left for a person). Neither: skipped.
// A requirement that already has a company is never touched.
//
// date_updated: as in scripts/move-mobiles.mjs. The 0044 trigger would set
// date_updated to now() on this data change, so each row's date is read first
// and put back by a second, date-only UPDATE in the same transaction. Before
// COMMIT every changed row is checked and the whole run rolls back on any
// difference. updated_at does move (a data column changed).
import { readFileSync } from "node:fs";
import { Client } from "@neondatabase/serverless";

import { parseTenant } from "../src/lib/import-parse.ts";

const KEY = "STORAGE_CRM_DATABASE_URL";

function readUrl(envFile) {
  const text = readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0 || line.slice(0, eq).trim() !== KEY) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0])
      value = value.slice(1, -1);
    return value;
  }
  return "";
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : "";
};
const envFile = flag("--env");
const agency = flag("--agency");
if (!envFile) {
  console.error("REFUSED: --env <file> is required (it names the database to read).");
  process.exit(2);
}
if (agency && !/^[0-9a-f-]{36}$/i.test(agency)) {
  console.error("REFUSED: --agency must be a UUID.");
  process.exit(2);
}
const url = readUrl(envFile);
if (!url) {
  console.error(`${KEY} is not set in ${envFile}`);
  process.exit(2);
}
console.log(`target host: ${new URL(url).hostname.toLowerCase()}`);
console.log(apply ? "mode: APPLY (writes)" : "mode: dry run (nothing is written)");

const client = new Client(url);
await client.connect();
let failed = false;
try {
  const reqs = (
    await client.query(
      `select r.id, r.agency_id, r.title, r.date_updated::text as date_updated,
              k.company_id as contact_company
         from public.requirements r
         left join public.contacts k
                on k.id = r.contact_id and k.agency_id = r.agency_id
        where r.company_id is null
          and ($1::uuid is null or r.agency_id = $1::uuid)`,
      [agency || null],
    )
  ).rows;
  const companies = (
    await client.query(
      `select id, agency_id, lower(btrim(name)) as n
         from public.companies
        where ($1::uuid is null or agency_id = $1::uuid)`,
      [agency || null],
    )
  ).rows;
  // agency -> name -> [company ids]
  const byName = new Map();
  const companyAgency = new Map();
  for (const c of companies) {
    companyAgency.set(c.id, c.agency_id);
    const m = byName.get(c.agency_id) ?? new Map();
    m.set(c.n, [...(m.get(c.n) ?? []), c.id]);
    byName.set(c.agency_id, m);
  }

  const counts = {
    noCompany: reqs.length,
    viaContact: 0,
    viaTenant: 0,
    bothSame: 0,
    conflict: 0,
    ambiguousName: 0,
    noRoute: 0,
  };
  const changes = [];
  for (const r of reqs) {
    const a = r.contact_company && companyAgency.get(r.contact_company) === r.agency_id ? r.contact_company : null;
    let b = null;
    const tenant = parseTenant(r.title ?? "");
    if (tenant.companyName) {
      const ids = byName.get(r.agency_id)?.get(tenant.companyName.trim().toLowerCase()) ?? [];
      if (ids.length === 1) b = ids[0];
      else if (ids.length > 1) counts.ambiguousName++;
    }
    let pick = null;
    if (a && b) {
      if (a === b) {
        counts.bothSame++;
        pick = a;
      } else counts.conflict++;
    } else if (a) {
      counts.viaContact++;
      pick = a;
    } else if (b) {
      counts.viaTenant++;
      pick = b;
    } else counts.noRoute++;
    if (pick) changes.push({ id: r.id, agency: r.agency_id, company: pick, date: r.date_updated });
  }
  console.log(`requirements with no company: ${counts.noCompany}`);
  console.log(`  would link through the contact's company only: ${counts.viaContact}`);
  console.log(`  would link through the tenant name in the title only: ${counts.viaTenant}`);
  console.log(`  both routes agree: ${counts.bothSame}`);
  console.log(`  skipped, the two routes name DIFFERENT companies: ${counts.conflict}`);
  console.log(`  skipped, no route: ${counts.noRoute}`);
  console.log(`  (tenant name matched more than one company, not used: ${counts.ambiguousName})`);
  console.log(`total to link: ${changes.length}`);

  if (!apply) console.log("dry run: nothing written. Add --apply to write.");
  else if (changes.length > 0) {
    await client.query("begin");
    try {
      const ids = changes.map((c) => c.id);
      const cos = changes.map((c) => c.company);
      const ags = changes.map((c) => c.agency);
      const dates = changes.map((c) => c.date);
      const linked = await client.query(
        `update public.requirements r
            set company_id = t.company
           from unnest($1::uuid[], $2::uuid[], $3::uuid[]) as t(id, company, agency)
          where r.id = t.id and r.agency_id = t.agency and r.company_id is null`,
        [ids, cos, ags],
      );
      // Date-only update: the trigger keeps updated_at and takes our date_updated.
      await client.query(
        `update public.requirements r
            set date_updated = t.d
           from unnest($1::uuid[], $2::timestamptz[]) as t(id, d)
          where r.id = t.id`,
        [ids, dates],
      );
      const bad = await client.query(
        `select count(*)::int as n
           from public.requirements r
           join unnest($1::uuid[], $2::timestamptz[]) as t(id, d) on t.id = r.id
          where r.date_updated is distinct from t.d`,
        [ids, dates],
      );
      console.log(`linked: ${linked.rowCount}`);
      console.log(`linked rows whose date_updated differs from the original: ${bad.rows[0].n}`);
      if (bad.rows[0].n !== 0 || linked.rowCount !== changes.length) {
        throw new Error(
          `check failed (linked ${linked.rowCount} of ${changes.length}, ${bad.rows[0].n} dates differ): rolled back`,
        );
      }
      await client.query("commit");
      console.log("committed");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
} catch (err) {
  failed = true;
  console.error(err instanceof Error ? err.message : String(err));
} finally {
  await client.end();
}
if (failed) process.exit(1);
