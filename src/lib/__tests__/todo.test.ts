import test from "node:test";
import assert from "node:assert/strict";

import {
  sameDueMinute,
  staysFindable,
  filterEntries,
  isOverdue,
  isTodo,
  parseEntryFilter,
  sortEntries,
  statusFor,
} from "../todo.ts";

const NOW = new Date("2026-11-27T12:00:00Z");
const e = (over: Partial<{ id: string; status: string | null; due_at: string | null; occurred_at: string }>) => ({
  id: "x",
  status: null as string | null,
  due_at: null as string | null,
  occurred_at: "2026-11-01T10:00:00Z",
  ...over,
});

test("a to-do is an entry with a status; a note has none", () => {
  assert.equal(isTodo(e({ status: null })), false);
  assert.equal(isTodo(e({ status: "open" })), true);
  assert.equal(isTodo(e({ status: "done" })), true);
});

test("isOverdue: only an open to-do with a past due time", () => {
  assert.equal(isOverdue(e({ status: "open", due_at: "2026-11-26T12:00:00Z" }), NOW), true);
  assert.equal(isOverdue(e({ status: "open", due_at: "2026-11-28T12:00:00Z" }), NOW), false);
  assert.equal(isOverdue(e({ status: "done", due_at: "2026-11-26T12:00:00Z" }), NOW), false);
  assert.equal(isOverdue(e({ status: null, due_at: "2026-11-26T12:00:00Z" }), NOW), false);
  assert.equal(isOverdue(e({ status: "open", due_at: null }), NOW), false);
  assert.equal(isOverdue(e({ status: "open", due_at: "not a date" }), NOW), false);
});

test("isOverdue reads the timestamp text that Postgres returns", () => {
  assert.equal(isOverdue(e({ status: "open", due_at: "2026-11-26 12:00:00+00" }), NOW), true);
  assert.equal(isOverdue(e({ status: "open", due_at: "2026-11-28 12:00:00.123456+00" }), NOW), false);
});

test("statusFor: an assignee or a due date makes a to-do, neither stays a note", () => {
  assert.equal(statusFor({ assigneeId: "u1", dueAt: null }), "open");
  assert.equal(statusFor({ assigneeId: null, dueAt: "2026-12-01T09:00:00Z" }), "open");
  assert.equal(statusFor({ assigneeId: null, dueAt: null }), null);
});

test("statusFor: an existing status is kept, so an edit never re-opens a done to-do", () => {
  assert.equal(statusFor({ assigneeId: "u1", dueAt: null }, "done"), "done");
  assert.equal(statusFor({ assigneeId: null, dueAt: null }, "open"), "open");
});

test("filterEntries", () => {
  const list = [
    e({ id: "note" }),
    e({ id: "open", status: "open" }),
    e({ id: "done", status: "done" }),
  ];
  assert.deepEqual(filterEntries(list, "all").map((x) => x.id), ["note", "open", "done"]);
  assert.deepEqual(filterEntries(list, "notes").map((x) => x.id), ["note"]);
  assert.deepEqual(filterEntries(list, "open").map((x) => x.id), ["open"]);
  assert.deepEqual(filterEntries(list, "done").map((x) => x.id), ["done"]);
});

test("parseEntryFilter: unknown values fall back to all", () => {
  assert.equal(parseEntryFilter("open"), "open");
  assert.equal(parseEntryFilter("nonsense"), "all");
  assert.equal(parseEntryFilter(undefined), "all");
  assert.equal(parseEntryFilter(["open"]), "all");
});

test("sortEntries: open to-dos first by due date (none last), then the rest newest first", () => {
  const list = [
    e({ id: "old-note", occurred_at: "2026-10-01T00:00:00Z" }),
    e({ id: "open-no-due", status: "open", occurred_at: "2026-11-20T00:00:00Z" }),
    e({ id: "open-late", status: "open", due_at: "2026-12-10T00:00:00Z" }),
    e({ id: "new-note", occurred_at: "2026-11-25T00:00:00Z" }),
    e({ id: "open-soon", status: "open", due_at: "2026-11-28T00:00:00Z" }),
    e({ id: "done-todo", status: "done", due_at: "2026-11-01T00:00:00Z", occurred_at: "2026-11-02T00:00:00Z" }),
  ];
  assert.deepEqual(
    sortEntries(list).map((x) => x.id),
    ["open-soon", "open-late", "open-no-due", "new-note", "done-todo", "old-note"],
  );
});

test("sortEntries does not change the input", () => {
  const list = [e({ id: "a", occurred_at: "2026-01-01T00:00:00Z" }), e({ id: "b", occurred_at: "2026-02-01T00:00:00Z" })];
  sortEntries(list);
  assert.deepEqual(list.map((x) => x.id), ["a", "b"]);
});

test("sameDueMinute: ignores seconds, sees a real change, handles none", () => {
  assert.equal(sameDueMinute("2026-11-27 12:00:41+00", "2026-11-27T12:00:00.000Z"), true);
  assert.equal(sameDueMinute("2026-11-27 12:00:00+00", "2026-11-27T12:01:00.000Z"), false);
  assert.equal(sameDueMinute(null, null), true);
  assert.equal(sameDueMinute(null, "2026-11-27T12:00:00.000Z"), false);
  assert.equal(sameDueMinute("2026-11-27T12:00:00.000Z", null), false);
});

test("staysFindable: an entry with no record has to stay a to-do", () => {
  assert.equal(staysFindable({ entity_type: null, status: null }), false);
  assert.equal(staysFindable({ entity_type: null, status: "open" }), true);
  assert.equal(staysFindable({ entity_type: null, status: "done" }), true);
  assert.equal(staysFindable({ entity_type: "company", status: null }), true);
});
