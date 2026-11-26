import test from "node:test";
import assert from "node:assert/strict";

import { fieldFor, isIsoDate, parseField, type FieldDef } from "../panel-fields/types.ts";
import { LISTING_FIELDS, LISTING_STATUSES } from "../panel-fields/listing.ts";
import { REQUIREMENT_CHOICES, REQUIREMENT_FIELDS } from "../panel-fields/requirement.ts";
import { buildPatchSql } from "../db/queries/patch-sql.ts";

const field = (reg: Record<string, FieldDef>, key: string): FieldDef => {
  const def = fieldFor(reg, key);
  assert.ok(def, `no field ${key}`);
  return def;
};

test("number: pound signs, commas and spaces are read, the value is a number", () => {
  const rent = field(LISTING_FIELDS, "rent_pa");
  assert.deepEqual(parseField(rent, "£95,000"), { ok: true, value: 95000 });
  assert.deepEqual(parseField(rent, " 1 250.5 "), { ok: true, value: 1250.5 });
  assert.deepEqual(parseField(rent, ""), { ok: true, value: null });
});

test("number: rejects text, negatives and values above the limit", () => {
  const rent = field(LISTING_FIELDS, "rent_pa");
  for (const bad of ["abc", "-5", "1e12", "12,3,4x", "NaN", "Infinity"]) {
    assert.equal(parseField(rent, bad).ok, false, bad);
  }
});

test("number: whole-number fields refuse a fraction, and ranges are enforced", () => {
  const covers = field(LISTING_FIELDS, "covers_internal");
  assert.equal(parseField(covers, "40").ok, true);
  assert.equal(parseField(covers, "40.5").ok, false);
  const year = field(LISTING_FIELDS, "next_rent_review");
  assert.equal(parseField(year, "2030").ok, true);
  assert.equal(parseField(year, "30").ok, false);
  const psf = field(REQUIREMENT_FIELDS, "max_rent_psf");
  assert.equal(parseField(psf, "0").ok, false);
  assert.equal(parseField(psf, "25.5").ok, true);
  assert.equal(parseField(psf, "100000").ok, false);
});

test("date: a real calendar date only", () => {
  const expiry = field(LISTING_FIELDS, "lease_expiry");
  assert.deepEqual(parseField(expiry, "2031-06-30"), { ok: true, value: "2031-06-30" });
  for (const bad of ["2031-02-30", "30/06/2031", "2031-6-3", "tomorrow"]) {
    assert.equal(parseField(expiry, bad).ok, false, bad);
  }
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2025-02-29"), false);
});

test("select: only listed values; an optional select may be cleared; a required one may not", () => {
  const status = field(LISTING_FIELDS, "status");
  assert.deepEqual(parseField(status, "Under Offer"), { ok: true, value: "Under Offer" });
  assert.equal(parseField(status, "Banana").ok, false);
  assert.deepEqual(parseField(status, ""), { ok: true, value: null });
  const type = field(LISTING_FIELDS, "disposal_type");
  assert.equal(parseField(type, "").ok, false);
  assert.equal(parseField(type, "new_lease").ok, true);
  assert.equal(parseField(field(REQUIREMENT_FIELDS, "status"), "").ok, false);
});

test("multi: a list of listed values, de-duplicated; unknown values are refused", () => {
  const tenure = field(REQUIREMENT_CHOICES, "tenure_prefs");
  assert.deepEqual(parseField(tenure, ["leasehold", "freehold", "leasehold"]), {
    ok: true,
    value: ["leasehold", "freehold"],
  });
  assert.deepEqual(parseField(tenure, []), { ok: true, value: [] });
  assert.equal(parseField(tenure, ["leasehold", "timeshare"]).ok, false);
});

test("requirement use classes: the picker list only, not the retired planning classes", () => {
  const use = field(REQUIREMENT_CHOICES, "use_classes");
  assert.equal(parseField(use, ["pub", "restaurant"]).ok, true);
  for (const retired of ["E", "A3", "A4", "A5"]) {
    assert.equal(parseField(use, [retired]).ok, false, retired);
  }
});

test("the listing status list is the five the screens drive", () => {
  assert.deepEqual([...LISTING_STATUSES], ["Available", "Under Offer", "Let", "Sold", "Withdrawn"]);
});

test("registry columns never include ids, tenant, coordinates, source or lock columns", () => {
  const banned = new Set([
    "id",
    "agency_id",
    "lat",
    "lng",
    "updated_at",
    "created_at",
    "created_by",
    "source",
    "source_ref",
    "lead_agent_id",
    "company_id",
    "contact_id",
    "rent_raw",
    "premium_raw",
    "images",
    "location_anchor_lat",
    "location_anchor_lng",
    "location_anchor_text",
    "location_radius_miles",
  ]);
  for (const reg of [LISTING_FIELDS, REQUIREMENT_FIELDS, REQUIREMENT_CHOICES]) {
    for (const def of Object.values(reg)) assert.ok(!banned.has(def.column), def.column);
  }
});

test("every select and multi field names its allowed values", () => {
  for (const reg of [LISTING_FIELDS, REQUIREMENT_FIELDS, REQUIREMENT_CHOICES]) {
    for (const def of Object.values(reg)) {
      if (def.kind === "select" || def.kind === "multi") {
        assert.ok(def.options && def.options.length > 0, `${def.key} has no options`);
      }
    }
  }
});

test("a key that is not in the registry is refused", () => {
  for (const bad of ["lat", "source", "images", "constructor", "__proto__"]) {
    assert.equal(fieldFor(LISTING_FIELDS, bad), null, bad);
    assert.equal(fieldFor(REQUIREMENT_FIELDS, bad), null, bad);
  }
});

test("buildPatchSql accepts disposals and requirements, and still refuses other tables", () => {
  assert.match(buildPatchSql("disposals", { rent_pa: 1 }).text, /^update public\.disposals set rent_pa = \$1 where id = \$2 and agency_id = \$3/);
  assert.match(buildPatchSql("requirements", { max_rent: 1 }).text, /^update public\.requirements set max_rent = \$1/);
  for (const bad of ["agencies", "users", "deals", "activities", "disposals; drop table x"]) {
    assert.throws(() => buildPatchSql(bad, { a: 1 }), bad);
  }
});

test("key features: a long scraped list can be edited", () => {
  const features = field(LISTING_FIELDS, "key_features");
  const long = Array.from({ length: 80 }, (_, i) => `Feature number ${i}`).join(", ");
  assert.ok(long.length > 500);
  const r = parseField(features, long);
  assert.ok(r.ok);
  assert.equal((r.value as string[]).length, 80);
  assert.equal(parseField(features, "x".repeat(5001)).ok, false);
});
