"use server";

import { redirect } from "next/navigation";
import { Resend } from "resend";

import { createServiceClient } from "@/lib/supabase/service";
import type { FormState } from "@/lib/actions/types";

// The CDG agent who owns every publicly-submitted requirement, plus the
// Brian-side admin who is cc'd on the notification. Both resolved by email at
// submit time (no hardcoded UUIDs); overridable per-environment, with the
// original values as fallbacks so nothing breaks when the vars are unset.
const defaultAgentEmail = () =>
  process.env.INTAKE_DEFAULT_AGENT_EMAIL || "morris@cdgleisure.com";
const adminEmail = () => process.env.INTAKE_ADMIN_EMAIL || "cliftonflack@gmail.com";

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
 * `intake_submissions` via the service-role client (never a live company /
 * contact / requirement: anonymous input is triaged at /intake first), then
 * pings the default agent and the admin through the notification bell and, when
 * Resend is configured, by email. Notification/email failures are non-fatal —
 * the submission is already safely recorded.
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

  const supabase = createServiceClient();
  if (!supabase) return { error: UNAVAILABLE };

  // Resolve the default agent → their user id + agency (the target tenant).
  const { data: agentProfile } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", defaultAgentEmail())
    .maybeSingle();
  if (!agentProfile) return { error: UNAVAILABLE };

  const { data: membership } = await supabase
    .from("agency_members")
    .select("agency_id")
    .eq("user_id", agentProfile.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return { error: UNAVAILABLE };

  const agencyId = membership.agency_id;
  const agentId = agentProfile.id;

  const { data: submission, error: insertError } = await supabase
    .from("intake_submissions")
    .insert({
      agency_id: agencyId,
      status: "pending",
      company_name: companyName,
      first_name: firstName,
      last_name: lastName || null,
      email,
      phone: phone || null,
      property_type: propertyType || null,
      target_locations: targetLocations || null,
      min_sqft: num(formData, "min_sqft"),
      max_sqft: num(formData, "max_sqft"),
      min_covers: num(formData, "min_covers"),
      max_covers: num(formData, "max_covers"),
      max_rent: num(formData, "max_rent"),
      max_premium: num(formData, "max_premium"),
      notes: notes || null,
    })
    .select("id")
    .single();
  if (insertError || !submission) {
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
  const recipients = [{ id: agentId, email: agentProfile.email }];
  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("email", adminEmail())
    .maybeSingle();
  if (adminProfile && adminProfile.id !== agentId) {
    recipients.push({ id: adminProfile.id, email: adminProfile.email });
  }

  await supabase.from("notifications").insert(
    recipients.map((r) => ({
      agency_id: agencyId,
      user_id: r.id,
      title: "New property requirement submitted",
      body: `${companyName} — from ${who} (${email}). Review it in the intake queue.`,
      link: "/intake",
    })),
  );

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
