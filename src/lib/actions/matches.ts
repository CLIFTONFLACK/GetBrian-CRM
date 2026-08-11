"use server";

import { revalidatePath } from "next/cache";

import { isListingMatchable } from "@/lib/badges";
import { DEFAULT_LOCATION_FLEX, scoreMatch } from "@/lib/matching/score";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  getDisposalsForMatchingByIds,
  listDisposalsForMatching,
  type MatchDisposal,
} from "@/lib/db/queries/disposals";
import {
  getActiveRequirementForMatching,
  getRequirementAgentIdsForMany,
  listActiveRequirementsForMatching,
  type MatchRequirement,
} from "@/lib/db/queries/requirements";
import {
  getExistingMatchPairs,
  setMatchStatus as setMatchStatusRow,
  upsertMatchScores,
} from "@/lib/db/queries/matches";
import { createNotificationRows } from "@/lib/db/queries/messages";
import type { Database, Json } from "@/lib/database.types";

type MatchStatus = Database["public"]["Enums"]["match_status"];

/**
 * Persisted-matches layer for MatchMaker.
 *
 * Scores are still computed live on every page render (cheap, and always
 * current) — the `matches` table exists so a human decision survives: which
 * suggestions were shortlisted, which were rejected, and which requirement
 * agents have already been told about a new pairing.
 *
 * Rule that must never be broken: a refresh may update `score`/`reasons` on an
 * existing row, but it must NEVER write `status` — see matches.ts (the DAO)'s
 * `upsertMatchScores` for where that's enforced.
 */

/** Pairs scoring below this are not worth persisting or alerting on. */
const MATCH_THRESHOLD = 50;
/** Never fire more than this many "new match" notifications in one refresh. */
const MAX_NOTIFICATION_ITEMS = 3;

type ScopedRequirement = { id: string; title: string; lead_agent_id: string | null };
type ScopedListing = { id: string; title: string | null; status: string | null };

/**
 * Score every requirement × listing pair, persist the ones worth keeping, and
 * return the pairs that did not exist before (the ones worth alerting on).
 */
async function persistPairs(
  agencyId: string,
  requirements: (ScopedRequirement & Parameters<typeof scoreMatch>[0])[],
  listings: (ScopedListing & Parameters<typeof scoreMatch>[1])[],
  scope: { listingIds: string[] } | { requirementIds: string[] },
): Promise<{ requirement: ScopedRequirement; listing: ScopedListing; score: number }[]> {
  const scored: {
    requirement: ScopedRequirement;
    listing: ScopedListing;
    score: number;
    reasons: Json;
  }[] = [];
  for (const requirement of requirements) {
    for (const listing of listings) {
      const { score, reasons } = scoreMatch(requirement, listing, {
        locationFlex: DEFAULT_LOCATION_FLEX,
      });
      if (score < MATCH_THRESHOLD) continue;
      scored.push({
        requirement,
        listing,
        score,
        reasons: reasons as unknown as Json,
      });
    }
  }
  if (scored.length === 0) return [];

  // Which pairs already exist? Read on the narrower axis of the refresh.
  const known = await getExistingMatchPairs(agencyId, scope);

  try {
    await upsertMatchScores(
      agencyId,
      scored.map((s) => ({
        listingId: s.listing.id,
        requirementId: s.requirement.id,
        score: s.score,
        reasons: s.reasons,
      })),
    );
  } catch (err) {
    console.error("matches: upsert failed:", (err as Error).message);
    return [];
  }

  return scored
    .filter((s) => !known.has(`${s.requirement.id}:${s.listing.id}`))
    .map(({ requirement, listing, score }) => ({ requirement, listing, score }));
}

/**
 * Tell each requirement's agents (lead + additional) about pairings that were
 * just suggested for the first time. One notification per recipient per
 * refresh — a 200-listing intel resync must not produce 200 bell rows.
 */
async function notifyNewSuggestions(
  agencyId: string,
  actorId: string | null,
  fresh: { requirement: ScopedRequirement; listing: ScopedListing; score: number }[],
) {
  if (fresh.length === 0) return;

  const requirementIds = [...new Set(fresh.map((f) => f.requirement.id))];
  const extraAgents = await getRequirementAgentIdsForMany(agencyId, requirementIds);

  const recipientsFor = new Map<string, Set<string>>();
  for (const id of requirementIds) recipientsFor.set(id, new Set());
  for (const f of fresh) {
    if (f.requirement.lead_agent_id) {
      recipientsFor.get(f.requirement.id)?.add(f.requirement.lead_agent_id);
    }
  }
  for (const row of extraAgents) {
    recipientsFor.get(row.requirement_id)?.add(row.user_id);
  }

  // recipient -> the new pairings they care about
  const byUser = new Map<string, typeof fresh>();
  for (const f of fresh) {
    for (const user of recipientsFor.get(f.requirement.id) ?? []) {
      if (user === actorId) continue; // no self-pings
      const list = byUser.get(user) ?? [];
      list.push(f);
      byUser.set(user, list);
    }
  }
  if (byUser.size === 0) return;

  const rows = [...byUser.entries()].map(([user_id, items]) => {
    const first = items[0];
    const listingName = first.listing.title ?? "a new listing";
    if (items.length === 1) {
      return {
        agencyId,
        userId: user_id,
        title: `New match for “${first.requirement.title}”`,
        body: `${listingName} — ${first.score}% match`,
        link: `/requirements/${first.requirement.id}`,
      };
    }
    const preview = items
      .slice(0, MAX_NOTIFICATION_ITEMS)
      .map((i) => `${i.listing.title ?? "Untitled listing"} (${i.score}%)`)
      .join("; ");
    return {
      agencyId,
      userId: user_id,
      title: `${items.length} new matches for your requirements`,
      body:
        preview +
        (items.length > MAX_NOTIFICATION_ITEMS
          ? ` and ${items.length - MAX_NOTIFICATION_ITEMS} more`
          : ""),
      link: "/matches",
    };
  });

  try {
    await createNotificationRows(rows);
  } catch (err) {
    console.error("matches: notification insert failed:", (err as Error).message);
  }
}

async function session(): Promise<{ userId: string; agencyId: string } | null> {
  if (!isDbConfigured) return null;
  const authSession = await auth();
  if (!authSession?.user) return null;
  const agencyId = await currentAgencyId(authSession.user.id);
  if (!agencyId) return null;
  return { userId: authSession.user.id, agencyId };
}

/**
 * Regenerate suggestions for one or more listings that just landed (created,
 * edited or re-scraped) and alert the agents behind every requirement they now
 * match. Best-effort: never throws, so it can't fail the write that triggered
 * it. Call it AFTER the listing row is committed.
 */
export async function refreshMatchesForListings(listingIds: string[]): Promise<void> {
  const ids = [...new Set(listingIds.filter(Boolean))];
  if (ids.length === 0) return;

  try {
    const ctx = await session();
    if (!ctx) return;

    const [listingRows, requirementRows] = await Promise.all([
      getDisposalsForMatchingByIds(ctx.agencyId, ids),
      listActiveRequirementsForMatching(ctx.agencyId),
    ]);

    // Let/sold/withdrawn stock is never pitched, so it is never persisted.
    const listings: MatchDisposal[] = listingRows.filter((l) => isListingMatchable(l.status));
    const requirements: MatchRequirement[] = requirementRows;
    if (listings.length === 0 || requirements.length === 0) return;

    const fresh = await persistPairs(ctx.agencyId, requirements, listings, {
      listingIds: listings.map((l) => l.id),
    });
    await notifyNewSuggestions(ctx.agencyId, ctx.userId, fresh);
    if (fresh.length > 0) revalidatePath("/matches");
  } catch (err) {
    console.error("refreshMatchesForListings failed:", (err as Error).message);
  }
}

/** Single-listing convenience wrapper around {@link refreshMatchesForListings}. */
export async function refreshMatchesForListing(listingId: string): Promise<void> {
  await refreshMatchesForListings([listingId]);
}

/**
 * Mirror image: regenerate suggestions for one requirement against the agency's
 * live stock. Called whenever a brief is created or its criteria change.
 * Best-effort — never throws.
 */
export async function refreshMatchesForRequirement(
  requirementId: string,
): Promise<void> {
  if (!requirementId) return;
  try {
    const ctx = await session();
    if (!ctx) return;

    const requirement = await getActiveRequirementForMatching(ctx.agencyId, requirementId);
    if (!requirement) return; // satisfied / withdrawn briefs don't generate matches

    const listingRows = await listDisposalsForMatching(ctx.agencyId);
    const listings = listingRows.filter((l) => isListingMatchable(l.status));
    if (listings.length === 0) return;

    const fresh = await persistPairs(ctx.agencyId, [requirement], listings, {
      requirementIds: [requirementId],
    });
    await notifyNewSuggestions(ctx.agencyId, ctx.userId, fresh);
    if (fresh.length > 0) revalidatePath("/matches");
  } catch (err) {
    console.error("refreshMatchesForRequirement failed:", (err as Error).message);
  }
}

/**
 * Shortlist / reject / reopen a requirement ↔ listing pairing from the
 * MatchMaker list. Upserts because the pair may only exist as a live score —
 * the persisted row is created the moment a human first acts on it.
 */
export async function setMatchStatus(formData: FormData): Promise<void> {
  const ctx = await session();
  if (!ctx) return;

  const requirementId = String(formData.get("requirement_id") ?? "").trim();
  const listingId = String(formData.get("listing_id") ?? "").trim();
  const intent = String(formData.get("intent") ?? "").trim();
  if (!requirementId || !listingId) return;

  const status: MatchStatus | null =
    intent === "shortlist"
      ? "shortlisted"
      : intent === "reject"
        ? "rejected"
        : intent === "reopen"
          ? "suggested"
          : null;
  if (!status) return;

  const parsed = Number(formData.get("score") ?? 0);
  const score = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;

  try {
    await setMatchStatusRow(ctx.agencyId, requirementId, listingId, score, status);
  } catch (err) {
    console.error("setMatchStatus failed:", (err as Error).message);
    return;
  }

  revalidatePath("/matches");
  revalidatePath(`/requirements/${requirementId}`);
  revalidatePath(`/listings/${listingId}`);
}
