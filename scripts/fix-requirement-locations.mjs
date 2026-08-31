/**
 * Backfill the Target Location fields on the imported requirements.
 *
 * The first conversion could only place 51 of 82 briefs, because it demanded an
 * exact whole-token match against the location vocabularies. The rest kept
 * their location as free text in `notes` — and a requirement with no location
 * is unconstrained, so MatchMaker scored it 100% against every listing in the
 * book. Those matches were noise.
 *
 * scripts/lib/parse-area.mjs does the real work. This script:
 *   1. re-parses the Area column from CDG's original export
 *   2. resolves "within N miles of <X>" against CDG's own listing book
 *   3. geocodes whatever is left, snapping it to the nearest London area
 *   4. UNIONs the result onto what is already in the database
 *
 * Union, not replace: everything already stored came from an exact match and is
 * correct, just incomplete, so this can only ever add. `notes` is left alone —
 * the "Area (as exported)" line stays as provenance.
 *
 *   node --import ./scripts/_alias-register.mjs scripts/fix-requirement-locations.mjs
 *   ... --apply     write to the database
 *   ... --csv       also rewrite Data CSVs/import-ready/requirements-import.csv
 */
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

import { parseCsv, decodeCsvBytes, toCsv } from "@/lib/csv";
import { distanceMiles } from "@/lib/locations";
import { LONDON_AREA_OPTIONS } from "@/lib/locations/options";
import { geocodeAddress } from "@/lib/maps/geocode";
import { parseArea } from "./lib/parse-area.mjs";

const APPLY = process.argv.includes("--apply");
const WRITE_CSV = process.argv.includes("--csv");

const sql = neon(
  /^STORAGE_CRM_DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m.exec(fs.readFileSync(".env.local", "utf8"))[1],
);
const bytesOf = (p) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};
const fail = (m) => {
  console.error("ABORT: " + m);
  process.exit(1);
};

const LONDON_AREAS = JSON.parse(
  fs.readFileSync("src/lib/locations/data/london-areas.json", "utf8"),
).areas;
/** A geocoded point is only accepted as a neighbourhood within this radius. */
const SNAP_MILES = 2;

const listings = await sql`select title, area, city, postcode from public.disposals`;
const index = new Map(listings.map((l) => [l.title.trim().toLowerCase(), l]));

const src = parseCsv(decodeCsvBytes(bytesOf("Data CSVs/requirement-list-1787838152.csv"))).slice(2);

const live = await sql`
  select id, title, contact_email_placeholder, min_sqft::float8, max_sqft::float8,
         target_london_zones, target_neighbourhoods, target_towns,
         target_counties, target_regions, target_postcode_districts
  from (
    select r.*, c.email as contact_email_placeholder
    from public.requirements r join public.contacts c on c.id = r.contact_id
  ) q`;

// (title, min, max) must identify one row — several briefs share a title.
const keyOf = (t, min, max) => `${t.trim().toLowerCase()}|${min ?? ""}|${max ?? ""}`;
const byKey = new Map();
for (const r of live) {
  const k = keyOf(r.title, r.min_sqft, r.max_sqft);
  if (byKey.has(k)) fail(`key collision: two requirements share "${k}" — need a better key`);
  byKey.set(k, r);
}
console.log(`${live.length} requirements in the database, all uniquely keyed\n`);

const SQM = 10.7639;
const parseSize = (cell) => {
  const m = /([\d,.]+)\s*(?:to|-|–)\s*([\d,.]+)\s*sq\s*\.?\s*(ft|m)\b/i.exec(cell);
  if (!m) return [null, null];
  const n = (v) => Number(v.replace(/,/g, ""));
  const f = m[3].toLowerCase() === "m" ? SQM : 1;
  return [Math.round(n(m[1]) * f), Math.round(n(m[2]) * f)];
};

const plan = [];
let geocoded = 0;
let geocodeRejected = 0;

for (const r of src) {
  const [tenant, size, , , area, email] = r.map((v) => (v ?? "").trim());
  if (!tenant || !email) continue;
  const [min, max] = parseSize(size);
  const row = byKey.get(keyOf(tenant, min, max));
  if (!row) fail(`no database row for "${tenant}" (${min}-${max})`);

  const p = parseArea(area, index);

  // Anything the parser could not place: geocode it, and accept the result only
  // if it lands within SNAP_MILES of a London area centroid. A street that
  // geocodes somewhere else is rejected rather than guessed at.
  if (!p.any && p.leftover.length) {
    for (const phrase of p.leftover) {
      const query = phrase.replace(/^\s*within\s+[\d.]+\s+miles?\s+of\s+/i, "").trim();
      const geo = await geocodeAddress({ address_line: query });
      if (!geo) {
        geocodeRejected++;
        continue;
      }
      let nearest = null;
      for (const a of LONDON_AREAS) {
        const d = distanceMiles(geo, { lat: a.lat, lng: a.lng });
        if (!nearest || d < nearest.d) nearest = { d, a };
      }
      if (nearest && nearest.d <= SNAP_MILES) {
        p.neighbourhoods.push(nearest.a.name);
        (nearest.a.districts ?? []).forEach((d) => p.districts.push(d));
        geocoded++;
        console.log(`  geocoded  "${query}" -> ${nearest.a.name} (${nearest.d.toFixed(2)} mi)`);
      } else {
        geocodeRejected++;
        console.log(`  rejected  "${query}" — nearest London area ${nearest?.d.toFixed(1)} mi away`);
      }
    }
  }

  // Union with what is already stored: additive only.
  const merge = (existing, added) => [...new Set([...(existing ?? []), ...added])];
  const next = {
    target_london_zones: merge(row.target_london_zones, p.zones),
    target_neighbourhoods: merge(row.target_neighbourhoods, p.neighbourhoods),
    target_towns: merge(row.target_towns, p.towns),
    target_counties: merge(row.target_counties, p.counties),
    target_postcode_districts: merge(row.target_postcode_districts, p.districts),
  };
  const before = [
    row.target_london_zones, row.target_neighbourhoods, row.target_towns,
    row.target_counties, row.target_regions, row.target_postcode_districts,
  ].reduce((n, a) => n + (a?.length ?? 0), 0);
  const after = Object.values(next).reduce((n, a) => n + a.length, 0) + (row.target_regions?.length ?? 0);
  plan.push({ row, next, tenant, area, before, after, added: after - before });
}

const hadNone = plan.filter((p) => p.before === 0);
const nowHas = hadNone.filter((p) => p.after > 0);
console.log(`\nrequirements with no target location before : ${hadNone.length}`);
console.log(`  of those, now placed                      : ${nowHas.length}`);
console.log(`  still unplaced                            : ${hadNone.length - nowHas.length}`);
console.log(`total target values added                   : ${plan.reduce((n, p) => n + p.added, 0)}`);
console.log(`geocoded / rejected                         : ${geocoded} / ${geocodeRejected}`);
console.log(`rows unchanged                              : ${plan.filter((p) => p.added === 0).length}`);

// Nothing may ever be removed.
const shrunk = plan.filter((p) => p.after < p.before);
if (shrunk.length) fail(`${shrunk.length} rows would LOSE target values — union is broken`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply.");
} else {
  let updated = 0;
  for (const p of plan) {
    if (p.added === 0) continue;
    const done = await sql`
      update public.requirements set
        target_london_zones       = ${p.next.target_london_zones},
        target_neighbourhoods     = ${p.next.target_neighbourhoods},
        target_towns              = ${p.next.target_towns},
        target_counties           = ${p.next.target_counties},
        target_postcode_districts = ${p.next.target_postcode_districts}
      where id = ${p.row.id} returning id`;
    if (done.length !== 1) fail(`update of ${p.row.id} affected ${done.length} rows`);
    updated++;
  }
  console.log(`\nUpdated ${updated} requirements.`);

  const after = await sql`
    select count(*)::int as total,
           count(*) filter (where coalesce(array_length(target_london_zones,1),0)
                                + coalesce(array_length(target_neighbourhoods,1),0)
                                + coalesce(array_length(target_towns,1),0)
                                + coalesce(array_length(target_counties,1),0)
                                + coalesce(array_length(target_regions,1),0)
                                + coalesce(array_length(target_postcode_districts,1),0) > 0)::int as with_location
    from public.requirements`;
  console.log("Verify:", JSON.stringify(after[0]));
}

if (WRITE_CSV) {
  const file = path.join("Data CSVs", "import-ready", "requirements-import.csv");
  const rows = parseCsv(decodeCsvBytes(bytesOf(file)));
  const header = rows[0];
  const col = (n) => header.indexOf(n);
  const out = rows.slice(1).map((r) => {
    const p = plan.find(
      (x) => x.tenant === r[col("title")] && String(x.row.min_sqft ?? "") === String(Number(r[col("min_sqft")]) || ""),
    );
    if (!p) return r;
    const set = (name, vals) => (r[col(name)] = vals.join(";"));
    set("target_london_zones", p.next.target_london_zones);
    set("target_neighbourhoods", p.next.target_neighbourhoods);
    set("target_towns", p.next.target_towns);
    set("target_counties", p.next.target_counties);
    set("target_postcode_districts", p.next.target_postcode_districts);
    return r;
  });
  // The file lives on a Google Drive mount and is routinely held open by Excel
  // or the sync client, so a write can fail with EBUSY long after the database
  // work has succeeded. Fall back to a sibling rather than throwing.
  const body = "﻿" + toCsv(header, out);
  try {
    fs.writeFileSync(file, body, "utf8");
    console.log(`\nRewrote ${file}`);
  } catch (e) {
    if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
    const alt = file.replace(/\.csv$/, "-updated.csv");
    fs.writeFileSync(alt, body, "utf8");
    console.log(`\n${file} is locked (${e.code}) — wrote ${alt} instead.`);
    console.log("Close the file and rename it over the original, or re-run with --csv.");
  }
}
