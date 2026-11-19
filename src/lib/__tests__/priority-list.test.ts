import test from "node:test";
import assert from "node:assert/strict";
import { countStrongMatches, shapePriorityRow } from "../priority-list.ts";

type Req = Parameters<typeof countStrongMatches>[0];
type Listing = Parameters<typeof countStrongMatches>[1][number];

const req = (over: Partial<Req> = {}): Req =>
  ({
    target_towns: ["Leeds"],
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
  }) as Req;

const listing = (over: Partial<Listing> = {}): Listing =>
  ({
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
  }) as Listing;

test("countStrongMatches counts only listings scoring 50 or more", () => {
  const hit = listing({ city: "Leeds" });
  const miss = listing({ city: "Plymouth" });
  assert.equal(countStrongMatches(req(), [hit, hit, miss]), 2);
  assert.equal(countStrongMatches(req(), [miss]), 0);
  assert.equal(countStrongMatches(req(), []), 0);
});

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    title: "Brief",
    lead_agent_id: "u1",
    company_id: "c1",
    target_towns: ["Leeds", "York", "Hull"],
    target_regions: [],
    target_counties: ["Yorkshire", "Notts"],
    target_postcode_districts: [],
    target_neighbourhoods: [],
    target_london_zones: [],
    min_sqft: 1000,
    max_sqft: 2000,
    min_covers: null,
    max_covers: null,
    use_classes: [],
    tenure_prefs: [],
    max_rent: 50000,
    max_premium: null,
    max_guide_price: null,
    location_anchor_text: null,
    location_anchor_lat: null,
    location_anchor_lng: null,
    location_radius_miles: null,
    max_rent_psf: null,
    status: "active",
    listing_rating: 5,
    date_updated: "2026-11-01T10:00:00Z",
    company_name: "Acme",
    contact_id: "k1",
    contact_first_name: "Ann",
    contact_last_name: "Lee",
    contact_email: "ann@acme.test",
    contact_phone: "020 7946 0000",
    contact_mobile: null,
    lead_agent_name: "Bo",
    ...over,
  }) as Parameters<typeof shapePriorityRow>[0];

test("shapePriorityRow shapes locations, call number, email and budget", () => {
  const d = shapePriorityRow(row(), 3);
  assert.deepEqual(d.locations, { shown: ["Leeds", "York", "Hull"], more: 2 });
  assert.equal(d.call?.href, "tel:02079460000");
  assert.equal(d.emailHref, "mailto:ann@acme.test");
  assert.equal(d.contactName, "Ann Lee");
  assert.equal(d.budgetText, "£50,000 pa");
  assert.equal(d.sizeText, "1,000–2,000 sq ft");
  assert.equal(d.matchCount, 3);
});

test("shapePriorityRow: no contact details gives no email, no call, no name", () => {
  const d = shapePriorityRow(
    row({
      contact_id: null,
      contact_first_name: null,
      contact_last_name: null,
      contact_email: null,
      contact_phone: null,
      max_rent: null,
    }),
    0,
  );
  assert.equal(d.emailHref, null);
  assert.equal(d.call, null);
  assert.equal(d.contactName, null);
  assert.equal(d.budgetText, "—");
});

test("shapePriorityRow prefers the mobile number", () => {
  assert.equal(shapePriorityRow(row({ contact_mobile: "07700 900123" }), 0).call?.href, "tel:07700900123");
});
