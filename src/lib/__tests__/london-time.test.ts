import test from "node:test";
import assert from "node:assert/strict";
import { londonWallClockToUtc, parseDueInput } from "../london-time.ts";

const iso = (v: string) => londonWallClockToUtc(v)?.toISOString();

test("winter time is UTC", () => {
  assert.equal(iso("2026-01-15T09:00"), "2026-01-15T09:00:00.000Z");
});

test("summer time is one hour behind the wall clock", () => {
  assert.equal(iso("2026-07-01T09:00"), "2026-07-01T08:00:00.000Z");
  assert.equal(iso("2026-07-01T00:30"), "2026-06-30T23:30:00.000Z");
});

test("seconds are optional", () => {
  assert.equal(iso("2026-07-01T09:00:30"), "2026-07-01T08:00:30.000Z");
});

test("the day before and after the changes are ordinary", () => {
  assert.equal(iso("2026-03-28T12:00"), "2026-03-28T12:00:00.000Z"); // still GMT
  assert.equal(iso("2026-03-30T12:00"), "2026-03-30T11:00:00.000Z"); // BST
  assert.equal(iso("2026-10-24T12:00"), "2026-10-24T11:00:00.000Z"); // BST
  assert.equal(iso("2026-10-26T12:00"), "2026-10-26T12:00:00.000Z"); // GMT
});

test("spring gap: a time that does not exist moves forward one hour", () => {
  // 29 March 2026: clocks go from 01:00 GMT to 02:00 BST. 01:30 never happens.
  assert.equal(iso("2026-03-29T01:30"), "2026-03-29T01:30:00.000Z"); // 02:30 BST
  assert.equal(iso("2026-03-29T00:59"), "2026-03-29T00:59:00.000Z");
  assert.equal(iso("2026-03-29T02:00"), "2026-03-29T01:00:00.000Z"); // first real 02:00 BST
});

test("autumn overlap: the first occurrence is used", () => {
  // 25 October 2026: clocks go from 02:00 BST back to 01:00 GMT. 01:30 happens twice.
  assert.equal(iso("2026-10-25T01:30"), "2026-10-25T00:30:00.000Z"); // the BST one
  assert.equal(iso("2026-10-25T00:59"), "2026-10-24T23:59:00.000Z");
  assert.equal(iso("2026-10-25T02:30"), "2026-10-25T02:30:00.000Z"); // GMT, after the overlap
});

test("a wall clock that does not exist as written is refused", () => {
  for (const v of ["2026-02-31T09:00", "2026-13-01T09:00", "2026-01-01T24:00", "2026-01-01T09:60", "2026-00-10T09:00"]) {
    assert.equal(londonWallClockToUtc(v), null, v);
  }
});

test("wrong shapes are refused", () => {
  for (const v of ["", "tomorrow", "2026-07-01", "2026-07-01 09:00", "2026-07-01T9:00", "2026-07-01T09:00Z"]) {
    assert.equal(londonWallClockToUtc(v), null, v);
  }
});

test("parseDueInput reads a zone-less value as London and keeps an explicit zone", () => {
  assert.equal(parseDueInput("2026-07-01T09:00")?.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(parseDueInput("2026-07-01T09:00:00Z")?.toISOString(), "2026-07-01T09:00:00.000Z");
  assert.equal(parseDueInput("2026-07-01T09:00:00+02:00")?.toISOString(), "2026-07-01T07:00:00.000Z");
  assert.equal(parseDueInput("not a date"), null);
  assert.equal(parseDueInput("2026-07-01"), null);
  assert.equal(parseDueInput("   "), null);
});
