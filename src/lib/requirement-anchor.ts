// "Within N miles of X" on a requirement: validate the form fields and find the
// coordinates of X. Server-side. The geocoder is passed in (the action gives it
// geocodeAddress) so this file can be tested without a network call.
//
// Order of lookup: coordinates already stored for the SAME text (an edit that
// did not change the place must not call the geocoder again), then the offline
// gazetteer (London areas, towns, counties, postcode districts), then the
// geocoder. A geocoder hit outside the UK is refused. When nothing finds the
// place, the text and radius are still saved but the coordinates are not, so
// the brief's location is not scored, and the caller is told with a warning.

import { normName } from "@/lib/import-parse";
import { inUkBox } from "@/lib/import-followup";
import { districtCentroid, getCounty, getLondonArea, getTown } from "@/lib/locations";
import {
  COUNTY_OPTIONS,
  LONDON_AREA_OPTIONS,
  TOWN_OPTIONS,
} from "@/lib/locations/options";

export type LatLngPair = { lat: number; lng: number };

export const MIN_ANCHOR_MILES = 0.1;
export const MAX_ANCHOR_MILES = 50;
/** numeric(8,2) holds up to 999,999.99; no real rent per sq ft is near that. */
export const MAX_RENT_PSF = 100_000;

const DISTRICT_SHAPE = /^[A-Z]{1,2}\d[A-Z\d]?$/;

const londonByKey = new Map(LONDON_AREA_OPTIONS.map((a) => [normName(a[0]), a[0]]));
const townByKey = new Map(TOWN_OPTIONS.map((t) => [normName(t), t]));
const countyByKey = new Map(COUNTY_OPTIONS.map((c) => [normName(c), c]));

/** Coordinates from the offline gazetteer, or null. Apostrophes and case are ignored. */
export function resolveAnchorOffline(text: string): LatLngPair | null {
  const key = normName(text).replace(/\.+$/, "");
  for (const k of [key, key.replace(/,?\s*london$/, ""), key.replace(/^the\s+/, "")]) {
    const area = londonByKey.get(k);
    if (area) {
      const a = getLondonArea(area);
      if (a) return { lat: a.lat, lng: a.lng };
    }
    const town = townByKey.get(k);
    if (town) {
      const t = getTown(town);
      if (t) return { lat: t.lat, lng: t.lng };
    }
    const county = countyByKey.get(k);
    if (county) {
      const c = getCounty(county);
      if (c && c.lat !== null && c.lng !== null) return { lat: c.lat, lng: c.lng };
    }
  }
  const upper = text.trim().toUpperCase().replace(/\s+/g, "");
  if (DISTRICT_SHAPE.test(upper)) return districtCentroid(upper);
  return null;
}

export type AnchorFields = {
  locationAnchorText: string | null;
  locationAnchorLat: number | null;
  locationAnchorLng: number | null;
  locationRadiusMiles: number | null;
};

export type StoredAnchor = {
  text: string | null;
  lat: number | null;
  lng: number | null;
};

export type AnchorOutcome =
  | { ok: true; fields: AnchorFields; warning: string | null }
  | { ok: false; error: string };

const CLEARED: AnchorFields = {
  locationAnchorText: null,
  locationAnchorLat: null,
  locationAnchorLng: null,
  locationRadiusMiles: null,
};

/**
 * Turn the two form fields into what is stored. Cleared text clears the lot
 * (text, coordinates and radius). Text needs a radius and a radius needs text.
 */
export async function resolveAnchor(
  input: { text: string | null; miles: number | null; milesRaw?: string },
  stored: StoredAnchor | null,
  geocode: (text: string) => Promise<LatLngPair | null>,
): Promise<AnchorOutcome> {
  const text = (input.text ?? "").replace(/\s+/g, " ").trim();
  const raw = (input.milesRaw ?? "").trim();
  if (!text) {
    if (input.miles !== null || raw) {
      return { ok: false, error: 'Name the place in "Near (place)", or clear "Within (miles)".' };
    }
    return { ok: true, fields: CLEARED, warning: null };
  }
  if (input.miles === null) {
    return {
      ok: false,
      error: raw
        ? '"Within (miles)" must be a number.'
        : 'Enter "Within (miles)" for the place you named, or clear "Near (place)".',
    };
  }
  if (input.miles < MIN_ANCHOR_MILES || input.miles > MAX_ANCHOR_MILES) {
    return {
      ok: false,
      error: `"Within (miles)" must be between ${MIN_ANCHOR_MILES} and ${MAX_ANCHOR_MILES}.`,
    };
  }
  const miles = Math.round(input.miles * 100) / 100;
  const fields = (at: LatLngPair | null): AnchorFields => ({
    locationAnchorText: text,
    locationAnchorLat: at?.lat ?? null,
    locationAnchorLng: at?.lng ?? null,
    locationRadiusMiles: miles,
  });

  // The place did not change: keep the coordinates it already has.
  if (
    stored?.text &&
    stored.lat !== null &&
    stored.lng !== null &&
    normName(stored.text) === normName(text)
  ) {
    return { ok: true, fields: fields({ lat: stored.lat, lng: stored.lng }), warning: null };
  }

  const offline = resolveAnchorOffline(text);
  if (offline) return { ok: true, fields: fields(offline), warning: null };

  let hit: LatLngPair | null = null;
  try {
    hit = await geocode(text);
  } catch {
    hit = null;
  }
  if (hit && inUkBox(hit.lat, hit.lng)) return { ok: true, fields: fields(hit), warning: null };
  return {
    ok: true,
    fields: fields(null),
    warning: `The place "${text}" was not found, so no coordinates were saved and the location is not scored. Check the spelling, or use a town, a postcode district or a fuller address.`,
  };
}

/** A per-sq-ft ceiling the database will accept (above 0, below the column limit). */
export function rentPsfError(value: number | null): string | null {
  if (value === null) return null;
  if (!(value > 0) || value >= MAX_RENT_PSF) {
    return `"Max rent per sq ft" must be above 0 and below ${MAX_RENT_PSF.toLocaleString("en-GB")}.`;
  }
  return null;
}
