import { USE_CLASS_OPTIONS } from "../use-classes.ts";
import type { FieldDef, Registry } from "./types.ts";

export const REQUIREMENT_STATUSES = ["active", "on_hold", "satisfied", "withdrawn"] as const;
export const REQUIREMENT_TENURES = ["freehold", "leasehold", "assignment", "new_letting"] as const;

/** numeric(8,2): no real rent per square foot comes near this (see src/lib/requirement-anchor.ts). */
const MAX_RENT_PSF = 100_000;

const num = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  column: key,
  label,
  kind: "number",
  min: 0,
  ...extra,
});
const places = (key: string, label: string): FieldDef => ({ key, column: key, label, kind: "tags", maxLength: 1000 });

/**
 * Requirement fields the panel can edit one at a time. The use classes and
 * tenure (a list of choices), the place and radius, the company and contact,
 * and the agents have their own actions. Every patch re-scores the brief.
 */
export const REQUIREMENT_FIELDS: Registry = {
  title: { key: "title", column: "title", label: "Title", kind: "text", required: true, maxLength: 200 },
  status: {
    key: "status",
    column: "status",
    label: "Status",
    kind: "select",
    required: true,
    options: REQUIREMENT_STATUSES,
  },
  notes: { key: "notes", column: "notes", label: "Summary note", kind: "textarea" },
  min_sqft: num("min_sqft", "Smallest size (sq ft)"),
  max_sqft: num("max_sqft", "Largest size (sq ft)"),
  min_covers: num("min_covers", "Fewest covers", { integer: true }),
  max_covers: num("max_covers", "Most covers", { integer: true }),
  max_rent: num("max_rent", "Highest rent (per year)"),
  max_rent_psf: num("max_rent_psf", "Highest rent per sq ft", { min: 0.01, max: MAX_RENT_PSF - 0.01 }),
  max_premium: num("max_premium", "Highest premium"),
  max_guide_price: num("max_guide_price", "Highest guide price"),
  target_london_zones: places("target_london_zones", "London zones"),
  target_neighbourhoods: places("target_neighbourhoods", "Areas"),
  target_towns: places("target_towns", "Towns"),
  target_counties: places("target_counties", "Counties"),
  target_regions: places("target_regions", "Regions"),
  target_postcode_districts: places("target_postcode_districts", "Postcode districts"),
};

/** The fields that hold a list of choices. They post a checkbox group. */
export const REQUIREMENT_CHOICES: Registry = {
  use_classes: {
    key: "use_classes",
    column: "use_classes",
    label: "Use class",
    kind: "multi",
    options: USE_CLASS_OPTIONS.map(([slug]) => slug),
  },
  tenure_prefs: {
    key: "tenure_prefs",
    column: "tenure_prefs",
    label: "Tenure",
    kind: "multi",
    options: REQUIREMENT_TENURES,
  },
};
