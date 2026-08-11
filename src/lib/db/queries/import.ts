import { sql } from "@/lib/db/client";

// DAO for the bulk CSV importer's own lookups (src/lib/actions/import-data.ts).
// The actual row inserts reuse each domain's existing create* function
// (createCompany/createContact/createRequirement/createDisposal) rather than
// duplicating insert logic here — see AGENTS.md. Every function takes the
// caller's agencyId as a mandatory first parameter and filters on it
// explicitly — see the same note in companies.ts.

/** Every contact's email → id, lower-cased, for the importer's
 *  `contact_email` column resolution (every listing/requirement row must
 *  reference an existing contact). */
export async function listContactEmailMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, email from public.contacts
    where agency_id = ${agencyId} and email is not null
  `) as { id: string; email: string }[];
  return new Map(rows.map((r) => [r.email.trim().toLowerCase(), r.id]));
}

/** Every company's name → id, lower-cased — used to dedupe company imports
 *  and to resolve contacts' `company_name` links. */
export async function listCompanyNameMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, name from public.companies where agency_id = ${agencyId}
  `) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
}
