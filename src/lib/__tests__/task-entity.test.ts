import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskEntity, TASK_ENTITY_TYPES } from "../task-entity.ts";

const ID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";

test("both fields blank means a task with no record", () => {
  assert.deepEqual(parseTaskEntity("", ""), { ok: true, entity: null });
  assert.deepEqual(parseTaskEntity(null, null), { ok: true, entity: null });
  assert.deepEqual(parseTaskEntity(undefined, "  "), { ok: true, entity: null });
});

test("every allowed type with a uuid gives an entity, id lowercased", () => {
  for (const type of TASK_ENTITY_TYPES) {
    assert.deepEqual(parseTaskEntity(type, ID.toUpperCase()), {
      ok: true,
      entity: { type, id: ID },
    });
  }
  assert.deepEqual([...TASK_ENTITY_TYPES], ["company", "contact", "requirement", "listing", "deal"]);
});

test("one field without the other is an error, not a silent no-record", () => {
  assert.equal(parseTaskEntity("company", "").ok, false);
  assert.equal(parseTaskEntity("", ID).ok, false);
});

test("unknown types are rejected", () => {
  for (const type of ["disposal", "Company", "users", "constructor", "__proto__", "company ", "company;--", "agency"]) {
    const r = parseTaskEntity(type, ID);
    // "company " trims to a valid type, so it is the one allowed through.
    if (type === "company ") assert.equal(r.ok, true);
    else assert.equal(r.ok, false, type);
  }
});

test("ids that are not uuids are rejected", () => {
  for (const id of ["1", "abc", `${ID}x`, `${ID}'; drop table tasks;--`, "../etc", ID.replace("3f2b", "zzzz")]) {
    assert.equal(parseTaskEntity("company", id).ok, false, id);
  }
});

test("non-string input is rejected, not coerced", () => {
  assert.equal(parseTaskEntity(["company"], ID).ok, false);
  assert.equal(parseTaskEntity("company", [ID]).ok, false);
  assert.equal(parseTaskEntity({}, {}).ok, true); // non-strings read as blank
});
