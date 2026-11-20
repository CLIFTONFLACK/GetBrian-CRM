import { sql } from "@/lib/db/client";
import type { KycReportData, KycSummary } from "@/lib/kyc/types";

// DAO for public.kyc_reports (+ the company-registration fields it depends
// on, company_number/vat_number on public.companies). Every function takes
// the caller's agencyId as a mandatory first parameter — see the same note
// in companies.ts. Company lookups here query public.companies directly
// (rather than adding KYC-shaped helpers to companies.ts) — same pattern
// disposals.ts uses for its own cross-domain company reads.

export type KycReportStatus = "pending" | "complete" | "failed";
export type KycRisk = "low" | "medium" | "high" | "unknown";

export type KycCompanyOption = {
  id: string;
  name: string;
  company_number: string | null;
  vat_number: string | null;
};

export type KycReport = {
  id: string;
  agency_id: string;
  company_id: string;
  company_number: string | null;
  status: KycReportStatus;
  risk_rating: KycRisk;
  sources: string[];
  flags: string[];
  summary: KycSummary | null;
  payload: KycReportData | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type KycReportListItem = {
  id: string;
  company_id: string;
  company_number: string | null;
  status: KycReportStatus;
  risk_rating: KycRisk;
  created_at: string;
};

export type KycReportSummary = {
  id: string;
  risk_rating: KycRisk;
  flags: string[];
  created_at: string;
};

/** Companies for the KYC picker (id, name, current CRN/VAT) — feeds /kyc's
 *  company <select> and the registration-details form's prefill. */
export async function listCompaniesForKyc(agencyId: string): Promise<KycCompanyOption[]> {
  return (await sql`
    select id, name, company_number, vat_number
    from public.companies
    where agency_id = ${agencyId}
    order by name asc
  `) as KycCompanyOption[];
}

/** A single company's id/name/CRN/VAT, agency-scoped — confirms the company
 *  exists (and belongs to the caller's agency) before running a report. */
export async function getKycCompany(
  agencyId: string,
  companyId: string,
): Promise<KycCompanyOption | null> {
  const rows = await sql`
    select id, name, company_number, vat_number
    from public.companies
    where id = ${companyId} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as KycCompanyOption | undefined) ?? null;
}

/** Saves a company's Companies House number + VAT number (the "link CRN"
 *  step before running a report). Returns false when nothing matched (not
 *  found, or belongs to a different agency). */
export async function updateCompanyRegistration(
  agencyId: string,
  companyId: string,
  companyNumber: string | null,
  vatNumber: string | null,
): Promise<boolean> {
  const rows = await sql`
    update public.companies
    set company_number = ${companyNumber}, vat_number = ${vatNumber}
    where id = ${companyId} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

/** Most recent 50 KYC report runs across the agency, newest first — the
 *  "Recent reports" list on /kyc. */
export async function listRecentKycReports(agencyId: string): Promise<KycReportListItem[]> {
  return (await sql`
    select id, company_id, company_number, status, risk_rating, created_at::text as created_at
    from public.kyc_reports
    where agency_id = ${agencyId}
    order by created_at desc
    limit 50
  `) as KycReportListItem[];
}

/** The latest full report (payload + summary) for one company — the
 *  "Latest report" detail view on /kyc?company=. */
export async function getLatestKycReport(
  agencyId: string,
  companyId: string,
): Promise<KycReport | null> {
  const rows = await sql`
    select id, agency_id, company_id, company_number, status, risk_rating, sources, flags,
      summary, payload, error, created_by,
      created_at::text as created_at, updated_at::text as updated_at
    from public.kyc_reports
    where agency_id = ${agencyId} and company_id = ${companyId}
    order by created_at desc
    limit 1
  `;
  return (rows[0] as KycReport | undefined) ?? null;
}

/** The latest report's headline fields only (risk + flags + when) — feeds
 *  the compact "KYC" card on the company detail page. */
export async function getLatestKycSummary(
  agencyId: string,
  companyId: string,
): Promise<KycReportSummary | null> {
  const rows = await sql`
    select id, risk_rating, flags, created_at::text as created_at
    from public.kyc_reports
    where agency_id = ${agencyId} and company_id = ${companyId}
    order by created_at desc
    limit 1
  `;
  return (rows[0] as KycReportSummary | undefined) ?? null;
}

export type CreateKycReportInput = {
  companyId: string;
  companyNumber: string | null;
  status: KycReportStatus;
  riskRating: KycRisk;
  sources: string[];
  flags: string[];
  summary: KycSummary | null;
  payload: KycReportData | null;
  createdBy: string;
};

/** Persists a KYC report run (an audit-trail insert — reports are never
 *  updated in place). `summary`/`payload` are stringified before the
 *  `::jsonb` cast, matching matches.ts's pattern for writing jsonb columns
 *  through the tagged-template `sql`. */
export async function createKycReport(
  agencyId: string,
  input: CreateKycReportInput,
): Promise<KycReport> {
  const summaryJson = input.summary === null ? null : JSON.stringify(input.summary);
  const payloadJson = input.payload === null ? null : JSON.stringify(input.payload);
  const rows = await sql`
    insert into public.kyc_reports (
      agency_id, company_id, company_number, status, risk_rating, sources, flags,
      summary, payload, created_by
    ) values (
      ${agencyId}, ${input.companyId}, ${input.companyNumber}, ${input.status}, ${input.riskRating},
      ${input.sources}, ${input.flags}, ${summaryJson}::jsonb, ${payloadJson}::jsonb, ${input.createdBy}
    )
    returning id, agency_id, company_id, company_number, status, risk_rating, sources, flags,
      summary, payload, error, created_by,
      created_at::text as created_at, updated_at::text as updated_at
  `;
  return rows[0] as KycReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// public.didit_sessions — the paid Didit identity checks.
//
// One row per check started for a CONTACT: a Didit KYC session verifies a
// person (document, liveness, face match, watchlist), so it hangs off contacts
// while carrying the company alongside for the company-level views
// (db/migrations/0042_didit_kyc.sql explains the split from kyc_reports).
// Same agency-scoping rule as everything above — agencyId is a mandatory first
// parameter, and it is in the WHERE clause of every read and every update.
// ─────────────────────────────────────────────────────────────────────────────

export type DiditSessionRow = {
  id: string;
  agency_id: string;
  contact_id: string;
  company_id: string | null;
  session_id: string;
  workflow_id: string | null;
  session_url: string | null;
  status: string;
  decision: unknown | null;
  aml_hits: number;
  verified_name: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A session joined to the contact it verifies — what the KYC page lists. */
export type DiditSessionWithContact = DiditSessionRow & {
  contact_name: string;
};

export type CreateDiditSessionInput = {
  contactId: string;
  companyId: string | null;
  sessionId: string;
  workflowId: string | null;
  sessionUrl: string | null;
  status: string;
  createdBy: string;
};

export async function createDiditSession(
  agencyId: string,
  input: CreateDiditSessionInput,
): Promise<DiditSessionRow> {
  const rows = await sql`
    insert into public.didit_sessions
      (agency_id, contact_id, company_id, session_id, workflow_id, session_url, status, created_by)
    values (
      ${agencyId}, ${input.contactId}, ${input.companyId}, ${input.sessionId},
      ${input.workflowId}, ${input.sessionUrl}, ${input.status}, ${input.createdBy}
    )
    returning id, agency_id, contact_id, company_id, session_id, workflow_id, session_url,
      status, decision, aml_hits, verified_name, error, created_by,
      created_at::text as created_at, updated_at::text as updated_at
  `;
  return rows[0] as DiditSessionRow;
}

/** Stores a freshly fetched decision. Unlike kyc_reports (append-only), this
 *  updates in place: it is the current state of one session, not an audit
 *  trail, and Didit's decision endpoint always returns the whole thing. */
export async function updateDiditDecision(
  agencyId: string,
  sessionId: string,
  status: string,
  decision: unknown,
  amlHits: number,
  verifiedName: string | null,
  /** When this decision's fetch STARTED. When given, the save is skipped if the
   *  row already holds a decision fetched later (migration 0048), so a slow
   *  fetch of an older state cannot overwrite a newer one. */
  fetchedAt: Date | null = null,
): Promise<boolean> {
  const decisionJson = decision === null ? null : JSON.stringify(decision);
  const fetchedIso = fetchedAt ? fetchedAt.toISOString() : null;
  const rows = fetchedIso
    ? await sql`
        update public.didit_sessions
        set status = ${status}, decision = ${decisionJson}::jsonb, aml_hits = ${amlHits},
            verified_name = ${verifiedName}, error = null,
            decision_fetched_at = ${fetchedIso}::timestamptz
        where agency_id = ${agencyId} and session_id = ${sessionId}
          and (decision_fetched_at is null or decision_fetched_at <= ${fetchedIso}::timestamptz)
        returning id
      `
    : await sql`
        update public.didit_sessions
        set status = ${status}, decision = ${decisionJson}::jsonb, aml_hits = ${amlHits},
            verified_name = ${verifiedName}, error = null
        where agency_id = ${agencyId} and session_id = ${sessionId}
        returning id
      `;
  return rows.length > 0;
}

/** Records a failed refresh without losing the last good decision. */
export async function setDiditSessionError(
  agencyId: string,
  sessionId: string,
  message: string,
): Promise<void> {
  await sql`
    update public.didit_sessions
    set error = ${message}
    where agency_id = ${agencyId} and session_id = ${sessionId}
  `;
}

/** One session by Didit's own id, agency-scoped — the refresh action's lookup,
 *  and the guard that stops one agency polling another's session. */
export async function getDiditSession(
  agencyId: string,
  sessionId: string,
): Promise<DiditSessionRow | null> {
  const rows = await sql`
    select id, agency_id, contact_id, company_id, session_id, workflow_id, session_url,
      status, decision, aml_hits, verified_name, error, created_by,
      created_at::text as created_at, updated_at::text as updated_at
    from public.didit_sessions
    where agency_id = ${agencyId} and session_id = ${sessionId}
    limit 1
  `;
  return (rows[0] as DiditSessionRow | undefined) ?? null;
}

/**
 * The latest check per contact for one company — the KYC page's Didit panel,
 * and the source the report pipeline reads (from the database, so generating a
 * report never triggers a paid call).
 *
 * A contact can be checked more than once (a re-verification a year on, or a
 * retry after a declined document), and only the newest matters here: hence
 * `distinct on (contact_id)` ordered newest-first, which is Postgres's way of
 * saying "one row per contact, the latest" without a self-join.
 */
export async function listLatestDiditSessionsForCompany(
  agencyId: string,
  companyId: string,
): Promise<DiditSessionWithContact[]> {
  return (await sql`
    select distinct on (d.contact_id)
      d.id, d.agency_id, d.contact_id, d.company_id, d.session_id, d.workflow_id,
      d.session_url, d.status, d.decision, d.aml_hits, d.verified_name, d.error,
      d.created_by, d.created_at::text as created_at, d.updated_at::text as updated_at,
      trim(concat(c.first_name, ' ', coalesce(c.last_name, ''))) as contact_name
    from public.didit_sessions d
    join public.contacts c on c.id = d.contact_id
    where d.agency_id = ${agencyId} and d.company_id = ${companyId}
    order by d.contact_id, d.created_at desc
  `) as DiditSessionWithContact[];
}

/** The latest check for one contact — the per-contact status on the KYC page
 *  and on a contact record. */
export async function getLatestDiditSessionForContact(
  agencyId: string,
  contactId: string,
): Promise<DiditSessionRow | null> {
  const rows = await sql`
    select id, agency_id, contact_id, company_id, session_id, workflow_id, session_url,
      status, decision, aml_hits, verified_name, error, created_by,
      created_at::text as created_at, updated_at::text as updated_at
    from public.didit_sessions
    where agency_id = ${agencyId} and contact_id = ${contactId}
    order by created_at desc
    limit 1
  `;
  return (rows[0] as DiditSessionRow | undefined) ?? null;
}
