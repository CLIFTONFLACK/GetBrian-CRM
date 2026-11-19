import test from "node:test";
import assert from "node:assert/strict";

import { scoreMatch } from "../matching/score.ts";
import { normalizePlace, samePlace } from "../matching/place-key.ts";

type Req = Parameters<typeof scoreMatch>[0];
type Listing = Parameters<typeof scoreMatch>[1];

// A requirement with a location target and nothing else, so the score is the
// location factor alone: 100 for a hit, 0 for a miss, between for proximity.
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
    ...over,
  } as Req;
}

function listing(over: Partial<Listing> = {}): Listing {
  return {
    city: null,
    area: null,
    postcode: null,
    address_line: null,
    county: null,
    lat: null,
    lng: null,
    size_sqft: null,
    covers_internal: null,
    use_class: null,
    property_type: null,
    disposal_type: "new_lease",
    rent_pa: null,
    premium: null,
    guide_price: null,
    ...over,
  } as Listing;
}

test("normalizePlace trims, collapses spaces and lower-cases", () => {
  assert.equal(normalizePlace("  Greater   LONDON "), "greater london");
  assert.equal(normalizePlace(null), "");
  assert.equal(samePlace(" Surrey", "surrey  "), true);
  assert.equal(samePlace("", ""), false);
});

test("Greater London and City of London stay separate counties", () => {
  // The location data lists them as two counties in one region.
  assert.equal(samePlace("Greater London", "City of London"), false);
});

test("town text match scores a direct hit", () => {
  const r = req({ target_towns: ["Guildford"] });
  assert.equal(scoreMatch(r, listing({ city: "Guildford" }), { locationFlex: 0 }).score, 100);
  assert.equal(scoreMatch(r, listing({ city: "Leeds", county: "West Yorkshire" }), { locationFlex: 0 }).score, 0);
});

test("postcode district match scores a direct hit", () => {
  const r = req({ target_postcode_districts: ["GU1"] });
  assert.equal(scoreMatch(r, listing({ postcode: "GU1 3AB" }), { locationFlex: 0 }).score, 100);
  assert.equal(scoreMatch(r, listing({ postcode: "GU10 3AB" }), { locationFlex: 0 }).score, 0);
});

test("county match ignores stray spaces and case on either side", () => {
  const r = req({ target_counties: ["  SURREY "] });
  const hit = scoreMatch(r, listing({ city: "Elsewhere", county: "Surrey" }), { locationFlex: 0 });
  assert.equal(hit.score, 100);
  const hit2 = scoreMatch(
    req({ target_counties: ["surrey"] }),
    listing({ city: "Elsewhere", county: " Surrey  " }),
    { locationFlex: 0 },
  );
  assert.equal(hit2.score, 100);
});

test("region target matches a county with doubled inner spaces", () => {
  const r = req({ target_regions: ["London"] });
  const m = scoreMatch(r, listing({ city: "Elsewhere", county: "Greater   London" }), {
    locationFlex: 0,
  });
  assert.equal(m.score, 100);
});

test("county-only requirement at flex 0 gives no credit for a near miss", () => {
  const r = req({ target_counties: ["Surrey"] });
  // Maidstone is in Kent; coordinates are close enough to earn proximity credit
  // at a wide flex, but flex 0 means exact matches only.
  const near = listing({ city: "Maidstone", county: "Kent", lat: 51.3, lng: -0.5 });
  assert.equal(scoreMatch(r, near, { locationFlex: 0 }).score, 0);
  assert.ok(scoreMatch(r, near, { locationFlex: 100 }).score > 0);
});

test("listing with no coordinates and no known place scores 0 without throwing", () => {
  const r = req({ target_towns: ["Guildford"] });
  const m = scoreMatch(r, listing({ city: "Nowhere Special" }), { locationFlex: 100 });
  assert.equal(m.score, 0);
});

test("requirement with no targets does not count location", () => {
  const r = req({ min_sqft: 500, max_sqft: 1000 });
  const m = scoreMatch(r, listing({ city: "Anywhere", size_sqft: 800 }));
  assert.equal(m.score, 100);
  assert.ok(m.reasons.every((x) => !x.label.startsWith("Location")));
});

test("an intel listing scores the same as an identical cdg listing", () => {
  const r = req({ target_towns: ["Guildford"], min_sqft: 500, max_sqft: 1000 });
  const base = listing({ city: "Guildford", county: "Surrey", size_sqft: 800 });
  const cdg = { ...base, listing_type: "cdg" };
  const intel = { ...base, listing_type: "intel" };
  assert.deepEqual(scoreMatch(r, intel), scoreMatch(r, cdg));
});
