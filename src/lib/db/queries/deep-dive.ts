import { sql } from "@/lib/db/client";

// DAO for public.deep_dive_reports — one row per AI "Deep Dive" run (an
// audit trail, mirroring kyc_reports). Every function takes the caller's
// agencyId as a mandatory first parameter — see the same note in
// companies.ts.

export type DeepDiveStatus = "pending" | "complete" | "failed";

export type DeepDiveReportRow = {
  id: string;
  agency_id: string;
  company_id: string;
  status: DeepDiveStatus;
  model: string | null;
  markdown: string | null;
  sources: string[];
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DeepDiveCard = { markdown: string; created_at: string; model: string | null };

/** The latest *complete* Deep Dive for a company — feeds the company page's
 *  Deep Dive card and the PDF-export route. Only "complete" rows are ever
 *  surfaced (a failed run leaves the last complete report, if any, still
 *  showing) — matches the original Supabase query's `.eq("status",
 *  "complete")` filter. */
export async function getLatestCompleteDeepDive(
  agencyId: string,
  companyId: string,
): Promise<DeepDiveCard | null> {
  const rows = await sql`
    select markdown, created_at::text as created_at, model
    from public.deep_dive_reports
    where agency_id = ${agencyId} and company_id = ${companyId} and status = 'complete'
    order by created_at desc
    limit 1
  `;
  const row = rows[0] as
    | { markdown: string | null; created_at: string; model: string | null }
    | undefined;
  if (!row?.markdown) return null;
  return { markdown: row.markdown, created_at: row.created_at, model: row.model };
}

export type CreateDeepDiveInput = {
  companyId: string;
  status: DeepDiveStatus;
  model: string | null;
  markdown?: string | null;
  error?: string | null;
  createdBy: string;
};

/** Persists a Deep Dive run — complete (with markdown) or failed (with an
 *  error message) — one insert per run, never updated in place. */
export async function createDeepDiveReport(
  agencyId: string,
  input: CreateDeepDiveInput,
): Promise<void> {
  await sql`
    insert into public.deep_dive_reports (
      agency_id, company_id, status, model, markdown, error, created_by
    ) values (
      ${agencyId}, ${input.companyId}, ${input.status}, ${input.model},
      ${input.markdown ?? null}, ${input.error ?? null}, ${input.createdBy}
    )
  `;
}
