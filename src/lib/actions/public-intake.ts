"use server";

import { redirect } from "next/navigation";
import { Resend } from "resend";

import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { createIntakeSubmission, findUserByEmail } from "@/lib/db/queries/intake";
import { createNotifications } from "@/lib/db/queries/messages";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { FormState } from "@/lib/actions/types";

// ─────────────────────────────────────────────────────────────────────────
// SECURITY NOTE — read this before touching this file.
//
// This action is called from `/submit-requirement`
// (src/app/(public)/submit-requirement/page.tsx), a genuinely unauthenticated
// public form: there is no session, so there is no `auth()`-derived agencyId
// to scope anything to. Every other Server Action in this codebase resolves
// its agencyId from the SIGNED-IN caller (auth() → currentAgencyId(userId));
// that path does not exist here.
//
// Instead, the target agency is resolved from a value the CLIENT NEVER
// SUPPLIES: `INTAKE_DEFAULT_AGENT_EMAIL`, a server-only env var (with a
// hardcoded fallback), looked up against `public.users` and then
// `agency_members` — exactly the two-step lookup below. The public form's
// FormData carries none of {agencyId, userId, table name}; it can only ever
// supply the intake_submissions column *values* (company name, contact
// details, requirement criteria).
//
// The write itself goes through `createIntakeSubmission` (src/lib/db/queries
// /intake.ts) — the one DAO function in the whole codebase built specifically
// for unauthenticated input. Its SQL statement names exactly one table
// (`public.intake_submissions`), always writes status='pending', and takes no
// parameter that could redirect the write to a different table. That
// function is what replaces the old Supabase "service-role client bypassing
// RLS" pattern (see AGENTS.md): where RLS used to be the only thing standing
// between an anonymous caller and the rest of the schema, here it's this
// action + that one narrow DAO function, full stop. Do not widen either to
// accept a client-supplied table, column list, or agencyId.
// ─────────────────────────────────────────────────────────────────────────

// The CDG agent who owns every publicly-submitted requirement, plus the
// Brian-side admin who is cc'd on the notification. Both resolved by email at
// submit time (no hardcoded UUIDs); overridable per-environment, with the
// original values as fallbacks so nothing breaks when the vars are unset.
const defaultAgentEmail = () =>
  (process.env.INTAKE_DEFAULT_AGENT_EMAIL || "morris@cdgleisure.com").trim().toLowerCase();
const adminEmail = () =>
  (process.env.INTAKE_ADMIN_EMAIL || "cliftonflack@gmail.com").trim().toLowerCase();

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v.replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const UNAVAILABLE =
  "Submissions are temporarily unavailable — please email your requirement instead.";

/**
 * Public requirement intake — no session. Writes a *pending* row into
 * `intake_submissions` (never a live company / contact / requirement:
 * anonymous input is triaged at /intake first), then pings the default agent
 * and the admin through the notification bell and, when Resend is
 * configured, by email. Notification/email failures are non-fatal — the
 * submission is already safely recorded.
 */
export async function submitPublicRequirement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Honeypot: real users never fill the invisible "website" field. Pretend
  // success so bots don't learn they were caught.
  if (str(formData, "website")) redirect("/submit-requirement/thank-you");

  // Bots submit instantly; humans take longer than 3 seconds.
  const renderedAt = Number(str(formData, "rendered_at"));
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < 3_000) {
    return { error: "Please take a moment to review your details, then resubmit." };
  }

  // Spam protection — additive to the honeypot/timing checks above, not a
  // replacement. Keyed on caller IP (never anything client-supplied) and
  // checked before any DB work below.
  const ip = await getClientIp();
  const { success } = await checkRateLimit("intake", ip);
  if (!success) {
    return { error: "Too many attempts — try again shortly." };
  }

  const companyName = str(formData, "company_name");
  const firstName = str(formData, "first_name");
  const lastName = str(formData, "last_name");
  const email = str(formData, "email");
  const phone = str(formData, "phone");
  if (!companyName) return { error: "Your company / brand name is required." };
  if (!firstName) return { error: "Your name is required." };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "A valid email address is required." };
  }

  const propertyType = str(formData, "property_type");
  // The locations combobox posts one comma-joined value; `target_towns` is the
  // legacy free-text field name, still accepted.
  const targetLocations =
    str(formData, "target_locations") || str(formData, "target_towns");
  const notes = str(formData, "notes");

  if (!isDbConfigured) return { error: UNAVAILABLE };

  // Resolve the default agent → their user id + agency (the target tenant).
  // See this file's header note: this is the ONLY thing that decides which
  // agency the submission lands in, and it never comes from the form.
  const agentProfile = await findUserByEmail(defaultAgentEmail());
  if (!agentProfile) return { error: UNAVAILABLE };

  const agencyId = await currentAgencyId(agentProfile.id);
  if (!agencyId) return { error: UNAVAILABLE };
  const agentId = agentProfile.id;

  try {
    await createIntakeSubmission(agencyId, {
      companyName,
      firstName,
      lastName: lastName || null,
      email,
      phone: phone || null,
      propertyType: propertyType || null,
      targetLocations: targetLocations || null,
      minSqft: num(formData, "min_sqft"),
      maxSqft: num(formData, "max_sqft"),
      minCovers: num(formData, "min_covers"),
      maxCovers: num(formData, "max_covers"),
      maxRent: num(formData, "max_rent"),
      maxPremium: num(formData, "max_premium"),
      notes: notes || null,
    });
  } catch {
    return { error: "Something went wrong — please try again." };
  }

  const who = [firstName, lastName].filter(Boolean).join(" ");
  const summary = [
    `${companyName} — ${propertyType || "property"} requirement`,
    targetLocations ? `Locations: ${targetLocations}` : null,
    `From ${who} (${email}${phone ? `, ${phone}` : ""})`,
  ]
    .filter(Boolean)
    .join("\n");

  // ── Notify: bell for the agent + admin, then email (both best-effort) ──────
  // Recipients + agencyId are entirely server-resolved above — nothing here
  // is influenced by the form beyond the free-text summary that lands in the
  // notification body.
  const recipients = [{ id: agentId, email: agentProfile.email }];
  const adminProfile = await findUserByEmail(adminEmail());
  if (adminProfile && adminProfile.id !== agentId) {
    recipients.push({ id: adminProfile.id, email: adminProfile.email });
  }

  try {
    await createNotifications(agencyId, recipients.map((r) => r.id), {
      title: "New property requirement submitted",
      body: `${companyName} — from ${who} (${email}). Review it in the intake queue.`,
      link: "/intake",
    });
  } catch {
    // Non-fatal — the submission itself already landed.
  }

  await notifyByEmail(
    recipients.map((r) => r.email).filter((e): e is string => Boolean(e)),
    `New requirement submitted — ${companyName}`,
    [
      "A new property requirement was submitted through the public form.",
      "",
      summary,
      notes ? `\nNotes:\n${notes}` : null,
      "",
      "Review and approve it in the CRM under Intake.",
    ]
      .filter((l): l is string => l != null)
      .join("\n"),
  );

  redirect("/submit-requirement/thank-you");
}

/**
 * Best-effort plain-text notification email (mirrors deal-send.ts's Resend
 * usage). Silently does nothing when RESEND_API_KEY / EMAIL_FROM are unset, and
 * never throws — the in-app notification is the source of truth.
 */
async function notifyByEmail(to: string[], subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from || to.length === 0) return;
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to, subject, text });
  } catch {
    // Non-fatal — the submission and the bell notification already landed.
  }
}
