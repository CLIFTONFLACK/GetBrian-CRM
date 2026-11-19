import { sql } from "@/lib/db/client";
import type { MatchRequirement } from "@/lib/db/queries/requirements";

// Active requirements of one company or one contact, shaped for the scorer.
// Lives apart from requirements.ts so that file stays untouched. The column
// list is the same as its MATCH_COLUMNS: numeric columns are cast to float8 so
// the driver returns numbers, not strings, which would break the band checks.

const MATCH_COLUMNS = `
  id, title, lead_agent_id, company_id, target_towns, target_regions, target_counties,
  target_postcode_districts, target_neighbourhoods, target_london_zones,
  min_sqft::float8 as min_sqft, max_sqft::float8 as max_sqft,
  min_covers, max_covers, use_classes::text[] as use_classes, tenure_prefs::text[] as tenure_prefs,
  max_rent::float8 as max_rent, max_premium::float8 as max_premium,
  max_guide_price::float8 as max_guide_price
`;

export type EntityRequirements = {
  /** At most `limit`, most recently updated first. */
  rows: MatchRequirement[];
  /** All active requirements of the record, before the limit. */
  total: number;
};

export async function listActiveRequirementsForEntity(
  agencyId: string,
  entityType: "company" | "contact",
  entityId: string,
  limit: number,
): Promise<EntityRequirements> {
  const rows =
    entityType === "company"
      ? await sql`
          select ${sql.unsafe(MATCH_COLUMNS)}, count(*) over ()::int as total_count
          from public.requirements
          where agency_id = ${agencyId} and company_id = ${entityId} and status = 'active'
          order by date_updated desc, id
          limit ${limit}
        `
      : await sql`
          select ${sql.unsafe(MATCH_COLUMNS)}, count(*) over ()::int as total_count
          from public.requirements
          where agency_id = ${agencyId} and contact_id = ${entityId} and status = 'active'
          order by date_updated desc, id
          limit ${limit}
        `;
  const total = rows.length > 0 ? Number((rows[0] as { total_count: number }).total_count) : 0;
  return {
    rows: rows.map((r) => {
      const copy = { ...(r as Record<string, unknown>) };
      delete copy.total_count;
      return copy as unknown as MatchRequirement;
    }),
    total,
  };
}
