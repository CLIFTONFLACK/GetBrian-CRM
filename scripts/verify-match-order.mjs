/**
 * Proves the match ordering is deterministic: the same requirement scored
 * against the same listings in a different row order must produce the same
 * ranked list, and the same top 10.
 *
 * The control re-runs each case with the old score-only comparator. It MUST
 * come out unstable — otherwise this test proves nothing and the tiebreak was
 * never needed.
 *
 *   node --import ./scripts/_alias-register.mjs scripts/verify-match-order.mjs
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

import { byMatchQuality, scoreMatch } from "@/lib/matching/score";

const sql = neon(
  /^STORAGE_CRM_DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m.exec(fs.readFileSync(".env.local", "utf8"))[1],
);

const reqs = await sql`
  select id, title,
         target_towns, target_regions, target_counties, target_postcode_districts,
         target_neighbourhoods, target_london_zones,
         use_classes::text[] as use_classes, tenure_prefs::text[] as tenure_prefs,
         min_sqft::float8, max_sqft::float8, min_covers::float8, max_covers::float8,
         max_rent::float8, max_premium::float8, max_guide_price::float8, fit_out_prefs
  from public.requirements where status = 'active'`;
const lists = await sql`
  select id, title, city, county, postcode, area, lat, lng,
         property_type, use_class, disposal_type, tenure_raw, fit_out_state,
         size_sqft::float8, covers_internal::float8, covers_external::float8,
         rent_pa::float8, premium::float8, guide_price::float8
  from public.disposals`;

// Deterministic shuffle — no Math.random, so any failure is reproducible.
const shuffle = (arr, seed) => {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const rankWith = (cmp, req, listings) =>
  listings
    .map((d) => ({ d, ...scoreMatch(req, d) }))
    .filter((m) => m.score > 0)
    .sort(cmp)
    .slice(0, 10)
    .map((m) => m.d.id)
    .join(",");

const NEW = byMatchQuality((m) => m.d.id);
const OLD = (a, b) => b.score - a.score; // the previous behaviour

let newUnstable = 0;
let oldUnstable = 0;
let tiedCases = 0;

for (const r of reqs) {
  const orders = [lists, shuffle(lists, 7), shuffle(lists, 991), shuffle(lists, 40503)];
  const newTops = new Set(orders.map((o) => rankWith(NEW, r, o)));
  const oldTops = new Set(orders.map((o) => rankWith(OLD, r, o)));
  if (newTops.size > 1) {
    newUnstable++;
    if (newUnstable <= 3) console.log(`  UNSTABLE (new): ${r.title}`);
  }
  if (oldTops.size > 1) oldUnstable++;

  // Does this brief actually have ties inside its top 10? If none do, the whole
  // test is vacuous.
  const scored = lists.map((d) => scoreMatch(r, d).score).filter((s) => s > 0).sort((a, b) => b - a);
  const top = scored.slice(0, 10);
  if (new Set(top).size < top.length) tiedCases++;
}

console.log(`\nrequirements tested                       : ${reqs.length}`);
console.log(`  with ties inside their top 10           : ${tiedCases}`);
console.log(`  unstable under the NEW comparator       : ${newUnstable}`);
console.log(`  unstable under the OLD (score-only) one : ${oldUnstable}   <- control`);

const ok = newUnstable === 0;
const meaningful = oldUnstable > 0 && tiedCases > 0;
console.log(
  ok ? "\nPASS: ordering is stable across row order." : "\nFAIL: ordering still depends on row order.",
);
if (!meaningful)
  console.log("WARNING: the control did not go red — this test proves nothing. Investigate before trusting it.");
process.exit(ok && meaningful ? 0 : 1);
