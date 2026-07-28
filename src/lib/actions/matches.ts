"use server";

import { revalidatePath } from "next/cache";

import { isListingMatchable } from "@/lib/badges";
import { DEFAULT_LOCATION_FLEX, scoreMatch } from "@/lib/matching/score";
import { currentAgencyId } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/database.types";

type Supabase = Awaited<ReturnType<typeof createClient>>;
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
 * existing row, but it must NEVER write `status`. The upserts below deliberately
 * omit that column so PostgREST's ON CONFLICT DO UPDATE leaves a human's
 * shortlisted / rejected / converted decision alone; only brand-new rows take
 * the table default of 'suggested'.
 */

/** Pairs scoring below this are not worth persisting or alerting on. */
const MATCH_THRESHOLD = 50;
/** Keep upsert payloads (and their URLs) within comfortable limits. */
const CHUNK = 400;
/** Never fire more than this many "new match" notifications in one refresh. */
const MAX_NOTIFICATION_ITEMS = 3;

const REQUIREMENT_COLUMNS =
  "id, title, lead_agent_id, target_towns, target_regions, target_counties, target_postcode_districts, target_neighbourhoods, target_london_zones, min_sqft, max_sqft, min_covers, max_covers, use_classes, tenure_prefs, max_rent, max_premium, max_guide_price";

const LISTING_COLUMNS =
  "id, title, status, city, area, postcode, address_line, county, lat, lng, size_sqft, covers_internal, use_class, property_type, disposal_type, rent_pa, premium, guide_price, fit_out_state";

type ScopedRequirement = { id: string; title: string; lead_agent_id: string | null };
type ScopedListing = { id: string; title: string | null; status: string | null };

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Score every requirement × listing pair, persist the ones worth keeping, and
 * return the pairs that did not exist before (the ones worth alerting on).
 */
async function persistPairs(
  supabase: Supabase,
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
  const existing = supabase
    .from("matches")
    .select("listing_id, requirement_id")
    .eq("agency_id", agencyId);
  const { data: existingRows, error: readError } =
    "listingIds" in scope
      ? await existing.in("listing_id", scope.listingIds)
      : await existing.in("requirement_id", scope.requirementIds);
  if (readError) {
    console.error("matches: could not read existing rows:", readError.message);
    return [];
  }
  const known = new Set(
    (existingRows ?? []).map((r) => `${r.requirement_id}:${r.listing_id}`),
  );

  const payload = scored.map((s) => ({
    agency_id: agencyId,
    listing_id: s.listing.id,
    requirement_id: s.requirement.id,
    score: s.score,
    reasons: s.reasons,
    // NB: no `status` — see the module comment.
  }));
  for (const batch of chunk(payload, CHUNK)) {
    const { error } = await supabase
      .from("matches")
      .upsert(batch, { onConflict: "listing_id,requirement_id" });
    if (error) {
      console.error("matches: upsert failed:", error.message);
      return [];
    }
  }

  return scored
    .filter((s) => !known.has(`${s.requirement.id}:${s.listing.id}`))
    .map(({ requirement, listing, score }) => ({ requirement, listing, score }));
}

/**
 * Tell each requirement's agents (lead + additional) about pairings that were
 * just suggested for the first time. One notification per recipient per refresh
 * — a 200-listing intel resync must not produce 200 bell rows.
 */
async function notifyNewSuggestions(
  supabase: Supabase,
  agencyId: string,
  actorId: string | null,
  fresh: { requirement: ScopedRequirement; listing: ScopedListing; score: number }[],
) {
  if (fresh.length === 0) return;

  const requirementIds = [...new Set(fresh.map((f) => f.requirement.id))];
  const { data: extraAgents } = await supabase
    .from("requirement_agents")
    .select("requirement_id, user_id")
    .eq("agency_id", agencyId)
    .in("requirement_id", requirementIds);

  const recipientsFor = new Map<string, Set<string>>();
  for (const id of requirementIds) recipientsFor.set(id, new Set());
  for (const f of fresh) {
    if (f.requirement.lead_agent_id) {
      recipientsFor.get(f.requirement.id)?.add(f.requirement.lead_agent_id);
    }
  }
  for (const row of extraAgents ?? []) {
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
        agency_id: agencyId,
        user_id,
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
      agency_id: agencyId,
      user_id,
      title: `${items.length} new matches for your requirements`,
      body:
        preview +
        (items.length > MAX_NOTIFICATION_ITEMS
          ? ` and ${items.length - MAX_NOTIFICATION_ITEMS} more`
          : ""),
      link: "/matches",
    };
  });

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) console.error("matches: notification insert failed:", error.message);
}

async function session(supabase: Supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return null;
  return { userId: user.id, agencyId };
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
    const supabase = await createClient();
    const ctx = await session(supabase);
    if (!ctx) return;

    const [{ data: listingRows }, { data: requirementRows }] = await Promise.all([
      supabase
        .from("disposals")
        .select(LISTING_COLUMNS)
        .eq("agency_id", ctx.agencyId)
        .in("id", ids),
      supabase
        .from("requirements")
        .select(REQUIREMENT_COLUMNS)
        .eq("agency_id", ctx.agencyId)
        .eq("status", "active"),
    ]);

    // Let/sold/withdrawn stock is never pitched, so it is never persisted.
    const listings = (listingRows ?? []).filter((l) => isListingMatchable(l.status));
    const requirements = requirementRows ?? [];
    if (listings.length === 0 || requirements.length === 0) return;

    const fresh = await persistPairs(supabase, ctx.agencyId, requirements, listings, {
      listingIds: listings.map((l) => l.id),
    });
    await notifyNewSuggestions(supabase, ctx.agencyId, ctx.userId, fresh);
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
    const supabase = await createClient();
    const ctx = await session(supabase);
    if (!ctx) return;

    const { data: requirement } = await supabase
      .from("requirements")
      .select(REQUIREMENT_COLUMNS)
      .eq("agency_id", ctx.agencyId)
      .eq("id", requirementId)
      .eq("status", "active")
      .maybeSingle();
    if (!requirement) return; // satisfied / withdrawn briefs don't generate matches

    const { data: listingRows } = await supabase
      .from("disposals")
      .select(LISTING_COLUMNS)
      .eq("agency_id", ctx.agencyId);
    const listings = (listingRows ?? []).filter((l) => isListingMatchable(l.status));
    if (listings.length === 0) return;

    const fresh = await persistPairs(supabase, ctx.agencyId, [requirement], listings, {
      requirementIds: [requirementId],
    });
    await notifyNewSuggestions(supabase, ctx.agencyId, ctx.userId, fresh);
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
  const supabase = await createClient();
  const ctx = await session(supabase);
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

  const { error } = await supabase.from("matches").upsert(
    {
      agency_id: ctx.agencyId,
      requirement_id: requirementId,
      listing_id: listingId,
      score,
      status,
    },
    { onConflict: "listing_id,requirement_id" },
  );
  if (error) {
    console.error("setMatchStatus failed:", error.message);
    return;
  }

  revalidatePath("/matches");
  revalidatePath(`/requirements/${requirementId}`);
  revalidatePath(`/listings/${listingId}`);
}
