import test from "node:test";
import assert from "node:assert/strict";

import { scoreMatch, thinBriefHint, THIN_BRIEF_COVERAGE } from "../matching/score.ts";

type Req = Parameters<typeof scoreMatch>[0];
type Listing = Parameters<typeof scoreMatch>[1];

function req(over: Partial<Req> = {}): Req {
  return {
    target_towns: [],
    target_regions: [],
    target_counties: [],
    target_postcode_districts: [],
    target_neighbourhoods: [],
    target_london_zones: [],
    min_sqft: null,
    max_sqft: null,
    min_covers: null,
    max_covers: null,
    use_classes: [],
    tenure_prefs: [],
    max_rent: null,
    max_premium: null,
    max_guide_price: null,
    location_anchor_text: null,
    location_anchor_lat: null,
    location_anchor_lng: null,
    location_radius_miles: null,
    max_rent_psf: null,
    ...over,
  } as Req;
}

function listing(over: Partial<Listing> = {}): Listing {
  return {
    city: "Guildford",
    area: null,
    postcode: null,
    address_line: null,
    county: null,
    lat: null,
    lng: null,
    size_sqft: 1000,
    covers_internal: null,
    use_class: null,
    property_type: "Bar",
    disposal_type: "new_lease",
    rent_pa: 40000,
    premium: null,
    guide_price: null,
    ...over,
  } as Listing;
}

test("an empty brief scores 0 and is not called thin", () => {
  const m = scoreMatch(req(), listing());
  assert.equal(m.score, 0);
  assert.equal(m.coverage, 0);
  assert.equal(m.thin, false);
});

test("a size-only brief is thin: a perfect fit scores below 100", () => {
  const m = scoreMatch(req({ min_sqft: 500, max_sqft: 2000 }), listing());
  assert.equal(m.coverage, 15);
  assert.equal(m.thin, true);
  assert.equal(m.score, 50); // 100 x max(0.5, 15 / 50)
  assert.deepEqual(m.missing.slice(0, 3), ["location", "covers", "use class"]);
});

test("the reduction grows with coverage: more criteria, higher score", () => {
  const size = scoreMatch(req({ min_sqft: 500, max_sqft: 2000 }), listing());
  const sizeAndRent = scoreMatch(
    req({ min_sqft: 500, max_sqft: 2000, max_rent: 60000 }),
    listing(),
  );
  assert.equal(sizeAndRent.coverage, 25);
  assert.equal(sizeAndRent.score, 50);
  const sizeRentTenure = scoreMatch(
    req({ min_sqft: 500, max_sqft: 2000, max_rent: 60000, tenure_prefs: ["leasehold"] }),
    listing(),
  );
  assert.equal(sizeRentTenure.coverage, 35);
  assert.equal(sizeRentTenure.score, 70);
  assert.ok(sizeRentTenure.score > size.score);
});

test("a brief at the threshold is not thin and keeps its full score", () => {
  const r = req({
    target_towns: ["Guildford"],
    min_sqft: 500,
    max_sqft: 2000,
    max_rent: 60000,
  });
  const m = scoreMatch(r, listing(), { locationFlex: 0 });
  assert.equal(m.coverage, 50);
  assert.equal(THIN_BRIEF_COVERAGE, 50);
  assert.equal(m.thin, false);
  assert.equal(m.score, 100);
});

test("a thin brief that misses still scores 0", () => {
  const m = scoreMatch(req({ min_sqft: 5000, max_sqft: 9000 }), listing());
  assert.equal(m.thin, true);
  assert.equal(m.score, 0);
});

test("a thin brief no longer outranks a full brief that fits well", () => {
  const thin = scoreMatch(req({ min_sqft: 500, max_sqft: 2000 }), listing());
  const full = scoreMatch(
    req({
      target_towns: ["Guildford"],
      min_sqft: 500,
      max_sqft: 2000,
      max_rent: 30000, // the listing asks 40,000, so this one criterion fails
      tenure_prefs: ["leasehold"],
    }),
    listing(),
    { locationFlex: 0 },
  );
  assert.equal(full.thin, false);
  assert.ok(full.score >= 75, `got ${full.score}`);
  assert.ok(full.score > thin.score);
});

test("dampenThinBriefs: false restores the raw score", () => {
  const m = scoreMatch(req({ min_sqft: 500, max_sqft: 2000 }), listing(), {
    dampenThinBriefs: false,
  });
  assert.equal(m.score, 100);
  assert.equal(m.thin, true);
});

test("thinBriefHint names the missing criteria", () => {
  const m = scoreMatch(req({ min_sqft: 500, max_sqft: 2000 }), listing());
  const hint = thinBriefHint(m);
  assert.match(hint, /Thin brief/);
  assert.match(hint, /15 of 100/);
  assert.match(hint, /Add location, covers, use class/);
});
