import test from "node:test";
import assert from "node:assert/strict";
import { groupTopMatches, MIN_MATCH_SCORE, TOP_PER_REQUIREMENT } from "../matching/entity-matches.ts";
import { scoreMatch } from "../matching/score.ts";

// Invented inputs. The brief wants a town and a size band, nothing else, so the
// score is the location weight (25) plus the size weight (15) out of 40.
function req(id: string, title = `Brief ${id}`) {
  return {
    id,
    title,
    target_towns: ["Leeds"],
    target_regions: [],
    target_counties: [],
    target_postcode_districts: [],
    target_neighbourhoods: [],
    target_london_zones: [],
    min_sqft: 1000,
    max_sqft: 3000,
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
  };
}

function listing(
  id: string,
  over: Partial<{
    status: string | null;
    listing_type: string;
    city: string | null;
    size_sqft: number | null;
    title: string;
  }> = {},
) {
  return {
    id,
    title: over.title ?? `Listing ${id}`,
    status: over.status === undefined ? "Available" : over.status,
    listing_type: over.listing_type ?? "cdg",
    city: over.city === undefined ? "Leeds" : over.city,
    area: null,
    postcode: null,
    address_line: null,
    county: null,
    lat: null,
    lng: null,
    size_sqft: over.size_sqft === undefined ? 2000 : over.size_sqft,
    covers_internal: null,
    use_class: null,
    property_type: null,
    disposal_type: "new_lease",
    rent_pa: null,
    premium: null,
    guide_price: null,
    fit_out_state: null,
  };
}

test("the fixtures score as the other tests assume", () => {
  const r = req("r1");
  // The brief sets 40 of 100 points (town and size), so it is thin: a perfect
  // fit scores 100 x 40 / 50 = 80, not 100.
  assert.equal(scoreMatch(r, listing("a")).score, 80);
  // Right town, size outside the band: only the 25 location points of 40.
  const partial = scoreMatch(r, listing("b", { size_sqft: 9000 })).score;
  assert.ok(partial >= MIN_MATCH_SCORE && partial < 100, String(partial));
  // Wrong town, size inside the band: 15 of 40.
  const low = scoreMatch(r, listing("c", { city: "Bath" })).score;
  assert.ok(low < MIN_MATCH_SCORE, String(low));
});

test("an intel listing is scored like a CDG listing and keeps its type", () => {
  const [g] = groupTopMatches(
    [req("r1")],
    [listing("cdg-1"), listing("intel-1", { listing_type: "intel" })],
  );
  const types = g.top.map((m) => m.listing.listing_type).sort();
  assert.deepEqual(types, ["cdg", "intel"]);
});

test("a let, sold or withdrawn listing is never offered, even at 100", () => {
  const dead = ["Let", "Sold", "Withdrawn", "Completed", "Unavailable"].map((status, i) =>
    listing(`dead-${i}`, { status }),
  );
  const [g] = groupTopMatches([req("r1")], [...dead, listing("live")]);
  assert.deepEqual(
    g.top.map((m) => m.listing.id),
    ["live"],
  );
  assert.equal(g.further, 0);
  // Under offer and unknown status stay in play.
  const [h] = groupTopMatches(
    [req("r1")],
    [listing("uo", { status: "Under Offer" }), listing("nil", { status: null })],
  );
  assert.equal(h.top.length, 2);
});

test("matches below the minimum score are left out", () => {
  const [g] = groupTopMatches([req("r1")], [listing("far", { city: "Bath" })]);
  assert.deepEqual(g.top, []);
  assert.equal(g.further, 0);
  // The threshold is a parameter and is applied: raise it and a 63 drops out.
  const ok = listing("near", { size_sqft: 9000 });
  assert.equal(groupTopMatches([req("r1")], [ok])[0].top.length, 1);
  assert.equal(groupTopMatches([req("r1")], [ok], { minScore: 90 })[0].top.length, 0);
});

test("only the top five are returned and the rest are counted", () => {
  const listings = Array.from({ length: 8 }, (_, i) => listing(`l${i}`));
  const [g] = groupTopMatches([req("r1")], listings);
  assert.equal(g.top.length, TOP_PER_REQUIREMENT);
  assert.equal(g.further, 3);
  // Equal scores tie-break on id, so the five are the same on every run.
  assert.deepEqual(
    g.top.map((m) => m.listing.id),
    ["l0", "l1", "l2", "l3", "l4"],
  );
  const reversed = groupTopMatches([req("r1")], [...listings].reverse())[0];
  assert.deepEqual(
    reversed.top.map((m) => m.listing.id),
    g.top.map((m) => m.listing.id),
  );
});

test("better scores come first", () => {
  const [g] = groupTopMatches(
    [req("r1")],
    [listing("b-mid", { size_sqft: 9000 }), listing("a-best")],
  );
  assert.deepEqual(
    g.top.map((m) => m.listing.id),
    ["a-best", "b-mid"],
  );
  assert.ok(g.top[0].score > g.top[1].score);
});

test("a rejected pair is hidden and a shortlisted pair goes first", () => {
  const statusByPair = new Map([
    ["r1:rejected", "rejected"],
    ["r1:short", "shortlisted"],
    // Same listing id under another requirement must not leak across pairs.
    ["r2:best", "rejected"],
  ]);
  const [g] = groupTopMatches(
    [req("r1")],
    [listing("rejected"), listing("best"), listing("short", { size_sqft: 9000 })],
    { statusByPair },
  );
  assert.deepEqual(
    g.top.map((m) => [m.listing.id, m.shortlisted]),
    [
      ["short", true],
      ["best", false],
    ],
  );
  assert.equal(g.further, 0);
});

test("requirements keep their order and each is scored on its own", () => {
  const strict = { ...req("r2"), target_towns: ["Bath"] };
  const groups = groupTopMatches([req("r1"), strict], [listing("leeds-1")]);
  assert.deepEqual(
    groups.map((g) => g.requirement.id),
    ["r1", "r2"],
  );
  assert.equal(groups[0].top.length, 1);
  assert.equal(groups[1].top.length, 0);
});

test("no requirements and no listings give empty results", () => {
  assert.deepEqual(groupTopMatches([], [listing("a")]), []);
  const [g] = groupTopMatches([req("r1")], []);
  assert.deepEqual(g.top, []);
  assert.equal(g.further, 0);
});
