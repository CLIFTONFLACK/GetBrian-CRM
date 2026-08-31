/**
 * READ-ONLY smoke test: score every active requirement against the whole
 * listing book using the app's real scorer, and report the distribution.
 *
 * Answers two questions the UI can't be asked from here (it's behind auth):
 * does MatchMaker survive the freshly imported data, and does that data
 * actually produce matches?
 *
 * Run: node --import ./scripts/_alias-register.mjs scripts/smoke-match.mjs
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

import { scoreMatch } from "@/lib/matching/score";

const sql = neon(
  /^STORAGE_CRM_DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m.exec(fs.readFileSync(".env.local", "utf8"))[1],
);

// The same casts the DAO uses: the neon driver hands back numerics as strings
// and enum arrays as raw literals, both of which the scorer mis-reads.
const reqs = await sql`
  select id, title,
         target_towns, target_regions, target_counties, target_postcode_districts,
         target_neighbourhoods, target_london_zones,
         use_classes::text[] as use_classes, tenure_prefs::text[] as tenure_prefs,
         min_sqft::float8, max_sqft::float8, min_covers::float8, max_covers::float8,
         max_rent::float8, max_premium::float8, max_guide_price::float8, fit_out_prefs
  from public.requirements where status = 'active' order by title`;

const lists = await sql`
  select id, title, city, county, postcode, area, lat, lng,
         property_type, use_class, disposal_type, tenure_raw, fit_out_state,
         size_sqft::float8, covers_internal::float8, covers_external::float8,
         rent_pa::float8, premium::float8, guide_price::float8
  from public.disposals`;

console.log(`${reqs.length} active requirements x ${lists.length} listings = ${reqs.length * lists.length} pairs\n`);

let errors = 0;
let scored = 0;
const buckets = { "90+": 0, "70-89": 0, "50-69": 0, "under 50": 0 };
const best = new Map();

for (const r of reqs) {
  for (const l of lists) {
    try {
      const { score } = scoreMatch(r, l);
      scored++;
      if (score >= 90) buckets["90+"]++;
      else if (score >= 70) buckets["70-89"]++;
      else if (score >= 50) buckets["50-69"]++;
      else buckets["under 50"]++;
      const cur = best.get(r.id);
      if (!cur || score > cur.score)
        best.set(r.id, { score, listing: l.title, title: r.title, req: r });
    } catch (e) {
      if (errors < 5) console.log(`  ERROR  ${r.title} x ${l.title}: ${e.message}`);
      errors++;
    }
  }
}

console.log(`scored without error : ${scored}`);
console.log(`errors               : ${errors}`);
console.log(`distribution         : ${JSON.stringify(buckets)}`);

const scores = [...best.values()];
console.log(`requirements with a 50%+ listing : ${scores.filter((b) => b.score >= 50).length} / ${reqs.length}`);
console.log(`requirements with a 70%+ listing : ${scores.filter((b) => b.score >= 70).length} / ${reqs.length}`);
console.log(`requirements whose best is under 50%: ${scores.filter((b) => b.score < 50).length}`);

console.log("\ntop 8 pairings:");
for (const b of scores.sort((a, b) => b.score - a.score).slice(0, 8))
  console.log(`  ${String(b.score).padStart(3)}%  ${b.title.slice(0, 46).padEnd(46)} -> ${b.listing}`);

// A requirement with no target location is unconstrained on location, so it
// scores full marks against every listing in the book. That inflates the top
// of the distribution and makes the matches useless to an agent — split the
// two groups so the effect is visible rather than flattering.
const hasLocation = (r) =>
  [r.target_london_zones, r.target_neighbourhoods, r.target_towns,
   r.target_counties, r.target_regions, r.target_postcode_districts]
    .some((a) => Array.isArray(a) && a.length > 0);
const withLoc = scores.filter((b) => hasLocation(b.req));
const without = scores.filter((b) => !hasLocation(b.req));
const avg = (a) => (a.length ? Math.round(a.reduce((n, b) => n + b.score, 0) / a.length) : 0);
const perfect = (a) => a.filter((b) => b.score === 100).length;
console.log("\nlocation targeting, and what it does to the scores:");
console.log(`  with a target location   : ${withLoc.length} reqs, best-match avg ${avg(withLoc)}%, ${perfect(withLoc)} scoring a perfect 100%`);
console.log(`  with NO target location  : ${without.length} reqs, best-match avg ${avg(without)}%, ${perfect(without)} scoring a perfect 100%`);

process.exit(errors > 0 ? 1 : 0);
