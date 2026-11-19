import test from "node:test";
import assert from "node:assert/strict";
import { formatDateUpdated, formatLondonDateTime, pgTimestampToIso } from "../format-date.ts";

test("a Postgres text timestamp becomes ISO 8601", () => {
  assert.equal(pgTimestampToIso("2026-11-18 14:30:00.123456+00"), "2026-11-18T14:30:00.123+00:00");
  assert.equal(pgTimestampToIso("2026-11-18 14:30:00+01"), "2026-11-18T14:30:00.000+01:00");
  assert.equal(pgTimestampToIso("2026-11-18 14:30:00.5-05:30"), "2026-11-18T14:30:00.500-05:30");
  assert.equal(pgTimestampToIso("2026-11-18 14:30:00"), "2026-11-18T14:30:00.000Z");
  assert.equal(pgTimestampToIso("2026-11-18T14:30:00.123Z"), "2026-11-18T14:30:00.123Z");
});

test("other text is returned unchanged", () => {
  assert.equal(pgTimestampToIso("tomorrow"), "tomorrow");
  assert.equal(pgTimestampToIso(""), "");
});

test("the normalised text is a valid Date and the same instant", () => {
  const d = new Date(pgTimestampToIso("2026-07-01 08:00:00.250000+00"));
  assert.equal(d.toISOString(), "2026-07-01T08:00:00.250Z");
});

test("formatDateUpdated takes the raw Postgres text and shows London time", () => {
  // 23:30 UTC in summer is 00:30 the next day in London.
  const r = formatDateUpdated("2026-07-01 23:30:00.123456+00");
  assert.equal(r.text, "2 Jul 2026");
  assert.match(r.title ?? "", /00:30/);
  assert.deepEqual(formatDateUpdated("garbage"), { text: "—", title: undefined });
});

test("formatLondonDateTime shows London wall time in summer and winter", () => {
  assert.match(formatLondonDateTime("2026-07-01 08:00:00+00"), /09:00/);
  assert.match(formatLondonDateTime("2026-01-15 09:00:00+00"), /09:00/);
  assert.equal(formatLondonDateTime(null), "—");
});
