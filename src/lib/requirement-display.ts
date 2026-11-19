// Wording for the two 0046 fields on requirement screens. No imports, so server
// and client components can both use it and tests can load it directly.

export type AnchorView = {
  /** "Within 3 miles of Soho". */
  text: string;
  /** False when the place has no coordinates: the brief's location is not scored. */
  located: boolean;
};

/** The "within N miles of X" line, or null when the brief has no radius or no place. */
export function describeAnchor(r: {
  location_anchor_text: string | null;
  location_anchor_lat: number | null;
  location_anchor_lng: number | null;
  location_radius_miles: number | null;
}): AnchorView | null {
  const place = r.location_anchor_text?.trim();
  if (!place || r.location_radius_miles == null) return null;
  const n = Number(r.location_radius_miles);
  if (!Number.isFinite(n) || n <= 0) return null;
  const miles = +n.toFixed(2);
  return {
    text: `Within ${miles} ${miles === 1 ? "mile" : "miles"} of ${place}`,
    located: r.location_anchor_lat != null && r.location_anchor_lng != null,
  };
}

/** "£25/sq ft" or "£12.50/sq ft"; "—" when there is no ceiling. */
export function formatRentPsf(value: number | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `£${Number(text).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}/sq ft`;
}
