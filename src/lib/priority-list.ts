// Plain module (not "use client"): the dashboard page and the client list both
// use it. Pure row shaping for the dashboard's "Priority requirements" list.

import { mailtoHref, pickCallNumber } from "@/lib/contact-links";
import { formatDateUpdated } from "@/lib/format-date";
import { sizeRangeText, summariseLocations } from "@/lib/listing-rating";
import { DEFAULT_LOCATION_FLEX, scoreMatch } from "@/lib/matching/score";
import type { PriorityRequirementRow } from "@/lib/db/queries/requirements";

/** A match counts as strong from this score up. */
export const STRONG_MATCH_SCORE = 50;
export const PRIORITY_LIMIT = 20;

/**
 * Listings that score STRONG_MATCH_SCORE or more for one requirement. The
 * caller passes the matchable listings (isListingMatchable applied once), so
 * the same set and the same scorer as the requirement page are used.
 */
export function countStrongMatches(
  req: Parameters<typeof scoreMatch>[0],
  matchable: readonly Parameters<typeof scoreMatch>[1][],
): number {
  let n = 0;
  for (const d of matchable) {
    if (scoreMatch(req, d, { locationFlex: DEFAULT_LOCATION_FLEX }).score >= STRONG_MATCH_SCORE) n++;
  }
  return n;
}

export type PriorityRowData = {
  id: string;
  title: string;
  rating: number;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  sizeText: string;
  budgetText: string;
  locations: { shown: string[]; more: number };
  leadAgentName: string | null;
  /** Finished text, made on the server: the client never parses a timestamp. */
  updatedText: string;
  updatedTitle: string | undefined;
  matchCount: number;
  emailHref: string | null;
  call: { display: string; href: string } | null;
};

export function shapePriorityRow(row: PriorityRequirementRow, matchCount: number): PriorityRowData {
  const contactName =
    [row.contact_first_name, row.contact_last_name].filter(Boolean).join(" ").trim() || null;
  const updated = formatDateUpdated(row.date_updated);
  const targets = [
    ...row.target_london_zones,
    ...row.target_neighbourhoods,
    ...row.target_towns,
    ...row.target_counties,
    ...row.target_regions,
    ...row.target_postcode_districts,
  ];
  return {
    id: row.id,
    title: row.title,
    rating: row.listing_rating,
    companyId: row.company_id,
    companyName: row.company_name,
    contactId: row.contact_id,
    contactName,
    sizeText: sizeRangeText(row.min_sqft, row.max_sqft),
    budgetText: row.max_rent != null ? `£${row.max_rent.toLocaleString("en-GB")} pa` : "—",
    locations: summariseLocations(targets, 3),
    leadAgentName: row.lead_agent_name,
    updatedText: updated.text,
    updatedTitle: updated.title,
    matchCount,
    emailHref: mailtoHref(row.contact_email),
    call: pickCallNumber(row.contact_mobile, row.contact_phone),
  };
}
