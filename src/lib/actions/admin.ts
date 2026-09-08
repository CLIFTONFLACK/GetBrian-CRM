"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import {
  createAgent as createAgentRow,
  emailExists,
  removeMember,
  setAgentPassword as setAgentPasswordRow,
  updateAgentProfile,
  updateMemberRole,
  upsertAgencySettings,
  type MemberRole,
} from "@/lib/db/queries/admin";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const asRole = (v: string): MemberRole =>
  v === "admin" ? "admin" : v === "manager" ? "manager" : "agent";

/** Postgres SQLSTATE for a unique-constraint violation (users.email) — same
 *  pattern as auth.ts's signUp. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

type AdminContext = { userId: string; agencyId: string };

/**
 * Resolves the caller's session + agency + "admin of that specific agency"
 * status in one place. Every write action below calls this FIRST and rejects
 * outright on failure — this is the real security boundary now that there's
 * no RLS/SECURITY DEFINER backstop in the database (see AGENTS.md), not just
 * the admin-only UI. Replicates the original RPCs' `is_agency_admin
 * (p_agency_id)` self-gate exactly (agencies.ts's isAgencyAdmin).
 */
async function requireAgencyAdmin(): Promise<AdminContext | { error: string }> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const admin = await isAgencyAdmin(session.user.id, agencyId);
  if (!admin) return { error: "Only an agency admin can do that." };

  return { userId: session.user.id, agencyId };
}

/** Create a new agent in the caller's agency (admin only — enforced above). */
export async function createAgent(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAgencyAdmin();
  if ("error" in ctx) return { error: ctx.error };

  const email = str(formData, "email").toLowerCase();
  const password = str(formData, "password");
  if (!email) return { error: "Email is required." };
  if (!password) return { error: "Password is required." };

  if (await emailExists(email)) {
    return { error: "A user with that email already exists." };
  }

  const passwordHash = await hashPassword(password);
  try {
    await createAgentRow(ctx.agencyId, {
      email,
      passwordHash,
      fullName: str(formData, "full_name") || null,
      role: asRole(str(formData, "role")),
    });
  } catch (error) {
    // Race: someone else took this email between the check above and here.
    if (isUniqueViolation(error)) {
      return { error: "A user with that email already exists." };
    }
    throw error;
  }

  revalidatePath("/admin");
  return { message: `Added ${email}.` };
}

/** Edit an agent's details: name, email, phone, photo, socials (admin only). */
export async function updateAgent(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAgencyAdmin();
  if ("error" in ctx) return { error: ctx.error };

  const userId = str(formData, "user_id");
  const email = str(formData, "email").toLowerCase();
  if (!userId) return { error: "Missing user." };
  if (!email) return { error: "Email is required." };

  if (await emailExists(email, userId)) {
    return { error: "A user with that email already exists." };
  }

  const ok = await updateAgentProfile(ctx.agencyId, userId, {
    email,
    fullName: str(formData, "full_name") || null,
    phone: str(formData, "phone") || null,
    avatarUrl: str(formData, "avatar_url") || null,
    linkedinUrl: str(formData, "linkedin_url") || null,
    xUrl: str(formData, "x_url") || null,
  });
  if (!ok) return { error: "That user is not a member of this agency." };

  revalidatePath("/admin");
  return { message: "Saved." };
}

/** Reset an agent's password (admin only — enforced above). */
export async function setAgentPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAgencyAdmin();
  if ("error" in ctx) return { error: ctx.error };

  const userId = str(formData, "user_id");
  const password = str(formData, "password");
  if (!userId) return { error: "Missing user." };
  if (!password) return { error: "Password is required." };

  const passwordHash = await hashPassword(password);
  const ok = await setAgentPasswordRow(ctx.agencyId, userId, passwordHash);
  if (!ok) return { error: "That user is not a member of this agency." };

  revalidatePath("/admin");
  return { message: "Password updated." };
}

/** Change a member's role (admin only — enforced above; RLS used to restrict
 *  this via a members_update policy). */
export async function updateAgentRole(formData: FormData): Promise<void> {
  const ctx = await requireAgencyAdmin();
  if ("error" in ctx) return;

  const userId = str(formData, "user_id");
  if (!userId) return;

  await updateMemberRole(ctx.agencyId, userId, asRole(str(formData, "role")));
  revalidatePath("/admin");
}

/**
 * Save the agency's AI settings (OpenRouter key, model and Deep Dive brief).
 *
 * A blank key keeps the existing one, so the masked field never has to echo the
 * secret back. A blank *prompt*, by contrast, is meaningful: it clears the
 * override and restores the built-in default, which is what the "Reset to
 * default" button posts.
 */
export async function saveAgencySettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAgencyAdmin();
  if ("error" in ctx) return { error: ctx.error };

  const model = str(formData, "openrouter_model") || "perplexity/sonar";
  const key = str(formData, "openrouter_api_key") || null;
  const prompt = str(formData, "deep_dive_prompt") || null;

  await upsertAgencySettings(ctx.agencyId, model, key, prompt);

  revalidatePath("/admin");
  return { message: "AI settings saved." };
}

/** Remove a member from the agency (admin only — enforced above; RLS used to
 *  restrict this via a members_delete policy). */
export async function removeAgent(formData: FormData): Promise<void> {
  const ctx = await requireAgencyAdmin();
  if ("error" in ctx) return;

  const userId = str(formData, "user_id");
  if (!userId) return;

  await removeMember(ctx.agencyId, userId);
  revalidatePath("/admin");
}
