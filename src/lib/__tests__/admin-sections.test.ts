import test from "node:test";
import assert from "node:assert/strict";

import { ADMIN_SECTIONS, DEFAULT_ADMIN_SECTION, parseAdminSection } from "../admin-sections.ts";

test("every section resolves to itself", () => {
  for (const s of ADMIN_SECTIONS) assert.equal(parseAdminSection(s.slug), s.slug);
});

test("a missing, unknown or odd section gives the default", () => {
  for (const bad of [undefined, null, "", "billing", "constructor", "__proto__", 5, {}, []]) {
    assert.equal(parseAdminSection(bad), DEFAULT_ADMIN_SECTION, String(bad));
  }
});

test("a repeated param uses the first value", () => {
  assert.equal(parseAdminSection(["data", "team"]), "data");
});

test("section slugs are unique and each has an intro", () => {
  const slugs = ADMIN_SECTIONS.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of ADMIN_SECTIONS) assert.ok(s.intro.length > 10, s.slug);
});
