import test from "node:test";
import assert from "node:assert/strict";
import { datetimeLocalToIso, withIsoDueAt } from "../local-datetime.ts";
import { parseDueInput } from "../london-time.ts";

// The browser reads a datetime-local value in the viewer's zone. These tests
// set the zone of this process, as the browser would have it, and restore it.
function inZone<T>(zone: string, fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

test("the same wall clock is a different instant in each zone", () => {
  assert.equal(
    inZone("America/New_York", () => datetimeLocalToIso("2026-07-01T09:00")),
    "2026-07-01T13:00:00.000Z",
  );
  assert.equal(
    inZone("Asia/Tokyo", () => datetimeLocalToIso("2026-07-01T09:00")),
    "2026-07-01T00:00:00.000Z",
  );
  assert.equal(
    inZone("Europe/London", () => datetimeLocalToIso("2026-07-01T09:00")),
    "2026-07-01T08:00:00.000Z",
  );
});

test("seconds are kept", () => {
  assert.equal(
    inZone("Asia/Tokyo", () => datetimeLocalToIso("2026-07-01T09:00:30")),
    "2026-07-01T00:00:30.000Z",
  );
});

test("empty, impossible and already-zoned values come back as they were", () => {
  inZone("Asia/Tokyo", () => {
    assert.equal(datetimeLocalToIso(""), "");
    assert.equal(datetimeLocalToIso("2026-02-31T09:00"), "2026-02-31T09:00");
    assert.equal(datetimeLocalToIso("not a date"), "not a date");
    assert.equal(datetimeLocalToIso("2026-07-01T09:00:00.000Z"), "2026-07-01T09:00:00.000Z");
    assert.equal(datetimeLocalToIso("2026-07-01T09:00+02:00"), "2026-07-01T09:00+02:00");
  });
});

test("withIsoDueAt rewrites only the due_at field, in place", () => {
  const fd = new FormData();
  fd.set("title", "Call back");
  fd.set("due_at", "2026-07-01T09:00");
  const out = inZone("Asia/Tokyo", () => withIsoDueAt(fd));
  assert.equal(out, fd);
  assert.equal(fd.get("due_at"), "2026-07-01T00:00:00.000Z");
  assert.equal(fd.get("title"), "Call back");
});

test("withIsoDueAt leaves a missing or empty due_at alone", () => {
  const none = new FormData();
  withIsoDueAt(none);
  assert.equal(none.has("due_at"), false);
  const empty = new FormData();
  empty.set("due_at", "");
  withIsoDueAt(empty);
  assert.equal(empty.get("due_at"), "");
});

test("the server keeps the viewer's instant, not a London reading of it", () => {
  // A viewer in Tokyo types 09:00. Read as London wall clock it would be 08:00Z.
  const posted = inZone("Asia/Tokyo", () => datetimeLocalToIso("2026-07-01T09:00"));
  assert.equal(parseDueInput(posted)?.toISOString(), "2026-07-01T00:00:00.000Z");
  // A zone-less value from a direct post still reads as London.
  assert.equal(parseDueInput("2026-07-01T09:00")?.toISOString(), "2026-07-01T08:00:00.000Z");
});
