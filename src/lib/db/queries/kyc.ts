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
