import { sql } from "@/lib/db/client";
import { listCompanyTypes, listContactRoles } from "@/lib/db/queries/lookups";
import {
  chunk,
  countBySlug,
  groupBySlug,
  inferCompanyType,
  inferContactRole,
  type PlannedChange,
} from "@/lib/type-inference";

// Automatic allocation of company TYPE and contact ROLE (Admin -> "Auto-allocate
// types"). The rules live in src/lib/type-inference.ts. Only rows that are now
// 'other' (or null) are looked at, and only those are written.

const CHUNK_SIZE = 500;
const EXAMPLES_PER_SLUG = 5;

export type CompanyExample = { name: string; reason: string };

export type EntityPlan = {
  /** Rows that were looked at (type or role is 'other' or null). */
  total: number;
  /** Server-side only. Never send this list to the browser. */
  changes: PlannedChange[];
  bySlug: Record<string, number>;
  unchanged: number;
};

export type TypeAllocationPlan = {
  companies: EntityPlan & { examples: Record<string, CompanyExample[]> };
  contacts: EntityPlan;
};

/** What the browser may see: counts and company-name examples. No ids, no contact data. */
export type TypeAllocationPreview = {
  companies: {
    total: number;
    unchanged: number;
    bySlug: Record<string, number>;
    examples: Record<string, CompanyExample[]>;
  };
  contacts: { total: number; unchanged: number; bySlug: Record<string, number> };
};

export function previewOf(plan: TypeAllocationPlan): TypeAllocationPreview {
  return {
    companies: {
      total: plan.companies.total,
      unchanged: plan.companies.unchanged,
      bySlug: plan.companies.bySlug,
      examples: plan.companies.examples,
    },
    contacts: {
      total: plan.contacts.total,
      unchanged: plan.contacts.unchanged,
      bySlug: plan.contacts.bySlug,
    },
  };
}

type CompanyRow = { id: string; name: string; website: string | null; date_updated: string | null };
type ContactRow = {
  id: string;
  email: string | null;
  company_id: string | null;
  company_type: string | null;
  company_name: string | null;
  date_updated: string | null;
};

/**
 * Works out what would change. Reads only; writes nothing.
 * Companies have no e-mail column, so a company is judged by name and web address.
 * A contact is judged by its e-mail DOMAIN, its company name and its company type.
 * If the company is itself being given a type in this plan, the contact uses that
 * planned type, so the preview and the apply step agree.
 */
export async function planTypeAllocation(agencyId: string): Promise<TypeAllocationPlan> {
  const [typeRows, roleRows, companyRows, contactRows] = await Promise.all([
    listCompanyTypes(),
    listContactRoles(),
    sql`
      select id, name, website, date_updated::text as date_updated
      from public.companies
      where agency_id = ${agencyId} and (type = 'other' or type is null)
      order by name asc
    ` as unknown as Promise<CompanyRow[]>,
    sql`
      select c.id, c.email, c.company_id,
             co.type as company_type, co.name as company_name,
             c.date_updated::text as date_updated
      from public.contacts c
      left join public.companies co
        on co.id = c.company_id and co.agency_id = c.agency_id
      where c.agency_id = ${agencyId} and (c.role = 'other' or c.role is null)
    ` as unknown as Promise<ContactRow[]>,
  ]);

  const typeSlugs = typeRows.map((t) => t.slug);
  const roleSlugs = roleRows.map((r) => r.slug);

  const companyChanges: PlannedChange[] = [];
  const examples: Record<string, CompanyExample[]> = {};
  const plannedType = new Map<string, string>();
  for (const c of companyRows) {
    const hit = inferCompanyType({ name: c.name, website: c.website, email: null }, typeSlugs);
    if (!hit) continue;
    companyChanges.push({ id: c.id, slug: hit.slug, dateUpdated: c.date_updated });
    plannedType.set(c.id, hit.slug);
    const list = (examples[hit.slug] ??= []);
    if (list.length < EXAMPLES_PER_SLUG) list.push({ name: c.name, reason: hit.reason });
  }

  const contactChanges: PlannedChange[] = [];
  for (const c of contactRows) {
    const type =
      c.company_type && c.company_type !== "other"
        ? c.company_type
        : ((c.company_id ? plannedType.get(c.company_id) : undefined) ?? null);
    const hit = inferContactRole(
      { email: c.email, companyType: type, companyName: c.company_name },
      roleSlugs,
    );
    if (hit) contactChanges.push({ id: c.id, slug: hit.slug, dateUpdated: c.date_updated });
  }

  return {
    companies: {
      total: companyRows.length,
      changes: companyChanges,
      bySlug: countBySlug(companyChanges),
      unchanged: companyRows.length - companyChanges.length,
      examples,
    },
    contacts: {
      total: contactRows.length,
      changes: contactChanges,
      bySlug: countBySlug(contactChanges),
      unchanged: contactRows.length - contactChanges.length,
    },
  };
}

/**
 * Writes the plan. The plan is recomputed here, on the server: a list from the
 * browser is never used. Each write checks again that the row is still 'other'
 * or null, so a type or role set by a person is never overwritten.
 *
 * The 0044 trigger moves date_updated when type or role changes. So a second
 * statement, in the same transaction, puts the ORIGINAL date_updated back. It
 * changes only date_updated, which the trigger accepts as supplied (case 2 in
 * db/migrations/0044_date_updated_rating.sql). updated_at does move, because
 * the type itself changed. That is the normal effect of any edit.
 *
 * This cannot be run without a database, so it is not covered by a unit test.
 */
export async function applyTypeAllocation(
  agencyId: string,
): Promise<{ companies: number; contacts: number }> {
  const plan = await planTypeAllocation(agencyId);
  let companies = 0;
  let contacts = 0;

  for (const part of chunk(plan.companies.changes, CHUNK_SIZE)) {
    const groups = [...groupBySlug(part)];
    const results = await sql.transaction((tx) =>
      groups.flatMap(([slug, rows]) => {
        const ids = rows.map((r) => r.id);
        const dated = rows.filter((r) => r.dateUpdated !== null);
        return [
          tx`
            update public.companies set type = ${slug}
            where id = any(${ids}::uuid[]) and agency_id = ${agencyId}
              and (type = 'other' or type is null)
            returning id
          `,
          tx`
            update public.companies c set date_updated = v.d
            from unnest(${dated.map((r) => r.id)}::uuid[], ${dated.map((r) => r.dateUpdated)}::timestamptz[]) as v(id, d)
            where c.id = v.id and c.agency_id = ${agencyId} and c.type = ${slug}
          `,
        ];
      }),
    );
    // Even positions are the "set type" statements; odd ones re-assert the date.
    for (let i = 0; i < groups.length; i++) companies += (results[2 * i] as unknown[]).length;
  }

  for (const part of chunk(plan.contacts.changes, CHUNK_SIZE)) {
    const groups = [...groupBySlug(part)];
    const results = await sql.transaction((tx) =>
      groups.flatMap(([slug, rows]) => {
        const ids = rows.map((r) => r.id);
        const dated = rows.filter((r) => r.dateUpdated !== null);
        return [
          tx`
            update public.contacts set role = ${slug}
            where id = any(${ids}::uuid[]) and agency_id = ${agencyId}
              and (role = 'other' or role is null)
            returning id
          `,
          tx`
            update public.contacts c set date_updated = v.d
            from unnest(${dated.map((r) => r.id)}::uuid[], ${dated.map((r) => r.dateUpdated)}::timestamptz[]) as v(id, d)
            where c.id = v.id and c.agency_id = ${agencyId} and c.role = ${slug}
          `,
        ];
      }),
    );
    for (let i = 0; i < groups.length; i++) contacts += (results[2 * i] as unknown[]).length;
  }

  return { companies, contacts };
}
