/**
 * Profile an export (.xlsx, .xls or .csv) with the importer's own parsing layer
 * and print AGGREGATE COUNTS ONLY: no database, no rows, no personal data.
 *
 *   node scripts/kato-dry-run.mjs <file> [<file> ...]
 *
 * Each file's kind (companies / contacts / requirements) is worked out from its
 * headers. Node strips the TypeScript types itself, so this loads the real
 * modules in src/lib: nothing is re-implemented here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import { decodeCsvBytes, mapHeaders, parseCsv } from "../src/lib/csv.ts";
import {
  buildLocationCatalog,
  hasLetterOrDigit,
  legacyRowRef,
  parseArea,
  parseBool,
  parseRent,
  parseSize,
  parseSourceDate,
  parseTenant,
} from "../src/lib/import-parse.ts";
import { workbookToRows } from "../src/lib/xlsx-rows.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const uk = readJson("src/lib/locations/data/uk-location-options.json");
const london = readJson("src/lib/locations/data/london-area-options.json");
const catalog = buildLocationCatalog({
  neighbourhoods: london.areas.map((a) => a[0]),
  towns: uk.towns,
  counties: uk.counties,
  regions: uk.regions,
  districts: uk.districts.map((d) => d[0]),
});

const bump = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const show = (title, m, limit = 50) => {
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  console.log(`  ${title}:`);
  if (rows.length === 0) console.log("    (none)");
  for (const [k, v] of rows) console.log(`    ${String(v).padStart(5)}  ${k}`);
};
const nines = (s) => s.replace(/\d/g, "9");

function loadRows(file) {
  const bytes = fs.readFileSync(file);
  if (/\.xlsx?$/i.test(file)) {
    const { rows, warnings } = workbookToRows(XLSX, new Uint8Array(bytes));
    for (const w of warnings) console.log(`  WARNING: ${w}`);
    return rows;
  }
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseCsv(decodeCsvBytes(ab));
}

function detectEntity(rows) {
  let best = null;
  for (const entity of ["companies", "contacts", "requirements"]) {
    const h = mapHeaders(entity, rows);
    const score = h.columns.size - h.unrecognised.length * 0.01;
    if (!best || score > best.score) best = { entity, score, header: h };
  }
  return best;
}

function profileDates(rows, header, get) {
  const dates = { ok: 0, failed: 0, empty: 0 };
  const failShapes = new Map();
  for (const r of rows) {
    const raw = get(r, "date_updated");
    const d = parseSourceDate(raw);
    if (d.kind === "ok") dates.ok++;
    else if (d.kind === "empty") dates.empty++;
    else {
      dates.failed++;
      bump(failShapes, nines(raw));
    }
  }
  console.log(`  date_updated: parsed ${dates.ok}, failed ${dates.failed}, empty ${dates.empty}`);
  if (dates.failed) show("failing date shapes", failShapes, 10);
}

for (const file of process.argv.slice(2)) {
  const all = loadRows(file);
  const { entity, header } = detectEntity(all);
  const data = all.slice(header.headerRow + 1);
  const get = (r, name) => {
    for (const i of header.columns.get(name) ?? []) {
      const v = (r[i] ?? "").trim();
      if (v) return v;
    }
    return "";
  };
  console.log(`\n== ${path.basename(file).replace(/\d{6,}/, "N")}  (${entity})`);
  console.log(`  rows read: ${data.length}   header row index: ${header.headerRow}`);
  console.log(`  columns placed: ${[...header.columns.keys()].join(", ")}`);
  console.log(`  unrecognised headers: ${header.unrecognised.length ? header.unrecognised.join(", ") : "(none)"}`);
  profileDates(data, header, get);

  if (entity === "companies") {
    const placeholders = data.filter((r) => !hasLetterOrDigit(get(r, "name"))).length;
    console.log(`  names with no letter or digit (would be skipped): ${placeholders}`);
    const names = new Map();
    for (const r of data) bump(names, get(r, "name").trim().toLowerCase());
    console.log(`  duplicate company names within the file: ${[...names.values()].filter((n) => n > 1).length}`);
    const tokens = new Map();
    let multi = 0;
    for (const r of data) {
      const cell = get(r, "type");
      if (!cell) continue;
      const parts = cell.split(cell.includes(";") ? ";" : ",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) multi++;
      for (const p of parts) bump(tokens, p);
    }
    console.log(`  company type cells with more than one value: ${multi}`);
    show("company type values (top 20)", tokens, 20);
  }

  if (entity === "contacts") {
    let noFirst = 0, withEmail = 0, mobileOnly = 0, both = 0, newsYes = 0, alertsYes = 0, boolBad = 0;
    const emails = new Map();
    for (const r of data) {
      if (!get(r, "first_name")) noFirst++;
      const e = get(r, "email").toLowerCase();
      if (e) {
        withEmail++;
        bump(emails, e);
      }
      const phone = get(r, "phone");
      const mobile = get(r, "mobile");
      if (mobile && !phone) mobileOnly++;
      if (mobile && phone) both++;
      for (const [col, isNews] of [["marketing_opt_in", true], ["marketing_property_alerts", false]]) {
        const v = parseBool(get(r, col));
        if (v === true && isNews) newsYes++;
        if (v === true && !isNews) alertsYes++;
        if (v === "invalid") boolBad++;
      }
    }
    console.log(`  rows with no first name: ${noFirst}   with email: ${withEmail}   duplicate emails in file: ${[...emails.values()].filter((n) => n > 1).length}`);
    console.log(`  mobile only (phone stays empty): ${mobileOnly}   phone and mobile: ${both}`);
    console.log(`  marketing latest news = yes: ${newsYes}   property alerts = yes: ${alertsYes}   unreadable yes/no: ${boolBad}`);
  }

  if (entity === "requirements") {
    const sizeKinds = new Map(), sizeFail = new Map(), rentKinds = new Map();
    const placed = new Map(), unplaced = new Map(), tenantShapes = new Map();
    let sqm = 0, swapped = 0, noEmail = 0, areaNoteRows = 0, unplacedTokens = 0, partialTokens = 0, unknownNoEmail = 0;
    const refs = new Map();
    const identities = new Map();
    for (const r of data) {
      const size = parseSize(get(r, "size_text"));
      bump(sizeKinds, size.kind);
      if (size.kind === "unparsed") bump(sizeFail, size.shape);
      if (size.swapped) swapped++;
      if (/sq\.?\s*m|sqm|m2/i.test(get(r, "size_text"))) sqm++;
      bump(rentKinds, parseRent(get(r, "rent_text")).outcome);
      const area = parseArea(get(r, "area_text"), catalog);
      for (const [k, v] of Object.entries(area.placed)) if (v) bump(placed, k, v);
      for (const t of area.unplaced) {
        unplacedTokens++;
        bump(unplaced, t);
      }
      partialTokens += area.partial.length;
      if (area.note) areaNoteRows++;
      const tenant = parseTenant(get(r, "title"));
      bump(tenantShapes, tenant.shape);
      const email = get(r, "contact_email");
      if (!email) {
        noEmail++;
        if (tenant.shape === "unknown") unknownNoEmail++;
      }
      const ref = legacyRowRef({
          title: get(r, "title"),
          size: get(r, "size_text"),
          propertyType: get(r, "use_classes"),
          rent: get(r, "rent_text"),
          area: get(r, "area_text"),
          email: get(r, "contact_email"),
      });
      bump(refs, ref);
      const who = `${get(r, "title").trim().toLowerCase()}|${get(r, "contact_email").trim().toLowerCase()}`;
      if (refs.get(ref) === 1) bump(identities, who);
    }
    console.log(`  size kinds: ${[...sizeKinds].map(([k, v]) => `${k}=${v}`).join(", ")}   in sq m: ${sqm}   reversed ranges: ${swapped}`);
    if (sizeFail.size) show("size shapes that failed (digits as 9)", sizeFail, 20);
    else console.log("  size shapes that failed: (none)");
    console.log(`  rent outcomes: ${[...rentKinds].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  area tokens placed, by kind: ${[...placed].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  area tokens unplaced: ${unplacedTokens} (${unplaced.size} distinct)   placed in part (text also kept): ${partialTokens}   rows with area text in notes: ${areaNoteRows}`);
    show("top unplaced area tokens", unplaced, 30);
    console.log(`  tenant shapes: ${[...tenantShapes].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    const distinct = refs.size;
    console.log(`  distinct stable references: ${distinct}   duplicate rows collapsed: ${data.length - distinct}`);
    const sharedIdentity = [...identities.values()].filter((n) => n > 1).length;
    console.log(`  distinct tenant+email pairs shared by more than one distinct row (would be ambiguous when matching changed rows): ${sharedIdentity}`);
    console.log(`  rows with no email: ${noEmail}   of which tenant "Unknown": ${unknownNoEmail}`);
  }
}
