import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";

export type AdminContext = { userId: string; agencyId: string };

/**
 * Resolves the caller's session + agency + "admin of that specific agency"
 * status in one place. Any write action that only an admin may perform calls
 * this FIRST and rejects outright on failure — this is the real security
 * boundary now that there's no RLS/SECURITY DEFINER backstop in the database
 * (see AGENTS.md), not just the admin-only UI. Same gate as
 * src/lib/actions/admin.ts's private requireAgencyAdmin, shared here (a plain
 * module, so non-async exports are allowed) for actions living in other files.
 */
export async function requireAgencyAdmin(): Promise<AdminContext | { error: string }> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const admin = await isAgencyAdmin(session.user.id, agencyId);
  if (!admin) return { error: "Only an agency admin can do that." };

  return { userId: session.user.id, agencyId };
}
