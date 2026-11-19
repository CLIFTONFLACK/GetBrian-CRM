import test from "node:test";
import assert from "node:assert/strict";
import { resolveTouchTarget } from "../date-updated-target.ts";

test("company, contact and requirement map to themselves", () => {
  assert.equal(resolveTouchTarget("company"), "company");
  assert.equal(resolveTouchTarget("contact"), "contact");
  assert.equal(resolveTouchTarget("requirement"), "requirement");
});

test("entity types without a date_updated column map to null", () => {
  // activities.entity_type also carries listing and deal; tasks.entity_type is free text.
  for (const t of ["listing", "deal", "disposal", "Company", " company", ""]) {
    assert.equal(resolveTouchTarget(t), null, `expected null for ${JSON.stringify(t)}`);
  }
});

test("null, undefined and non-string input map to null instead of throwing", () => {
  for (const t of [null, undefined, 0, {}, ["company"]]) {
    assert.equal(resolveTouchTarget(t), null);
  }
});

test("object-prototype keys are not mistaken for entity types", () => {
  assert.equal(resolveTouchTarget("constructor"), null);
  assert.equal(resolveTouchTarget("__proto__"), null);
});
