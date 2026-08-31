import type { Tables } from "@/lib/database.types";
import { containsWord } from "@/lib/text-match";
import { USE_CLASS_CONCEPTS, USE_CLASS_PLANNING } from "@/lib/use-classes";
import {
  deriveCounty,
  distanceMiles,
  districtCentroid,
  districtMatches,
  expandRegions,
  extractDistrict,
  getCounty,
  getLondonArea,
  getTown,
  londonAreasInZone,
  parseLondonZone,
  regionOfCounty,
  type LatLng,
} from "@/lib/locations";

// Pick (rather than the full row) so callers can narrow their `select()` to
// just these columns — e.g. the listing detail page, which only needs this
// subset to score matches.
type Requirement = Pick<
  Tables<"requirements">,
  | "target_towns"
  | "target_regions"
  | "target_counties"
  | "target_postcode_districts"
  | "target_neighbourhoods"
  | "target_london_zones"
  | "min_sqft"
  | "max_sqft"
  | "min_covers"
  | "max_covers"
  | "use_classes"
  | "tenure_prefs"
  | "max_rent"
  | "max_premium"
  | "max_guide_price"
>;
type Disposal = Pick<
  Tables<"disposals">,
  | "city"
  | "area"
  | "postcode"
  | "address_line"
  | "county"
  | "lat"
  | "lng"
  | "size_sqft"
  | "covers_internal"
  | "use_class"
  | "property_type"
  | "disposal_type"
  | "rent_pa"
  | "premium"
  | "guide_price"
>;

export type MatchReason = { label: string; ok: boolean; partial?: boolean };
export type MatchResult = { score: number; reasons: MatchReason[] };
export type ScoreOptions = {
  /**
   * Location flexibility 0–100: how far outside the targeted locations a
   * disposal may sit and still earn partial location credit. 0 = exact
   * matches only (legacy behaviour); the search radius is (flex / 100) × 25
   * miles, with credit fading linearly to zero at the edge.
   */
  locationFlex?: number;
};

export const DEFAULT_LOCATION_FLEX = 50;
const MAX_RADIUS_MILES = 25;
/** Proximity credit is capped below 1 so a nearby miss never beats a direct hit. */
const PROXIMITY_CAP = 0.8;
/**
 * Extra search radius allowed around a COUNTY centroid. A county centroid can
 * sit 20–30 miles from its own border, so a listing "just over the line" from a
 * targeted county would otherwise never come within the town-sized radius. The
 * bonus only applies when flex > 0 (flex 0 still means exact matches only).
 */
const COUNTY_RADIUS_BONUS_MILES = 15;
/**
 * Hard reach caps for the fine-grained London targets. A neighbourhood or a
 * fare zone is a small, dense thing — "Soho" must not pull in a listing 20
 * miles away just because the flex slider is wide open, the way a county
 * target legitimately can.
 */
const NEIGHBOURHOOD_MAX_REACH_MILES = 3;
const ZONE_MAX_REACH_MILES = 2;

const lc = (s: string) => s.toLowerCase();
const gbp = (n: number) => `£${Number(n).toLocaleString("en-GB")}`;
const num = (n: number) => Number(n).toLocaleString("en-GB");

// Requirement tenure preference -> acceptable disposal_type values.
// The form now offers only Freehold and Leasehold, so "leasehold" has to carry
// every leasehold structure — including assignments, which used to be their own
// (now retired) option.
const TENURE_MAP: Record<string, string[]> = {
  freehold: ["freehold"],
  leasehold: ["new_lease", "sublease", "lease_assignment"],
  new_letting: ["new_lease"],
  assignment: ["lease_assignment"],
};

function withinBand(
  v: number | null,
  min: number | null,
  max: number | null,
): boolean {
  if (v == null) return false;
  if (min != null && v < min) return false;
  if (max != null && v > max) return false;
  return true;
}

/** Credit for a listing that only agrees on the planning class, not the concept. */
const PLANNING_ONLY_CREDIT = 0.6;

/**
 * Use-class factor 0–1. A disposal records its trade twice and unreliably:
 * `property_type` is the concept in free text ("Bar / Restaurant") and
 * `use_class` is the planning class ("Class E", "Sui Generis"). The concept is
 * far more precise, so a listing that states its own type is judged on that
 * alone: if an operator wants a Pub, a listing marked "Restaurant" is a miss,
 * not a partial hit, even though both can sit in the same planning class.
 */
function scoreUseClass(
  reqClasses: readonly string[],
  d: Disposal,
): { factor: number; label: string } {
  const type = d.property_type?.trim() ?? "";
  const hits = (map: Record<string, string[]>, haystack: string) =>
    reqClasses.some((rc) => (map[rc] ?? []).some((w) => containsWord(haystack, w)));

  if (type) {
    const ok = hits(USE_CLASS_CONCEPTS, lc(type));
    return { factor: ok ? 1 : 0, label: `Type: ${type}` };
  }
  const planning = d.use_class?.trim() ?? "";
  if (planning && hits(USE_CLASS_PLANNING, lc(planning))) {
    return { factor: PLANNING_ONLY_CREDIT, label: `Use class: ${planning} (planning only)` };
  }
  return { factor: 0, label: `Type: ${planning || "—"}` };
}

const DISTRICT_RE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?$/;

/**
 * A named coordinate for the proximity pass. `bonus` widens the search radius
 * around coarse points (county centroids); `maxReach` caps it for fine ones
 * (London neighbourhoods and fare zones).
 */
type TargetPoint = { name: string; at: LatLng; bonus: number; maxReach?: number };

type ResolvedTargets = {
  /** Lowercased free-text targets for the whole-word containment pass. */
  text: string[];
  /** Lowercased county targets (incl. Home Counties expansion). */
  counties: string[];
  /** Lowercased region targets (after Home Counties expansion). */
  regions: string[];
  /**
   * Uppercased district codes — from the district column, district-shaped
   * towns, and the districts covered by any targeted London neighbourhood or
   * fare zone.
   */
  districts: string[];
  points: TargetPoint[];
  any: boolean;
};

// The matches page scores every requirement against every disposal; resolve
// each requirement's targets once, not once per pair.
const targetCache = new WeakMap<Requirement, ResolvedTargets>();

function resolveTargets(req: Requirement): ResolvedTargets {
  const cached = targetCache.get(req);
  if (cached) return cached;

  const towns = req.target_towns.filter(Boolean);
  const expanded = expandRegions(req.target_regions.filter(Boolean));
  const counties = [...req.target_counties, ...expanded.counties].filter(Boolean);
  const neighbourhoods = (req.target_neighbourhoods ?? []).filter(Boolean);
  const zones = (req.target_london_zones ?? []).filter(Boolean);
  // Legacy free-text targets like "W1" may be filed under towns — treat
  // district-shaped values as districts everywhere.
  const districts = [
    ...req.target_postcode_districts,
    ...towns.filter((t) => DISTRICT_RE.test(t.trim())),
  ].map((t) => t.trim().toUpperCase());

  const points: TargetPoint[] = [];

  // London neighbourhoods resolve to their own postcode districts (a direct
  // hit) plus a tight proximity circle. Names that aren't in the dataset —
  // typed freely — still work through the text pass below.
  for (const n of neighbourhoods) {
    const area = getLondonArea(n);
    if (!area) continue;
    districts.push(...area.districts);
    points.push({
      name: area.name,
      at: { lat: area.lat, lng: area.lng },
      bonus: 0,
      maxReach: NEIGHBOURHOOD_MAX_REACH_MILES,
    });
  }

  // A fare zone is the union of its neighbourhoods: their districts give direct
  // hits, their centroids give a short-range fallback for listings whose
  // postcode we can't place.
  for (const z of zones) {
    const zone = parseLondonZone(z);
    if (zone == null) continue;
    for (const area of londonAreasInZone(zone)) {
      districts.push(...area.districts);
      points.push({
        name: `${area.name} (Zone ${zone})`,
        at: { lat: area.lat, lng: area.lng },
        bonus: 0,
        maxReach: ZONE_MAX_REACH_MILES,
      });
    }
  }

  for (const t of towns) {
    if (DISTRICT_RE.test(t.trim())) continue;
    const town = getTown(t);
    if (town)
      points.push({ name: town.name, at: { lat: town.lat, lng: town.lng }, bonus: 0 });
  }
  for (const code of districts) {
    const at = districtCentroid(code);
    if (at) points.push({ name: code, at, bonus: 0 });
  }
  // County targets get proximity credit too (#18): a listing a couple of miles
  // the wrong side of a county line used to score a flat zero while an
  // equivalent town brief scored ~0.7. Measured from the county centroid, so it
  // carries a wider radius (see COUNTY_RADIUS_BONUS_MILES).
  for (const c of counties) {
    const county = getCounty(c);
    if (county?.lat != null && county.lng != null) {
      points.push({
        name: county.name,
        at: { lat: county.lat, lng: county.lng },
        bonus: COUNTY_RADIUS_BONUS_MILES,
      });
    }
  }

  const resolved: ResolvedTargets = {
    // Neighbourhoods join the text pass so a listing filed under `area = "Soho"`
    // scores a direct hit even when its postcode is missing.
    text: [...towns, ...req.target_regions, ...counties, ...neighbourhoods]
      .map(lc)
      .filter(Boolean),
    counties: counties.map(lc),
    regions: expanded.regions.map(lc),
    districts: [...new Set(districts)],
    points,
    any:
      towns.length > 0 ||
      req.target_regions.length > 0 ||
      counties.length > 0 ||
      neighbourhoods.length > 0 ||
      zones.length > 0 ||
      districts.length > 0,
  };
  targetCache.set(req, resolved);
  return resolved;
}

/** Disposal coordinates: stored lat/lng, else postcode-district centroid, else town. */
function disposalCoords(d: Disposal): LatLng | null {
  if (d.lat != null && d.lng != null) return { lat: d.lat, lng: d.lng };
  const fromDistrict = districtCentroid(extractDistrict(d.postcode));
  if (fromDistrict) return fromDistrict;
  const town = getTown(d.city);
  return town ? { lat: town.lat, lng: town.lng } : null;
}

/**
 * Location factor 0–1: 1 for a direct hit (targeted town/county/region text or
 * postcode district); otherwise, when flex > 0, partial credit fading linearly
 * with distance from the nearest targeted town, district or county centroid.
 */
function locationFactor(
  t: ResolvedTargets,
  d: Disposal,
  flex: number,
): { factor: number; label: string } {
  const place = [d.city, d.area, d.postcode, d.address_line]
    .filter(Boolean)
    .map((x) => lc(x as string))
    .join(" ");
  const fallback = `Location: ${d.city ?? "—"}`;

  // Whole-word containment, not raw substring: target "Ash" must not score a
  // direct hit on "Ashford" or "Ashley Road" (#18).
  if (t.text.some((target) => containsWord(place, target)))
    return { factor: 1, label: fallback };

  const disposalDistrict = extractDistrict(d.postcode);
  if (
    disposalDistrict &&
    t.districts.some((target) => districtMatches(target, disposalDistrict))
  ) {
    return { factor: 1, label: `Location: ${disposalDistrict}` };
  }

  const county = d.county ?? deriveCounty({ postcode: d.postcode, city: d.city });
  if (county) {
    if (t.counties.includes(lc(county)))
      return { factor: 1, label: `Location: ${county}` };
    const region = regionOfCounty(county);
    if (region && t.regions.includes(lc(region)))
      return { factor: 1, label: `Location: ${region}` };
  }

  const radius = (Math.min(Math.max(flex, 0), 100) / 100) * MAX_RADIUS_MILES;
  if (radius > 0 && t.points.length > 0) {
    const at = disposalCoords(d);
    if (at) {
      // Best = strongest credit, not merely nearest: a coarse county centroid
      // carries a wider radius, so 20 mi from a county can beat 20 mi from a
      // town (which earns nothing at all).
      let best: { name: string; dist: number; factor: number } | null = null;
      for (const p of t.points) {
        const reach = Math.min(radius + p.bonus, p.maxReach ?? Infinity);
        if (reach <= 0) continue;
        const dist = distanceMiles(p.at, at);
        if (dist > reach) continue;
        const factor = PROXIMITY_CAP * (1 - dist / reach);
        if (!best || factor > best.factor) best = { name: p.name, dist, factor };
      }
      if (best) {
        return {
          factor: best.factor,
          label: `Location: ${best.dist < 0.95 ? "under a mile" : `~${Math.round(best.dist)} mi`} from ${best.name}`,
        };
      }
    }
  }

  return { factor: 0, label: fallback };
}

/**
 * Score how well a disposal (supply) satisfies a requirement (demand), 0–100,
 * with per-dimension reasons. Only the criteria the requirement actually
 * specifies count toward the denominator, so an empty brief doesn't punish.
 * Budget caps treat "POA" (null) as a pass; size/covers bands need a known value.
 */
export function scoreMatch(
  req: Requirement,
  d: Disposal,
  opts: ScoreOptions = {},
): MatchResult {
  const reasons: MatchReason[] = [];
  let gained = 0;
  let possible = 0;
  const add = (
    weight: number,
    applicable: boolean,
    okOrFactor: boolean | number,
    label: string,
  ) => {
    if (!applicable) return;
    const factor = typeof okOrFactor === "number" ? okOrFactor : okOrFactor ? 1 : 0;
    possible += weight;
    gained += weight * factor;
    reasons.push({
      label,
      ok: factor >= 0.999,
      ...(factor > 0 && factor < 0.999 ? { partial: true } : {}),
    });
  };

  const targets = resolveTargets(req);
  const loc = locationFactor(targets, d, opts.locationFlex ?? DEFAULT_LOCATION_FLEX);
  add(25, targets.any, loc.factor, loc.label);

  add(
    15,
    req.min_sqft != null || req.max_sqft != null,
    withinBand(d.size_sqft, req.min_sqft, req.max_sqft),
    `Size: ${d.size_sqft != null ? `${num(d.size_sqft)} sq ft` : "unknown"}`,
  );

  add(
    10,
    req.min_covers != null || req.max_covers != null,
    withinBand(d.covers_internal, req.min_covers, req.max_covers),
    `Covers: ${d.covers_internal != null ? d.covers_internal : "unknown"}`,
  );

  // Use class absorbed the old, separate "property types" dimension — the two
  // asked the same question of the same listing, so they now share one weight.
  const use = scoreUseClass(req.use_classes, d);
  add(20, req.use_classes.length > 0, use.factor, use.label);

  add(
    10,
    req.tenure_prefs.length > 0,
    req.tenure_prefs.some((p) => (TENURE_MAP[p] ?? []).includes(d.disposal_type)),
    `Tenure: ${d.disposal_type}`,
  );

  add(
    10,
    req.max_rent != null,
    d.rent_pa == null || d.rent_pa <= (req.max_rent as number),
    `Rent: ${d.rent_pa != null ? `${gbp(d.rent_pa)} pa` : "POA"} vs max ${gbp(req.max_rent ?? 0)}`,
  );

  add(
    5,
    req.max_premium != null,
    d.premium == null || d.premium <= (req.max_premium as number),
    `Premium: ${d.premium != null ? gbp(d.premium) : "—"}`,
  );

  add(
    5,
    req.max_guide_price != null,
    d.guide_price == null || d.guide_price <= (req.max_guide_price as number),
    `Guide: ${d.guide_price != null ? gbp(d.guide_price) : "—"}`,
  );

  const score = possible > 0 ? Math.round((gained / possible) * 100) : 0;
  return { score, reasons };
}

/**
 * Deterministic ordering for a scored match list.
 *
 * Sorting on `score` alone leaves ties in whatever order the rows arrived from
 * Postgres, which is not stable between requests — and because the record pages
 * take the top 10, a tie doesn't merely reshuffle the list, it decides which
 * matches an agent ever sees. A real brief hit this: with no target location it
 * was scored on size and use class alone, seven listings tied at 100%, and the
 * one the brief was actually written against sat last in row order.
 *
 * The tiers, in order:
 *
 *  1. `score` — the headline number, unchanged.
 *  2. How many dimensions were applicable. `score` is a percentage of the
 *     criteria that could be checked, so 100% from five checks is stronger
 *     evidence than 100% from two, and should outrank it. Applicability is a
 *     property of the requirement, so this separates briefs on the agency-wide
 *     board rather than listings under one brief.
 *  3. `id` — nothing meaningful left to say, so fall back to something fixed
 *     rather than to row order. This is the tier that makes the list stable.
 *
 * Note there is deliberately no tier for "passed more individual criteria":
 * at equal weighted score, clearing one 25-point dimension versus a 15 and a 10
 * is not obviously better, and inventing a preference would be noise.
 */
export function byMatchQuality<T extends MatchResult>(
  idOf: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) =>
    b.score - a.score ||
    b.reasons.length - a.reasons.length ||
    idOf(a).localeCompare(idOf(b));
}
