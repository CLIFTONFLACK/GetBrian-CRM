/**
 * Checks the bulk importer's de-duplication rules against the real thing: it
 * imports src/lib/import-matching.ts and src/lib/requirement-rules.ts directly
 * (no reimplementation) and exercises the decisions those modules make.
 *
 * Follows the same discipline as verify-import-headers.mjs: every assertion is
 * paired with a control that must FAIL — usually the behaviour before this
 * change. A check that cannot go red proves nothing, so the run prints both
 * columns and exits non-zero if a control unexpectedly passes.
 *
 * SCOPE — read this before trusting a green run. These are the *decision*
 * rules: which existing record a row refers to, and how repeated rows in one
 * file combine. The four UPDATE statements that carry those decisions out
 * (src/lib/db/queries/import.ts) are NOT covered — they need a live Postgres,
 * and there is none in this environment. Their blank-preserving behaviour rests
 * on `coalesce($value, column)` and is unexercised until run against a database.
 *
 * Run:  node scripts/verify-import-upsert.mjs
 */

import {
  companyFileKey,
  contactNameKey,
  matchCompanyId,
  mergePatch,
  normaliseKey,
} from "../src/lib/import-matching.ts";
import { requirementLinkError } from "../src/lib/requirement-rules.ts";

let failures = 0;
let controlsThatShouldHaveFailed = 0;

function pass(name, detail = "") {
  console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  failures++;
  console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
}
function check(name, fn, detail = "") {
  let ok = false;
  try {
    ok = fn() === true;
  } catch (e) {
    ok = false;
    detail = `threw: ${e.message}`;
  }
  if (ok) pass(name, detail);
  else fail(name, detail);
}
/** The paired control: this MUST be false, or the check above proves nothing. */
function control(name, fn) {
  let ok = false;
  try {
    ok = fn() === true;
  } catch {
    ok = false;
  }
  if (ok) {
    controlsThatShouldHaveFailed++;
    console.log(`  !!    control UNEXPECTEDLY PASSED: ${name}`);
  } else {
    console.log(`  red    control: ${name}`);
  }
}

console.log("\n1. normaliseKey — matching ignores case and surrounding space");
check("case-insensitive", () => normaliseKey("ABC Ltd") === normaliseKey("abc ltd"));
check("whitespace-insensitive", () => normaliseKey("  ABC Ltd  ") === "abc ltd");
control(
  "the old lookup key (raw .toLowerCase(), no trim) matched a padded name",
  // The pre-existing bug: listCompanyNameMap keyed on name.trim().toLowerCase()
  // but the importer looked up name.toLowerCase(), so a padded cell missed.
  () => "  abc ltd  ".toLowerCase() === "abc ltd",
);

console.log("\n2. matchCompanyId — CRN beats name, name is the fallback");
const byNumber = new Map([["09876543", "id-crn"]]);
const byName = new Map([["riverside taverns ltd", "id-name"]]);

check("CRN wins when both match", () =>
  matchCompanyId("09876543", "Riverside Taverns Ltd", byNumber, byName) === "id-crn",
);
check("falls back to name when no CRN supplied", () =>
  matchCompanyId("", "Riverside Taverns Ltd", byNumber, byName) === "id-name",
);
check("falls back to name when the CRN is unknown", () =>
  matchCompanyId("00000000", "Riverside Taverns Ltd", byNumber, byName) === "id-name",
);
check("a renamed company is still matched by its CRN", () =>
  matchCompanyId("09876543", "Riverside Taverns Limited", byNumber, byName) === "id-crn",
);
check("genuinely new company matches nothing", () =>
  matchCompanyId("", "Brand New Bars Ltd", byNumber, byName) === null,
);
check("matching is case-insensitive on both keys", () =>
  matchCompanyId("", "RIVERSIDE TAVERNS LTD", byNumber, byName) === "id-name",
);
control(
  "name-only matching (the old rule) also caught the renamed company",
  () => (byName.get(normaliseKey("Riverside Taverns Limited")) ?? null) !== null,
);

console.log("\n3. companyFileKey — repeated rows in one file resolve together");
check("an existing record's id is the key", () =>
  companyFileKey("id-name", "09876543", "Riverside Taverns Ltd") === "id-name",
);
check("two rows for one existing company share a key", () =>
  companyFileKey("id-name", "09876543", "Riverside Taverns Ltd") ===
  companyFileKey("id-name", "", "riverside taverns ltd"),
);
check("two rows for the same NEW company share a key (by CRN)", () =>
  companyFileKey(null, "12345678", "New Co") === companyFileKey(null, "12345678", "New Co Ltd"),
);
check("two rows for the same NEW company share a key (by name)", () =>
  companyFileKey(null, "", "New Co") === companyFileKey(null, "", "  NEW CO  "),
);
check("different new companies get different keys", () =>
  companyFileKey(null, "", "New Co") !== companyFileKey(null, "", "Other Co"),
);

console.log("\n4. mergePatch — blanks never clobber, later supplied values win");
{
  const first = { name: "ABC", phone: "0207 111", website: null, notes: "from row 1" };
  const second = { name: "ABC", phone: null, website: "abc.co.uk", notes: "from row 2" };
  mergePatch(first, second);
  check("a null in the later row leaves the earlier value", () => first.phone === "0207 111");
  check("a value in the later row fills an earlier null", () => first.website === "abc.co.uk");
  check("later supplied value wins over earlier", () => first.notes === "from row 2");
  control(
    "a plain object spread (the naive merge) preserved the earlier phone",
    () => ({ ...first, ...second }).phone === "0207 111",
  );
}
{
  // marketing_opt_in must never be silently turned OFF by a blank cell.
  const stored = { marketingOptIn: true };
  mergePatch(stored, { marketingOptIn: null });
  check("a blank marketing cell cannot opt someone out", () => stored.marketingOptIn === true);
  const optIn = { marketingOptIn: null };
  mergePatch(optIn, { marketingOptIn: true });
  check("an explicit yes still opts someone in", () => optIn.marketingOptIn === true);
}

console.log("\n5. contactNameKey — the email-less fallback");
check("same person, same company → same key", () =>
  contactNameKey("James", "Hartley", "co-1") === contactNameKey(" james ", "HARTLEY", "co-1"),
);
check("same name at a different company → different key", () =>
  contactNameKey("James", "Hartley", "co-1") !== contactNameKey("James", "Hartley", "co-2"),
);
check("same name with no company → still distinct from one with a company", () =>
  contactNameKey("James", "Hartley", null) !== contactNameKey("James", "Hartley", "co-1"),
);
check("a missing surname doesn't collide with a different surname", () =>
  contactNameKey("James", null, "co-1") !== contactNameKey("James", "Hartley", "co-1"),
);
control(
  "keying on the name alone (ignoring company) told the two Jameses apart",
  () => "james|hartley" !== "james|hartley",
);

console.log("\n6. requirementLinkError — a CSV can't create what the form rejects");
check("company only is accepted", () =>
  requirementLinkError({ title: "Bar", companyId: "c1", contactId: null }) === null,
);
check("contact only is accepted", () =>
  requirementLinkError({ title: "Bar", companyId: null, contactId: "p1" }) === null,
);
check("both is accepted", () =>
  requirementLinkError({ title: "Bar", companyId: "c1", contactId: "p1" }) === null,
);
check("neither is refused", () =>
  requirementLinkError({ title: "Bar", companyId: null, contactId: null }) !== null,
);
check("a missing title is refused", () =>
  requirementLinkError({ title: "", companyId: "c1", contactId: null }) !== null,
);
control(
  "the old rule (contact mandatory) also accepted a company-only requirement",
  () => {
    const data = { title: "Bar", companyId: "c1", contactId: null };
    return Boolean(data.title) && Boolean(data.contactId);
  },
);

console.log("\n" + "-".repeat(70));
if (failures === 0 && controlsThatShouldHaveFailed === 0) {
  console.log("All checks passed and every control went red.");
  console.log(
    "NOT covered: the UPDATE statements in src/lib/db/queries/import.ts —\n" +
      "they need a live Postgres. Blank preservation is unexercised here.",
  );
  process.exit(0);
}
console.log(
  `FAILED: ${failures} check(s) failed, ${controlsThatShouldHaveFailed} control(s) wrongly passed.`,
);
process.exit(1);
