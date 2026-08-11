"use server";

import { revalidatePath } from "next/cache";

import type { DisposalInsert } from "@/lib/disposals/cdg";
import { intelSourceById, pool } from "@/lib/intel/sources";
import { geocodeAddress } from "@/lib/maps/geocode";
import { refreshMatchesForListings } from "@/lib/actions/matches";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import { upsertDisposalFromSource } from "@/lib/db/queries/disposals";
import {
  deleteIntelDisposals,
  listDisposalIdsBySource,
  listDisposalRefsBySource,
  listDisposalsMissingCoords,
  markDisposalsWithdrawn,
  updateDisposalCoords,
} from "@/lib/db/queries/intel";
import type { FormState } from "@/lib/actions/types";

const CONCURRENCY = 6;
const RETRIES = 2;
const GEOCODE_CONCURRENCY = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Caller must be an admin of their agency; returns ids or an error state.
 *  Same shape as admin.ts's `requireAgencyAdmin` — this is the real security
 *  boundary now that there's no RLS/SECURITY DEFINER backstop (see AGENTS.md). */
async function requireAdmin(): Promise<
  { userId: string; agencyId: string } | { error: string }
> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const admin = await isAgencyAdmin(session.user.id, agencyId);
  if (!admin) return { error: "Only agency admins can manage Market Intel." };

  return { userId: session.user.id, agencyId };
}

/**
 * Re-scrape a partner source live and upsert into that source's intel rows for
 * the caller's agency, keyed on the (agency_id, source, source_ref) unique
 * index (see disposals.ts's `upsertDisposalFromSource`). Row ids are
 * preserved, so deals, send history and attached docs/areas/contacts survive
 * a resync. Rows in the DB that the fresh scrape no longer returns are marked
 * Withdrawn (never deleted), and rows missing coordinates are geocoded
 * best-effort after the sync.
 */
export async function resyncIntelSource(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error };
  const { userId, agencyId } = gate;

  const sourceId = String(formData.get("source") ?? "");
  const source = intelSourceById.get(sourceId);
  if (!source) return { error: "Unknown Market Intel source." };
  if (!source.scraper) {
    return { error: `${source.label} doesn't have a scraper yet — coming soon.` };
  }

  let urls: string[];
  try {
    urls = await source.scraper.fetchUrls();
  } catch (err) {
    return { error: `Couldn't enumerate ${source.label}: ${(err as Error).message}` };
  }

  const failures: string[] = [];
  const failedUrls = new Set<string>();
  const rows = await pool(urls, CONCURRENCY, async (url) => {
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        return await source.scraper!.fetchDetail(url);
      } catch (err) {
        if (attempt === RETRIES) {
          failures.push(`${url}: ${(err as Error).message}`);
          failedUrls.add(url);
        } else await sleep(400 * attempt);
      }
    }
    return null;
  });
  const good = rows.filter((r): r is DisposalInsert => r !== null);
  if (good.length === 0) {
    return { error: `Scrape of ${source.label} produced no listings — kept existing data.` };
  }

  // Current book for this source — used to work out which refs disappeared.
  const existingRows = await listDisposalRefsBySource(agencyId, source.id);

  // Dedupe by ref (later rows win) on the (agency_id, source, source_ref)
  // conflict key so existing row ids — and everything hanging off them — are
  // preserved. `source_ref` falls back to the listing URL so a ref-less
  // scrape can never dodge the conflict key, and `source_updated_at` is
  // stamped now() because the partner scrapers emit null.
  const nowIso = new Date().toISOString();
  const byRef = new Map<string, DisposalInsert>(
    good.map((r) => [
      r.source_ref ?? r.source_url,
      {
        ...r,
        source_ref: r.source_ref ?? r.source_url,
        source_updated_at: r.source_updated_at ?? nowIso,
      },
    ]),
  );

  for (const row of byRef.values()) {
    await upsertDisposalFromSource(agencyId, userId, "intel", row);
  }

  // Listings gone from the partner's site: mark Withdrawn, never delete —
  // deals and send history keep pointing at a real row. Rows whose detail page
  // merely FAILED to scrape are left alone (absence isn't evidence there).
  const freshRefs = new Set(byRef.keys());
  const missingIds = existingRows
    .filter(
      (r) =>
        (r.source_ref == null || !freshRefs.has(r.source_ref)) &&
        !(r.source_url && failedUrls.has(r.source_url)),
    )
    .map((r) => r.id);
  const withdrawn = await markDisposalsWithdrawn(agencyId, missingIds);

  // Best-effort geocode for rows still lacking coordinates (concurrency-capped;
  // geocodeAddress fails soft, so individual misses are simply skipped).
  const toGeocode = await listDisposalsMissingCoords(agencyId, source.id);
  let geocoded = 0;
  if (toGeocode.length > 0) {
    await pool(toGeocode, GEOCODE_CONCURRENCY, async (row) => {
      const loc = await geocodeAddress(row);
      if (loc) {
        const ok = await updateDisposalCoords(agencyId, row.id, loc.lat, loc.lng);
        if (ok) geocoded++;
      }
      return null;
    });
  }

  // Score the freshly-synced stock against live briefs so new market intel
  // raises suggestions (and bell alerts) without anyone reopening /matches.
  const syncedIds = await listDisposalIdsBySource(agencyId, source.id);
  await refreshMatchesForListings(syncedIds);

  revalidatePath("/admin");
  revalidatePath("/listings");
  revalidatePath("/matches");
  return {
    message:
      `Synced ${byRef.size} ${source.label} listings.` +
      (withdrawn ? ` ${withdrawn} no longer listed — marked Withdrawn.` : "") +
      (geocoded ? ` ${geocoded} geocoded.` : "") +
      (failures.length ? ` ${failures.length} pages failed.` : ""),
  };
}

/** Remove every intel row for one partner source from the caller's agency. */
export async function deleteIntelSource(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error };
  const { agencyId } = gate;

  const sourceId = String(formData.get("source") ?? "");
  const source = intelSourceById.get(sourceId);
  if (!source) return { error: "Unknown Market Intel source." };

  const count = await deleteIntelDisposals(agencyId, source.id);

  revalidatePath("/admin");
  revalidatePath("/listings");
  revalidatePath("/matches");
  return { message: `Deleted ${count} ${source.label} listings.` };
}
