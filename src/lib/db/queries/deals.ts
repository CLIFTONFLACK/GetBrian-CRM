import { sql } from "@/lib/db/client";
import type { Database } from "@/lib/database.types";

// DAO for public.deals (+ deal_agents, deal_stage_events, deal_reminders, and
// the write side of external_sends — the "Send Deal → External" audit log).
// Every function takes the caller's agencyId as a mandatory first parameter
// and filters on it explicitly — see the same note in companies.ts.
//
// A handful of small cross-domain reads live here too (listing/requirement/
// company summaries, contact email options) — one-off reads specific to
// rendering or sending a deal, kept local to this file rather than added to
// disposals.ts/requirements.ts/contacts.ts, mirroring disposals.ts's own
// getLinkedCompany/getLinkedContact/getUserProfile pattern.

type DealStage = Database["public"]["Enums"]["deal_stage"];

export type Deal = {
  id: string;
  agency_id: string;
  listing_id: string | null;
  requirement_id: string | null;
  company_id: string | null;
  title: string;
  stage: DealStage;
  value: number | null;
  hot_terms: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lead_agent_id: string | null;
  expected_close: string | null;
};

const FULL_COLUMNS = `
  id, agency_id, listing_id, requirement_id, company_id, title, stage, value::float8 as value,
  hot_terms, notes, created_by, created_at::text as created_at, updated_at::text as updated_at,
  lead_agent_id, expected_close::text as expected_close
`;

export async function getDealById(agencyId: string, id: string): Promise<Deal | null> {
  const rows = await sql`
    select ${sql.unsafe(FULL_COLUMNS)}
    from public.deals
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as Deal | undefined) ?? null;
}

/** Just the title — feeds `generateMetadata` without pulling the whole row. */
export async function getDealTitle(agencyId: string, id: string): Promise<string | null> {
  const rows = await sql`
    select title from public.deals where id = ${id} and agency_id = ${agencyId} limit 1
  `;
  return (rows[0] as { title: string } | undefined)?.title ?? null;
}

/** Row shape for the pipeline board — flattens the linked listing/requirement/
 *  company's display fields via LEFT JOINs (no ORM, so this replaces the
 *  original `select(..., listing:disposals(...), ...)` embed). */
export type DealBoardRow = {
  id: string;
  title: string;
  stage: DealStage;
  value: number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  lead_agent_id: string | null;
  expected_close: string | null;
  listing_id: string | null;
  requirement_id: string | null;
  company_id: string | null;
  listing_title: string | null;
  listing_city: string | null;
  requirement_title: string | null;
  company_name: string | null;
};

/** Every deal in the agency for the pipeline board, newest-moved first. */
export async function listDealsForBoard(agencyId: string): Promise<DealBoardRow[]> {
  return (await sql`
    select
      d.id, d.title, d.stage, d.value::float8 as value,
      d.created_at::text as created_at, d.updated_at::text as updated_at,
      d.created_by, d.lead_agent_id, d.expected_close::text as expected_close,
      d.listing_id, d.requirement_id, d.company_id,
      l.title as listing_title, l.city as listing_city,
      r.title as requirement_title,
      c.name as company_name
    from public.deals d
    left join public.disposals l on l.id = d.listing_id and l.agency_id = ${agencyId}
    left join public.requirements r on r.id = d.requirement_id and r.agency_id = ${agencyId}
    left join public.companies c on c.id = d.company_id and c.agency_id = ${agencyId}
    where d.agency_id = ${agencyId}
    order by d.updated_at desc
  `) as DealBoardRow[];
}

/** Full row set for /reports's funnel/aging/per-agent aggregates — a
 *  different column set than {@link listDealsForBoard} (no joined
 *  listing/requirement/company display fields; reports doesn't render
 *  those). */
export type DealReportRow = {
  id: string;
  title: string;
  stage: DealStage;
  value: number | null;
  created_at: string;
  updated_at: string;
  lead_agent_id: string | null;
  created_by: string | null;
  requirement_id: string | null;
};

export async function listDealsForReports(agencyId: string): Promise<DealReportRow[]> {
  return (await sql`
    select id, title, stage, value::float8 as value,
           created_at::text as created_at, updated_at::text as updated_at,
           lead_agent_id, created_by, requirement_id
    from public.deals
    where agency_id = ${agencyId}
    order by updated_at desc
  `) as DealReportRow[];
}

/** Every stage-change event in the agency, oldest first — /reports derives
 *  "average time in stage" from consecutive events on the same deal (see the
 *  page for the derivation). */
export async function listStageEventsForReports(
  agencyId: string,
): Promise<{ deal_id: string; from_stage: DealStage | null; to_stage: DealStage; created_at: string }[]> {
  return (await sql`
    select deal_id, from_stage, to_stage, created_at::text as created_at
    from public.deal_stage_events
    where agency_id = ${agencyId}
    order by created_at asc
  `) as { deal_id: string; from_stage: DealStage | null; to_stage: DealStage; created_at: string }[];
}

/** Every (requirement_id, listing_id) pair that already has a deal — /matches
 *  uses this to mark a suggested pairing "Deal created" whether or not its
 *  own `matches` row says so (deal creation doesn't write to `matches`). */
export async function listDealPairs(
  agencyId: string,
): Promise<{ requirement_id: string; listing_id: string }[]> {
  return (await sql`
    select requirement_id, listing_id from public.deals
    where agency_id = ${agencyId} and requirement_id is not null and listing_id is not null
  `) as { requirement_id: string; listing_id: string }[];
}

/** Deals already created from one listing ("under offer to X") — feeds the
 *  listing detail page's "Deals" card. */
export async function getDealsForListing(
  agencyId: string,
  listingId: string,
): Promise<{ id: string; title: string; stage: DealStage; value: number | null }[]> {
  return (await sql`
    select id, title, stage, value
    from public.deals
    where agency_id = ${agencyId} and listing_id = ${listingId}
    order by updated_at desc
  `) as { id: string; title: string; stage: DealStage; value: number | null }[];
}

/** Every deal_agents row in the agency — the board's "agent filter" needs the
 *  full collaborator set to know which deals to include, not just one deal's. */
export async function listDealAgentRows(
  agencyId: string,
): Promise<{ deal_id: string; user_id: string }[]> {
  return (await sql`
    select deal_id, user_id from public.deal_agents where agency_id = ${agencyId}
  `) as { deal_id: string; user_id: string }[];
}

/** Latest stage-change timestamp per deal (one row per deal_id) — drives the
 *  board's "in stage Xd" + Stuck badge, falling back to `updated_at` for
 *  deals created before stage history existed (see the caller). */
export async function listLatestStageEventPerDeal(
  agencyId: string,
): Promise<{ deal_id: string; created_at: string }[]> {
  return (await sql`
    select distinct on (deal_id) deal_id, created_at::text as created_at
    from public.deal_stage_events
    where agency_id = ${agencyId}
    order by deal_id, created_at desc
  `) as { deal_id: string; created_at: string }[];
}

export type DealCreateInput = {
  title: string;
  stage: DealStage;
  requirementId: string | null;
  listingId: string | null;
  companyId: string | null;
  value: number | null;
  leadAgentId: string | null;
};

export async function createDeal(
  agencyId: string,
  createdBy: string,
  input: DealCreateInput,
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.deals (
      agency_id, created_by, title, stage, requirement_id, listing_id, company_id, value, lead_agent_id
    ) values (
      ${agencyId}, ${createdBy}, ${input.title}, ${input.stage}, ${input.requirementId},
      ${input.listingId}, ${input.companyId}, ${input.value}, ${input.leadAgentId}
    )
    returning id
  `;
  return rows[0] as { id: string };
}

/** Finds an existing deal for the same (requirement, listing) pair — the
 *  create-from-match flow is idempotent on this so the same match can't spawn
 *  duplicate deals. */
export async function findDealByMatch(
  agencyId: string,
  requirementId: string,
  listingId: string,
): Promise<{ id: string; title: string } | null> {
  const rows = await sql`
    select id, title from public.deals
    where agency_id = ${agencyId} and requirement_id = ${requirementId} and listing_id = ${listingId}
    limit 1
  `;
  return (rows[0] as { id: string; title: string } | undefined) ?? null;
}

/** The subset getDealForUpdate needs: fields read as "before" state ahead of
 *  a stage/lead change, plus updated_at for the optimistic-concurrency check
 *  (see companies.ts's `getCompanyForUpdate`). */
export async function getDealForUpdate(
  agencyId: string,
  id: string,
): Promise<{
  stage: DealStage;
  lead_agent_id: string | null;
  requirement_id: string | null;
  listing_id: string | null;
  updated_at: string;
} | null> {
  const rows = await sql`
    select stage, lead_agent_id, requirement_id, listing_id, updated_at::text as updated_at
    from public.deals
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (
    (rows[0] as {
      stage: DealStage;
      lead_agent_id: string | null;
      requirement_id: string | null;
      listing_id: string | null;
      updated_at: string;
    } | undefined) ?? null
  );
}

/** The editable-form subset — `updateDeal` never touches requirement_id/
 *  listing_id/company_id (those are set once, at creation, and only change
 *  via a re-match, not the detail-page edit form — matches the original
 *  Supabase action's field list exactly). */
export type DealUpdateInput = {
  title: string;
  stage: DealStage;
  value: number | null;
  hotTerms: string | null;
  notes: string | null;
  leadAgentId: string | null;
  expectedClose: string | null;
};

/** Guarded by agencyId + optimistic concurrency — see companies.ts's
 *  `updateCompany`. The original Supabase version of this action had no such
 *  guard; AGENTS.md calls for adding it here to match disposals/companies/
 *  requirements. Returns null when nothing matched (not found, wrong agency,
 *  or changed since `expectedUpdatedAt` was read). */
export async function updateDeal(
  agencyId: string,
  id: string,
  expectedUpdatedAt: string,
  input: DealUpdateInput,
): Promise<{ id: string } | null> {
  const rows = await sql`
    update public.deals set
      title = ${input.title},
      stage = ${input.stage},
      value = ${input.value},
      hot_terms = ${input.hotTerms},
      notes = ${input.notes},
      lead_agent_id = ${input.leadAgentId},
      expected_close = ${input.expectedClose}
    where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
    returning id
  `;
  return (rows[0] as { id: string } | undefined) ?? null;
}

/** Single-field quick move for the board's stage selector / stepper — no
 *  concurrency guard, mirrors disposals.ts's `updateDisposalStatusOnly`. */
export async function updateDealStageOnly(
  agencyId: string,
  id: string,
  stage: DealStage,
): Promise<boolean> {
  const rows = await sql`
    update public.deals set stage = ${stage}
    where id = ${id} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

/** Inline pencil-icon rename used across board cards / detail header / linked
 *  sections — a single-field quick update, no concurrency guard. */
export async function updateDealTitle(
  agencyId: string,
  id: string,
  title: string,
): Promise<boolean> {
  const rows = await sql`
    update public.deals set title = ${title}
    where id = ${id} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteDeal(agencyId: string, id: string): Promise<void> {
  await sql`delete from public.deals where id = ${id} and agency_id = ${agencyId}`;
}

// ── deal_agents (additional-agent collaborators) ────────────────────────────

export async function getDealAgentIds(agencyId: string, dealId: string): Promise<string[]> {
  const rows = await sql`
    select user_id from public.deal_agents where agency_id = ${agencyId} and deal_id = ${dealId}
  `;
  return (rows as { user_id: string }[]).map((r) => r.user_id);
}

/** Replaces a deal's additional-agent rows — see companies.ts's
 *  `syncCompanyAgents` for the delete+unnest-insert pattern. */
export async function syncDealAgents(
  agencyId: string,
  dealId: string,
  userIds: string[],
): Promise<void> {
  await sql.transaction((tx) => [
    tx`delete from public.deal_agents where agency_id = ${agencyId} and deal_id = ${dealId}`,
    tx`
      insert into public.deal_agents (agency_id, deal_id, user_id)
      select ${agencyId}, ${dealId}, u from unnest(${userIds}::uuid[]) as u
    `,
  ]);
}

// ── deal_stage_events (audit trail) ─────────────────────────────────────────

/** Best-effort stage-history entry, written on creation (fromStage null) and
 *  on every stage change. Callers wrap this in try/catch and log rather than
 *  fail the surrounding action — matches the original Supabase version's
 *  "insert, log on error, never throw" behavior. */
export async function recordDealStageEvent(
  agencyId: string,
  dealId: string,
  fromStage: DealStage | null,
  toStage: DealStage,
  changedBy: string | null,
): Promise<void> {
  await sql`
    insert into public.deal_stage_events (agency_id, deal_id, from_stage, to_stage, changed_by)
    values (${agencyId}, ${dealId}, ${fromStage}, ${toStage}, ${changedBy})
  `;
}

// ── deal_reminders ───────────────────────────────────────────────────────────

export type DealReminder = {
  id: string;
  title: string;
  due_at: string;
  done: boolean;
  created_by: string | null;
};

export async function listDealReminders(agencyId: string, dealId: string): Promise<DealReminder[]> {
  return (await sql`
    select id, title, due_at::text as due_at, done, created_by
    from public.deal_reminders
    where agency_id = ${agencyId} and deal_id = ${dealId}
    order by due_at
  `) as DealReminder[];
}

/** Every not-done reminder in the agency, for the "My reminders" panel on
 *  /messages (filtered client-side there to "mine" — set by me or on a deal
 *  I lead). */
export async function listOpenDealReminders(
  agencyId: string,
  limit = 100,
): Promise<
  { id: string; title: string; due_at: string; deal_id: string; created_by: string | null }[]
> {
  return (await sql`
    select id, title, due_at::text as due_at, deal_id, created_by
    from public.deal_reminders
    where agency_id = ${agencyId} and done = false
    order by due_at asc
    limit ${limit}
  `) as { id: string; title: string; due_at: string; deal_id: string; created_by: string | null }[];
}

/** deals a user leads — used to decide which reminders are "theirs" on
 *  /messages (set by me, or on a deal I lead). */
export async function listDealIdsLedBy(agencyId: string, userId: string): Promise<string[]> {
  const rows = await sql`
    select id from public.deals where agency_id = ${agencyId} and lead_agent_id = ${userId}
  `;
  return (rows as { id: string }[]).map((r) => r.id);
}

export async function createDealReminder(
  agencyId: string,
  createdBy: string,
  dealId: string,
  input: { title: string; dueAt: string },
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.deal_reminders (agency_id, deal_id, title, due_at, created_by)
    values (${agencyId}, ${dealId}, ${input.title}, ${input.dueAt}, ${createdBy})
    returning id
  `;
  return rows[0] as { id: string };
}

/** The deal's title + owner (lead agent, falling back to creator) — feeds the
 *  "notify the deal owner a reminder was set" step. */
export async function getDealOwnerInfo(
  agencyId: string,
  dealId: string,
): Promise<{ title: string; created_by: string | null; lead_agent_id: string | null } | null> {
  const rows = await sql`
    select title, created_by, lead_agent_id from public.deals
    where id = ${dealId} and agency_id = ${agencyId}
    limit 1
  `;
  return (
    (rows[0] as { title: string; created_by: string | null; lead_agent_id: string | null } | undefined) ??
    null
  );
}

export async function setDealReminderDone(
  agencyId: string,
  id: string,
  done: boolean,
): Promise<void> {
  await sql`
    update public.deal_reminders set done = ${done}
    where id = ${id} and agency_id = ${agencyId}
  `;
}

export async function deleteDealReminder(agencyId: string, id: string): Promise<void> {
  await sql`delete from public.deal_reminders where id = ${id} and agency_id = ${agencyId}`;
}

// ── Requirement / listing side-effects of a stage change ───────────────────

/** Flips a requirement's status when its deal closes/reopens — a plain,
 *  unconditional set (used for the "close" direction: completed → satisfied). */
export async function setRequirementStatus(
  agencyId: string,
  requirementId: string,
  status: Database["public"]["Enums"]["requirement_status"],
): Promise<void> {
  await sql`
    update public.requirements set status = ${status}
    where id = ${requirementId} and agency_id = ${agencyId}
  `;
}

/** Reactivates a requirement only if it's still `satisfied` — guards against
 *  stomping a manual withdraw/hold made after the deal closed it (the
 *  "reopen" direction: a deal leaving `completed`). */
export async function reactivateRequirementIfSatisfied(
  agencyId: string,
  requirementId: string,
): Promise<void> {
  await sql`
    update public.requirements set status = 'active'
    where id = ${requirementId} and agency_id = ${agencyId} and status = 'satisfied'
  `;
}

/** The listing's status + let/sale flags — drives the "does this stage
 *  change advance the listing's status" decision (see the caller). */
export async function getListingStatusFlags(
  agencyId: string,
  listingId: string,
): Promise<{ status: string | null; to_let: boolean; for_sale: boolean } | null> {
  const rows = await sql`
    select status, to_let, for_sale from public.disposals
    where id = ${listingId} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as { status: string | null; to_let: boolean; for_sale: boolean } | undefined) ?? null;
}

export async function setListingStatus(
  agencyId: string,
  listingId: string,
  status: string,
): Promise<void> {
  await sql`
    update public.disposals set status = ${status}
    where id = ${listingId} and agency_id = ${agencyId}
  `;
}

// ── One-off cross-domain reads for rendering / sending a deal ──────────────

/** Requirement summary for the create-from-match flow (title for the deal
 *  name, company_id to link the deal to the requirement's operator). */
export async function getRequirementSummaryForDeal(
  agencyId: string,
  requirementId: string,
): Promise<{ title: string; company_id: string | null } | null> {
  const rows = await sql`
    select title, company_id from public.requirements
    where id = ${requirementId} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as { title: string; company_id: string | null } | undefined) ?? null;
}

/** Listing summary for the create-from-match flow (title/city for the deal
 *  name, guide_price/premium/rent_pa to seed an indicative deal value). */
export async function getListingSummaryForDeal(
  agencyId: string,
  listingId: string,
): Promise<{
  title: string | null;
  city: string | null;
  guide_price: number | null;
  premium: number | null;
  rent_pa: number | null;
} | null> {
  const rows = await sql`
    select title, city, guide_price::float8 as guide_price, premium::float8 as premium,
           rent_pa::float8 as rent_pa from public.disposals
    where id = ${listingId} and agency_id = ${agencyId}
    limit 1
  `;
  return (
    (rows[0] as {
      title: string | null;
      city: string | null;
      guide_price: number | null;
      premium: number | null;
      rent_pa: number | null;
    } | undefined) ?? null
  );
}

/** The deal's own linked listing — id/title/city plus its own company/contact
 *  links, for the deal detail page's "Listing" card. */
export async function getDealListingSummary(
  agencyId: string,
  listingId: string,
): Promise<{
  id: string;
  title: string | null;
  city: string | null;
  company_id: string | null;
  contact_id: string | null;
} | null> {
  const rows = await sql`
    select id, title, city, company_id, contact_id from public.disposals
    where id = ${listingId} and agency_id = ${agencyId}
    limit 1
  `;
  return (
    (rows[0] as {
      id: string;
      title: string | null;
      city: string | null;
      company_id: string | null;
      contact_id: string | null;
    } | undefined) ?? null
  );
}

/** Requirement briefs (title + headline criteria) for the Send Deal wizard's
 *  bulk-requirements email body. */
export async function getRequirementBriefsForSend(
  agencyId: string,
  ids: string[],
): Promise<
  { id: string; title: string; target_towns: string[]; min_sqft: number | null; max_sqft: number | null; max_rent: number | null }[]
> {
  if (ids.length === 0) return [];
  return (await sql`
    select id, title, target_towns,
           min_sqft::float8 as min_sqft, max_sqft::float8 as max_sqft, max_rent::float8 as max_rent
    from public.requirements
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as {
    id: string;
    title: string;
    target_towns: string[];
    min_sqft: number | null;
    max_sqft: number | null;
    max_rent: number | null;
  }[];
}

/** Every contact's email in the agency — the Send Deal wizard's contact
 *  picker hides contacts with no address rather than failing after submit. */
export async function getContactEmailOptions(
  agencyId: string,
): Promise<{ id: string; email: string | null }[]> {
  return (await sql`
    select id, email from public.contacts where agency_id = ${agencyId}
  `) as { id: string; email: string | null }[];
}

// ── external_sends — write side only (the "Send Deal → External" log) ─────
// Read side (history cards on listing/requirement detail pages) stays on the
// Supabase client until those pages' own migration batch — see AGENTS.md.

export type ExternalSendInput = {
  dealId: string | null;
  requirementId: string | null;
  listingId: string | null;
  companyId: string | null;
  contactId: string;
  recipientEmail: string;
  subject: string;
  body: string | null;
  pdfKind: "branded" | "unbranded" | null;
  providerId: string | null;
};

/** Logs a batch of sends in one round trip — one row per requirement ×
 *  listing pair, matching the original fan-out. No-op on an empty batch. */
export async function createExternalSends(
  agencyId: string,
  sentBy: string,
  rows: ExternalSendInput[],
): Promise<void> {
  if (rows.length === 0) return;
  await sql.transaction((tx) =>
    rows.map(
      (r) => tx`
        insert into public.external_sends (
          agency_id, deal_id, requirement_id, listing_id, company_id, contact_id,
          recipient_email, subject, body, pdf_kind, provider_id, sent_by
        ) values (
          ${agencyId}, ${r.dealId}, ${r.requirementId}, ${r.listingId}, ${r.companyId}, ${r.contactId},
          ${r.recipientEmail}, ${r.subject}, ${r.body}, ${r.pdfKind}, ${r.providerId}, ${sentBy}
        )
      `,
    ),
  );
}

// ── external_sends — read side (history cards on listing/requirement detail
//    pages, and the /matches "Sent" chip) ────────────────────────────────

/** Prior sends for a specific set of requirement↔listing pairs — feeds
 *  src/lib/send-history.ts's getPairSendHistory (the /matches "Sent ×N"
 *  chip and the send wizard's double-send warning). Recipient display name
 *  is resolved via a LEFT JOIN rather than a second round trip. */
export async function getExternalSendPairRows(
  agencyId: string,
  requirementIds: string[],
  listingIds: string[],
): Promise<
  {
    requirement_id: string | null;
    listing_id: string | null;
    recipient_email: string;
    created_at: string;
    contact_first_name: string | null;
    contact_last_name: string | null;
  }[]
> {
  if (requirementIds.length === 0 || listingIds.length === 0) return [];
  return (await sql`
    select es.requirement_id, es.listing_id, es.recipient_email,
           es.created_at::text as created_at,
           c.first_name as contact_first_name, c.last_name as contact_last_name
    from public.external_sends es
    left join public.contacts c on c.id = es.contact_id and c.agency_id = ${agencyId}
    where es.agency_id = ${agencyId}
      and es.requirement_id = ANY(${requirementIds}::uuid[])
      and es.listing_id = ANY(${listingIds}::uuid[])
    order by es.created_at desc
  `) as {
    requirement_id: string | null;
    listing_id: string | null;
    recipient_email: string;
    created_at: string;
    contact_first_name: string | null;
    contact_last_name: string | null;
  }[];
}

/** Full send-history rows (with sender, recipient and counterpart display
 *  fields joined in) for one listing or requirement — feeds
 *  src/lib/send-history.ts's getSendHistory (the listing/requirement detail
 *  page's "Sent history" card). Exactly one of `listingId`/`requirementId`
 *  is expected; the unused side's join columns come back null and are
 *  ignored by the caller. */
export async function getExternalSendHistoryRows(
  agencyId: string,
  filter: { listingId?: string; requirementId?: string },
): Promise<
  {
    id: string;
    created_at: string;
    recipient_email: string;
    pdf_kind: string | null;
    requirement_id: string | null;
    listing_id: string | null;
    contact_first_name: string | null;
    contact_last_name: string | null;
    company_name: string | null;
    requirement_title: string | null;
    listing_title: string | null;
    sender_full_name: string | null;
    sender_email: string | null;
  }[]
> {
  const listingId = filter.listingId ?? null;
  const requirementId = filter.requirementId ?? null;
  if (!listingId && !requirementId) return [];

  const columns = sql.unsafe(`
    es.id, es.created_at::text as created_at, es.recipient_email, es.pdf_kind,
    es.requirement_id, es.listing_id,
    c.first_name as contact_first_name, c.last_name as contact_last_name,
    co.name as company_name,
    r.title as requirement_title,
    d.title as listing_title,
    u.full_name as sender_full_name, u.email as sender_email
  `);
  // Every joined counterpart table except `users` (a shared, non-agency-scoped
  // identity table) is re-scoped to this agency, so a stale foreign
  // company_id/listing_id/etc. on the es row can't surface another agency's
  // display fields (there's no RLS backstop — see AGENTS.md).
  const rows = listingId
    ? await sql`
        select ${columns} from public.external_sends es
        left join public.contacts c on c.id = es.contact_id and c.agency_id = ${agencyId}
        left join public.companies co on co.id = es.company_id and co.agency_id = ${agencyId}
        left join public.requirements r on r.id = es.requirement_id and r.agency_id = ${agencyId}
        left join public.disposals d on d.id = es.listing_id and d.agency_id = ${agencyId}
        left join public.users u on u.id = es.sent_by
        where es.agency_id = ${agencyId} and es.listing_id = ${listingId}
        order by es.created_at desc
        limit 50
      `
    : await sql`
        select ${columns} from public.external_sends es
        left join public.contacts c on c.id = es.contact_id and c.agency_id = ${agencyId}
        left join public.companies co on co.id = es.company_id and co.agency_id = ${agencyId}
        left join public.requirements r on r.id = es.requirement_id and r.agency_id = ${agencyId}
        left join public.disposals d on d.id = es.listing_id and d.agency_id = ${agencyId}
        left join public.users u on u.id = es.sent_by
        where es.agency_id = ${agencyId} and es.requirement_id = ${requirementId}
        order by es.created_at desc
        limit 50
      `;
  return rows as {
    id: string;
    created_at: string;
    recipient_email: string;
    pdf_kind: string | null;
    requirement_id: string | null;
    listing_id: string | null;
    contact_first_name: string | null;
    contact_last_name: string | null;
    company_name: string | null;
    requirement_title: string | null;
    listing_title: string | null;
    sender_full_name: string | null;
    sender_email: string | null;
  }[];
}

/**
 * Stamps an external_sends row's engagement tracking column, matched by
 * Resend's own message id (`provider_id`) — the correlation key
 * POST /api/webhooks/resend uses. This is a service-role, cross-agency site
 * (no user session — see AGENTS.md): `provider_id` is globally unique (one
 * Resend message id per send), so it alone correctly scopes the update to
 * exactly one row without needing a caller agencyId. Returns false when no
 * row matched (unknown/not-yet-written provider id — the caller 500s so
 * Resend retries).
 */
export async function updateExternalSendTrackingByProviderId(
  providerId: string,
  patch: {
    status: string;
    column: "delivered_at" | "opened_at" | "clicked_at" | "bounced_at";
    at: string;
  },
): Promise<boolean> {
  // patch.column reaches sql.unsafe, so re-assert it against the 4-value
  // whitelist at the boundary rather than trusting the TypeScript type alone
  // (the value originates from a webhook event type). Mirrors disposals.ts's
  // FACET_SORT_COLUMNS whitelist-then-sql.unsafe pattern.
  const ALLOWED = new Set(["delivered_at", "opened_at", "clicked_at", "bounced_at"]);
  if (!ALLOWED.has(patch.column)) throw new Error("Invalid tracking column.");
  const columnIdent = sql.unsafe(patch.column);
  const rows = await sql`
    update public.external_sends set status = ${patch.status}, ${columnIdent} = ${patch.at}
    where provider_id = ${providerId}
    returning id
  `;
  return rows.length > 0;
}

// ── Cron job (system-wide, no caller agency) — deal reminders ─────────────

export type DueDealReminder = {
  id: string;
  agency_id: string;
  deal_id: string;
  title: string;
  due_at: string;
  created_by: string | null;
};

/**
 * Deal reminders past due, not yet notified, across every agency — the cron
 * job's due-reminders feed (src/app/api/cron/due/route.ts). Deliberately
 * unscoped by agencyId (a system-wide scheduled job, not a single caller);
 * each row's own agency_id is used by the caller to scope every downstream
 * read/write back to that reminder's agency — see the route's header note.
 */
export async function listDueDealReminders(limit = 100): Promise<DueDealReminder[]> {
  const nowIso = new Date().toISOString();
  return (await sql`
    select id, agency_id, deal_id, title, due_at::text as due_at, created_by
    from public.deal_reminders
    where done = false and notified_at is null and due_at <= ${nowIso}
    limit ${limit}
  `) as DueDealReminder[];
}

/**
 * Deal title + owner for a set of deal ids spanning potentially several
 * agencies (the cron job's reminders can belong to any agency) — each
 * returned row carries its own agency_id so the caller can verify it
 * matches the reminder's agency_id before using it, rather than trusting
 * the deal_id alone.
 */
export async function getDealsByIdsAcrossAgencies(
  dealIds: string[],
): Promise<{ id: string; agency_id: string; title: string; lead_agent_id: string | null; created_by: string | null }[]> {
  if (dealIds.length === 0) return [];
  return (await sql`
    select id, agency_id, title, lead_agent_id, created_by
    from public.deals
    where id = ANY(${dealIds}::uuid[])
  `) as { id: string; agency_id: string; title: string; lead_agent_id: string | null; created_by: string | null }[];
}

/** Stamps a deal reminder's notified_at so the cron job fires exactly once
 *  per due reminder. Scoped by agencyId — the id alone comes from a
 *  cross-agency cron read (listDueDealReminders), so this re-asserts the
 *  row's own agency on write. */
export async function markDealReminderNotified(
  agencyId: string,
  id: string,
  notifiedAt: string,
): Promise<void> {
  await sql`
    update public.deal_reminders set notified_at = ${notifiedAt}
    where id = ${id} and agency_id = ${agencyId}
  `;
}
