import { sql } from "@/lib/db/client";
import type { Database, Json } from "@/lib/database.types";

// DAO for public.matches — links a disposal + requirement with a score,
// reasons and a human decision (status). The FK columns are still named
// `listing_id`/`requirement_id` (0004_unify_listings_into_disposals.sql kept
// the column name while repointing its target at `disposals`), and the
// `unique (listing_id, requirement_id)` constraint from 0001 is unchanged —
// every upsert here conflicts on that pair.
//
// Every function takes the caller's agencyId as a mandatory first parameter
// and filters on it explicitly — see the same note in companies.ts.

type MatchStatus = Database["public"]["Enums"]["match_status"];

export type MatchRow = { requirement_id: string; listing_id: string; status: MatchStatus };

/** Every persisted match decision for the agency — powers the /matches
 *  status-by-pair map (scores themselves are always computed live). */
export async function listMatches(agencyId: string): Promise<MatchRow[]> {
  return (await sql`
    select requirement_id, listing_id, status
    from public.matches
    where agency_id = ${agencyId}
  `) as MatchRow[];
}

/** Which pairs already exist, scoped to one side of a refresh (either a set
 *  of listing ids or a set of requirement ids) — cheaper than reading every
 *  match in the agency when only a handful of listings/requirements changed. */
export async function getExistingMatchPairs(
  agencyId: string,
  scope: { listingIds: string[] } | { requirementIds: string[] },
): Promise<Set<string>> {
  const rows =
    "listingIds" in scope
      ? scope.listingIds.length === 0
        ? []
        : ((await sql`
            select listing_id, requirement_id from public.matches
            where agency_id = ${agencyId} and listing_id = ANY(${scope.listingIds}::uuid[])
          `) as { listing_id: string; requirement_id: string }[])
      : scope.requirementIds.length === 0
        ? []
        : ((await sql`
            select listing_id, requirement_id from public.matches
            where agency_id = ${agencyId} and requirement_id = ANY(${scope.requirementIds}::uuid[])
          `) as { listing_id: string; requirement_id: string }[]);
  return new Set(rows.map((r) => `${r.requirement_id}:${r.listing_id}`));
}

export type ScoredPair = {
  listingId: string;
  requirementId: string;
  score: number;
  reasons: Json;
};

/**
 * Persist a batch of scored pairs. Rule that must never be broken: a refresh
 * may update `score`/`reasons` on an existing row, but it must NEVER write
 * `status` — the ON CONFLICT clause deliberately omits that column so a
 * human's shortlisted/rejected/converted decision survives a re-score; only
 * brand-new rows take the table default of 'suggested'.
 */
export async function upsertMatchScores(agencyId: string, pairs: ScoredPair[]): Promise<void> {
  if (pairs.length === 0) return;
  const listingIds = pairs.map((p) => p.listingId);
  const requirementIds = pairs.map((p) => p.requirementId);
  const scores = pairs.map((p) => p.score);
  const reasons = pairs.map((p) => JSON.stringify(p.reasons));
  await sql`
    insert into public.matches (agency_id, listing_id, requirement_id, score, reasons)
    select ${agencyId}, l, r, s, j::jsonb
    from unnest(${listingIds}::uuid[], ${requirementIds}::uuid[], ${scores}::numeric[], ${reasons}::text[])
      as t(l, r, s, j)
    on conflict (listing_id, requirement_id)
    do update set score = excluded.score, reasons = excluded.reasons, updated_at = now()
  `;
}

/** Shortlist / reject / reopen a pairing — upserts because the pair may only
 *  exist as a live score until a human first acts on it (see requirements.ts
 *  for the analogous "row created on first decision" pattern). */
export async function setMatchStatus(
  agencyId: string,
  requirementId: string,
  listingId: string,
  score: number,
  status: MatchStatus,
): Promise<void> {
  await sql`
    insert into public.matches (agency_id, listing_id, requirement_id, score, status)
    values (${agencyId}, ${listingId}, ${requirementId}, ${score}, ${status})
    on conflict (listing_id, requirement_id)
    do update set score = excluded.score, status = excluded.status, updated_at = now()
  `;
}
