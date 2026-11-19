// Maintainer script: re-read the Kato requirements export with the CURRENT
// parsers (import-parse.ts) and ADD what they now find to the requirements the
// first import created, matched by external_ref (the "kato-" reference that
// legacyRowRef computes from six cells of the row).
//
//   node scripts/reparse-kato-requirements.mjs <requirements.xlsx> --env .env.local          # dry run
//   node scripts/reparse-kato-requirements.mjs <requirements.xlsx> --env .env.local --apply  # write
//   ... [--agency <agency uuid>]    (needed when more than one agency has kato- references)
//
// --env is required, with or without --apply (the script always reads the
// database). URL from STORAGE_CRM_DATABASE_URL in that file. Prints the database
// host, never the user name or password. Prints COUNTS ONLY: no names, ids or rows.
//
// It only ever ADDS:
//   - number fields (min_sqft, max_sqft, max_rent, max_rent_psf) are set only
//     where the stored value is null;
//   - the "within N miles" group (text, latitude, longitude, radius) is set only
//     where the row has no place text and no radius, and only when the place
//     was found in the offline gazetteer. Places that need the geocoder are
//     counted, not written: run the file through Admin > Import again to look
//     them up (60 per import);
//   - the target_* arrays are unioned: stored values stay, parsed ones that are
//     missing are appended;
//   - notes are never touched.
// A value an agent has edited since the first import is therefore never replaced
// (except that a place an agent removed from an array can come back).
//
// date_updated: the 0044 trigger sets date_updated to now() on a data change. The
// script reads each row's date_updated first and sets it back in a second,
// date-only UPDATE in the same transaction. updated_at does move (a data column
// changed). Before COMMIT every touched row is checked for its original
// date_updated; any difference rolls the whole run back.
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { Client } from "@neondatabase/serverless";

import { mapHeaders } from "../src/lib/csv.ts";
import { legacyRowRef, parseArea, parseRent, parseSize } from "../src/lib/import-parse.ts";
import { workbookToRows } from "../src/lib/xlsx-rows.ts";
import { catalog } from "./lib/kato-catalog.mjs";

const KEY = "STORAGE_CRM_DATABASE_URL";
const CHUNK = 400;

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
const agencyArg = flag("--agency");
const skipValues = new Set([envFile, agencyArg].filter(Boolean));
const file = args.find((a) => !a.startsWith("--") && !skipValues.has(a));
if (!file) {
  console.error("REFUSED: name the requirements .xlsx or .csv file.");
  process.exit(2);
}
if (!envFile) {
  console.error("REFUSED: --env <file> is required (it names the database to read).");
  process.exit(2);
}
if (agencyArg && !/^[0-9a-f-]{36}$/i.test(agencyArg)) {
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

// ---- read the file ----------------------------------------------------------
const bytes = readFileSync(file);
const { rows: sheet } = workbookToRows(XLSX, new Uint8Array(bytes));
const header = mapHeaders("requirements", sheet);
const get = (r, name) => {
  for (const i of header.columns.get(name) ?? []) {
    const v = (r[i] ?? "").trim();
    if (v) return v;
  }
  return "";
};
const parsedByRef = new Map();
for (const r of sheet.slice(header.headerRow + 1)) {
  if (!get(r, "title")) continue;
  const ref = legacyRowRef({
    title: get(r, "title"),
    size: get(r, "size_text"),
    propertyType: get(r, "use_classes"),
    rent: get(r, "rent_text"),
    area: get(r, "area_text"),
    email: get(r, "contact_email"),
  });
  if (parsedByRef.has(ref)) continue; // exact duplicate rows share a reference
  const size = parseSize(get(r, "size_text"));
  const rent = parseRent(get(r, "rent_text"));
  const area = parseArea(get(r, "area_text"), catalog);
  parsedByRef.set(ref, { size, rent, area });
}
console.log(`file rows with a title: ${sheet.length - header.headerRow - 1}   distinct references: ${parsedByRef.size}`);

// ---- read the database ------------------------------------------------------
const ARRAYS = [
  ["target_london_zones", "zones"],
  ["target_neighbourhoods", "neighbourhoods"],
  ["target_towns", "towns"],
  ["target_counties", "counties"],
  ["target_regions", "regions"],
  ["target_postcode_districts", "districts"],
];
const union = (stored, parsed) => [...new Set([...(stored ?? []), ...parsed])];

const client = new Client(url);
await client.connect();
let failed = false;
try {
  let agencyId = agencyArg;
  if (!agencyId) {
    const { rows } = await client.query(
      `select distinct agency_id from public.requirements where external_ref like 'kato-%'`,
    );
    if (rows.length !== 1) {
      throw new Error(
        `${rows.length} agencies have kato- references: pass --agency <uuid> to choose one.`,
      );
    }
    agencyId = rows[0].agency_id;
  }
  const { rows: stored } = await client.query(
    `select id, external_ref, min_sqft::float8 as min_sqft, max_sqft::float8 as max_sqft,
            max_rent::float8 as max_rent, max_rent_psf::float8 as max_rent_psf,
            target_london_zones, target_neighbourhoods, target_towns, target_counties,
            target_regions, target_postcode_districts,
            location_anchor_text, location_radius_miles::float8 as location_radius_miles,
            date_updated::text as date_updated
       from public.requirements
      where agency_id = $1 and external_ref like 'kato-%'`,
    [agencyId],
  );

  const counts = {
    stored: stored.length,
    matched: 0,
    notInFile: 0,
    wouldChange: 0,
    min_sqft: 0,
    max_sqft: 0,
    max_rent: 0,
    max_rent_psf: 0,
    anchor: 0,
    anchorNeedsGeocoder: 0,
    anchorAlreadySet: 0,
    ...Object.fromEntries(ARRAYS.map(([col]) => [col, 0])),
  };
  const updates = [];
  for (const row of stored) {
    const parsed = parsedByRef.get(String(row.external_ref).toLowerCase());
    if (!parsed) {
      counts.notInFile++;
      continue;
    }
    counts.matched++;
    const { size, rent, area } = parsed;
    const u = { id: row.id, date: row.date_updated };
    let changed = false;
    const setNum = (col, value) => {
      if (row[col] === null && value !== null && value !== undefined) {
        u[col] = value;
        counts[col]++;
        changed = true;
      }
    };
    setNum("min_sqft", size.minSqft);
    setNum("max_sqft", size.maxSqft);
    setNum("max_rent", rent.maxRent);
    setNum("max_rent_psf", rent.rentPsf);
    for (const [col, key] of ARRAYS) {
      const merged = union(row[col], area[key]);
      if (merged.length !== (row[col] ?? []).length) {
        u[col] = merged;
        counts[col]++;
        changed = true;
      }
    }
    if (area.anchor) {
      if (row.location_anchor_text !== null || row.location_radius_miles !== null) {
        counts.anchorAlreadySet++;
      } else if (area.anchor.lat === null) {
        counts.anchorNeedsGeocoder++;
      } else {
        u.anchor_text = area.anchor.text;
        u.anchor_lat = area.anchor.lat;
        u.anchor_lng = area.anchor.lng;
        u.anchor_miles = area.anchor.miles;
        counts.anchor++;
        changed = true;
      }
    }
    if (changed) {
      counts.wouldChange++;
      updates.push(u);
    }
  }

  console.log(`stored kato- requirements in the agency: ${counts.stored}`);
  console.log(`  matched to a row in the file: ${counts.matched}   not in the file: ${counts.notInFile}`);
  console.log(`  rows that would change: ${counts.wouldChange}`);
  console.log("  fields that would be added, by field (rows):");
  for (const col of ["min_sqft", "max_sqft", "max_rent", "max_rent_psf", ...ARRAYS.map(([c]) => c)]) {
    console.log(`    ${col}: ${counts[col]}`);
  }
  console.log(`    "within N miles" place (found offline, with coordinates): ${counts.anchor}`);
  console.log(`  "within N miles" needing the geocoder (not written): ${counts.anchorNeedsGeocoder}`);
  console.log(`  "within N miles" skipped, the row already has a place or radius: ${counts.anchorAlreadySet}`);

  if (!apply) {
    console.log("dry run: nothing written. Add --apply to write.");
  } else if (updates.length === 0) {
    console.log("nothing to write.");
  } else {
    await client.query("begin");
    try {
      let written = 0;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const part = updates.slice(i, i + CHUNK);
        const payload = JSON.stringify(
          part.map((u) => ({
            id: u.id,
            min_sqft: u.min_sqft ?? null,
            max_sqft: u.max_sqft ?? null,
            max_rent: u.max_rent ?? null,
            max_rent_psf: u.max_rent_psf ?? null,
            zones: u.target_london_zones ?? null,
            neighbourhoods: u.target_neighbourhoods ?? null,
            towns: u.target_towns ?? null,
            counties: u.target_counties ?? null,
            regions: u.target_regions ?? null,
            districts: u.target_postcode_districts ?? null,
            anchor_text: u.anchor_text ?? null,
            anchor_lat: u.anchor_lat ?? null,
            anchor_lng: u.anchor_lng ?? null,
            anchor_miles: u.anchor_miles ?? null,
          })),
        );
        const res = await client.query(
          `update public.requirements r set
              min_sqft     = coalesce(r.min_sqft, t.min_sqft),
              max_sqft     = coalesce(r.max_sqft, t.max_sqft),
              max_rent     = coalesce(r.max_rent, t.max_rent),
              max_rent_psf = coalesce(r.max_rent_psf, t.max_rent_psf),
              target_london_zones       = coalesce(t.zones, r.target_london_zones),
              target_neighbourhoods     = coalesce(t.neighbourhoods, r.target_neighbourhoods),
              target_towns              = coalesce(t.towns, r.target_towns),
              target_counties           = coalesce(t.counties, r.target_counties),
              target_regions            = coalesce(t.regions, r.target_regions),
              target_postcode_districts = coalesce(t.districts, r.target_postcode_districts),
              location_anchor_text  = case when r.location_anchor_text is null and r.location_radius_miles is null
                                           then t.anchor_text else r.location_anchor_text end,
              location_anchor_lat   = case when r.location_anchor_text is null and r.location_radius_miles is null
                                           then t.anchor_lat else r.location_anchor_lat end,
              location_anchor_lng   = case when r.location_anchor_text is null and r.location_radius_miles is null
                                           then t.anchor_lng else r.location_anchor_lng end,
              location_radius_miles = case when r.location_anchor_text is null and r.location_radius_miles is null
                                           then t.anchor_miles else r.location_radius_miles end
            from jsonb_to_recordset($1::jsonb) as t(
              id uuid, min_sqft numeric, max_sqft numeric, max_rent numeric, max_rent_psf numeric,
              zones text[], neighbourhoods text[], towns text[], counties text[], regions text[],
              districts text[], anchor_text text, anchor_lat double precision,
              anchor_lng double precision, anchor_miles numeric
            )
           where r.id = t.id and r.agency_id = $2`,
          [payload, agencyId],
        );
        written += res.rowCount;
      }
      const ids = updates.map((u) => u.id);
      const dates = updates.map((u) => u.date);
      // Date-only update: the 0044 trigger keeps updated_at and takes this date_updated.
      await client.query(
        `update public.requirements r set date_updated = t.d
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
      console.log(`rows written: ${written}`);
      console.log(`written rows whose date_updated differs from the original: ${bad.rows[0].n}`);
      if (bad.rows[0].n !== 0 || written !== updates.length) {
        throw new Error(
          `check failed (wrote ${written} of ${updates.length}, ${bad.rows[0].n} dates differ): rolled back`,
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
