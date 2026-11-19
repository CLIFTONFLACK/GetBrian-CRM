// Plain module (not "use client"): server pages, server actions and client
// components all import it. A "use client" module's exports reach the server as
// references, not values.
//
// Listing Rating: how ready a requirement's operator is to take a listing.
// Stored in requirements.listing_rating (smallint, 1..5 or null = not rated).

export const RATING_LABELS: Record<number, string> = {
  1: "Time Waster",
  2: "Not Ready Now",
  3: "Actively Looking",
  4: "Ready to Deal",
  5: "Already made offers",
};

export const NOT_RATED_LABEL = "Not rated";
export const RATING_NOT_ALLOWED = "Only the lead agent or an admin can change this";

/** Label for a stored rating. Anything that is not an integer 1..5 reads "Not rated". */
export function ratingLabel(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isInteger(n)) return NOT_RATED_LABEL;
  return RATING_LABELS[n] ?? NOT_RATED_LABEL;
}

/**
 * Validate an incoming rating (server action input is untrusted). Accepts an
 * integer 1..5 or null. Everything else (0, 6, 4.5, "4", NaN, undefined) is
 * rejected with `ok: false`.
 */
export function parseRatingInput(
  v: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) {
    return { ok: true, value: v };
  }
  return { ok: false };
}

/**
 * Who may change the rating: the lead agent of that requirement, or an agency
 * admin. Managers and additional (non-lead) agents may not.
 */
export function canEditRating(args: {
  userId: string | null | undefined;
  leadAgentId: string | null | undefined;
  isAdmin: boolean;
}): boolean {
  if (args.isAdmin) return true;
  if (!args.userId || !args.leadAgentId) return false;
  return args.userId === args.leadAgentId;
}

/** Rating filter values for the requirements list (`?rating=`). */
export const RATING_FILTERS = [
  { value: "5", label: "5 stars" },
  { value: "4plus", label: "4 and above" },
  { value: "3plus", label: "3 and above" },
  { value: "none", label: "Not rated" },
] as const;

export function matchesRatingFilter(
  rating: number | null | undefined,
  filter: string | undefined,
): boolean {
  switch (filter) {
    case "5":
      return rating === 5;
    case "4plus":
      return rating != null && rating >= 4;
    case "3plus":
      return rating != null && rating >= 3;
    case "none":
      return rating == null;
    default:
      return true; // no filter, or an unknown value
  }
}

// ── Priority list row shaping ───────────────────────────────────────────────

/** First `max` locations, then "+N" for the rest. */
export function summariseLocations(
  locations: readonly string[],
  max = 3,
): { shown: string[]; more: number } {
  const clean = locations.map((l) => l.trim()).filter(Boolean);
  const unique = [...new Set(clean)];
  return { shown: unique.slice(0, max), more: Math.max(0, unique.length - max) };
}

/** Size range text for a requirement row. */
export function sizeRangeText(min: number | null, max: number | null): string {
  const f = (n: number) => n.toLocaleString("en-GB");
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${f(min)}–${f(max)} sq ft`;
  if (min != null) return `${f(min)}+ sq ft`;
  return `up to ${f(max!)} sq ft`;
}
