// UK location dropdown options — client-safe (names/codes only, no centroids).
//
// Contains OS data © Crown copyright and database right. Contains Royal Mail
// data © Royal Mail copyright and database right. Contains ONS data © Crown
// copyright and database right. Licensed under the Open Government Licence
// v3.0. Source CSV via doogal.co.uk. Regenerate with
// `node scripts/build-uk-locations.mjs`.
//
// London neighbourhoods and fare zones come from the hand-curated
// `london-areas.json` (regenerate its options with
// `node scripts/build-london-areas.mjs`).

import options from "./data/uk-location-options.json";
import londonOptions from "./data/london-area-options.json";

export type LocationKind =
  | "town"
  | "county"
  | "region"
  | "district"
  | "neighbourhood"
  | "zone";

export type LocationOption = {
  kind: LocationKind;
  /** Stored value — place name, district code, or "Zone 3". */
  value: string;
  /** Extra display context, e.g. the district's post town or an area's borough. */
  detail?: string;
  /**
   * Text the search should consider besides `value`, when that differs from
   * what's displayed. A neighbourhood shows "Westminster · Zone 1" but must not
   * turn up under the query "zone" — only its borough is worth searching.
   * Defaults to `detail`.
   */
  search?: string;
};

export const REGION_OPTIONS: string[] = options.regions;
export const COUNTY_OPTIONS: string[] = options.counties;
export const TOWN_OPTIONS: string[] = options.towns;
export const DISTRICT_OPTIONS: [code: string, town: string][] =
  options.districts as [string, string][];

/** London neighbourhoods as `[name, borough, fare zone]`. */
export const LONDON_AREA_OPTIONS: [name: string, borough: string, zone: number][] =
  londonOptions.areas as [string, string, number][];

/** The stored/display form of a fare zone — "Zone 1" … "Zone 9". */
export const zoneLabel = (zone: number) => `Zone ${zone}`;

export const LONDON_ZONE_OPTIONS: string[] = londonOptions.zones.map(zoneLabel);

export const KIND_LABELS: Record<LocationKind, string> = {
  town: "Towns",
  county: "Counties",
  region: "Regions",
  district: "Postcode districts",
  neighbourhood: "London neighbourhoods",
  zone: "London transport zones",
};

export function optionsForKinds(kinds: readonly LocationKind[]): LocationOption[] {
  const out: LocationOption[] = [];
  for (const kind of kinds) {
    if (kind === "town") for (const value of TOWN_OPTIONS) out.push({ kind, value });
    if (kind === "county") for (const value of COUNTY_OPTIONS) out.push({ kind, value });
    if (kind === "region") for (const value of REGION_OPTIONS) out.push({ kind, value });
    if (kind === "district")
      for (const [code, town] of DISTRICT_OPTIONS)
        out.push({ kind, value: code, detail: town || undefined });
    if (kind === "neighbourhood")
      for (const [name, borough, zone] of LONDON_AREA_OPTIONS)
        out.push({
          kind,
          value: name,
          detail: `${borough} · ${zoneLabel(zone)}`,
          search: borough,
        });
    if (kind === "zone")
      for (const [i, value] of LONDON_ZONE_OPTIONS.entries())
        out.push({
          kind,
          value,
          detail: i === 0 ? "central London" : "London fare zone",
        });
  }
  return out;
}

const lcSet = (values: readonly string[]) => new Set(values.map((v) => v.toLowerCase()));
const townSet = lcSet(TOWN_OPTIONS);
const countySet = lcSet(COUNTY_OPTIONS);
const regionSet = lcSet(REGION_OPTIONS);
const districtSet = new Set(DISTRICT_OPTIONS.map(([code]) => code));
const neighbourhoodSet = lcSet(LONDON_AREA_OPTIONS.map(([name]) => name));
const zoneSet = lcSet(LONDON_ZONE_OPTIONS);

/**
 * Best-effort kind for a stored value (used to re-seed chips when editing a
 * record saved before structured locations, or typed as free text).
 *
 * Zones are checked first (nothing else looks like "Zone 3") and neighbourhoods
 * last of the named kinds, so a value that is both a post town and a London
 * area — Richmond, Croydon, Sutton — keeps its broader town meaning.
 */
export function classifyLocation(value: string): LocationKind | null {
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (zoneSet.has(lower)) return "zone";
  if (regionSet.has(lower)) return "region";
  if (countySet.has(lower)) return "county";
  if (townSet.has(lower)) return "town";
  if (neighbourhoodSet.has(lower)) return "neighbourhood";
  const upper = v.toUpperCase();
  if (districtSet.has(upper) || /^[A-Z]{1,2}\d[A-Z\d]?$/.test(upper)) return "district";
  return null;
}
