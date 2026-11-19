import test from "node:test";
import assert from "node:assert/strict";
import { mailtoHref, pickCallNumber } from "../contact-links.ts";
import {
  canEditRating,
  matchesRatingFilter,
  parseRatingInput,
  ratingLabel,
  sizeRangeText,
  summariseLocations,
} from "../listing-rating.ts";

test("ratingLabel gives the five exact labels", () => {
  assert.equal(ratingLabel(1), "Time Waster");
  assert.equal(ratingLabel(2), "Not Ready Now");
  assert.equal(ratingLabel(3), "Actively Looking");
  assert.equal(ratingLabel(4), "Ready to Deal");
  assert.equal(ratingLabel(5), "Already made offers");
});

test("ratingLabel: null, out of range and fractions read Not rated", () => {
  assert.equal(ratingLabel(null), "Not rated");
  assert.equal(ratingLabel(undefined), "Not rated");
  assert.equal(ratingLabel(0), "Not rated");
  assert.equal(ratingLabel(6), "Not rated");
  assert.equal(ratingLabel(4.5), "Not rated");
});

test("canEditRating", () => {
  const lead = "u-lead";
  assert.equal(canEditRating({ userId: lead, leadAgentId: lead, isAdmin: false }), true, "lead agent");
  assert.equal(canEditRating({ userId: "u-x", leadAgentId: lead, isAdmin: true }), true, "admin");
  assert.equal(canEditRating({ userId: "u-mgr", leadAgentId: lead, isAdmin: false }), false, "manager or other agent");
  assert.equal(canEditRating({ userId: "u-x", leadAgentId: null, isAdmin: false }), false, "no lead agent");
  assert.equal(canEditRating({ userId: null, leadAgentId: null, isAdmin: false }), false, "null user, null lead");
  assert.equal(canEditRating({ userId: null, leadAgentId: lead, isAdmin: false }), false, "null user");
  assert.equal(canEditRating({ userId: undefined, leadAgentId: undefined, isAdmin: false }), false);
  assert.equal(canEditRating({ userId: "", leadAgentId: "", isAdmin: false }), false, "empty ids never match");
});

test("parseRatingInput accepts 1..5 and null only", () => {
  for (const n of [1, 2, 3, 4, 5]) assert.deepEqual(parseRatingInput(n), { ok: true, value: n });
  assert.deepEqual(parseRatingInput(null), { ok: true, value: null });
  for (const bad of [0, 6, -1, 4.5, "4", "", NaN, Infinity, undefined, {}, [], true]) {
    assert.deepEqual(parseRatingInput(bad), { ok: false }, `rejects ${String(bad)}`);
  }
});

test("matchesRatingFilter", () => {
  assert.equal(matchesRatingFilter(5, "5"), true);
  assert.equal(matchesRatingFilter(4, "5"), false);
  assert.equal(matchesRatingFilter(4, "4plus"), true);
  assert.equal(matchesRatingFilter(3, "4plus"), false);
  assert.equal(matchesRatingFilter(null, "4plus"), false);
  assert.equal(matchesRatingFilter(3, "3plus"), true);
  assert.equal(matchesRatingFilter(2, "3plus"), false);
  assert.equal(matchesRatingFilter(null, "none"), true);
  assert.equal(matchesRatingFilter(1, "none"), false);
  assert.equal(matchesRatingFilter(null, undefined), true);
  assert.equal(matchesRatingFilter(null, "junk"), true);
});

test("summariseLocations: first 3, then +N", () => {
  assert.deepEqual(summariseLocations([]), { shown: [], more: 0 });
  assert.deepEqual(summariseLocations(["A", "B"]), { shown: ["A", "B"], more: 0 });
  assert.deepEqual(summariseLocations(["A", "B", "C"]), { shown: ["A", "B", "C"], more: 0 });
  assert.deepEqual(summariseLocations(["A", "B", "C", "D", "E"]), { shown: ["A", "B", "C"], more: 2 });
  assert.deepEqual(summariseLocations(["A", " ", "A", "B", "C", "D"]), { shown: ["A", "B", "C"], more: 1 });
});

test("ratingLabel: null, out of range and fractions read Not rated", () => {
  assert.equal(ratingLabel(null), "Not rated");
  assert.equal(ratingLabel(undefined), "Not rated");
  assert.equal(ratingLabel(0), "Not rated");
  assert.equal(ratingLabel(6), "Not rated");
  assert.equal(ratingLabel(4.5), "Not rated");
});

test("canEditRating", () => {
  const lead = "u-lead";
  assert.equal(canEditRating({ userId: lead, leadAgentId: lead, isAdmin: false }), true, "lead agent");
  assert.equal(canEditRating({ userId: "u-x", leadAgentId: lead, isAdmin: true }), true, "admin");
  assert.equal(canEditRating({ userId: "u-mgr", leadAgentId: lead, isAdmin: false }), false, "manager or other agent");
  assert.equal(canEditRating({ userId: "u-x", leadAgentId: null, isAdmin: false }), false, "no lead agent");
  assert.equal(canEditRating({ userId: null, leadAgentId: null, isAdmin: false }), false, "null user, null lead");
  assert.equal(canEditRating({ userId: null, leadAgentId: lead, isAdmin: false }), false, "null user");
  assert.equal(canEditRating({ userId: undefined, leadAgentId: undefined, isAdmin: false }), false);
  assert.equal(canEditRating({ userId: "", leadAgentId: "", isAdmin: false }), false, "empty ids never match");
});

test("parseRatingInput accepts 1..5 and null only", () => {
  for (const n of [1, 2, 3, 4, 5]) assert.deepEqual(parseRatingInput(n), { ok: true, value: n });
  assert.deepEqual(parseRatingInput(null), { ok: true, value: null });
  for (const bad of [0, 6, -1, 4.5, "4", "", NaN, Infinity, undefined, {}, [], true]) {
    assert.deepEqual(parseRatingInput(bad), { ok: false }, `rejects ${String(bad)}`);
  }
});

test("matchesRatingFilter", () => {
  assert.equal(matchesRatingFilter(5, "5"), true);
  assert.equal(matchesRatingFilter(4, "5"), false);
  assert.equal(matchesRatingFilter(4, "4plus"), true);
  assert.equal(matchesRatingFilter(3, "4plus"), false);
  assert.equal(matchesRatingFilter(null, "4plus"), false);
  assert.equal(matchesRatingFilter(3, "3plus"), true);
  assert.equal(matchesRatingFilter(2, "3plus"), false);
  assert.equal(matchesRatingFilter(null, "none"), true);
  assert.equal(matchesRatingFilter(1, "none"), false);
  assert.equal(matchesRatingFilter(null, undefined), true);
  assert.equal(matchesRatingFilter(null, "junk"), true);
});

test("summariseLocations: first 3, then +N", () => {
  assert.deepEqual(summariseLocations([]), { shown: [], more: 0 });
  assert.deepEqual(summariseLocations(["A", "B"]), { shown: ["A", "B"], more: 0 });
  assert.deepEqual(summariseLocations(["A", "B", "C"]), { shown: ["A", "B", "C"], more: 0 });
  assert.deepEqual(summariseLocations(["A", "B", "C", "D", "E"]), { shown: ["A", "B", "C"], more: 2 });
  assert.deepEqual(summariseLocations(["A", " ", "A", "B", "C", "D"]), { shown: ["A", "B", "C"], more: 1 });
});

test("pickCallNumber prefers mobile, then phone, else null", () => {
  assert.deepEqual(pickCallNumber("07700 900123", "020 7946 0000"), {
    display: "07700 900123",
    href: "tel:07700900123",
  });
  assert.deepEqual(pickCallNumber(null, "+44 20 7946 0000"), {
    display: "+44 20 7946 0000",
    href: "tel:+442079460000",
  });
  assert.deepEqual(pickCallNumber("  ", "020 7946 0000")?.href, "tel:02079460000");
  assert.equal(pickCallNumber(null, null), null);
  assert.equal(pickCallNumber("n/a", ""), null);
});

test("mailtoHref", () => {
  assert.equal(mailtoHref("a@b.co"), "mailto:a@b.co");
  assert.equal(mailtoHref(" a@b.co "), "mailto:a@b.co");
  assert.equal(mailtoHref(""), null);
  assert.equal(mailtoHref(null), null);
  assert.equal(mailtoHref("not an email"), null);
});

test("sizeRangeText", () => {
  assert.equal(sizeRangeText(null, null), "—");
  assert.equal(sizeRangeText(1000, 2000), "1,000–2,000 sq ft");
  assert.equal(sizeRangeText(1000, null), "1,000+ sq ft");
  assert.equal(sizeRangeText(null, 2500), "up to 2,500 sq ft");
});
