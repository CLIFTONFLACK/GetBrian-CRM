// What a LISTINGS import does after its rows are written: give new and changed
// listings coordinates, and score them against live requirements, the same as a
// listing saved through the form or an intel resync. Pure helpers only (id
// collection, caps, wording); the database and geocoder calls live in
// src/lib/actions/import-data.ts.
//
// The numbers, and why (the import runs inside a server action on the Admin
// page, which has maxDuration = 120 seconds; this file does not raise it):
//
//   MAX_RESCORE_LISTINGS = 500. Scoring is in memory and blocks the event loop:
//     500 listings x about 2,200 active requirements is 1.1 million pair
//     scores, measured at about 5.5 s for the location step alone on a laptop,
//     plus one chunked write of the pairs worth keeping.
//     Notifications are already one per agent per call, so volume is bounded.
//   MAX_GEOCODE_LISTINGS = 100, five at a time (the resync's concurrency), each
//     call times out at 10 s inside geocodeAddress. 100 is 20 rounds: about 10 s
//     when the geocoder answers normally.
//   ONE CLOCK for the whole action (startedAt is taken at the top of the
//     import): no geocoding if 70 s have gone; otherwise geocode for at most
//     45 s and never past 85 s in total; no re-scoring if 90 s have gone. That
//     leaves at least 30 s of the 120 s for scoring, the write and the response.
//
// Whatever is over a cap, or skipped for time, is left for later and counted.

export const MAX_RESCORE_LISTINGS = 500;
export const MAX_GEOCODE_LISTINGS = 100;
export const GEOCODE_CONCURRENCY = 5;
export const GEOCODE_BUDGET_MS = 45_000;
export const GEOCODE_SKIP_AFTER_MS = 70_000;
export const GEOCODE_TOTAL_CAP_MS = 85_000;
export const RESCORE_SKIP_AFTER_MS = 90_000;
export const UPSERT_CHUNK = 2_000;

/** Whether to geocode now, and for how long (ms), given the time already used. */
export function geocodeWindow(elapsedMs: number): { run: boolean; budgetMs: number } {
  if (elapsedMs > GEOCODE_SKIP_AFTER_MS) return { run: false, budgetMs: 0 };
  return { run: true, budgetMs: Math.max(0, Math.min(GEOCODE_BUDGET_MS, GEOCODE_TOTAL_CAP_MS - elapsedMs)) };
}

/** Whether there is still time to re-score. */
export function shouldRescore(elapsedMs: number): boolean {
  return elapsedMs <= RESCORE_SKIP_AFTER_MS;
}

/** Split into consecutive chunks of at most `size` (one chunk for small input). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type StoredAddress = {
  address_line: string | null;
  area: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
};

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** True when the import supplies an address part that differs from the stored
 *  one. A blank or missing cell (null) never counts: it keeps the stored value. */
export function addressChanged(stored: StoredAddress, patch: Partial<StoredAddress>): boolean {
  return (["address_line", "area", "city", "county", "postcode"] as const).some((k) => {
    const incoming = patch[k];
    return incoming != null && incoming.trim() !== "" && !sameText(stored[k], incoming);
  });
}

/** Ids of the listings an import touched: created and updated, de-duplicated, in order. */
export function collectListingIds(
  createdIds: readonly (string | null | undefined)[],
  updatedIds: readonly (string | null | undefined)[],
): string[] {
  return [...new Set([...createdIds, ...updatedIds].filter((x): x is string => !!x))];
}

/** First `cap` items, and how many were left over. */
export function capList<T>(items: readonly T[], cap: number): { take: T[]; remainder: number } {
  const take = items.slice(0, Math.max(0, cap));
  return { take, remainder: items.length - take.length };
}

export type FollowUpResult = {
  /** Live listings scored, and matches saved. */
  scored: number;
  pairsSaved: number;
  /** False when the match refresh reported that it could not save. */
  scoringOk: boolean;
  /** Let, sold or withdrawn listings: not scored, not geocoded. */
  notScored: number;
  rescoreRemainder: number;
  /** True when re-scoring was skipped for lack of time. */
  rescoreSkipped: boolean;
  geocoded: number;
  /** Matchable listings that needed coordinates and were not tried (cap or time). */
  geocodeRemainder: number;
  /** Tried and the geocoder found nothing. */
  geocodeNoMatch: number;
  /** Tried and the coordinates could not be saved. */
  geocodeSaveFailed: number;
  /** Set when a step threw. */
  failures: string[];
};

/** The sentence(s) appended to the import result. Empty when there was nothing to do. */
export function followUpSummary(r: FollowUpResult): string {
  const parts: string[] = [];
  if (r.geocoded) parts.push(`${r.geocoded} listing${r.geocoded === 1 ? "" : "s"} geocoded`);
  if (r.geocodeNoMatch)
    parts.push(`${r.geocodeNoMatch} not found by the geocoder (no match for the address)`);
  if (r.geocodeSaveFailed)
    parts.push(`${r.geocodeSaveFailed} found but the coordinates could not be saved`);
  if (r.scored && r.scoringOk)
    parts.push(`Scored ${r.scored} live listing${r.scored === 1 ? "" : "s"} against requirements: ${r.pairsSaved} match${r.pairsSaved === 1 ? "" : "es"} saved`);
  if (r.notScored)
    parts.push(`${r.notScored} let, sold or withdrawn listing${r.notScored === 1 ? "" : "s"} not scored`);
  const text = parts.length ? ` ${parts.join("; ")}.` : "";
  const later: string[] = [];
  if (r.geocodeRemainder)
    later.push(
      `${r.geocodeRemainder} listing${r.geocodeRemainder === 1 ? " still needs" : "s still need"} coordinates. Open each listing and save it, or import the file again only if every row has an external_ref.`,
    );
  if (r.rescoreRemainder || r.rescoreSkipped) {
    const n = r.rescoreRemainder;
    later.push(
      r.rescoreSkipped
        ? `Re-scoring was skipped (the import ran out of time). Listings are scored the next time the listing or a requirement is saved.`
        : `${n} listing${n === 1 ? " was" : "s were"} not re-scored (limit ${MAX_RESCORE_LISTINGS} per import). They are scored the next time the listing or a requirement is saved.`,
    );
  }
  // scoringOk starts true and only turns false when a refresh ran and failed.
  // A refresh that throws reports zero scored listings, so do not test scored.
  if (!r.scoringOk)
    later.push(
      "Matches could not be saved. They are scored the next time a listing or requirement is saved.",
    );
  const warn = r.failures.length ? ` Follow-up problems: ${r.failures.join("; ")}.` : "";
  return `${text}${later.length ? ` ${later.join(" ")}` : ""}${warn}`;
}
/** Dry-run wording: nothing is written, geocoded or notified. */
export function dryRunFollowUp(rescore: number, needCoords: number): string {
  if (rescore === 0) return "";
  return ` Would re-score ${Math.min(rescore, MAX_RESCORE_LISTINGS)} listing${rescore === 1 ? "" : "s"}${
    rescore > MAX_RESCORE_LISTINGS ? ` (${rescore - MAX_RESCORE_LISTINGS} more over the limit)` : ""
  }, ${needCoords} need${needCoords === 1 ? "s" : ""} coordinates.`;
}
