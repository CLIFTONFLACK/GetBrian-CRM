"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { currentAgencyId, getMemberRole } from "@/lib/db/queries/agencies";
import { getContactById } from "@/lib/db/queries/contacts";
import {
  createDiditSession,
  getDiditSession,
  getKycCompany,
  getLatestDiditSessionForContact,
  setDiditSessionError,
  updateCompanyRegistration,
  updateDiditDecision,
} from "@/lib/db/queries/kyc";
import { getAgencyDidit } from "@/lib/kyc/didit-config";
import {
  canStartIdentityCheck,
  checkPhase,
  createIdentitySession,
  getDecision,
  isDiditOutcomeUnknown,
  mapDecision,
} from "@/lib/kyc/providers/didit";
import { runKycReport } from "@/lib/kyc/report";
import { checkRateLimit } from "@/lib/rate-limit";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const nullable = (fd: FormData, k: string) => str(fd, k) || null;

/** Run a KYC report for a company and store it. Used by the "Run report" button. */
export async function runKyc(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const companyId = str(formData, "company_id");
  if (!companyId) return { error: "Pick a company first." };

  const company = await getKycCompany(agencyId, companyId);
  if (!company) return { error: "Company not found." };

  try {
    await runKycReport(company, agencyId, session.user.id);
  } catch (err) {
    return { error: (err as Error).message };
  }

  revalidatePath("/kyc");
  revalidatePath(`/companies/${companyId}`);
  return { message: "KYC report generated." };
}

/** Save a company's registration number (CRN) + VAT number (from picker or manual). */
export async function linkCompanyNumber(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const id = str(formData, "company_id");
  if (!id) return { error: "Missing company id." };

  const company_number = nullable(formData, "company_number");
  const vat_number = nullable(formData, "vat_number");

  const ok = await updateCompanyRegistration(agencyId, id, company_number, vat_number);
  if (!ok) return { error: "Company not found." };

  revalidatePath("/kyc");
  revalidatePath(`/companies/${id}`);
  return { message: "Saved registration details." };
}

// ─────────────────────────────────────────────────────────────────────────────
// Didit identity verification — the paid, per-person check.
//
// startIdentityCheck is the ONLY thing in the codebase that creates a Didit
// session, and a session is billed the moment it is created. That is why it is
// a standalone action behind its own button rather than a step inside runKyc:
// the Companies House report must stay free and repeatable.
// ─────────────────────────────────────────────────────────────────────────────

/** The app's own origin, for the URL Didit returns the person to. Derived from
 *  the request rather than an env var so it is correct on localhost, previews
 *  and production without another variable to keep in sync. */
async function originFromRequest(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Contact name as the CRM holds it — used for the session's own record, not
 *  sent to Didit (see createIdentitySession's note on why the answer isn't
 *  pre-filled). */
const contactName = (c: { first_name: string; last_name: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ").trim();

/** How long an open check stops a new one for the same person. This is the
 *  CRM's own limit, not a figure from Didit. */
const OPEN_CHECK_BLOCK_DAYS = 7;

/** True when a Postgres timestamp text is more than `days` old. An unreadable
 *  timestamp counts as recent, so the guard stays on the side that does not
 *  bill twice. */
function isOlderThan(timestamp: string | null | undefined, days: number): boolean {
  if (!timestamp) return false;
  // Postgres prints "2026-11-19 18:20:00.123456+00"; make it ISO 8601.
  const iso = timestamp
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  return Date.now() - at > days * 24 * 60 * 60 * 1000;
}

/**
 * Starts a Didit identity check for a contact.
 *
 * The session is asynchronous: Didit returns a hosted URL, the person completes
 * it on their own device, and the decision is collected later by
 * refreshIdentityCheck. One decision fetch happens immediately anyway, so a
 * session that is somehow already settled shows the right status straight away.
 */
export async function startIdentityCheck(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  // A check is billed to the agency, so only an admin or a manager can start
  // one. This is the real gate; the card only hides the button.
  if (!canStartIdentityCheck(await getMemberRole(agencyId, session.user.id))) {
    return { error: "Only an agency admin or manager can start a paid identity check." };
  }

  const contactId = str(formData, "contact_id");
  if (!contactId) return { error: "Pick a contact to verify." };

  const contact = await getContactById(agencyId, contactId);
  if (!contact) return { error: "Contact not found." };

  const config = await getAgencyDidit(agencyId);
  if (!config) {
    return {
      error: "Didit is not configured. Add an API key and pick a workflow in Admin.",
    };
  }

  // A session is billed when it is created, so this guard runs before anything
  // is sent to Didit. An open check is never duplicated. A decided one is only
  // replaced when the agent ticked the box that says so, because the list shows
  // the newest check per contact and a new one hides the result.
  const latest = await getLatestDiditSessionForContact(agencyId, contact.id);
  if (latest) {
    let status = latest.status;
    // There is no webhook, so the stored status is only as new as the last
    // Refresh. An old "open" row can hide a result that is already decided at
    // Didit. Ask Didit (free) before this row is allowed to be replaced.
    if (checkPhase(status) === "open" && isOlderThan(latest.created_at, OPEN_CHECK_BLOCK_DAYS)) {
      try {
        const decision = await getDecision(config.apiKey, latest.session_id);
        const mapped = mapDecision(decision.raw);
        await updateDiditDecision(
          agencyId,
          latest.session_id,
          decision.status,
          decision.raw,
          mapped.aml.length,
          mapped.document?.fullName ?? null,
        );
        status = decision.status;
      } catch {
        // No answer. Keep the stored status, so a session that Didit no longer
        // knows does not lock the person for good.
      }
    }
    const phase = checkPhase(status);
    // An open check blocks a new one only while it is recent. Without the age
    // limit, a session that never settles (or whose refresh keeps failing)
    // would lock the contact for good.
    if (phase === "open" && !isOlderThan(latest.created_at, OPEN_CHECK_BLOCK_DAYS)) {
      return {
        error: `${contactName(contact)} already has an identity check in progress. Send them its verification link, or press Refresh to get the result. No new check was started.`,
      };
    }
    if (phase === "decided" && str(formData, "confirm_recheck") !== "1") {
      return {
        error: `${contactName(contact)} already has an identity result. Tick "Start a new paid check" to run it again. No new check was started.`,
        // The result can sit under another company, where this card does not
        // list it. The flag makes the card show the tick box anyway.
        needsRecheckConfirm: true,
      };
    }
  }

  // Last check before the billed call, so a rejection by the guard above does
  // not use up the limit.
  const { success: withinLimit } = await checkRateLimit(
    "diditStart",
    `${agencyId}:${session.user.id}`,
  );
  if (!withinLimit) {
    return {
      error: "Too many identity checks were started in the last hour. Try again later. No new check was started.",
    };
  }

  const origin = await originFromRequest();

  let created;
  try {
    created = await createIdentitySession(config.apiKey, {
      workflowId: config.workflowId,
      // vendor_data comes back on the decision and on webhooks, so it is the
      // contact id — that is what a later payload has to be matched against.
      vendorData: contact.id,
      email: contact.email,
      callbackUrl:
        origin && contact.company_id
          ? `${origin}/kyc?company=${contact.company_id}`
          : origin
            ? `${origin}/contacts/${contact.id}`
            : null,
    });
  } catch (err) {
    if (isDiditOutcomeUnknown(err)) {
      // The CRM has no row for it, so the duplicate guard cannot stop a retry.
      console.error(`[didit] start for contact ${contact.id} got no reply:`, (err as Error).message);
      return {
        error:
          `${(err as Error).message} The check may have been started and billed. ` +
          `Look in the Didit dashboard before you press the button again.`,
      };
    }
    return { error: (err as Error).message };
  }

  // From here the check exists at Didit and is billed. If the CRM cannot save
  // it, the agent must still get the session id and the link: without them the
  // check cannot be refreshed, sent or found again.
  let row;
  try {
    row = await createDiditSession(agencyId, {
      contactId: contact.id,
      companyId: contact.company_id,
      sessionId: created.sessionId,
      workflowId: config.workflowId,
      sessionUrl: created.url,
      status: created.status,
      createdBy: session.user.id,
    });
  } catch (err) {
    console.error(
      `[didit] session ${created.sessionId} was created but not saved:`,
      (err as Error).message,
    );
    return {
      error:
        `The check was started at Didit and is billed, but the CRM could not save it. ` +
        `Do not press the button again. Keep this session id: ${created.sessionId}.` +
        (created.url ? ` Verification link: ${created.url}` : ""),
    };
  }

  // First decision poll. Failing here is not a failure of the action — the
  // session exists and has been paid for; it just has nothing to report yet.
  try {
    const decision = await getDecision(config.apiKey, row.session_id);
    const mapped = mapDecision(decision.raw);
    await updateDiditDecision(
      agencyId,
      row.session_id,
      decision.status,
      decision.raw,
      mapped.aml.length,
      mapped.document?.fullName ?? null,
    );
  } catch {
    // Leave the row at its created status; the Refresh button retries.
  }

  revalidatePath("/kyc");
  if (contact.company_id) revalidatePath(`/companies/${contact.company_id}`);
  return {
    message: created.url
      ? `Identity check started for ${contactName(contact)}. Send them the verification link.`
      : `Identity check started for ${contactName(contact)}.`,
  };
}

/** Re-fetches a check's decision. Free — no session is created here, so this is
 *  safe to press repeatedly while a check is outstanding. */
export async function refreshIdentityCheck(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const sessionId = str(formData, "session_id");
  if (!sessionId) return { error: "Missing session." };

  // Agency-scoped lookup: this is what stops one agency polling another's
  // session by guessing an id.
  const row = await getDiditSession(agencyId, sessionId);
  if (!row) return { error: "That identity check belongs to another agency." };

  const config = await getAgencyDidit(agencyId);
  if (!config) return { error: "Didit is not configured." };

  try {
    const decision = await getDecision(config.apiKey, row.session_id);
    const mapped = mapDecision(decision.raw);
    await updateDiditDecision(
      agencyId,
      row.session_id,
      decision.status,
      decision.raw,
      mapped.aml.length,
      mapped.document?.fullName ?? null,
    );
    revalidatePath("/kyc");
    if (row.company_id) revalidatePath(`/companies/${row.company_id}`);
    return {
      message: `Identity check is ${decision.status.toLowerCase().replace(/_/g, " ")}.`,
    };
  } catch (err) {
    await setDiditSessionError(agencyId, row.session_id, (err as Error).message);
    return { error: (err as Error).message };
  }
}
