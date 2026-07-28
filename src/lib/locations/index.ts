// UK locations reference data — server-side helpers.
//
// Contains OS data © Crown copyright and database right. Contains Royal Mail
// data © Royal Mail copyright and database right. Contains ONS data © Crown
// copyright and database right. Licensed under the Open Government Licence
// v3.0. Source CSV via doogal.co.uk. Regenerate the JSON with
// `node scripts/build-uk-locations.mjs`.
//
// Server-side only (same convention as lib/maps/geocode.ts): the dataset
// carries ~3,000 centroids and must not ship to the client. Never import this
// from a client component — client components use `@/lib/locations/options`.

import data from "./data/uk-locations.json";
import londonData from "./data/london-areas.json";

export type LatLng = { lat: number; lng: number };
export type LocationKind =
  | "town"
  | "county"
  | "region"
  | "district"
  | "neighbourhood"
  | "zone";

type Town = { name: string; county: string | null; region: string | null } & LatLng;
type County = {
  name: string;
  region: string | null;
  homeCounty: boolean;
  lat: number | null;
  lng: number | null;
};
type District = {
  code: string;
  town: string | null;
  county: string | null;
  region: string | null;
} & LatLng;

const towns = data.towns as Town[];
const counties = data.counties as County[];
const districts = data.districts as District[];

export const HOME_COUNTIES: readonly string[] = data.homeCounties;
export const REGIONS: readonly string[] = data.regions;

const lc = (s: string) => s.trim().toLowerCase();

const townByName = new Map(towns.map((t) => [lc(t.name), t]));
const countyByName = new Map(counties.map((c) => [lc(c.name), c]));
const districtByCode = new Map(districts.map((d) => [d.code, d]));

export function getTown(name: string | null | undefined): Town | null {
  return name ? (townByName.get(lc(name)) ?? null) : null;
}

export function getCounty(name: string | null | undefined): County | null {
  return name ? (countyByName.get(lc(name)) ?? null) : null;
}

/** "W1D 3QF" → "W1D"; "gu1" → "GU1"; garbage → null. */
export function extractDistrict(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const m = postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return m ? m[1] : null;
}

/**
 * Centroid for a district code. Exact match first; otherwise a prefix average —
 * "W1" isn't a real district (it's subdivided into W1D, W1F, …), so its
 * centroid is the mean of all W1* districts.
 */
export function districtCentroid(code: string | null | undefined): LatLng | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  const exact = districtByCode.get(c);
  if (exact) return { lat: exact.lat, lng: exact.lng };
  if (!/^[A-Z]{1,2}\d/.test(c)) return null;
  // Subdivision boundary: "W1" → W1A…W1K (letter suffix), never W10/W11.
  const members = districts.filter(
    (d) => d.code.startsWith(c) && /^[A-Z]$/.test(d.code.slice(c.length)),
  );
  if (members.length === 0) return null;
  return {
    lat: members.reduce((a, d) => a + d.lat, 0) / members.length,
    lng: members.reduce((a, d) => a + d.lng, 0) / members.length,
  };
}

/**
 * Whether a targeted district covers a disposal's district. Prefix-aware in
 * one direction: target "W1" matches disposal "W1D" (broader target covers
 * subdivisions), but target "W1D" does not match disposal "W1F".
 * A prefix only counts at a subdivision boundary — "W1" must not match "W10".
 */
export function districtMatches(target: string, disposalDistrict: string): boolean {
  const t = target.trim().toUpperCase();
  const d = disposalDistrict.trim().toUpperCase();
  if (t === d) return true;
  // target "W1" vs disposal "W1D": next char after the prefix must be a letter
  // (a digit would make it a different district, e.g. W10).
  return d.startsWith(t) && /^[A-Z]$/.test(d.slice(t.length));
}

/** Best-effort county from postcode and/or town. Fallback only — user input wins. */
export function deriveCounty(parts: {
  postcode?: string | null;
  city?: string | null;
}): string | null {
  const town = getTown(parts.city);
  if (town?.county) return town.county;
  const district = extractDistrict(parts.postcode);
  if (district) {
    const exact = districtByCode.get(district);
    if (exact?.county) return exact.county;
    // Pseudo-districts like "W1": fall back to any real district in the area.
    const area = district.match(/^[A-Z]{1,2}/)?.[0];
    if (area) {
      const sibling = districts.find((d) => d.code.startsWith(area));
      if (sibling?.county) return sibling.county;
    }
  }
  return null;
}

export function regionOfCounty(county: string | null | undefined): string | null {
  return getCounty(county ?? null)?.region ?? null;
}

/** Expand "Home Counties" into its member counties; pass other regions through. */
export function expandRegions(regions: readonly string[]): {
  regions: string[];
  counties: string[];
} {
  const out: { regions: string[]; counties: string[] } = { regions: [], counties: [] };
  for (const r of regions) {
    if (lc(r) === "home counties") out.counties.push(...HOME_COUNTIES);
    else out.regions.push(r);
  }
  return out;
}

// --- London neighbourhoods & transport fare zones -------------------------
//
// Hand-curated (see `london-areas.json`): each area carries its borough, its
// TfL fare zone, the postcode districts it dominates and an approximate
// centroid. Selecting "Soho" or "Zone 2" on a brief resolves through here into
// the same district / proximity targets the rest of the matcher already speaks.

export type LondonArea = {
  name: string;
  borough: string;
  zone: number;
  districts: string[];
} & LatLng;

const londonAreas = londonData.areas as LondonArea[];

export const LONDON_ZONES: readonly number[] = londonData.zones;

const londonAreaByName = new Map(londonAreas.map((a) => [lc(a.name), a]));

export function getLondonArea(name: string | null | undefined): LondonArea | null {
  return name ? (londonAreaByName.get(lc(name)) ?? null) : null;
}

/** "Zone 3" → 3; "3" → 3; anything else → null. */
export function parseLondonZone(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(?:zone\s*)?(\d)$/i);
  const n = m ? Number(m[1]) : NaN;
  return LONDON_ZONES.includes(n) ? n : null;
}

export function londonAreasInZone(zone: number): LondonArea[] {
  return londonAreas.filter((a) => a.zone === zone);
}

const EARTH_RADIUS_MILES = 3958.8;

export function distanceMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}
