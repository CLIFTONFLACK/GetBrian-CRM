import test from "node:test";
import assert from "node:assert/strict";

import { fieldFor, normaliseUrl, parseField } from "../panel-fields/types.ts";
import { COMPANY_FIELDS } from "../panel-fields/company.ts";
import { CONTACT_FIELDS } from "../panel-fields/contact.ts";
import { buildPatchSql } from "../db/queries/patch-sql.ts";

const f = (reg: typeof COMPANY_FIELDS, key: string) => {
  const def = fieldFor(reg, key);
  assert.ok(def, `no field ${key}`);
  return def;
};

test("fieldFor rejects keys that are not in the registry", () => {
  for (const bad of ["lat", "agency_id", "id", "updated_at", "constructor", "__proto__", "toString", "", null, 5]) {
    assert.equal(fieldFor(COMPANY_FIELDS, bad), null, String(bad));
    assert.equal(fieldFor(CONTACT_FIELDS, bad), null, String(bad));
  }
});

test("registry columns never include ids, tenant, coordinates or lock columns", () => {
  const banned = new Set([
    "id",
    "agency_id",
    "lat",
    "lng",
    "updated_at",
    "created_at",
    "created_by",
    "lead_agent_id",
    "company_id",
  ]);
  for (const reg of [COMPANY_FIELDS, CONTACT_FIELDS]) {
    for (const def of Object.values(reg)) assert.ok(!banned.has(def.column), def.column);
  }
});

test("required text: empty is an error, a value is trimmed", () => {
  assert.deepEqual(parseField(f(COMPANY_FIELDS, "name"), "  "), { ok: false, error: "Name is required." });
  assert.deepEqual(parseField(f(COMPANY_FIELDS, "name"), "  Acme Ltd "), { ok: true, value: "Acme Ltd" });
});

test("optional text: empty becomes null", () => {
  assert.deepEqual(parseField(f(COMPANY_FIELDS, "phone"), ""), { ok: true, value: null });
});

test("length limit", () => {
  assert.equal(parseField(f(COMPANY_FIELDS, "company_number"), "x".repeat(21)).ok, false);
});

test("url: adds https, rejects other schemes and junk", () => {
  const w = f(COMPANY_FIELDS, "website");
  assert.deepEqual(parseField(w, "example.co.uk"), { ok: true, value: "https://example.co.uk" });
  assert.deepEqual(parseField(w, "http://example.co.uk/a"), { ok: true, value: "http://example.co.uk/a" });
  for (const bad of ["javascript:alert(1)", "ftp://example.co.uk", "not a url", "localhost"]) {
    assert.equal(parseField(w, bad).ok, false, bad);
  }
  assert.equal(normaliseUrl(""), null);
});

test("tags: split on comma or semicolon, de-duplicated, empty gives an empty list", () => {
  const t = f(COMPANY_FIELDS, "sector_tags");
  assert.deepEqual(parseField(t, "Pub; Bar, pub ,Bar"), { ok: true, value: ["Pub", "Bar", "pub"] });
  assert.deepEqual(parseField(t, ""), { ok: true, value: [] });
});

test("contact email: one plain address only", () => {
  const e = f(CONTACT_FIELDS, "email");
  assert.deepEqual(parseField(e, "jo@example.co.uk"), { ok: true, value: "jo@example.co.uk" });
  assert.deepEqual(parseField(e, ""), { ok: true, value: null });
  for (const bad of ["a@b.co?bcc=x@y.co", "a@b.co, c@d.co", "no-at-sign", "a b@c.co"]) {
    assert.equal(parseField(e, bad).ok, false, bad);
  }
});

test("boolean fields", () => {
  const b = f(CONTACT_FIELDS, "marketing_opt_in");
  assert.deepEqual(parseField(b, "true"), { ok: true, value: true });
  assert.deepEqual(parseField(b, "on"), { ok: true, value: true });
  assert.deepEqual(parseField(b, "false"), { ok: true, value: false });
  assert.deepEqual(parseField(b, ""), { ok: true, value: false });
  assert.equal(parseField(b, "maybe").ok, false);
});

test("buildPatchSql: only the given columns, always scoped to the agency", () => {
  const q = buildPatchSql("companies", { name: "Acme", phone: null });
  assert.equal(
    q.text,
    "update public.companies set name = $1, phone = $2 where id = $3 and agency_id = $4 returning id, updated_at::text as updated_at",
  );
  assert.deepEqual(q.params, ["Acme", null]);
  assert.deepEqual(q.columns, ["name", "phone"]);
});

test("buildPatchSql with a lock adds the updated_at check", () => {
  const q = buildPatchSql("contacts", { city: "Leeds" }, { lock: true });
  assert.match(q.text, /where id = \$2 and agency_id = \$3 and updated_at = \$4 returning/);
});

test("buildPatchSql refuses an unknown table, a bad column name and an empty patch", () => {
  assert.throws(() => buildPatchSql("users", { name: "x" }));
  assert.throws(() => buildPatchSql("companies", { "name = 'x'; drop table companies; --": 1 }));
  assert.throws(() => buildPatchSql("companies", { Name: 1 }));
  assert.throws(() => buildPatchSql("companies", {}));
});
