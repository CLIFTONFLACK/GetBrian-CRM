"use client";

import * as React from "react";
import { useMemo } from "react";

import { LocationMultiPicker, type PickedLocation } from "@/components/location-select";
import { classifyLocation, type LocationKind } from "@/lib/locations/options";

/**
 * Unified "Target locations" field for the requirement form: one searchable
 * multi-select across London transport zones, towns, London neighbourhoods,
 * counties, regions and postcode districts, partitioned into the six
 * requirement array columns via hidden inputs.
 */
export function TargetLocationsField({
  towns = [],
  regions = [],
  counties = [],
  districts = [],
  neighbourhoods = [],
  zones = [],
}: {
  towns?: readonly string[];
  regions?: readonly string[];
  counties?: readonly string[];
  districts?: readonly string[];
  neighbourhoods?: readonly string[];
  zones?: readonly string[];
}) {
  const defaultSelected = useMemo(() => {
    const seed = (values: readonly string[], stored: LocationKind): PickedLocation[] =>
      values
        .filter((v) => v.trim())
        // Legacy free-text values may be misfiled (e.g. "W1" saved as a town) —
        // reclassify against the dataset, falling back to the stored kind.
        .map((v) => ({ kind: classifyLocation(v) ?? stored, value: v }));
    const all = [
      ...seed(zones, "zone"),
      ...seed(towns, "town"),
      ...seed(neighbourhoods, "neighbourhood"),
      ...seed(counties, "county"),
      ...seed(regions, "region"),
      ...seed(districts, "district"),
    ];
    return all.filter(
      (p, i) => all.findIndex((q) => q.value.toLowerCase() === p.value.toLowerCase()) === i,
    );
  }, [towns, regions, counties, districts, neighbourhoods, zones]);

  return (
    <LocationMultiPicker
      idBase="target-locations"
      label="Target locations"
      // Order drives both the suggestion groups and their headings: zones are
      // tiny and highly specific, so they lead; districts are the long tail.
      kinds={["zone", "neighbourhood", "town", "county", "region", "district"]}
      namesByKind={{
        zone: "target_london_zones",
        neighbourhood: "target_neighbourhoods",
        town: "target_towns",
        county: "target_counties",
        region: "target_regions",
        district: "target_postcode_districts",
      }}
      defaultSelected={defaultSelected}
      placeholder="Search zones, neighbourhoods, towns, counties, postcodes…"
      hint='London transport zones ("Zone 1") and neighbourhoods ("Soho"), plus towns, counties (incl. "Home Counties"), regions and postcode districts (e.g. W1). Unlisted places can be typed freely.'
    />
  );
}
