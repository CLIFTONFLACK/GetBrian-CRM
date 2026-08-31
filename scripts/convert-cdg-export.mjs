/**
 * One-off converter: CDG's exports from their previous system → the admin
 * bulk-importer's template shape.
 *
 * The three source files (companies / contacts / requirements) are Windows-1252
 * exports with foreign column names, a title banner above the requirements
 * header, comma-separated multi-value cells, and free-text sizes and rents.
 * This turns them into UTF-8 CSVs that match `IMPORT_TEMPLATES` exactly.
 *
 * Two decisions worth knowing about:
 *
 *  - Only 18 of the 83 requirement rows name a contact that exists in the
 *    contacts export, and the importer refuses a requirement with no contact.
 *    The remaining 65 carry a name and an email in their own "Tenant" /
 *    "Tenant Email" columns, so those are written to a SEPARATE
 *    `contacts-from-requirements.csv`. It is derived data — import it only if
 *    CDG want those 65 people in the CRM.
 *  - Anything that will not fit a structured column (an "Area" of "Within 3
 *    miles of 34-43 Russell Street", a rent band, a "Retail" use class) is
 *    written verbatim into `notes` rather than dropped.
 *
 * Run:  node scripts/convert-cdg-export.mjs
 * Reads  "Data CSVs/"  →  writes  "Data CSVs/import-ready/"
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "Data CSVs");
const OUT = path.join(SRC, "import-ready");

const SOURCES = {
  companies: "companies-list-1787838466.csv",
  contacts: "contact-list-1787838411.csv",
  requirements: "requirement-list-1787838152.csv",
};

// --- reading -------------------------------------------------------------

/** Mirrors src/lib/csv.ts decodeCsvBytes: strict UTF-8, else Windows-1252. */
function decode(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Mirrors src/lib/csv.ts parseCsv. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const read = (name) => parseCsv(decode(fs.readFileSync(path.join(SRC, name))));

/** Mirrors src/lib/csv.ts toCsv, and writes UTF-8 with a BOM so Excel behaves. */
function writeCsv(file, headers, rows) {
  const esc = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const body = [headers, ...rows].map((r) => r.map((v) => esc(v ?? "")).join(",")).join("\r\n");
  fs.writeFileSync(path.join(OUT, file), "﻿" + body, "utf8");
  return rows.length;
}

// --- vocabularies --------------------------------------------------------

const uk = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/lib/locations/data/uk-location-options.json"), "utf8"),
);
const london = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/lib/locations/data/london-area-options.json"), "utf8"),
);

const lower = (a) => new Map(a.map((v) => [v.toLowerCase(), v]));
const AREAS = lower(london.areas.map((a) => a[0]));
const TOWNS = lower(uk.towns);
const COUNTIES = lower(uk.counties);
const DISTRICTS = new Set(uk.districts.map((d) => d[0].toUpperCase()));

/** The use-class concepts, mirroring src/lib/use-classes.ts USE_CLASS_CONCEPTS. */
const USE_CLASSES = [
  ["Pub", ["pub", "public house", "inn", "tavern"]],
  ["Bar", ["bar", "wine bar", "cocktail bar"]],
  ["Nightclub", ["nightclub", "night club"]],
  ["Hot food takeaway", ["takeaway", "take away", "hot food"]],
  ["Cafe", ["cafe", "coffee", "coffee shop"]],
  ["Gym", ["gym", "fitness", "health club"]],
  ["Leisure", ["leisure", "cinema", "bowling", "soft play", "entertainment"]],
  ["Restaurant", ["restaurant", "dining", "diner"]],
];

/** Mirrors src/lib/text-match.ts wordPad. */
const pad = (s) =>
  ` ${s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
const hasWord = (hay, needle) => pad(hay).includes(pad(needle));

// --- parsers -------------------------------------------------------------

const SQM_TO_SQFT = 10.7639;

/** "1,070 to 1,310 sq ft" → [1070, 1310]; "175 to 275 sq m" → converted. */
function parseSize(cell) {
  const m = /([\d,.]+)\s*(?:to|-|–)\s*([\d,.]+)\s*sq\s*\.?\s*(ft|m)\b/i.exec(cell);
  if (!m) return [null, null, cell.trim() ? cell.trim() : null];
  const n = (v) => Number(v.replace(/,/g, ""));
  const factor = m[3].toLowerCase() === "m" ? SQM_TO_SQFT : 1;
  return [Math.round(n(m[1]) * factor), Math.round(n(m[2]) * factor), null];
}

/**
 * "Up to £120,000" → 120000; "£50,000 - £120,000 per annum" → 120000.
 * max_rent is a ceiling, so the top of a band is the value that belongs in it.
 */
function parseRent(cell) {
  const nums = [...cell.matchAll(/[\d][\d,]*/g)].map((m) => Number(m[0].replace(/,/g, "")));
  const usable = nums.filter((n) => Number.isFinite(n) && n > 0);
  return usable.length ? Math.max(...usable) : null;
}

/** "Cafe (A1), Retail" → { classes: ["Cafe"], unmapped: ["Retail"] }. */
function parseUseClasses(cell) {
  const classes = new Set();
  const unmapped = [];
  for (const token of cell.split(",").map((s) => s.trim()).filter(Boolean)) {
    const hits = USE_CLASSES.filter(([, words]) => words.some((w) => hasWord(token, w)));
    if (hits.length) hits.forEach(([label]) => classes.add(label));
    else unmapped.push(token);
  }
  return { classes: [...classes], unmapped };
}

/**
 * The "Area" column is free text from a search-alert builder: fare zones,
 * neighbourhoods, postcode districts, and radius phrases like "Within 3 miles
 * of 34-43 Russell Street" all share one cell. Classify what the CRM has a
 * column for; everything else is returned so the caller can keep it in notes.
 */
function parseArea(cell) {
  const out = {
    zones: new Set(),
    neighbourhoods: new Set(),
    towns: new Set(),
    counties: new Set(),
    districts: new Set(),
  };
  const leftover = [];

  const classify = (raw) => {
    const t = raw
      .replace(/^within\s+[\d.]+\s+miles?\s+of\s+/i, "")
      .replace(/\(\s*\+\s*[\d.]+\s*miles?\s*\)/i, "")
      .trim()
      .replace(/[.,]$/, "");
    if (!t) return true;
    const zone = /^zone\s*([1-9])$/i.exec(t);
    if (zone) {
      out.zones.add(`Zone ${zone[1]}`);
      return true;
    }
    if (AREAS.has(t.toLowerCase())) {
      out.neighbourhoods.add(AREAS.get(t.toLowerCase()));
      return true;
    }
    if (TOWNS.has(t.toLowerCase())) {
      out.towns.add(TOWNS.get(t.toLowerCase()));
      return true;
    }
    if (COUNTIES.has(t.toLowerCase())) {
      out.counties.add(COUNTIES.get(t.toLowerCase()));
      return true;
    }
    if (/^[a-z]{1,2}\d{1,2}[a-z]?$/i.test(t) && DISTRICTS.has(t.toUpperCase())) {
      out.districts.add(t.toUpperCase());
      return true;
    }
    // "Clapham/Balham/Tooting" is three places in one token; only accept the
    // split when every part lands somewhere, so an address like
    // "34-43 Russell Street/Crown Lane" isn't shredded into halves.
    if (t.includes("/")) {
      const parts = t.split("/").map((p) => p.trim()).filter(Boolean);
      const snapshot = {
        zones: new Set(out.zones),
        neighbourhoods: new Set(out.neighbourhoods),
        towns: new Set(out.towns),
        counties: new Set(out.counties),
        districts: new Set(out.districts),
      };
      if (parts.length > 1 && parts.every((p) => classify(p))) return true;
      Object.assign(out, snapshot);
    }
    return false;
  };

  for (const token of cell.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!classify(token)) leftover.push(token);
  }
  return {
    zones: [...out.zones].sort(),
    neighbourhoods: [...out.neighbourhoods],
    towns: [...out.towns],
    counties: [...out.counties],
    districts: [...out.districts],
    leftover,
  };
}

const TITLES = /^(mr|mrs|ms|miss|dr|prof)\.?$/i;

/**
 * "Loukma limited (Mr Melih Tatli)" → company "Loukma limited", Melih Tatli.
 * "Ms Habibeh Abgoon" → no company, Habibeh Abgoon.
 */
function parseTenant(raw) {
  const s = raw.trim();
  const paren = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(s);
  const company = paren ? paren[1].trim() : "";
  const person = paren ? paren[2].trim() : s;
  const words = person.split(/\s+/).filter(Boolean);
  if (words.length && TITLES.test(words[0])) words.shift();
  return {
    company: company || null,
    firstName: words[0] ?? "",
    lastName: words.slice(1).join(" "),
  };
}

const joinNotes = (...parts) => parts.filter(Boolean).join(" | ");

// --- conversion ----------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true });
const report = [];

// 1. Companies ------------------------------------------------------------
const COMPANY_HEADERS = [
  "name", "type", "sector_tags", "website", "phone",
  "address_line", "city", "postcode", "county", "notes",
];
const companySrc = read(SOURCES.companies).slice(1);
const companyRows = [];
const companySeen = new Map(); // lowercased name → row index

const addCompany = (name, website = "", phone = "", address = ["", "", ""]) => {
  const key = name.trim().toLowerCase();
  if (!key || companySeen.has(key)) return false;
  companySeen.set(key, companyRows.length);
  companyRows.push([
    name.trim(), "", "", website.trim(), phone.trim(),
    address[0], address[1], address[2], "", "",
  ]);
  return true;
};

for (const r of companySrc) {
  addCompany(r[0] ?? "", r[2] ?? "", r[6] ?? "", [r[3] ?? "", r[4] ?? "", r[5] ?? ""]);
}
const fromExport = companyRows.length;

// 2. Contacts -------------------------------------------------------------
const CONTACT_HEADERS = [
  "first_name", "last_name", "email", "phone", "role", "company_name",
  "address_line", "city", "postcode", "county", "marketing_opt_in", "notes",
];
const contactSrc = read(SOURCES.contacts).slice(1);
const contactRows = [];
const emailSeen = new Set();

for (const r of contactSrc) {
  const [first, surname, email, company, phone, mobile, news, alerts] = r.map((v) =>
    (v ?? "").trim(),
  );
  if (!first) continue;
  const key = email.toLowerCase();
  if (key && emailSeen.has(key)) continue;
  if (key) emailSeen.add(key);
  if (company) addCompany(company);
  const optIn = /^yes$/i.test(news) || /^yes$/i.test(alerts);
  // Both numbers are kept: the spare one goes to notes rather than being lost.
  const primary = phone || mobile;
  const spare = phone && mobile && phone !== mobile ? `Mobile: ${mobile}` : "";
  contactRows.push([
    first, surname, email, primary, "", company,
    "", "", "", "", optIn ? "true" : "false", spare,
  ]);
}

// 3. Requirements ---------------------------------------------------------
const REQUIREMENT_HEADERS = [
  "title", "contact_email", "status", "target_london_zones", "target_neighbourhoods",
  "target_towns", "target_counties", "target_regions", "target_postcode_districts",
  "use_classes", "tenure_prefs", "min_sqft", "max_sqft", "min_covers", "max_covers",
  "max_rent", "max_premium", "max_guide_price", "notes",
];
const reqRows = read(SOURCES.requirements);
// Skip the "Requirements" banner and the real header row beneath it.
const reqHeaderRow = reqRows.findIndex((r) => /^tenant$/i.test((r[0] ?? "").trim()));
if (reqHeaderRow < 0) throw new Error("requirements export: no 'Tenant' header row found");
const reqSrc = reqRows.slice(reqHeaderRow + 1);

const requirementRows = [];
const derivedContacts = [];
const derivedSeen = new Set();
const skippedRequirements = [];

for (const r of reqSrc) {
  const [tenant, size, propertyType, rent, area, email] = r.map((v) => (v ?? "").trim());
  if (!tenant) continue;
  if (!email) {
    skippedRequirements.push(`${tenant} — no Tenant Email`);
    continue;
  }
  const who = parseTenant(tenant);
  const key = email.toLowerCase();

  // Any tenant with no row in the contacts export becomes a derived contact,
  // otherwise the importer rejects the requirement for having no contact.
  if (!emailSeen.has(key) && !derivedSeen.has(key)) {
    derivedSeen.add(key);
    if (who.company) addCompany(who.company);
    derivedContacts.push([
      who.firstName || tenant, who.lastName, email, "", "", who.company ?? "",
      "", "", "", "", "false", "Created from the requirements export",
    ]);
  }

  const [minSqft, maxSqft, sizeLeftover] = parseSize(size);
  const { classes, unmapped } = parseUseClasses(propertyType);
  const loc = parseArea(area);
  const maxRent = parseRent(rent);

  requirementRows.push([
    tenant,
    email,
    "active",
    loc.zones.join(";"),
    loc.neighbourhoods.join(";"),
    loc.towns.join(";"),
    loc.counties.join(";"),
    "",
    loc.districts.join(";"),
    classes.join(";"),
    "",
    minSqft ?? "",
    maxSqft ?? "",
    "",
    "",
    maxRent ?? "",
    "",
    "",
    joinNotes(
      loc.leftover.length ? `Area (as exported): ${area}` : "",
      unmapped.length ? `Use classes not in the CRM list: ${unmapped.join(", ")}` : "",
      rent ? `Rent (as exported): ${rent}` : "",
      sizeLeftover ? `Size (as exported): ${sizeLeftover}` : "",
    ),
  ]);
}

// --- write ---------------------------------------------------------------

report.push(`companies-import.csv          ${writeCsv("companies-import.csv", COMPANY_HEADERS, companyRows)} rows` +
  ` (${fromExport} from the companies export, ${companyRows.length - fromExport} referenced by contacts/requirements)`);
report.push(`contacts-import.csv           ${writeCsv("contacts-import.csv", CONTACT_HEADERS, contactRows)} rows`);
report.push(`contacts-from-requirements.csv ${writeCsv("contacts-from-requirements.csv", CONTACT_HEADERS, derivedContacts)} rows (derived — optional)`);
report.push(`requirements-import.csv       ${writeCsv("requirements-import.csv", REQUIREMENT_HEADERS, requirementRows)} rows`);

console.log(report.join("\n"));
if (skippedRequirements.length)
  console.log(`\nRequirements skipped (${skippedRequirements.length}): ${skippedRequirements.join("; ")}`);

// A quick shape check so a silent mis-map can't pass as success.
const zoneCount = requirementRows.filter((r) => r[3]).length;
const areaCount = requirementRows.filter((r) => r[4] || r[5] || r[8]).length;
const sizeCount = requirementRows.filter((r) => r[11] && r[12]).length;
const rentCount = requirementRows.filter((r) => r[15]).length;
const ucCount = requirementRows.filter((r) => r[9]).length;
console.log(
  `\nRequirements coverage: ${sizeCount}/${requirementRows.length} sizes, ` +
    `${ucCount} use classes, ${zoneCount} zoned, ${areaCount} with a mapped area, ${rentCount} rents.`,
);
