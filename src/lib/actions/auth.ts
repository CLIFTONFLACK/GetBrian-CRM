"use server";

import { randomUUID } from "node:crypto";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { signIn as authSignIn, signOut as authSignOut } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { isDbConfigured, sql } from "@/lib/db/client";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { AuthState } from "@/lib/actions/types";

const NOT_CONFIGURED =
  "The database isn't configured yet. Set DATABASE_URL and AUTH_SECRET.";
const TOO_MANY_ATTEMPTS = "Too many attempts — try again shortly.";

/** Postgres SQLSTATE for a unique-constraint violation (users.email). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * A friendly default agency name for a brand-new sign-up. The sign-up form
 * only collects email + password (see src/components/auth-form.tsx) — there
 * is no agency-name field yet — so this is a placeholder derived from the
 * email's local part. Worth adding a real "Agency name" field to the form
 * later; flagged in the phase report.
 */
function defaultAgencyName(email: string): string {
  const local = email.split("@")[0] ?? "";
  const label = local.replace(/[._-]+/g, " ").trim();
  const titled = (label || "New").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${titled}'s Agency`;
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (!isDbConfigured) return { error: NOT_CONFIGURED };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  // Brute-force protection — checked before authorize(), keyed on caller IP
  // (never anything client-supplied) so it can't be bypassed by trying
  // different emails from the same machine. Generic error either way: never
  // reveal whether the limit hit is distinct from a bad password.
  const ip = await getClientIp();
  const { success } = await checkRateLimit("login", ip);
  if (!success) return { error: TOO_MANY_ATTEMPTS };

  try {
    // redirect: false — signIn() would otherwise attempt its own redirect
    // via a Next.js control-flow throw; doing the redirect ourselves below
    // keeps this function's error handling straightforward.
    await authSignIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (!isDbConfigured) return { error: NOT_CONFIGURED };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const existing = await sql`
    select 1 from public.users where email = ${email} limit 1
  `;
  if (existing.length > 0) {
    return { error: "An account with that email already exists." };
  }

  const passwordHash = await hashPassword(password);
  // Generated up front (rather than relying on the tables' own
  // gen_random_uuid() defaults + RETURNING) because sql.transaction() runs
  // its queries as one non-interactive batch over a single HTTP round trip
  // — later statements in the batch can't consume an earlier statement's
  // RETURNING output, so the same id is passed as a literal into every
  // insert that needs it instead.
  const userId = randomUUID();
  const agencyId = randomUUID();

  // No handle_new_user()/seed_agency() DB trigger anymore (dropped in the
  // migration adaptation — see db/migrations/0001_init.sql's header note),
  // so sign-up does the trigger's job explicitly here: create the user,
  // create a new agency, and add the user as its admin. Demo seed data is
  // deliberately NOT replicated.
  try {
    await sql.transaction((tx) => [
      tx`insert into public.users (id, email, password_hash)
         values (${userId}, ${email}, ${passwordHash})`,
      tx`insert into public.agencies (id, name)
         values (${agencyId}, ${defaultAgencyName(email)})`,
      tx`insert into public.agency_members (agency_id, user_id, role)
         values (${agencyId}, ${userId}, 'admin')`,
    ]);
  } catch (error) {
    // Race: someone else took this email between the check above and here.
    if (isUniqueViolation(error)) {
      return { error: "An account with that email already exists." };
    }
    throw error;
  }

  try {
    await authSignIn("credentials", { email, password, redirect: false });
  } catch {
    // Account exists and is usable even if establishing the session here
    // failed for some reason — send them to sign in by hand rather than
    // surfacing a scary error after a successful sign-up.
    redirect("/login");
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  if (isDbConfigured) {
    await authSignOut({ redirect: false });
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
