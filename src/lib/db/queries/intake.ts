import { sql } from "@/lib/db/client";
import { escapeLike } from "@/lib/search";

// DAO for public.intake_submissions (the public-form triage queue — see
// db/migrations/0032_intake_triage.sql) plus the small find-by-name/email
// lookups the approve flow needs. Every function that reads/writes an
// AGENCY's data takes agencyId as a mandatory first parameter — see the same
// note in companies.ts. There is no RLS backstop on this schema (see
// AGENTS.md).
//
// `createIntakeSubmission` is the one function in this file — and in the
// entire migrated codebase — that a genuinely unauthenticated caller's data
// can reach. It is deliberately narrow: the SQL statement names exactly one
// table (`public.intake_submissions`) and every column is either the
// server-resolved `agencyId` or a scalar copied straight off the public
// form. There is no table name, column list or agencyId the caller can
// influence — see src/lib/actions/public-intake.ts for how `agencyId` itself
// is resolved (never from the form; always from a fixed env-configured
// agent's email, looked up server-side).

export type IntakeStatus = "pending" | "approved" | "rejected";

export type IntakeSubmissionRow = {
  id: string;
  status: IntakeStatus;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  property_type: string | null;
  target_locations: string | null;
  min_sqft: number | null;
  max_sqft: number | null;
  min_covers: number | null;
  max_covers: number | null;
  max_rent: number | null;
  max_premium: number | null;
  notes: string | null;
  created_requirement_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const LIST_COLUMNS = `
  id, status, company_name, first_name, last_name, email, phone, property_type,
  target_locations, min_sqft, max_sqft, min_covers, max_covers, max_rent, max_premium,
  notes, created_requirement_id, reviewed_by,
  reviewed_at::text as reviewed_at, created_at::text as created_at
`;

/** Feeds the /intake triage page's tiles (all statuses, newest first). */
export async function listIntakeSubmissions(
  agencyId: string,
  limit = 200,
): Promise<IntakeSubmissionRow[]> {
  return (await sql`
    select ${sql.unsafe(LIST_COLUMNS)}
    from public.intake_submissions
    where agency_id = ${agencyId}
    order by created_at desc
    limit ${limit}
  `) as IntakeSubmissionRow[];
}

/** The fields the approve/reject flow needs, scoped to a still-pending row —
 *  returns null for an unknown id, a wrong-agency id, or one already reviewed. */
export async function getPendingIntakeSubmission(
  agencyId: string,
  id: string,
): Promise<Omit<
  IntakeSubmissionRow,
  "created_requirement_id" | "reviewed_by" | "reviewed_at" | "created_at"
> | null> {
  const rows = await sql`
    select id, status, company_name, first_name, last_name, email, phone, property_type,
           target_locations, min_sqft, max_sqft, min_covers, max_covers, max_rent, max_premium, notes
    from public.intake_submissions
    where id = ${id} and agency_id = ${agencyId} and status = 'pending'
    limit 1
  `;
  return (
    (rows[0] as Omit<
      IntakeSubmissionRow,
      "created_requirement_id" | "reviewed_by" | "reviewed_at" | "created_at"
    > | undefined) ?? null
  );
}

/** Stamps a pending submission approved and links the requirement it produced.
 *  Scoped to status = 'pending' so a double-submit can't double-approve.
 *  Returns false if nothing matched (already reviewed, wrong agency, unknown id). */
export async function approveIntakeSubmission(
  agencyId: string,
  id: string,
  requirementId: string,
  reviewedBy: string,
): Promise<boolean> {
  const rows = await sql`
    update public.intake_submissions set
      status = 'approved',
      created_requirement_id = ${requirementId},
      reviewed_by = ${reviewedBy},
      reviewed_at = now()
    where id = ${id} and agency_id = ${agencyId} and status = 'pending'
    returning id
  `;
  return rows.length > 0;
}

/** Rejects a pending submission — nothing else is written to the CRM. */
export async function rejectIntakeSubmission(
  agencyId: string,
  id: string,
  reviewedBy: string,
): Promise<boolean> {
  const rows = await sql`
    update public.intake_submissions set
      status = 'rejected',
      reviewed_by = ${reviewedBy},
      reviewed_at = now()
    where id = ${id} and agency_id = ${agencyId} and status = 'pending'
    returning id
  `;
  return rows.length > 0;
}

/** Exact (case-insensitive) company-name lookup for the approve flow's
 *  find-or-create — same escaped-exact-match convention as companies.ts's
 *  `findDuplicateCompanyByName`, but returning the id this flow needs. */
export async function findCompanyIdByExactName(
  agencyId: string,
  name: string,
): Promise<string | null> {
  const rows = await sql`
    select id from public.companies
    where agency_id = ${agencyId} and name ilike ${escapeLike(name)}
    limit 1
  `;
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

/** Exact (case-insensitive) contact-email lookup for the approve flow's
 *  find-or-create. */
export async function findContactIdByExactEmail(
  agencyId: string,
  email: string,
): Promise<string | null> {
  const rows = await sql`
    select id from public.contacts
    where agency_id = ${agencyId} and email ilike ${escapeLike(email)}
    limit 1
  `;
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

export type IntakeAgent = { id: string; email: string; full_name: string | null };

/**
 * Looks up a `public.users` row by email — used to resolve the fixed,
 * env-configured default agent (and admin cc) the public form hands
 * submissions to. Intentionally NOT agency-scoped: at the point this runs
 * for the public form, the agency isn't known yet — resolving it (via
 * agencies.ts's `currentAgencyId(agent.id)`) is the very next step, and this
 * lookup only ever reads id/email/full_name, never anything else.
 */
export async function findUserByEmail(email: string): Promise<IntakeAgent | null> {
  const rows = await sql`
    select id, email, full_name from public.users where email = ${email} limit 1
  `;
  return (rows[0] as IntakeAgent | undefined) ?? null;
}

export type PublicIntakeInput = {
  companyName: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  propertyType: string | null;
  targetLocations: string | null;
  minSqft: number | null;
  maxSqft: number | null;
  minCovers: number | null;
  maxCovers: number | null;
  maxRent: number | null;
  maxPremium: number | null;
  notes: string | null;
};

/**
 * THE public-write path (see this file's header comment). Inserts exactly
 * one row into `public.intake_submissions`, status always 'pending' — an
 * unauthenticated caller can never write anywhere else, and can never mark a
 * submission anything but pending, through this function.
 */
export async function createIntakeSubmission(
  agencyId: string,
  input: PublicIntakeInput,
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.intake_submissions (
      agency_id, status, company_name, first_name, last_name, email, phone,
      property_type, target_locations, min_sqft, max_sqft, min_covers, max_covers,
      max_rent, max_premium, notes
    ) values (
      ${agencyId}, 'pending', ${input.companyName}, ${input.firstName}, ${input.lastName},
      ${input.email}, ${input.phone}, ${input.propertyType}, ${input.targetLocations},
      ${input.minSqft}, ${input.maxSqft}, ${input.minCovers}, ${input.maxCovers},
      ${input.maxRent}, ${input.maxPremium}, ${input.notes}
    )
    returning id
  `;
  return rows[0] as { id: string };
}
