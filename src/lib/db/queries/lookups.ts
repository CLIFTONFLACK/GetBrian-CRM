import { sql } from "@/lib/db/client";

// DAO for the two system-wide editable lookup lists — company_types and
// contact_roles (db/migrations/0026_company_types.sql, 0023_contact_roles.sql).
// Both tables are shared across every agency (not agency-scoped — see those
// migrations' header notes: "effectively a single-tenant CDG CRM" for these
// two lists specifically), so unlike every other function in src/lib/db/queries
// these deliberately do NOT take an agencyId. Writes must still be permission
// -gated by the caller (src/lib/actions/company-types.ts /
// src/lib/actions/contact-roles.ts) via agencies.ts's isAnyAgencyAdmin().

export type CompanyType = {
  id: string;
  slug: string;
  label: string;
  sort_order: number;
  is_system: boolean;
};

export type ContactRole = {
  id: string;
  slug: string;
  label: string;
  sort_order: number;
  is_system: boolean;
};

export async function listCompanyTypes(): Promise<CompanyType[]> {
  return (await sql`
    select id, slug, label, sort_order, is_system
    from public.company_types
    order by sort_order asc
  `) as CompanyType[];
}

export async function listContactRoles(): Promise<ContactRole[]> {
  return (await sql`
    select id, slug, label, sort_order, is_system
    from public.contact_roles
    order by sort_order asc
  `) as ContactRole[];
}

/** True if `slug` is a real contact-role slug — used to coerce a submitted
 *  contact role to a valid value (falls back to "other" otherwise). */
export async function contactRoleSlugExists(slug: string): Promise<boolean> {
  const rows = await sql`
    select 1 from public.contact_roles where slug = ${slug} limit 1
  `;
  return rows.length > 0;
}

/** Existing slugs + the highest sort_order, for computing a new row's slug
 *  (de-duped) and place in the list. */
export async function companyTypeSlugsAndMaxSort(): Promise<{
  slugs: Set<string>;
  maxSort: number;
}> {
  const rows = (await sql`select slug, sort_order from public.company_types`) as {
    slug: string;
    sort_order: number;
  }[];
  return {
    slugs: new Set(rows.map((r) => r.slug)),
    maxSort: rows.reduce((m, r) => Math.max(m, r.sort_order), 0),
  };
}

export async function contactRoleSlugsAndMaxSort(): Promise<{
  slugs: Set<string>;
  maxSort: number;
}> {
  const rows = (await sql`select slug, sort_order from public.contact_roles`) as {
    slug: string;
    sort_order: number;
  }[];
  return {
    slugs: new Set(rows.map((r) => r.slug)),
    maxSort: rows.reduce((m, r) => Math.max(m, r.sort_order), 0),
  };
}

export async function insertCompanyType(
  slug: string,
  label: string,
  sortOrder: number,
): Promise<void> {
  await sql`
    insert into public.company_types (slug, label, sort_order)
    values (${slug}, ${label}, ${sortOrder})
  `;
}

export async function insertContactRole(
  slug: string,
  label: string,
  sortOrder: number,
): Promise<void> {
  await sql`
    insert into public.contact_roles (slug, label, sort_order)
    values (${slug}, ${label}, ${sortOrder})
  `;
}

export async function getCompanyTypeById(
  id: string,
): Promise<{ slug: string; label: string; is_system: boolean } | null> {
  const rows = await sql`
    select slug, label, is_system from public.company_types where id = ${id} limit 1
  `;
  return (rows[0] as { slug: string; label: string; is_system: boolean } | undefined) ?? null;
}

export async function getContactRoleById(
  id: string,
): Promise<{ slug: string; label: string; is_system: boolean } | null> {
  const rows = await sql`
    select slug, label, is_system from public.contact_roles where id = ${id} limit 1
  `;
  return (rows[0] as { slug: string; label: string; is_system: boolean } | undefined) ?? null;
}

export async function renameCompanyType(id: string, label: string): Promise<void> {
  await sql`update public.company_types set label = ${label} where id = ${id}`;
}

export async function renameContactRole(id: string, label: string): Promise<void> {
  await sql`update public.contact_roles set label = ${label} where id = ${id}`;
}

/** Cross-agency usage count via the SQL helpers kept for this purpose (see
 *  db/migrations/0024_contact_role_usage.sql / 0026_company_types.sql). */
export async function companyTypeInUseCount(slug: string): Promise<number> {
  const rows = await sql`select company_type_in_use(${slug}) as count`;
  return (rows[0] as { count: number }).count;
}

export async function contactRoleInUseCount(slug: string): Promise<number> {
  const rows = await sql`select contact_role_in_use(${slug}) as count`;
  return (rows[0] as { count: number }).count;
}

export async function deleteCompanyTypeById(id: string): Promise<void> {
  await sql`delete from public.company_types where id = ${id}`;
}

export async function deleteContactRoleById(id: string): Promise<void> {
  await sql`delete from public.contact_roles where id = ${id}`;
}
