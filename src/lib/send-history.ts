import type { SendHistoryRow } from "@/components/send-history-card";
import { getExternalSendHistoryRows, getExternalSendPairRows } from "@/lib/db/queries/deals";

// external_sends read helpers for the "Sent" chip / send-history cards.
// Ported off the Supabase client onto the Neon DAO layer (deals.ts — see its
// header note on why external_sends reads live there) as part of the
// disposals/requirements/matches migration batch (see AGENTS.md). Only
// src/lib/db/queries/*.ts may import the raw `sql` client, so this module
// delegates every read to deals.ts rather than querying directly.

export type PairSend = { name: string; at: string };

/** Map key for one requirement↔listing pair. */
export const pairKey = (requirementId: string, listingId: string) =>
  `${requirementId}:${listingId}`;

/**
 * Prior external sends for a specific set of requirement↔listing pairs, keyed
 * by `pairKey`. Powers the "Sent ×N" chip and the double-send warning.
 *
 * The lookup is scoped to the pairs actually being rendered — a blanket
 * "newest 500 sends agency-wide" query silently drops old chips once a busy
 * book passes the cap, which reads as "never sent" on exactly the pairings an
 * agent is most likely to re-send.
 */
export async function getPairSendHistory(
  agencyId: string,
  pairs: { requirementId: string; listingId: string }[],
): Promise<Map<string, PairSend[]>> {
  const out = new Map<string, PairSend[]>();
  if (pairs.length === 0) return out;

  const wanted = new Set(pairs.map((p) => pairKey(p.requirementId, p.listingId)));
  const requirementIds = [...new Set(pairs.map((p) => p.requirementId))];
  const listingIds = [...new Set(pairs.map((p) => p.listingId))];

  const rows = await getExternalSendPairRows(agencyId, requirementIds, listingIds);
  if (rows.length === 0) return out;

  for (const r of rows) {
    if (!r.requirement_id || !r.listing_id) continue;
    const key = pairKey(r.requirement_id, r.listing_id);
    // The cross-product of requirementIds × listingIds may include pairs we
    // didn't ask for — those are dropped here.
    if (!wanted.has(key)) continue;
    const list = out.get(key) ?? [];
    list.push({
      name:
        [r.contact_first_name, r.contact_last_name].filter(Boolean).join(" ") ||
        r.recipient_email,
      at: r.created_at,
    });
    out.set(key, list);
  }
  return out;
}

/**
 * External-send history for one listing or requirement, with recipient/company/
 * sender names and the counterpart record resolved for display.
 */
export async function getSendHistory(
  agencyId: string,
  filter: { listingId?: string; requirementId?: string },
): Promise<SendHistoryRow[]> {
  const rows = await getExternalSendHistoryRows(agencyId, filter);
  if (rows.length === 0) return [];

  // Sender display names fall back to email when full_name is unset — same
  // convention as every other actor-name resolution in this codebase (see
  // disposals.ts's getUserNames), applied inline here since the row already
  // carries the sender's full_name/email via the DAO's JOIN.
  return rows.map((r) => {
    const counterpartId = filter.listingId ? r.requirement_id : r.listing_id;
    const counterpartTitle = filter.listingId ? r.requirement_title : r.listing_title;
    const counterpartBase = filter.listingId ? "/requirements" : "/listings";
    return {
      id: r.id,
      at: r.created_at,
      recipientName:
        [r.contact_first_name, r.contact_last_name].filter(Boolean).join(" ") || null,
      recipientEmail: r.recipient_email,
      companyName: r.company_name,
      senderName: r.sender_full_name ?? r.sender_email ?? null,
      pdfKind: r.pdf_kind,
      aboutLabel: counterpartId ? (counterpartTitle ?? null) : null,
      aboutHref: counterpartId ? `${counterpartBase}/${counterpartId}` : null,
    };
  });
}
