import type { FieldDef, Registry } from "./types.ts";

// Values the database and the matcher accept. They mirror disposalFieldsFromForm
// in src/lib/actions/disposals.ts (and the price_qualifier check, migration 0004).
export const LISTING_TYPES = ["cdg", "intel"] as const;
export const DISPOSAL_TYPES = ["freehold", "new_lease", "lease_assignment", "sublease", "unknown"] as const;
export const FIT_OUT_STATES = ["fully_fitted", "part_fitted", "shell"] as const;
export const PRICE_QUALIFIERS = ["fixed", "offers_in_region", "offers_in_excess", "on_application"] as const;
/** The five statuses the listing screens drive. Scraped rows may carry others; they stay as they are until edited. */
export const LISTING_STATUSES = ["Available", "Under Offer", "Let", "Sold", "Withdrawn"] as const;

const money = (key: string, label: string): FieldDef => ({ key, column: key, label, kind: "number", min: 0 });
const textarea = (key: string, label: string): FieldDef => ({ key, column: key, label, kind: "textarea" });
const text = (key: string, label: string, maxLength = 200): FieldDef => ({
  key,
  column: key,
  label,
  kind: "text",
  maxLength,
});
const flag = (key: string, label: string): FieldDef => ({ key, column: key, label, kind: "boolean" });

/**
 * Listing (disposals) fields the panel can edit one at a time. The address
 * block, the use classes, the company and contact, and the agents have their own
 * actions. Changing rent or premium also clears the scraped raw text (see
 * panel-edit-listing.ts).
 */
export const LISTING_FIELDS: Registry = {
  title: { key: "title", column: "title", label: "Title", kind: "text", required: true, maxLength: 200 },
  listing_type: {
    key: "listing_type",
    column: "listing_type",
    label: "Listing type",
    kind: "select",
    required: true,
    options: LISTING_TYPES,
  },
  status: { key: "status", column: "status", label: "Status", kind: "select", options: LISTING_STATUSES },
  disposal_type: {
    key: "disposal_type",
    column: "disposal_type",
    label: "Disposal type",
    kind: "select",
    required: true,
    options: DISPOSAL_TYPES,
  },
  to_let: flag("to_let", "To let"),
  for_sale: flag("for_sale", "For sale"),
  area: text("area", "Area", 120),
  size_sqft: money("size_sqft", "Size (sq ft)"),
  size_sqm: money("size_sqm", "Size (sq m)"),
  covers_internal: { key: "covers_internal", column: "covers_internal", label: "Covers (internal)", kind: "number", min: 0, integer: true },
  covers_external: { key: "covers_external", column: "covers_external", label: "Covers (external)", kind: "number", min: 0, integer: true },
  fit_out_state: {
    key: "fit_out_state",
    column: "fit_out_state",
    label: "Fit-out",
    kind: "select",
    options: FIT_OUT_STATES,
  },
  epc_rating: text("epc_rating", "EPC rating", 10),
  tenure_raw: text("tenure_raw", "Tenure", 120),
  rent_pa: money("rent_pa", "Rent (per year)"),
  premium: money("premium", "Premium"),
  guide_price: money("guide_price", "Guide price"),
  rateable_value: money("rateable_value", "Rateable value"),
  service_charge: money("service_charge", "Service charge"),
  business_rates: money("business_rates", "Business rates"),
  estate_charge: money("estate_charge", "Estate charge"),
  parking_charge: money("parking_charge", "Parking charge"),
  key_features: { key: "key_features", column: "key_features", label: "Key features", kind: "tags", maxLength: 5000 },
  description: textarea("description", "Description"),
  summary: textarea("summary", "Summary"),
  location_description: textarea("location_description", "Location description"),
  licensing_notes: textarea("licensing_notes", "Licensing notes"),
  vat_applicable: flag("vat_applicable", "VAT applicable"),
  inside_1954_act: flag("inside_1954_act", "Inside the 1954 Act"),
  lease_term_years: { key: "lease_term_years", column: "lease_term_years", label: "Lease term (years)", kind: "number", min: 0, max: 999, integer: true },
  lease_expiry: { key: "lease_expiry", column: "lease_expiry", label: "Lease expiry", kind: "date" },
  rent_review_basis: text("rent_review_basis", "Rent review basis"),
  next_rent_review: { key: "next_rent_review", column: "next_rent_review", label: "Next rent review (year)", kind: "number", min: 1900, max: 2200, integer: true },
  rent_period: text("rent_period", "Rent period", 40),
  price_qualifier: {
    key: "price_qualifier",
    column: "price_qualifier",
    label: "Price qualifier",
    kind: "select",
    options: PRICE_QUALIFIERS,
  },
  brochure_url: { key: "brochure_url", column: "brochure_url", label: "Brochure link", kind: "url", maxLength: 500 },
};
