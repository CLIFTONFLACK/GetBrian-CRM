import test from "node:test";
import assert from "node:assert/strict";

import {
  rentPsfError,
  resolveAnchor,
  resolveAnchorOffline,
  type StoredAnchor,
} from "../requirement-anchor.ts";
import { describeAnchor, formatRentPsf } from "../requirement-display.ts";

const never = async () => {
  throw new Error("the geocoder must not be called");
};

function counting(result: { lat: number; lng: number } | null) {
  let calls = 0;
  const fn = async () => {
    calls++;
    return result;
  };
  return { fn, calls: () => calls };
}

test("offline: London areas, towns and district codes resolve; case and apostrophes are ignored", () => {
  const soho = resolveAnchorOffline("Soho");
  assert.ok(soho && soho.lat > 51.4 && soho.lat < 51.6, "Soho is in central London");
  assert.deepEqual(resolveAnchorOffline("  soho "), soho);
  const kx = resolveAnchorOffline("Kings Cross");
  assert.ok(kx, "Kings Cross must find King's Cross");
  assert.deepEqual(resolveAnchorOffline("King's Cross"), kx);
  assert.ok(resolveAnchorOffline("W1D"));
  assert.ok(resolveAnchorOffline("w1d"));
  assert.equal(resolveAnchorOffline("Nowhere Street"), null);
  assert.equal(resolveAnchorOffline("34-43 Russell Street, Covent Garden"), null);
});

test("anchor: no text clears everything; a radius with no text is an error", async () => {
  const cleared = await resolveAnchor({ text: null, miles: null }, null, never);
  assert.deepEqual(cleared, {
    ok: true,
    warning: null,
    fields: {
      locationAnchorText: null,
      locationAnchorLat: null,
      locationAnchorLng: null,
      locationRadiusMiles: null,
    },
  });
  const orphan = await resolveAnchor({ text: "  ", miles: 3, milesRaw: "3" }, null, never);
  assert.equal(orphan.ok, false);
});

test("anchor: text with no radius, a non-number and an out-of-range radius are errors", async () => {
  assert.equal((await resolveAnchor({ text: "Soho", miles: null }, null, never)).ok, false);
  const nan = await resolveAnchor({ text: "Soho", miles: null, milesRaw: "abc" }, null, never);
  assert.equal(nan.ok, false);
  if (!nan.ok) assert.match(nan.error, /must be a number/);
  for (const miles of [0, 0.05, 51, 1000, -2]) {
    assert.equal((await resolveAnchor({ text: "Soho", miles, milesRaw: String(miles) }, null, never)).ok, false, String(miles));
  }
  for (const miles of [0.1, 50, 3]) {
    assert.equal((await resolveAnchor({ text: "Soho", miles, milesRaw: String(miles) }, null, never)).ok, true, String(miles));
  }
});

test("anchor: a known place resolves offline and the geocoder is not called", async () => {
  const out = await resolveAnchor({ text: "Soho", miles: 3 }, null, never);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.warning, null);
    assert.equal(out.fields.locationAnchorText, "Soho");
    assert.equal(out.fields.locationRadiusMiles, 3);
    assert.ok(out.fields.locationAnchorLat !== null && out.fields.locationAnchorLng !== null);
  }
});

test("anchor: an unknown place goes to the geocoder; a UK hit is stored", async () => {
  const g = counting({ lat: 51.515, lng: -0.131 });
  const out = await resolveAnchor({ text: "34-43 Russell Street, Covent Garden", miles: 2.5 }, null, g.fn);
  assert.equal(g.calls(), 1);
  assert.equal(out.ok && out.fields.locationAnchorLat, 51.515);
  assert.equal(out.ok && out.warning, null);
});

test("anchor: a hit outside the UK, no hit, or a throwing geocoder all save text and radius with a warning and no coordinates", async () => {
  for (const geo of [
    async () => ({ lat: 48.85, lng: 2.35 }), // Paris
    async () => null,
    async () => {
      throw new Error("network");
    },
  ]) {
    const out = await resolveAnchor({ text: "Nowhere Street", miles: 3 }, null, geo);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.fields.locationAnchorText, "Nowhere Street");
      assert.equal(out.fields.locationRadiusMiles, 3);
      assert.equal(out.fields.locationAnchorLat, null);
      assert.equal(out.fields.locationAnchorLng, null);
      assert.match(out.warning ?? "", /was not found/);
    }
  }
});

test("anchor: unchanged text keeps the stored coordinates without any lookup; changed text looks up again", async () => {
  const stored: StoredAnchor = { text: "Berwick Street", lat: 51.5136, lng: -0.1365 };
  const same = await resolveAnchor({ text: " berwick   street ", miles: 4 }, stored, never);
  assert.equal(same.ok && same.fields.locationAnchorLat, 51.5136);
  assert.equal(same.ok && same.fields.locationRadiusMiles, 4);
  const g = counting({ lat: 52.2, lng: 0.12 });
  const changed = await resolveAnchor({ text: "Cambridge Road", miles: 4 }, stored, g.fn);
  assert.equal(g.calls(), 1);
  assert.equal(changed.ok && changed.fields.locationAnchorLat, 52.2);
  // Stored text with NO coordinates (a place that was not found) is tried again.
  const retry = counting({ lat: 51.5, lng: -0.1 });
  await resolveAnchor({ text: "Berwick Street", miles: 4 }, { text: "Berwick Street", lat: null, lng: null }, retry.fn);
  assert.equal(retry.calls(), 1);
});

test("rent per sq ft: above 0 and below the column limit", () => {
  assert.equal(rentPsfError(null), null);
  assert.equal(rentPsfError(25), null);
  assert.equal(rentPsfError(0.01), null);
  for (const bad of [0, -1, 100_000, 5_000_000, Number.NaN]) {
    assert.notEqual(rentPsfError(bad), null, String(bad));
  }
});

test("describeAnchor and formatRentPsf: wording", () => {
  const base = { location_anchor_text: "Soho", location_anchor_lat: 51.5, location_anchor_lng: -0.13, location_radius_miles: 3 };
  assert.deepEqual(describeAnchor(base), { text: "Within 3 miles of Soho", located: true });
  assert.equal(describeAnchor({ ...base, location_radius_miles: 1 })?.text, "Within 1 mile of Soho");
  assert.equal(describeAnchor({ ...base, location_radius_miles: 0.5 })?.text, "Within 0.5 miles of Soho");
  assert.equal(describeAnchor({ ...base, location_anchor_lat: null, location_anchor_lng: null })?.located, false);
  assert.equal(describeAnchor({ ...base, location_radius_miles: null }), null);
  assert.equal(describeAnchor({ ...base, location_anchor_text: " " }), null);
  assert.equal(formatRentPsf(25), "£25/sq ft");
  assert.equal(formatRentPsf(12.5), "£12.50/sq ft");
  assert.equal(formatRentPsf(null), "—");
});
