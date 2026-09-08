import { randomUUID } from "node:crypto";

import { sql } from "@/lib/db/client";

// DAO for the agency-admin surface: creating/editing agents, resetting
// passwords, role changes, member removal, and per-agency AI settings.
// Reimplements the original Supabase SECURITY DEFINER RPCs
// (admin_create_agent/admin_set_agent_password/admin_update_agent in
// supabase/migrations/0009_admin_functions.sql, 0010_editable_profiles.sql,
// 0014_agent_socials.sql) as plain TypeScript — see AGENTS.md. Those RPCs
// wrote straight into Supabase's auth.users/auth.identities; here that's just
// public.users (db/migrations/0001_init.sql's merged users table).
//
// IMPORTANT: none of these functions re-check "is the caller an agency
// admin" themselves — that's the action layer's job
// (src/lib/actions/admin.ts's requireAgencyAdmin(), using
// agencies.ts's isAgencyAdmin()). What every mutation here DOES enforce is
// narrower but just as load-bearing: that the target user is actually a
// member of the agencyId passed in, so an admin of agency A can never affect
// a user who only belongs to agency B — replicated from the original RPCs'
// `if not exists (select 1 from agency_members where agency_id = p_agency_id
// and user_id = p_user_id) then raise exception` guard, done here as a single
// scoped UPDATE (join through agency_members) rather than a separate
// check-then-write round trip.

export type MemberRole = "admin" | "agent" | "manager";

export type AgencyMemberFull = {
  id: string;
  role: MemberRole;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  linkedin_url: string | null;
  x_url: string | null;
};

/** The agency roster with full editable-profile fields, for the Admin page's
 *  team list (unlike agencies.ts's getAgencyMembers, which only returns
 *  id/name/email for picker dropdowns). */
export async function listAgencyMembersFull(agencyId: string): Promise<AgencyMemberFull[]> {
  return (await sql`
    select u.id, am.role, u.email, u.full_name, u.phone, u.avatar_url, u.linkedin_url, u.x_url
    from public.agency_members am
    join public.users u on u.id = am.user_id
    where am.agency_id = ${agencyId}
  `) as AgencyMemberFull[];
}

/** Case-insensitive email uniqueness check (users.email is stored
 *  lower-cased — see auth.ts's signUp). `excludeUserId` lets an edit form
 *  keep the user's own current email. */
export async function emailExists(email: string, excludeUserId?: string): Promise<boolean> {
  const rows = excludeUserId
    ? await sql`select 1 from public.users where email = ${email} and id <> ${excludeUserId} limit 1`
    : await sql`select 1 from public.users where email = ${email} limit 1`;
  return rows.length > 0;
}

export type CreateAgentInput = {
  email: string;
  passwordHash: string;
  fullName: string | null;
  role: MemberRole;
};

/**
 * Creates a new login (public.users row) and adds it to the agency
 * (agency_members row) — the two inserts admin_create_agent used to do
 * against auth.users/auth.identities + agency_members. Run as one
 * transaction, same reasoning as auth.ts's signUp: sql.transaction() batches
 * independent statements over a single HTTP round trip, so the id is
 * generated up front (randomUUID()) rather than relying on a later
 * statement consuming an earlier one's RETURNING output.
 */
export async function createAgent(
  agencyId: string,
  input: CreateAgentInput,
): Promise<{ id: string }> {
  const userId = randomUUID();
  await sql.transaction((tx) => [
    tx`insert into public.users (id, email, password_hash, full_name)
       values (${userId}, ${input.email}, ${input.passwordHash}, ${input.fullName})`,
    tx`insert into public.agency_members (agency_id, user_id, role)
       values (${agencyId}, ${userId}, ${input.role})`,
  ]);
  return { id: userId };
}

/** Resets a member's password — scoped to agencyId via a join through
 *  agency_members, so this silently no-ops (returns false) for a user who
 *  isn't actually a member of the caller's agency. */
export async function setAgentPassword(
  agencyId: string,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const rows = await sql`
    update public.users u
    set password_hash = ${passwordHash}
    from public.agency_members am
    where u.id = ${userId}
      and am.user_id = u.id
      and am.agency_id = ${agencyId}
    returning u.id
  `;
  return rows.length > 0;
}

export type AgentProfileInput = {
  email: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
};

/** Edits an agent's editable profile fields — same agency-membership scoping
 *  as setAgentPassword above. */
export async function updateAgentProfile(
  agencyId: string,
  userId: string,
  input: AgentProfileInput,
): Promise<boolean> {
  const rows = await sql`
    update public.users u
    set email = ${input.email},
        full_name = ${input.fullName},
        phone = ${input.phone},
        avatar_url = ${input.avatarUrl},
        linkedin_url = ${input.linkedinUrl},
        x_url = ${input.xUrl}
    from public.agency_members am
    where u.id = ${userId}
      and am.user_id = u.id
      and am.agency_id = ${agencyId}
    returning u.id
  `;
  return rows.length > 0;
}

/** Changes a member's role within the agency. */
export async function updateMemberRole(
  agencyId: string,
  userId: string,
  role: MemberRole,
): Promise<boolean> {
  const rows = await sql`
    update public.agency_members set role = ${role}
    where agency_id = ${agencyId} and user_id = ${userId}
    returning user_id
  `;
  return rows.length > 0;
}

/** Removes a member from the agency (does not delete their public.users row —
 *  they may belong to other agencies, or the row is just orphaned, matching
 *  the original RLS-gated `agency_members` delete's behavior). */
export async function removeMember(agencyId: string, userId: string): Promise<void> {
  await sql`delete from public.agency_members where agency_id = ${agencyId} and user_id = ${userId}`;
}

export type AgencySettings = {
  openrouter_api_key: string | null;
  openrouter_model: string;
  /** Null = use the built-in default brief (see src/lib/deep-dive/report.ts). */
  deep_dive_prompt: string | null;
};

export async function getAgencySettings(agencyId: string): Promise<AgencySettings | null> {
  const rows = await sql`
    select openrouter_api_key, openrouter_model, deep_dive_prompt
    from public.agency_settings
    where agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as AgencySettings | undefined) ?? null;
}

/** Upserts the agency's AI settings. `apiKey: null` leaves any existing key
 *  untouched (so the masked field never has to echo the secret back — same
 *  contract as the original action). */
export async function upsertAgencySettings(
  agencyId: string,
  model: string,
  apiKey: string | null,
  /** The Deep Dive research brief. null clears it, restoring the built-in
   *  default (DEFAULT_DEEP_DIVE_PROMPT) — that is what "Reset to default"
   *  posts. Written on every save, unlike the key. */
  deepDivePrompt: string | null = null,
): Promise<void> {
  if (apiKey) {
    await sql`
      insert into public.agency_settings
        (agency_id, openrouter_model, openrouter_api_key, deep_dive_prompt)
      values (${agencyId}, ${model}, ${apiKey}, ${deepDivePrompt})
      on conflict (agency_id) do update
        set openrouter_model = excluded.openrouter_model,
            openrouter_api_key = excluded.openrouter_api_key,
            deep_dive_prompt = excluded.deep_dive_prompt
    `;
  } else {
    await sql`
      insert into public.agency_settings (agency_id, openrouter_model, deep_dive_prompt)
      values (${agencyId}, ${model}, ${deepDivePrompt})
      on conflict (agency_id) do update
        set openrouter_model = excluded.openrouter_model,
            deep_dive_prompt = excluded.deep_dive_prompt
    `;
  }
}

export type IntelSourceRow = { source: string; created_at: string };

/**
 * Per-source stock for the Admin page's Market Intel card: every intel-listed
 * disposal's source + created_at, for the page to bucket by source and find
 * each one's most recent sync. disposals moved to Neon in an earlier batch
 * (src/lib/db/queries/disposals.ts) — reading it via the Supabase client here
 * would silently return nothing, same trap noted in
 * src/app/(app)/companies/[id]/page.tsx. The resync/delete actions themselves
 * (src/lib/actions/intel.ts) stay on Supabase until their own batch — this
 * only feeds the read-only stats display.
 */
export async function listIntelSourceRows(agencyId: string): Promise<IntelSourceRow[]> {
  return (await sql`
    select source, created_at::text as created_at
    from public.disposals
    where agency_id = ${agencyId} and listing_type = 'intel'
  `) as IntelSourceRow[];
}
