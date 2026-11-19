import { isListingMatchable } from "@/lib/badges";
import { byMatchQuality, scoreMatch, type MatchReason } from "@/lib/matching/score";

// Picks the best listings for each of a record's requirements. Pure: no
// database, so the selection rules are unit-tested. The company and contact
// Matchmaker tabs call this with rows they have already loaded once.

/** The tab lists only matches at or above this score. */
export const MIN_MATCH_SCORE = 50;
/** Listings shown per requirement. The rest are counted. */
export const TOP_PER_REQUIREMENT = 5;
/** Requirements scored for one record, most recently updated first. */
export const MAX_REQUIREMENTS = 20;

type ScorerRequirement = Parameters<typeof scoreMatch>[0];
type ScorerListing = Parameters<typeof scoreMatch>[1];

export type MatchableRequirement = ScorerRequirement & { id: string; title: string };
export type MatchableListing = ScorerListing & {
  id: string;
  status: string | null;
};

export type TopMatch<L> = {
  listing: L;
  score: number;
  reasons: MatchReason[];
  shortlisted: boolean;
};

export type RequirementMatches<R, L> = {
  requirement: R;
  /** At most `topN`, best first. */
  top: TopMatch<L>[];
  /** Matches at or above the minimum score that are not in `top`. */
  further: number;
};

/**
 * For each requirement (order kept): score every live listing, keep those at or
 * above `minScore`, order by match quality, and return the top `topN` plus the
 * count of the rest.
 *
 * - Listings are not filtered by type: CDG and Market Intel are scored alike.
 *   The caller shows the type badge.
 * - A listing that is let, sold or withdrawn is not live supply
 *   (isListingMatchable), so it is dropped before scoring.
 * - A pair the agency rejected on the Matchmaker board stays hidden, so that
 *   rejecting a suggestion there is not undone here. `statusByPair` is keyed
 *   `requirementId:listingId`. A shortlisted pair is flagged and ranked first.
 */
export function groupTopMatches<R extends MatchableRequirement, L extends MatchableListing>(
  requirements: readonly R[],
  listings: readonly L[],
  opts: {
    locationFlex?: number;
    minScore?: number;
    topN?: number;
    statusByPair?: ReadonlyMap<string, string>;
  } = {},
): RequirementMatches<R, L>[] {
  const minScore = opts.minScore ?? MIN_MATCH_SCORE;
  const topN = opts.topN ?? TOP_PER_REQUIREMENT;
  const statusByPair = opts.statusByPair;
  const live = listings.filter((l) => isListingMatchable(l.status));

  return requirements.map((requirement) => {
    const scored = live
      .map((listing) => ({
        listing,
        ...scoreMatch(requirement, listing, { locationFlex: opts.locationFlex }),
        status: statusByPair?.get(`${requirement.id}:${listing.id}`),
      }))
      .filter((m) => m.score >= minScore && m.status !== "rejected");
    const byQuality = byMatchQuality<(typeof scored)[number]>((m) => m.listing.id);
    scored.sort((a, b) => {
      const rank = (m: typeof a) => (m.status === "shortlisted" ? 1 : 0);
      return rank(b) - rank(a) || byQuality(a, b);
    });
    return {
      requirement,
      top: scored.slice(0, topN).map((m) => ({
        listing: m.listing,
        score: m.score,
        reasons: m.reasons,
        shortlisted: m.status === "shortlisted",
      })),
      further: Math.max(0, scored.length - topN),
    };
  });
}
