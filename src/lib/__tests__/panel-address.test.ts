import test from "node:test";
import assert from "node:assert/strict";

import { decideGeo, normalisePostcode, parseAddress } from "../panel-fields/address.ts";

const noCounty = () => null;
const surreyCounty = () => "Surrey";

test("normalisePostcode: upper case, single spaces", () => {
  assert.equal(normalisePostcode("  gu1   3ab "), "GU1 3AB");
});

test("parseAddress trims, normalises the postcode and fills a blank county", () => {
  const r = parseAddress(
    { address_line: " 1 High St ", city: "Guildford", postcode: "gu1 3ab", county: "" },
    surreyCounty,
  );
  assert.deepEqual(r, {
    ok: true,
    value: { address_line: "1 High St", city: "Guildford", postcode: "GU1 3AB", county: "Surrey" },
  });
});

test("parseAddress keeps a county that was typed", () => {
  const r = parseAddress({ city: "X", county: "Kent" }, surreyCounty);
  assert.ok(r.ok);
  assert.equal(r.value.county, "Kent");
});

test("parseAddress: all blank gives all null", () => {
  const r = parseAddress({}, noCounty);
  assert.deepEqual(r, {
    ok: true,
    value: { address_line: null, city: null, postcode: null, county: null },
  });
});

test("parseAddress rejects a long value and a postcode with odd characters", () => {
  assert.equal(parseAddress({ address_line: "x".repeat(201) }, noCounty).ok, false);
  assert.equal(parseAddress({ postcode: "GU1; drop" }, noCounty).ok, false);
});

const next = { address_line: "1 High St", city: "Guildford", postcode: "GU1 3AB", county: "Surrey" };
const stored = { address_line: "1 High St", city: "Guildford", postcode: "GU1 3AB", lat: 51.2, lng: -0.57 };

test("decideGeo: cleared address clears the pin", () => {
  const blank = { address_line: null, city: null, postcode: null, county: "Surrey" };
  assert.deepEqual(decideGeo(blank, stored, null), { lat: null, lng: null, note: null });
});

test("decideGeo: unchanged address keeps the pin and ignores the geocode", () => {
  assert.deepEqual(decideGeo(next, stored, { lat: 1, lng: 2 }), { lat: 51.2, lng: -0.57, note: null });
});

test("decideGeo: changed address takes the fresh geocode", () => {
  const moved = { ...next, postcode: "GU2 4AA" };
  assert.deepEqual(decideGeo(moved, stored, { lat: 51.24, lng: -0.6 }), { lat: 51.24, lng: -0.6, note: null });
});

test("decideGeo: a failed geocode clears the old pin and says so", () => {
  const moved = { ...next, postcode: "GU2 4AA" };
  const d = decideGeo(moved, stored, null);
  assert.equal(d.lat, null);
  assert.equal(d.lng, null);
  assert.match(d.note ?? "", /could not be placed on the map/);
});

test("decideGeo: a first address on a record with no pin is geocoded", () => {
  const noPin = { ...stored, lat: null, lng: null };
  assert.deepEqual(decideGeo(next, noPin, { lat: 51.2, lng: -0.57 }), { lat: 51.2, lng: -0.57, note: null });
});

test("pinStillValid: true only with a pin and unchanged text", async () => {
  const { pinStillValid } = await import("../panel-fields/address.ts");
  assert.equal(pinStillValid(next, stored), true);
  assert.equal(pinStillValid({ ...next, city: "Woking" }, stored), false);
  assert.equal(pinStillValid(next, { ...stored, lat: null, lng: null }), false);
  assert.equal(pinStillValid(next, null), false);
});
