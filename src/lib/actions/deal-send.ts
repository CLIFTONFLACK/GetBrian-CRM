"use server";

import { Resend } from "resend";

import { renderParticularsPdf } from "@/lib/pdf/build-particulars";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  createExternalSends,
  getContactEmailOptions,
  getRequirementBriefsForSend,
} from "@/lib/db/queries/deals";
import { getContactById } from "@/lib/db/queries/contacts";
import { getCompanyName } from "@/lib/db/queries/companies";
import { getDisposalsByIds } from "@/lib/db/queries/disposals";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * Email addresses for the agency's contacts, so the Send Deal wizard can hide
 * contacts it could never email — the "that contact has no email address"
 * failure now surfaces before the send, not after. Agency-scoped explicitly
 * (there's no RLS backstop on this schema — see AGENTS.md; the original
 * Supabase version relied on RLS here and wasn't even agency-filtered).
 */
export async function listContactEmails(): Promise<{ id: string; email: string | null }[]> {
  if (!isDbConfigured) return [];
  const session = await auth();
  if (!session?.user) return [];
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return [];
  return getContactEmailOptions(agencyId);
}

/**
 * Ceiling on particulars PDFs in one email. Each is a few hundred KB and most
 * providers reject a message over ~25 MB outright; anything past this is listed
 * in the body instead of attached, and the agent is told.
 */
const MAX_ATTACHMENTS = 8;

/**
 * "Send Deal → External" — email one or more matched opportunities (or a batch
 * of requirement briefs) to a company contact, attaching each listing's
 * particulars PDF (branded for CDG stock, unbranded for intel). Every send is
 * logged to `external_sends`, one row per requirement × listing.
 */
export async function sendDealExternal(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return {
      error: "Email sending isn't configured yet — set RESEND_API_KEY and EMAIL_FROM.",
    };
  }

  const contactId = str(formData, "contact_id");
  if (!contactId) return { error: "Pick a contact to send to." };
  // company_id comes from the form; only keep it if this agency owns it, so a
  // foreign id can't be stamped onto external_sends and later surface another
  // agency's name in the send-history join (no RLS backstop — see AGENTS.md).
  // Note: getCompanyName returns the name (possibly "") when owned, or null when
  // not — so test `!== null`, NOT truthiness, or an owned company with a blank
  // name would be wrongly dropped.
  const rawCompanyId = str(formData, "company_id") || null;
  const companyOwned = rawCompanyId ? (await getCompanyName(agencyId, rawCompanyId)) !== null : false;
  const companyId = companyOwned ? rawCompanyId : null;
  // `listing_ids` is the multi-select form; `listing_id` is the single-listing
  // shape older callers still post.
  const listingIds = Array.from(
    new Set(
      [
        ...formData.getAll("listing_ids").map((v) => String(v)),
        str(formData, "listing_id"),
      ].filter(Boolean),
    ),
  );
  // Optional — set when the wizard is opened from a deal, so the deal can show
  // its own outbound history.
  const dealId = str(formData, "deal_id") || null;
  const requirementIds = Array.from(
    new Set(formData.getAll("requirement_ids").map((v) => String(v)).filter(Boolean)),
  );
  const subject = str(formData, "subject");
  if (!subject) return { error: "A subject is required." };
  const body = str(formData, "body");

  const contact = await getContactById(agencyId, contactId);
  if (!contact) return { error: "Contact not found." };
  if (!contact.email) return { error: "That contact has no email address — add one first." };

  // Attach a particulars PDF per listing, up to MAX_ATTACHMENTS.
  const attachments: { filename: string; content: Buffer }[] = [];
  const pdfKindOf = new Map<string, "branded" | "unbranded">();
  const notAttached: string[] = [];
  for (const id of listingIds) {
    const pdf = await renderParticularsPdf(agencyId, id);
    if (!pdf) return { error: "Listing not found." };
    pdfKindOf.set(id, pdf.isIntel ? "unbranded" : "branded");
    if (attachments.length < MAX_ATTACHMENTS) {
      attachments.push({ filename: pdf.filename, content: pdf.buffer });
    } else {
      notAttached.push(pdf.filename);
    }
  }

  // Requirement briefs (bulk mode) — summarised inline in the email body.
  let briefLines: string[] = [];
  if (requirementIds.length > 0) {
    const reqRows = await getRequirementBriefsForSend(agencyId, requirementIds);
    briefLines = reqRows.map((r) => {
      const bits = [
        r.target_towns.length ? r.target_towns.join(", ") : null,
        r.min_sqft != null || r.max_sqft != null
          ? `${r.min_sqft?.toLocaleString("en-GB") ?? "?"}–${r.max_sqft?.toLocaleString("en-GB") ?? "?"} sq ft`
          : null,
        r.max_rent != null ? `max £${r.max_rent.toLocaleString("en-GB")} pa` : null,
      ].filter(Boolean);
      return `• ${r.title}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
    });
  }

  // Listings (opportunity mode) — named inline so the email reads as a list
  // even when the attachments are stripped by the recipient's mail client.
  let listingLines: string[] = [];
  if (listingIds.length > 0) {
    const listingRows = await getDisposalsByIds(agencyId, listingIds);
    listingLines = listingRows.map((l) => {
      const bits = [
        l.city,
        l.size_sqft != null ? `${l.size_sqft.toLocaleString("en-GB")} sq ft` : null,
        l.rent_pa != null ? `£${l.rent_pa.toLocaleString("en-GB")} pa` : null,
      ].filter(Boolean);
      return `• ${l.title ?? "Untitled listing"}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
    });
  }

  const attachmentNote =
    attachments.length === 0
      ? null
      : attachments.length === 1
        ? "Full property particulars are attached."
        : `Particulars for ${attachments.length} of these are attached.`;

  const greeting = contact.first_name ? `Hi ${contact.first_name},` : "Hi,";
  const text = [
    greeting,
    "",
    body || "Please find details below.",
    listingLines.length ? "" : null,
    listingLines.length ? listingLines.join("\n") : null,
    briefLines.length ? "" : null,
    briefLines.length ? briefLines.join("\n") : null,
    attachmentNote ? "" : null,
    attachmentNote,
  ]
    .filter((l): l is string => l != null)
    .join("\n");

  // Replies should land with the sending agent, not the shared from-address —
  // the session already carries their email (no separate profiles lookup
  // needed now that profiles merged into users, see db/migrations/0001_init.sql).
  const replyTo = session.user.email ?? undefined;

  // A network/SDK fault throws rather than returning `error` — catch it so the
  // agent sees why the send failed instead of a crashed action.
  const resend = new Resend(apiKey);
  let sent: { id: string } | null = null;
  try {
    const { data, error: sendError } = await resend.emails.send({
      from,
      to: contact.email,
      replyTo,
      subject,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    if (sendError) return { error: `Email failed: ${sendError.message}` };
    sent = data;
  } catch (e) {
    return { error: `Email failed: ${e instanceof Error ? e.message : "unknown error"}` };
  }

  // Log the send — one row per requirement × listing, so the "already sent"
  // chips on both records stay accurate for every pair in the batch.
  const baseRow = {
    dealId,
    companyId,
    contactId,
    recipientEmail: contact.email,
    subject,
    body: body || null,
    providerId: sent?.id ?? null,
  };
  const rows = (requirementIds.length > 0 ? requirementIds : [null]).flatMap((requirementId) =>
    (listingIds.length > 0 ? listingIds : [null]).map((listingId) => ({
      ...baseRow,
      requirementId,
      listingId,
      pdfKind: listingId ? (pdfKindOf.get(listingId) ?? null) : null,
    })),
  );
  try {
    await createExternalSends(agencyId, session.user.id, rows);
  } catch (e) {
    // The email is already out — surface success but note the logging failure.
    const msg = e instanceof Error ? e.message : "unknown error";
    return { message: `Sent to ${contact.email} (logging failed: ${msg})` };
  }

  const capped = notAttached.length
    ? ` ${notAttached.length} particulars weren't attached (${MAX_ATTACHMENTS} max per email).`
    : "";
  return { message: `Sent to ${contact.email}.${capped}` };
}
