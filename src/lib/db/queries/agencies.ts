import { sql } from "@/lib/db/client";

// Agency-membership helpers shared by every tenant-scoped domain. This is the
// Neon/DAO equivalent of src/lib/supabase/agency.ts (kept alongside it — not
// deleted — until every domain that still imports the Supabase version has
// been ported; see AGENTS.md). The two functions below replicate that file's
// exact behavior against public.agency_members / public.users instead of
// PostgREST + RLS: the old `profiles` table doesn't exist anymore (merged
// into `users` in db/migrations/0001_init.sql), so agent names/emails resolve
// straight off `users`.

/**
 * The caller's agency id (their first membership, oldest first). Every other
 * DAO function in this domain takes `agencyId` as an explicit parameter
 * rather than re-resolving it — callers must fetch this once (after
 * `auth()`) and thread it through, never trust a client-supplied agencyId.
 * Returns null if the user has no agency.
 */
export async function currentAgencyId(userId: string): Promise<string | null> {
  const rows = await sql`
    select agency_id
    from public.agency_members
    where user_id = ${userId}
    order by created_at asc
    limit 1
  `;
  return (rows[0] as { agency_id: string } | undefined)?.agency_id ?? null;
}

/**
 * True if the user administers ANY agency (not necessarily a specific one).
 * Replicates the dropped `is_any_agency_admin()` RLS helper (see
 * db/migrations/0023_contact_roles.sql's header note) — used to gate writes
 * to the system-wide lookup tables (company_types, contact_roles), which are
 * shared across every agency rather than scoped to one.
 */
export async function isAnyAgencyAdmin(userId: string): Promise<boolean> {
  const rows = await sql`
    select 1 from public.agency_members
    where user_id = ${userId} and role = 'admin'
    limit 1
  `;
  return rows.length > 0;
}

/**
 * True if the user is specifically an admin of THIS agency — not just any
 * agency they belong to. This is the authorization boundary for every
 * agency-admin write action (create/edit/deactivate an agent, agency
 * settings, …) now that there's no RLS/SECURITY DEFINER backstop in the
 * database (see AGENTS.md). Replicates supabase/migrations/0001_init.sql's
 * dropped `is_agency_admin(p_agency_id)` SQL helper exactly: `agency_members`
 * has a row for (this user, this agency) with role = 'admin' — 'manager' does
 * NOT count, matching the original's strict `role = 'admin'` check.
 */
export async function isAgencyAdmin(userId: string, agencyId: string): Promise<boolean> {
  const rows = await sql`
    select 1 from public.agency_members
    where user_id = ${userId} and agency_id = ${agencyId} and role = 'admin'
    limit 1
  `;
  return rows.length > 0;
}

/** The caller's role within a specific agency, or null if not a member —
 *  the "elevated" (admin/manager) gate for /reports needs the exact role,
 *  not just a boolean, so it can't reuse isAgencyAdmin (which only checks
 *  for 'admin'). Scoped to the caller's OWN membership row — an unscoped
 *  lookup could surface a co-member's role instead of the caller's own. */
export async function getMemberRole(
  agencyId: string,
  userId: string,
): Promise<MemberRoleValue | null> {
  const rows = await sql`
    select role from public.agency_members
    where user_id = ${userId} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as { role: MemberRoleValue } | undefined)?.role ?? null;
}

type MemberRoleValue = "admin" | "agent" | "manager";

/** Just the agency's display name — feeds the dashboard header without
 *  pulling a full agency row. */
export async function getAgencyName(agencyId: string): Promise<string | null> {
  const rows = await sql`
    select name from public.agencies where id = ${agencyId} limit 1
  `;
  return (rows[0] as { name: string } | undefined)?.name ?? null;
}

/**
 * Plain public.users lookup by id, unscoped by agency — used by the cron job
 * (src/app/api/cron/due/route.ts), which is a system-wide job with no single
 * caller agency to scope by (it resolves each notification's agency from the
 * reminder/task row itself, not from this lookup). Returns email + display
 * name for the "due items" email digest.
 */
export async function getUsersByIds(
  userIds: string[],
): Promise<{ id: string; email: string; full_name: string | null }[]> {
  if (userIds.length === 0) return [];
  return (await sql`
    select id, email, full_name from public.users where id = ANY(${userIds}::uuid[])
  `) as { id: string; email: string; full_name: string | null }[];
}

export type AgentOption = { id: string; name: string; email: string | null };

/**
 * The agency roster as pickable agents (id + display name), sorted by name.
 * Resolves member user ids through `public.users` (the merged
 * profiles+auth.users table — see db/migrations/0001_init.sql). Returns []
 * if the agency has no members.
 */
export async function getAgencyMembers(agencyId: string): Promise<AgentOption[]> {
  const rows = (await sql`
    select u.id, u.full_name, u.email
    from public.agency_members am
    join public.users u on u.id = am.user_id
    where am.agency_id = ${agencyId}
  `) as { id: string; full_name: string | null; email: string }[];

  return rows
    .map((u) => ({
      id: u.id,
      name: u.full_name ?? u.email ?? "Unknown agent",
      email: u.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
