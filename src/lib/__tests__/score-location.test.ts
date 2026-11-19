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


// ---- "within N miles of X" --------------------------------------------------

const SOHO = { location_anchor_text: "Soho", location_anchor_lat: 51.5136, location_anchor_lng: -0.1365 };
const NEAR_SOHO = { lat: 51.52, lng: -0.14 }; // about 0.3 mi
const FOUR_MILES = { lat: 51.57, lng: -0.1365 }; // about 3.9 mi north
const MANCHESTER = { lat: 53.48, lng: -2.24 }; // about 160 mi

test("anchor: a listing inside the radius is a full location hit, labelled with the place", () => {
  const r = req({ ...SOHO, location_radius_miles: 3 });
  const m = scoreMatch(r, listing(NEAR_SOHO), { locationFlex: 0 });
  assert.equal(m.score, 100);
  assert.equal(m.reasons[0].label, "Location: within 3 mi of Soho");
  assert.equal(m.reasons[0].ok, true);
});

test("anchor: a listing far outside the radius scores 0, and the near one scores higher (negative control)", () => {
  const r = req({ ...SOHO, location_radius_miles: 3 });
  const inside = scoreMatch(r, listing(NEAR_SOHO), { locationFlex: 50 }).score;
  const far = scoreMatch(r, listing(MANCHESTER), { locationFlex: 50 }).score;
  assert.equal(far, 0);
  assert.ok(inside > far, "an anchor brief must score a far listing lower than a near one");
});

test("anchor: just outside the radius earns fading partial credit when flex allows, none at flex 0", () => {
  const r = req({ ...SOHO, location_radius_miles: 3 });
  const flexed = scoreMatch(r, listing(FOUR_MILES), { locationFlex: 50 });
  // 3.9 mi against radius 3 + 12.5 mi flex: 0.8 x (1 - 0.9 / 12.5) is about 0.74.
  assert.ok(flexed.score > 60 && flexed.score < 80, `got ${flexed.score}`);
  assert.equal(flexed.reasons[0].partial, true);
  assert.equal(scoreMatch(r, listing(FOUR_MILES), { locationFlex: 0 }).score, 0);
  // Credit never beats a hit, and shrinks with distance.
  const wide = scoreMatch(r, listing({ lat: 51.6, lng: -0.1365 }), { locationFlex: 50 }).score; // about 6 mi
  assert.ok(wide < flexed.score && wide > 0, `got ${wide} vs ${flexed.score}`);
});

test("anchor: a bigger radius turns a miss into a hit", () => {
  const small = req({ ...SOHO, location_radius_miles: 1 });
  const big = req({ ...SOHO, location_radius_miles: 5 });
  assert.equal(scoreMatch(small, listing(FOUR_MILES), { locationFlex: 0 }).score, 0);
  assert.equal(scoreMatch(big, listing(FOUR_MILES), { locationFlex: 0 }).score, 100);
});

test("anchor: a listing with no coordinates and no known postcode or town scores 0 without throwing", () => {
  const r = req({ ...SOHO, location_radius_miles: 3 });
  const m = scoreMatch(r, listing({ city: "Nowhere Special" }), { locationFlex: 100 });
  assert.equal(m.score, 0);
  assert.equal(m.reasons.length, 1);
});

test("anchor: a listing with only a postcode district is placed by its centroid", () => {
  const r = req({ ...SOHO, location_radius_miles: 3 });
  const m = scoreMatch(r, listing({ postcode: "W1D 3QF" }), { locationFlex: 0 });
  assert.equal(m.score, 100);
});

test("anchor: text and radius without coordinates is not scored and does not count as a location criterion", () => {
  const r = req({ location_anchor_text: "Nowhere Street", location_radius_miles: 3, min_sqft: 500, max_sqft: 1000 });
  const m = scoreMatch(r, listing({ size_sqft: 800, ...MANCHESTER }));
  assert.equal(m.score, 100);
  assert.ok(m.reasons.every((x) => !x.label.startsWith("Location")));
  // Coordinates without a radius are not scored either.
  const noRadius = req({ ...SOHO, min_sqft: 500, max_sqft: 1000 });
  assert.ok(scoreMatch(noRadius, listing({ size_sqft: 800 })).reasons.every((x) => !x.label.startsWith("Location")));
});

test("anchor: the best of the anchor and the other targets wins", () => {
  // Far from Soho, but a named town hit is still a full hit.
  const r = req({ ...SOHO, location_radius_miles: 1, target_towns: ["Guildford"] });
  assert.equal(scoreMatch(r, listing({ city: "Guildford", ...MANCHESTER }), { locationFlex: 0 }).score, 100);
  // Inside the anchor but not in the named town: the anchor carries it.
  assert.equal(scoreMatch(r, listing({ city: "Elsewhere", ...NEAR_SOHO }), { locationFlex: 0 }).score, 100);
  // Neither: 0.
  assert.equal(scoreMatch(r, listing({ city: "Leeds", county: "West Yorkshire", ...MANCHESTER }), { locationFlex: 0 }).score, 0);
});

// ---- rent per sq ft ---------------------------------------------------------

test("rent per sq ft: under the ceiling passes, over it fails", () => {
  const r = req({ max_rent_psf: 25 });
  assert.equal(scoreMatch(r, listing({ rent_pa: 50000, size_sqft: 2000 })).score, 100); // 25.00
  assert.equal(scoreMatch(r, listing({ rent_pa: 40000, size_sqft: 2000 })).score, 100); // 20.00
  const over = scoreMatch(r, listing({ rent_pa: 60000, size_sqft: 2000 })); // 30.00
  assert.equal(over.score, 0);
  assert.equal(over.reasons[0].label, "Rent: £30/sq ft vs max £25/sq ft");
});

test("rent per sq ft: an unknown rent or size passes, as POA does for the annual ceiling", () => {
  const r = req({ max_rent_psf: 25 });
  assert.equal(scoreMatch(r, listing({ rent_pa: null, size_sqft: 2000 })).score, 100);
  assert.equal(scoreMatch(r, listing({ rent_pa: 60000, size_sqft: null })).score, 100);
  assert.equal(scoreMatch(r, listing({ rent_pa: 60000, size_sqft: 0 })).score, 100);
});

test("rent per sq ft: both ceilings must hold, in the one rent dimension", () => {
  const r = req({ max_rent: 100000, max_rent_psf: 25 });
  // Annual fine (60,000 <= 100,000), per sq ft too high (30 > 25): fails.
  const m = scoreMatch(r, listing({ rent_pa: 60000, size_sqft: 2000 }));
  assert.equal(m.score, 0);
  assert.equal(m.reasons.length, 1, "one rent reason, not two");
  // Per sq ft fine, annual too high: fails.
  assert.equal(scoreMatch(req({ max_rent: 40000, max_rent_psf: 50 }), listing({ rent_pa: 60000, size_sqft: 2000 })).score, 0);
  // Both fine: passes.
  assert.equal(scoreMatch(r, listing({ rent_pa: 50000, size_sqft: 2000 })).score, 100);
});

test("rent per sq ft: the annual ceiling alone behaves as it did", () => {
  const r = req({ max_rent: 50000 });
  assert.equal(scoreMatch(r, listing({ rent_pa: 50000, size_sqft: 10 })).score, 100);
  assert.equal(scoreMatch(r, listing({ rent_pa: 50001 })).score, 0);
  assert.equal(scoreMatch(r, listing({ rent_pa: 50001 })).reasons[0].label, "Rent: £50,001 pa vs max £50,000");
});

test("an intel listing scores the same as an identical cdg listing", () => {
  const r = req({ target_towns: ["Guildford"], min_sqft: 500, max_sqft: 1000 });
  const base = listing({ city: "Guildford", county: "Surrey", size_sqft: 800 });
  const cdg = { ...base, listing_type: "cdg" };
  const intel = { ...base, listing_type: "intel" };
  assert.deepEqual(scoreMatch(r, intel), scoreMatch(r, cdg));
});
