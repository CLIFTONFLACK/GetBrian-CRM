// Pure helpers for comparing place names (counties, regions). No imports, so
// they run under `npm test` without the app's module aliases.

/**
 * Comparison key for a place name: trimmed, inner whitespace collapsed to one
 * space, lower case. "  Greater   LONDON " and "greater london" share a key.
 *
 * Deliberately NOT an alias table. The location data (uk-locations.json) lists
 * "Greater London" and "City of London" as two separate counties that share the
 * region "London", so they stay different counties here. A "London" region
 * target reaches both through the region step in the scorer.
 */
export function normalizePlace(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when both names are non-empty and share a comparison key. */
export function samePlace(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const key = normalizePlace(a);
  return key !== "" && key === normalizePlace(b);
}
