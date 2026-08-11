import { sql } from "@/lib/db/client";
import { escapeLike } from "@/lib/search";
import type { Database } from "@/lib/database.types";

// DAO for public.requirements (+ its requirement_agents join table). Every
// function takes the caller's agencyId as a mandatory first parameter and
// filters on it explicitly — see the same note in companies.ts.
//
// `database.types.ts` is imported here for its enum *types* only (UseClass /
// Tenure / ReqStatus are literal-union types generated from the schema) — no
// Supabase client is involved. src/lib/matching/score.ts narrows its own
// Requirement/Disposal types off the same file for the identical reason: the
// scorer's `use_classes`/`tenure_prefs` params are typed as these literal
// unions, so this DAO's row types have to match structurally.

type UseClass = Database["public"]["Enums"]["use_class"];
type Tenure = Database["public"]["Enums"]["tenure_type"];
type ReqStatus = Database["public"]["Enums"]["requirement_status"];

/** Full row shape — feeds the detail/edit pages. */
export type Requirement = {
  id: string;
  agency_id: string;
  company_id: string | null;
  contact_id: string | null;
  title: string;
  target_towns: string[];
  target_regions: string[];
  min_sqft: number | null;
  max_sqft: number | null;
  min_covers: number | null;
  max_covers: number | null;
  use_classes: UseClass[];
  max_rent: number | null;
  max_premium: number | null;
  tenure_prefs: Tenure[];
  notes: string | null;
  status: ReqStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  property_types: string[];
  max_guide_price: number | null;
  fit_out_prefs: string[];
  lead_agent_id: string | null;
  target_counties: string[];
  target_postcode_districts: string[];
  target_neighbourhoods: string[];
  target_london_zones: string[];
};

// use_classes/tenure_prefs are arrays of a custom Postgres enum (use_class[]/
// tenure_type[]), not a primitive array type — neon()'s driver only parses
// well-known array types (text[], uuid[], etc.) into real JS arrays; a custom
// enum array comes back as the raw literal string "{E}" instead, which then
// crashes anything calling .some()/.map() on it (see AGENTS.md). Casting to
// ::text[] in the query itself is the fix: same string values, but now a type
// the driver actually parses.
const FULL_COLUMNS = `
  id, agency_id, company_id, contact_id, title, target_towns, target_regions,
  min_sqft, max_sqft, min_covers, max_covers, use_classes::text[] as use_classes,
  max_rent, max_premium, tenure_prefs::text[] as tenure_prefs, notes, status, created_by,
  created_at::text as created_at, updated_at::text as updated_at,
  property_types, max_guide_price, fit_out_prefs, lead_agent_id,
  target_counties, target_postcode_districts, target_neighbourhoods, target_london_zones
`;

export async function getRequirementById(agencyId: string, id: string): Promise<Requirement | null> {
  const rows = await sql`
    select ${sql.unsafe(FULL_COLUMNS)}
    from public.requirements
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as Requirement | undefined) ?? null;
}

/** Just the title — feeds `generateMetadata` without pulling the whole row. */
export async function getRequirementTitle(agencyId: string, id: string): Promise<string | null> {
  const rows = await sql`
    select title from public.requirements where id = ${id} and agency_id = ${agencyId} limit 1
  `;
  return (rows[0] as { title: string } | undefined)?.title ?? null;
}

/** Row shape for the requirements-list aggregate pass. */
export type RequirementFacetRow = {
  id: string;
  status: ReqStatus;
  target_towns: string[];
  target_regions: string[];
  target_counties: string[];
  target_postcode_districts: string[];
  target_neighbourhoods: string[];
  target_london_zones: string[];
  created_at: string;
  use_classes: UseClass[];
};

const FACET_COLUMNS = `
  id, status, target_towns, target_regions, target_counties, target_postcode_districts,
  target_neighbourhoods, target_london_zones, created_at::text as created_at,
  use_classes::text[] as use_classes
`;

/** The requirements-list aggregate pass (search applied, unpaginated, sorted
 *  by the caller's chosen column) — source for the tiles and stats bar. */
export async function listRequirementFacetRows(
  agencyId: string,
  opts: { q?: string; column: "title" | "max_rent" | "status"; ascending: boolean },
): Promise<RequirementFacetRow[]> {
  const pattern = opts.q ? `%${escapeLike(opts.q)}%` : null;
  const order = `${opts.column} ${opts.ascending ? "asc" : "desc"}`;
  return (await sql`
    select ${sql.unsafe(FACET_COLUMNS)}
    from public.requirements
    where agency_id = ${agencyId}
      and (${pattern}::text is null or title ilike ${pattern})
    order by ${sql.unsafe(order)}
  `) as RequirementFacetRow[];
}

/** Count of active requirements, agency-wide — feeds the dashboard's "Live
 *  requirements" KPI tile without pulling every row. */
export async function countActiveRequirements(agencyId: string): Promise<number> {
  const rows = await sql`
    select count(*)::int as count from public.requirements
    where agency_id = ${agencyId} and status = 'active'
  `;
  return (rows[0] as { count: number }).count;
}

/** Cross-entity search hit list (id, title, status) — matches title or
 *  notes. Feeds /search; `pattern` must already be escapeLike-sanitized by
 *  the caller (see src/lib/search.ts). */
export async function searchRequirements(
  agencyId: string,
  pattern: string,
  limit = 10,
): Promise<{ id: string; title: string; status: ReqStatus }[]> {
  return (await sql`
    select id, title, status from public.requirements
    where agency_id = ${agencyId} and (title ilike ${pattern} or notes ilike ${pattern})
    limit ${limit}
  `) as { id: string; title: string; status: ReqStatus }[];
}

/** title/status/created_at/lead_agent_id, agency-wide — feeds /reports's
 *  "cold requirements" list and per-agent "requirements" column. */
export async function listRequirementsForReports(agencyId: string): Promise<
  { id: string; title: string; status: ReqStatus; created_at: string; lead_agent_id: string | null }[]
> {
  return (await sql`
    select id, title, status, created_at::text as created_at, lead_agent_id
    from public.requirements
    where agency_id = ${agencyId}
  `) as { id: string; title: string; status: ReqStatus; created_at: string; lead_agent_id: string | null }[];
}

/** Row shape for the paginated table's detail pass. */
export type RequirementListRow = {
  id: string;
  title: string;
  status: ReqStatus;
  target_towns: string[];
  max_rent: number | null;
  company_id: string | null;
};

/** Detail pass for a specific page of ids (order re-applied by the caller). */
export async function getRequirementsByIds(
  agencyId: string,
  ids: string[],
): Promise<RequirementListRow[]> {
  if (ids.length === 0) return [];
  return (await sql`
    select id, title, status, target_towns, max_rent, company_id
    from public.requirements
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as RequirementListRow[];
}

/** Feeds the company detail page's "Requirements" card. */
export async function listRequirementsForCompany(
  agencyId: string,
  companyId: string,
): Promise<{ id: string; title: string; status: string }[]> {
  return (await sql`
    select id, title, status
    from public.requirements
    where agency_id = ${agencyId} and company_id = ${companyId}
    order by title
  `) as { id: string; title: string; status: string }[];
}

/** Row shape used by the MatchMaker scorer. */
export type MatchRequirement = {
  id: string;
  title: string;
  lead_agent_id: string | null;
  company_id: string | null;
  target_towns: string[];
  target_regions: string[];
  target_counties: string[];
  target_postcode_districts: string[];
  target_neighbourhoods: string[];
  target_london_zones: string[];
  min_sqft: number | null;
  max_sqft: number | null;
  min_covers: number | null;
  max_covers: number | null;
  use_classes: UseClass[];
  tenure_prefs: Tenure[];
  max_rent: number | null;
  max_premium: number | null;
  max_guide_price: number | null;
};

const MATCH_COLUMNS = `
  id, title, lead_agent_id, company_id, target_towns, target_regions, target_counties,
  target_postcode_districts, target_neighbourhoods, target_london_zones, min_sqft, max_sqft,
  min_covers, max_covers, use_classes::text[] as use_classes, tenure_prefs::text[] as tenure_prefs,
  max_rent, max_premium, max_guide_price
`;

/** Every active requirement in the agency, for scoring against live stock. */
export async function listActiveRequirementsForMatching(
  agencyId: string,
): Promise<MatchRequirement[]> {
  return (await sql`
    select ${sql.unsafe(MATCH_COLUMNS)}
    from public.requirements
    where agency_id = ${agencyId} and status = 'active'
  `) as MatchRequirement[];
}

/** Single active requirement, for the "brief just changed" refresh. */
export async function getActiveRequirementForMatching(
  agencyId: string,
  id: string,
): Promise<MatchRequirement | null> {
  const rows = await sql`
    select ${sql.unsafe(MATCH_COLUMNS)}
    from public.requirements
    where agency_id = ${agencyId} and id = ${id} and status = 'active'
    limit 1
  `;
  return (rows[0] as MatchRequirement | undefined) ?? null;
}

export type RequirementWriteInput = {
  title: string;
  companyId: string | null;
  contactId: string | null;
  status: ReqStatus;
  targetTowns: string[];
  targetRegions: string[];
  targetCounties: string[];
  targetPostcodeDistricts: string[];
  targetNeighbourhoods: string[];
  targetLondonZones: string[];
  useClasses: UseClass[];
  tenurePrefs: Tenure[];
  minSqft: number | null;
  maxSqft: number | null;
  minCovers: number | null;
  maxCovers: number | null;
  maxRent: number | null;
  maxPremium: number | null;
  maxGuidePrice: number | null;
  notes: string | null;
  leadAgentId: string | null;
};

export async function createRequirement(
  agencyId: string,
  createdBy: string,
  input: RequirementWriteInput,
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.requirements (
      agency_id, created_by, title, company_id, contact_id, status,
      target_towns, target_regions, target_counties, target_postcode_districts,
      target_neighbourhoods, target_london_zones, use_classes, tenure_prefs,
      min_sqft, max_sqft, min_covers, max_covers, max_rent, max_premium,
      max_guide_price, notes, lead_agent_id
    ) values (
      ${agencyId}, ${createdBy}, ${input.title}, ${input.companyId}, ${input.contactId}, ${input.status},
      ${input.targetTowns}, ${input.targetRegions}, ${input.targetCounties}, ${input.targetPostcodeDistricts},
      ${input.targetNeighbourhoods}, ${input.targetLondonZones}, ${input.useClasses}::public.use_class[], ${input.tenurePrefs}::public.tenure_type[],
      ${input.minSqft}, ${input.maxSqft}, ${input.minCovers}, ${input.maxCovers}, ${input.maxRent}, ${input.maxPremium},
      ${input.maxGuidePrice}, ${input.notes}, ${input.leadAgentId}
    )
    returning id
  `;
  return rows[0] as { id: string };
}

/** Just the lead agent + updated_at — drives the "hand-off should ping the
 *  incoming agent" check and the optimistic-concurrency guard (see
 *  companies.ts's `getCompanyForUpdate`). */
export async function getRequirementForUpdate(
  agencyId: string,
  id: string,
): Promise<{ lead_agent_id: string | null; updated_at: string } | null> {
  const rows = await sql`
    select lead_agent_id, updated_at::text as updated_at
    from public.requirements
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as { lead_agent_id: string | null; updated_at: string } | undefined) ?? null;
}

/** Guarded by agencyId + optimistic concurrency — see companies.ts's
 *  `updateCompany`. Returns null when nothing matched (not found, wrong
 *  agency, or changed since `expectedUpdatedAt` was read). */
export async function updateRequirement(
  agencyId: string,
  id: string,
  expectedUpdatedAt: string,
  input: RequirementWriteInput,
): Promise<{ id: string } | null> {
  const rows = await sql`
    update public.requirements set
      title = ${input.title},
      company_id = ${input.companyId},
      contact_id = ${input.contactId},
      status = ${input.status},
      target_towns = ${input.targetTowns},
      target_regions = ${input.targetRegions},
      target_counties = ${input.targetCounties},
      target_postcode_districts = ${input.targetPostcodeDistricts},
      target_neighbourhoods = ${input.targetNeighbourhoods},
      target_london_zones = ${input.targetLondonZones},
      use_classes = ${input.useClasses}::public.use_class[],
      tenure_prefs = ${input.tenurePrefs}::public.tenure_type[],
      min_sqft = ${input.minSqft},
      max_sqft = ${input.maxSqft},
      min_covers = ${input.minCovers},
      max_covers = ${input.maxCovers},
      max_rent = ${input.maxRent},
      max_premium = ${input.maxPremium},
      max_guide_price = ${input.maxGuidePrice},
      notes = ${input.notes},
      lead_agent_id = ${input.leadAgentId}
    where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
    returning id
  `;
  return (rows[0] as { id: string } | undefined) ?? null;
}

export async function deleteRequirement(agencyId: string, id: string): Promise<boolean> {
  const rows = await sql`
    delete from public.requirements where id = ${id} and agency_id = ${agencyId} returning id
  `;
  return rows.length > 0;
}

/** Additional-agent (collaborator) user ids for a requirement. */
export async function getRequirementAgentIds(
  agencyId: string,
  requirementId: string,
): Promise<string[]> {
  const rows = await sql`
    select user_id from public.requirement_agents
    where agency_id = ${agencyId} and requirement_id = ${requirementId}
  `;
  return (rows as { user_id: string }[]).map((r) => r.user_id);
}

/** Additional-agent user ids across several requirements in one round trip —
 *  feeds the "notify every requirement's agents about a fresh match" fan-out. */
export async function getRequirementAgentIdsForMany(
  agencyId: string,
  requirementIds: string[],
): Promise<{ requirement_id: string; user_id: string }[]> {
  if (requirementIds.length === 0) return [];
  return (await sql`
    select requirement_id, user_id from public.requirement_agents
    where agency_id = ${agencyId} and requirement_id = ANY(${requirementIds}::uuid[])
  `) as { requirement_id: string; user_id: string }[];
}

/**
 * Replaces a requirement's additional-agent rows. Returns the agents that
 * were NOT already on the brief (so the caller can notify them) — mirrors
 * the original behavior (previously both were dropped on the floor on a
 * failed sync; a raw-SQL failure now throws instead of silently no-op'ing,
 * which is the correct behavior change since there's no PostgREST error
 * object to check here).
 */
export async function syncRequirementAgents(
  agencyId: string,
  requirementId: string,
  userIds: string[],
): Promise<{ added: string[] }> {
  const before = await getRequirementAgentIds(agencyId, requirementId);
  const had = new Set(before);

  await sql.transaction((tx) => [
    tx`delete from public.requirement_agents where agency_id = ${agencyId} and requirement_id = ${requirementId}`,
    tx`
      insert into public.requirement_agents (agency_id, requirement_id, user_id)
      select ${agencyId}, ${requirementId}, u from unnest(${userIds}::uuid[]) as u
    `,
  ]);

  return { added: userIds.filter((id) => !had.has(id)) };
}
