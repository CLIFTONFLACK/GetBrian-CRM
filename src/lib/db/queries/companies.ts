import { sql } from "@/lib/db/client";
import { escapeLike } from "@/lib/search";

// DAO for public.companies (+ its company_agents join table). Every function
// takes the caller's agencyId as a mandatory first parameter and filters on
// it explicitly — there is no RLS backstop on this schema (see AGENTS.md),
// so this filter IS the tenant boundary. Never accept an agencyId from a
// client input; callers must resolve it server-side via
// currentAgencyId(userId) (src/lib/db/queries/agencies.ts) first.

export type Company = {
  id: string;
  agency_id: string;
  name: string;
  type: string;
  sector_tags: string[];
  website: string | null;
  phone: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lead_agent_id: string | null;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  company_number: string | null;
  vat_number: string | null;
  county: string | null;
};

/** Row shape for the companies-list aggregate pass: just enough for the
 *  stats tiles, heatmap, facet dropdowns and the map layer. */
export type CompanyFacetRow = {
  id: string;
  name: string;
  type: string;
  sector_tags: string[];
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
};

/** Row shape for the paginated table's detail pass. */
export type CompanyListRow = {
  id: string;
  name: string;
  type: string;
  sector_tags: string[];
  website: string | null;
};

export async function getCompanyById(agencyId: string, id: string): Promise<Company | null> {
  // created_at/updated_at are cast to text: neon() (client.ts) parses
  // timestamptz into JS Date, which only holds millisecond precision — a
  // silent, lossy round trip against Postgres's microsecond-precision
  // storage. Not just cosmetic: getCompanyForUpdate below relies on getting
  // the exact stored string back for the optimistic-concurrency check.
  const rows = await sql`
    select
      id, agency_id, name, type, sector_tags, website, phone, notes, created_by,
      created_at::text as created_at, updated_at::text as updated_at,
      lead_agent_id, address_line, city, postcode, lat, lng,
      company_number, vat_number, county
    from public.companies
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as Company | undefined) ?? null;
}

/** Just the name — feeds the contact detail page's "Company" row without
 *  pulling the whole row. */
export async function getCompanyName(agencyId: string, id: string): Promise<string | null> {
  const rows = await sql`
    select name from public.companies where id = ${id} and agency_id = ${agencyId} limit 1
  `;
  return (rows[0] as { name: string } | undefined)?.name ?? null;
}

/** Agency-wide company count — feeds the dashboard's "Companies" KPI tile
 *  without pulling every row. */
export async function countCompanies(agencyId: string): Promise<number> {
  const rows = await sql`
    select count(*)::int as count from public.companies where agency_id = ${agencyId}
  `;
  return (rows[0] as { count: number }).count;
}

/** Cross-entity search hit list (id, name, type) — matches name, phone or
 *  website. Feeds /search; term must already be escapeLike-sanitized by the
 *  caller (matching every prior batch's search convention — see
 *  src/lib/search.ts). */
export async function searchCompanies(
  agencyId: string,
  pattern: string,
  limit = 10,
): Promise<{ id: string; name: string; type: string }[]> {
  return (await sql`
    select id, name, type from public.companies
    where agency_id = ${agencyId}
      and (name ilike ${pattern} or phone ilike ${pattern} or website ilike ${pattern})
    limit ${limit}
  `) as { id: string; name: string; type: string }[];
}

/** id + name only, sorted by name — feeds the "company" picker on the
 *  contacts forms. */
export async function listCompanyOptions(
  agencyId: string,
): Promise<{ id: string; name: string }[]> {
  return (await sql`
    select id, name from public.companies where agency_id = ${agencyId} order by name asc
  `) as { id: string; name: string }[];
}

/**
 * The companies-list aggregate pass (search + sort applied, unpaginated) —
 * source for the stats tiles, sector×type heatmap and the map layer.
 */
export async function listCompanyFacetRows(
  agencyId: string,
  opts: { q?: string; column: "name" | "type"; ascending: boolean },
): Promise<CompanyFacetRow[]> {
  // `sql` (client.ts) executes as soon as it's tagged — there's no fragment
  // composition, so each sort combination is written out as a complete,
  // standalone query rather than assembled from a shared partial string.
  const pattern = opts.q ? `%${escapeLike(opts.q)}%` : null;
  if (opts.column === "type") {
    return (opts.ascending
      ? await sql`
          select id, name, type, sector_tags, address_line, city, postcode, county, lat, lng
          from public.companies
          where agency_id = ${agencyId}
            and (${pattern}::text is null or name ilike ${pattern})
          order by type asc, name asc
        `
      : await sql`
          select id, name, type, sector_tags, address_line, city, postcode, county, lat, lng
          from public.companies
          where agency_id = ${agencyId}
            and (${pattern}::text is null or name ilike ${pattern})
          order by type desc, name asc
        `) as CompanyFacetRow[];
  }
  return (opts.ascending
    ? await sql`
        select id, name, type, sector_tags, address_line, city, postcode, county, lat, lng
        from public.companies
        where agency_id = ${agencyId}
          and (${pattern}::text is null or name ilike ${pattern})
        order by name asc
      `
    : await sql`
        select id, name, type, sector_tags, address_line, city, postcode, county, lat, lng
        from public.companies
        where agency_id = ${agencyId}
          and (${pattern}::text is null or name ilike ${pattern})
        order by name desc
      `) as CompanyFacetRow[];
}

/** Detail pass for a specific page of ids (order is re-applied by the caller —
 *  `= ANY()` does not preserve the requested order). */
export async function getCompaniesByIds(
  agencyId: string,
  ids: string[],
): Promise<CompanyListRow[]> {
  if (ids.length === 0) return [];
  return (await sql`
    select id, name, type, sector_tags, website
    from public.companies
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as CompanyListRow[];
}

/** Case-insensitive pre-insert duplicate lookup on exact company name.
 *  Returns the existing company's name, or null when there is no duplicate. */
export async function findDuplicateCompanyByName(
  agencyId: string,
  name: string,
): Promise<string | null> {
  const rows = await sql`
    select name from public.companies
    where agency_id = ${agencyId} and name ilike ${escapeLike(name)}
    limit 1
  `;
  return (rows[0] as { name: string } | undefined)?.name ?? null;
}

export type CompanyWriteInput = {
  name: string;
  type: string;
  sectorTags: string[];
  website: string | null;
  phone: string | null;
  notes: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  leadAgentId: string | null;
  addressLine: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
};

export async function createCompany(
  agencyId: string,
  createdBy: string,
  input: CompanyWriteInput,
  geo: { lat: number | null; lng: number | null },
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.companies (
      agency_id, created_by, name, type, sector_tags, website, phone, notes,
      company_number, vat_number, lead_agent_id,
      address_line, city, postcode, county, lat, lng
    ) values (
      ${agencyId}, ${createdBy}, ${input.name}, ${input.type}, ${input.sectorTags},
      ${input.website}, ${input.phone}, ${input.notes},
      ${input.companyNumber}, ${input.vatNumber}, ${input.leadAgentId},
      ${input.addressLine}, ${input.city}, ${input.postcode}, ${input.county},
      ${geo.lat}, ${geo.lng}
    )
    returning id
  `;
  return rows[0] as { id: string };
}

/** The subset of columns geocodeForSave needs to decide whether to
 *  re-geocode, plus updated_at for the optimistic-concurrency check. */
export async function getCompanyForUpdate(
  agencyId: string,
  id: string,
): Promise<{
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
} | null> {
  // updated_at::text — see getCompanyById's comment on why this cast matters
  // (a lossy Date round trip here would make the concurrency check below
  // spuriously reject saves that never actually conflicted).
  const rows = await sql`
    select address_line, city, postcode, lat, lng, updated_at::text as updated_at
    from public.companies
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (
    (rows[0] as {
      address_line: string | null;
      city: string | null;
      postcode: string | null;
      lat: number | null;
      lng: number | null;
      updated_at: string;
    } | undefined) ?? null
  );
}

/**
 * Updates the row guarded by both agencyId (tenant isolation) and
 * `expectedUpdatedAt` (optimistic concurrency — mirrors the Supabase
 * `.eq("updated_at", existing.updated_at)` check). Returns null when nothing
 * matched (not found, wrong agency, or changed since the form loaded).
 * `geo: null` means "leave lat/lng untouched"; a `{lat, lng}` object
 * (possibly both null, meaning the address was cleared) is written as-is.
 */
export async function updateCompany(
  agencyId: string,
  id: string,
  expectedUpdatedAt: string,
  input: CompanyWriteInput,
  geo: { lat: number | null; lng: number | null } | null,
): Promise<{ id: string } | null> {
  const rows = geo
    ? await sql`
        update public.companies set
          name = ${input.name},
          type = ${input.type},
          sector_tags = ${input.sectorTags},
          website = ${input.website},
          phone = ${input.phone},
          notes = ${input.notes},
          company_number = ${input.companyNumber},
          vat_number = ${input.vatNumber},
          lead_agent_id = ${input.leadAgentId},
          address_line = ${input.addressLine},
          city = ${input.city},
          postcode = ${input.postcode},
          county = ${input.county},
          lat = ${geo.lat},
          lng = ${geo.lng}
        where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
        returning id
      `
    : await sql`
        update public.companies set
          name = ${input.name},
          type = ${input.type},
          sector_tags = ${input.sectorTags},
          website = ${input.website},
          phone = ${input.phone},
          notes = ${input.notes},
          company_number = ${input.companyNumber},
          vat_number = ${input.vatNumber},
          lead_agent_id = ${input.leadAgentId},
          address_line = ${input.addressLine},
          city = ${input.city},
          postcode = ${input.postcode},
          county = ${input.county}
        where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
        returning id
      `;
  return (rows[0] as { id: string } | undefined) ?? null;
}

export async function deleteCompany(agencyId: string, id: string): Promise<void> {
  await sql`delete from public.companies where id = ${id} and agency_id = ${agencyId}`;
}

/** Additional-agent (collaborator) user ids for a company. */
export async function getCompanyAgentIds(agencyId: string, companyId: string): Promise<string[]> {
  const rows = await sql`
    select user_id from public.company_agents
    where agency_id = ${agencyId} and company_id = ${companyId}
  `;
  return (rows as { user_id: string }[]).map((r) => r.user_id);
}

/** Replaces a company's additional-agent rows in one round trip: delete then
 *  re-insert via `unnest`, which also handles the empty-array case (no rows
 *  inserted) without a separate branch. */
export async function syncCompanyAgents(
  agencyId: string,
  companyId: string,
  userIds: string[],
): Promise<void> {
  await sql.transaction((tx) => [
    tx`delete from public.company_agents where agency_id = ${agencyId} and company_id = ${companyId}`,
    tx`
      insert into public.company_agents (agency_id, company_id, user_id)
      select ${agencyId}, ${companyId}, u from unnest(${userIds}::uuid[]) as u
    `,
  ]);
}
