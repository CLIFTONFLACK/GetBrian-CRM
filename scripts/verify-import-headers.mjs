/**
 * Checks the bulk importer's header/encoding layer against the real thing:
 * it imports src/lib/csv.ts itself (no reimplementation) and runs it over
 * CDG's actual exports in "Data CSVs/".
 *
 * Every assertion here is paired with a control that must FAIL — the previous
 * behaviour, or a deliberately broken input. A check that cannot go red proves
 * nothing, so the run prints both columns and exits non-zero if a control
 * unexpectedly passes.
 *
 * Run:  node scripts/verify-import-headers.mjs
 */

import fs from "node:fs";
import path from "node:path";

import {
  decodeCsvBytes,
  IMPORT_TEMPLATES,
  mapHeaders,
  parseCsv,
  REQUIRED_COLUMNS,
  splitList,
} from "../src/lib/csv.ts";

const SRC = path.join(process.cwd(), "Data CSVs");
const READY = path.join(SRC, "import-ready");

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
/** Asserts the check still discriminates: `cond` must be FALSE. */
const control = (name, cond) => {
  if (cond) failed++;
  console.log(`${cond ? "  BROKEN" : "  red  "}  control: ${name}`);
};

const bytes = (p) => fs.readFileSync(p);
const rowsOf = (p) => parseCsv(decodeCsvBytes(bytes(p)));

const ORIGINALS = {
  companies: path.join(SRC, "companies-list-1787838466.csv"),
  contacts: path.join(SRC, "contact-list-1787838411.csv"),
  requirements: path.join(SRC, "requirement-list-1787838152.csv"),
};
const CONVERTED = {
  companies: path.join(READY, "companies-import.csv"),
  contacts: path.join(READY, "contacts-import.csv"),
  requirements: path.join(READY, "requirements-import.csv"),
};

// --- 1. Encoding ---------------------------------------------------------
console.log("\n1. Windows-1252 exports decode to the right characters");
{
  const raw = bytes(ORIGINALS.companies);
  const good = decodeCsvBytes(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  ok("curly apostrophe survives", good.includes("Lyon’s restaurants"));
  ok("no replacement characters", !good.includes("�"));
  // The old path: Blob.text() / TextDecoder utf-8, non-fatal.
  const oldWay = new TextDecoder("utf-8").decode(raw);
  control("old UTF-8-only decode is clean", !oldWay.includes("�"));

  const reqRaw = bytes(ORIGINALS.requirements);
  const reqGood = decodeCsvBytes(
    reqRaw.buffer.slice(reqRaw.byteOffset, reqRaw.byteOffset + reqRaw.length),
  );
  ok("pound signs survive", reqGood.includes("£120,000"));
  control(
    "old decode kept the pound sign",
    new TextDecoder("utf-8").decode(reqRaw).includes("£120,000"),
  );
}

// --- 2. The reported bug: headers on the originals ------------------------
console.log("\n2. The client's own exports now resolve their required columns");
for (const [entity, file] of Object.entries(ORIGINALS)) {
  const rows = rowsOf(file);
  const { columns, headerRow, unrecognised } = mapHeaders(entity, rows);
  const missing = REQUIRED_COLUMNS[entity].filter((c) => !columns.has(c));
  ok(
    `${entity}: required columns present`,
    missing.length === 0,
    `header row ${headerRow + 1}, ${columns.size} columns mapped, ` +
      `${rows.length - headerRow - 1} data rows` +
      (unrecognised.length ? `, ignored: ${unrecognised.join(", ")}` : ""),
  );
  // Old behaviour: exact match against row 0, lowercased only. Companies is
  // the case that made a "did it fail?" control useless — "Name" matched, so
  // the old path reported success while quietly dropping five columns. The
  // control that discriminates for every entity is how much it mapped.
  const oldHeader = rows[0].map((h) => h.trim().toLowerCase());
  const oldMapped = new Set(
    Object.values(IMPORT_TEMPLATES[entity].headers).filter((c) => oldHeader.includes(c)),
  );
  control(
    `${entity}: old exact-match mapped as many columns (${oldMapped.size} vs ${columns.size})`,
    oldMapped.size >= columns.size,
  );
  if (entity !== "companies") {
    const oldMissing = REQUIRED_COLUMNS[entity].filter((c) => oldHeader.indexOf(c) < 0);
    control(`${entity}: old exact-match found the required columns`, oldMissing.length === 0);
  }
}
{
  const rows = rowsOf(ORIGINALS.requirements);
  ok(
    "requirements: title banner skipped",
    mapHeaders("requirements", rows).headerRow === 1,
    `row 1 is ${JSON.stringify(rows[0].filter(Boolean))}`,
  );
  const rows2 = rowsOf(ORIGINALS.contacts);
  const { columns } = mapHeaders("contacts", rows2);
  ok(
    'contacts: "Phone Number" and "Mobile Number" both feed phone',
    (columns.get("phone") ?? []).length === 2,
    `indices ${JSON.stringify(columns.get("phone"))}`,
  );
}

// --- 3. Converted files ---------------------------------------------------
console.log("\n3. Converted files map cleanly");
for (const [entity, file] of Object.entries(CONVERTED)) {
  if (!fs.existsSync(file)) {
    ok(`${entity}: converted file exists`, false, file);
    continue;
  }
  const rows = rowsOf(file);
  const { columns, headerRow, unrecognised } = mapHeaders(entity, rows);
  const missing = REQUIRED_COLUMNS[entity].filter((c) => !columns.has(c));
  ok(
    `${entity}: no missing or unrecognised columns`,
    missing.length === 0 && unrecognised.length === 0 && headerRow === 0,
    `${rows.length - 1} data rows` +
      (missing.length ? `, MISSING ${missing.join(", ")}` : "") +
      (unrecognised.length ? `, UNRECOGNISED ${unrecognised.join(", ")}` : ""),
  );
}

// --- 4. Every requirement has a contact behind it ------------------------
console.log("\n4. Import order actually satisfies the contact requirement");
{
  const contactEmails = new Set();
  for (const f of ["contacts-import.csv", "contacts-from-requirements.csv"]) {
    const rows = rowsOf(path.join(READY, f));
    const { columns, headerRow } = mapHeaders("contacts", rows);
    const at = columns.get("email")?.[0];
    for (const r of rows.slice(headerRow + 1)) {
      const e = (r[at] ?? "").trim().toLowerCase();
      if (e) contactEmails.add(e);
    }
  }
  const reqRows = rowsOf(CONVERTED.requirements);
  const { columns, headerRow } = mapHeaders("requirements", reqRows);
  const at = columns.get("contact_email")[0];
  const emails = reqRows.slice(headerRow + 1).map((r) => (r[at] ?? "").trim().toLowerCase());
  const orphans = emails.filter((e) => !contactEmails.has(e));
  ok(
    "all requirement rows resolve to a contact",
    orphans.length === 0,
    `${emails.length} rows against ${contactEmails.size} contacts` +
      (orphans.length ? `, orphans: ${[...new Set(orphans)].slice(0, 5).join(", ")}` : ""),
  );

  // Control: contacts-import.csv ALONE must not be enough — that was the
  // finding that made the derived file necessary.
  const primaryOnly = new Set();
  const rows = rowsOf(path.join(READY, "contacts-import.csv"));
  const h = mapHeaders("contacts", rows);
  for (const r of rows.slice(h.headerRow + 1)) {
    const e = (r[h.columns.get("email")[0]] ?? "").trim().toLowerCase();
    if (e) primaryOnly.add(e);
  }
  control(
    "the exported contacts alone cover every requirement",
    emails.every((e) => primaryOnly.has(e)),
  );
}

// --- 4b. Cross-file integrity --------------------------------------------
console.log("\n4b. Cross-file integrity of the converted set");
{
  const cellsOf = (file, entity, col) => {
    const rows = rowsOf(path.join(READY, file));
    const h = mapHeaders(entity, rows);
    const at = h.columns.get(col)?.[0];
    return at === undefined ? [] : rows.slice(h.headerRow + 1).map((r) => (r[at] ?? "").trim());
  };

  const companies = new Set(
    cellsOf("companies-import.csv", "companies", "name").map((n) => n.toLowerCase()),
  );
  const linked = [
    ...cellsOf("contacts-import.csv", "contacts", "company_name"),
    ...cellsOf("contacts-from-requirements.csv", "contacts", "company_name"),
  ].filter(Boolean);
  const unlinked = [...new Set(linked.filter((n) => !companies.has(n.toLowerCase())))];
  // Not fatal to the import — the action creates a stub company for an unknown
  // name — but a stub means the company's own row never gets its details.
  ok(
    "every contact's company_name has a row in companies-import.csv",
    unlinked.length === 0,
    `${companies.size} companies` + (unlinked.length ? `, unlinked: ${unlinked.join(", ")}` : ""),
  );

  const emails = [
    ...cellsOf("contacts-import.csv", "contacts", "email"),
    ...cellsOf("contacts-from-requirements.csv", "contacts", "email"),
  ]
    .filter(Boolean)
    .map((e) => e.toLowerCase());
  const dupes = emails.filter((e, i) => emails.indexOf(e) !== i);
  ok("no email appears in both contact files", dupes.length === 0, `${emails.length} emails`);

  const blankNames = [
    ...cellsOf("contacts-import.csv", "contacts", "first_name"),
    ...cellsOf("contacts-from-requirements.csv", "contacts", "first_name"),
  ].filter((n) => !n);
  ok("no contact row has a blank first_name", blankNames.length === 0);

  // The apostrophe is the one that broke: a company named with U+2019 in one
  // file and U+FFFD in the other would never link.
  ok(
    "the curly apostrophe matches across files",
    companies.has("lyon\u2019s restaurants") &&
      linked.some((n) => n === "Lyon\u2019s restaurants"),
  );
  control(
    "a replacement character survived into the converted set",
    [...companies, ...linked].some((n) => n.includes("\ufffd")),
  );
}

// --- 5. Multi-value splitting --------------------------------------------
console.log("\n5. Multi-value cells");
ok('";" wins when present', JSON.stringify(splitList("Zone 1;Zone 2")) === '["Zone 1","Zone 2"]');
ok('"," is the fallback', JSON.stringify(splitList("Bar, Pub")) === '["Bar","Pub"]');
ok(
  "a comma inside a ;-separated cell is not shredded",
  JSON.stringify(splitList("Peek House, 20 Eastcheap;Soho")) ===
    '["Peek House, 20 Eastcheap","Soho"]',
);

// --- 6. A genuinely broken file is still rejected -------------------------
console.log("\n6. A file with no usable header is still refused");
{
  const junk = parseCsv("colour,shape,size\nred,round,big\n");
  const { columns } = mapHeaders("contacts", junk);
  const missing = REQUIRED_COLUMNS.contacts.filter((c) => !columns.has(c));
  ok("unrelated CSV reports the missing column", missing.length > 0, `missing: ${missing}`);
  control("unrelated CSV somehow passed", missing.length === 0);
}

console.log(
  failed === 0
    ? "\nAll checks passed and every control went red.\n"
    : `\n${failed} problem(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);
