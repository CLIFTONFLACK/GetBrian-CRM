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
 * Ceiling on recipients in one email. Resend rejects a To: line over 50
 * addresses outright, and a shared To: line this long is a privacy problem
 * anyway (every recipient sees every other). Enforced here AND in the modal.
 */
const MAX_RECIPIENTS = 20;

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

  // `contact_ids` is the multi-recipient form; `contact_id` is the single-value
  // shape older callers still post (mirrors how listing_ids/listing_id work).
  const contactIds = Array.from(
    new Set(
      [
        ...formData.getAll("contact_ids").map((v) => String(v)),
        str(formData, "contact_id"),
      ].filter(Boolean),
    ),
  );
  if (contactIds.length === 0) return { error: "Pick at least one contact to send to." };
  // Checked before any contact lookup or PDF render — a too-long list should
  // fail instantly, not after rendering eight attachments.
  if (contactIds.length > MAX_RECIPIENTS) {
    return { error: `Choose at most ${MAX_RECIPIENTS} contacts per send.` };
  }
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

  // Resolve every recipient BEFORE sending anything: a half-sent batch, where
  // some contacts got the email and the rest failed on a missing address, is
  // worse than sending nothing and saying which records need fixing.
  const contacts = [];
  const withoutEmail: string[] = [];
  for (const id of contactIds) {
    const c = await getContactById(agencyId, id);
    if (!c) return { error: "Contact not found." };
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact";
    if (!c.email) withoutEmail.push(name);
    else contacts.push({ id: c.id, email: c.email, name, firstName: c.first_name });
  }
  if (withoutEmail.length > 0) {
    return {
      error: `No email address for ${withoutEmail.join(", ")} — add one, or untick them.`,
    };
  }

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

  // One email, several recipients — it can only carry one greeting, so it stays
  // personal for a single recipient and turns neutral for a group rather than
  // greeting everyone by the first person's name.
  const greeting =
    contacts.length === 1 && contacts[0].firstName
      ? `Hi ${contacts[0].firstName},`
      : "Hi,";
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
  // Named in the result so the agent can see exactly who it went to.
  const recipientList =
    contacts.length <= 3
      ? contacts.map((c) => c.email).join(", ")
      : `${contacts.length} contacts`;

  const resend = new Resend(apiKey);
  let sent: { id: string } | null = null;
  try {
    const { data, error: sendError } = await resend.emails.send({
      from,
      // Every recipient in one To: line — they can see each other. Agreed
      // behaviour, but the reason the modal says so next to the picker.
      to: contacts.map((c) => c.email),
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
    subject,
    body: body || null,
    providerId: sent?.id ?? null,
  };
  // One row per recipient × requirement × listing. The recipient is now a third
  // dimension of the same fan-out, so the "already sent" chips on both records
  // stay accurate and each contact's own send history is complete. All rows
  // share one provider_id because it really was one email — the Resend
  // engagement webhook therefore reports delivery/opens for the send as a
  // whole, not per recipient. That is the trade-off of a shared To: line.
  const rows = contacts.flatMap((c) =>
    (requirementIds.length > 0 ? requirementIds : [null]).flatMap((requirementId) =>
      (listingIds.length > 0 ? listingIds : [null]).map((listingId) => ({
        ...baseRow,
        contactId: c.id,
        recipientEmail: c.email,
        requirementId,
        listingId,
        pdfKind: listingId ? (pdfKindOf.get(listingId) ?? null) : null,
      })),
    ),
  );
  try {
    await createExternalSends(agencyId, session.user.id, rows);
  } catch (e) {
    // The email is already out — surface success but note the logging failure.
    const msg = e instanceof Error ? e.message : "unknown error";
    return { message: `Sent to ${recipientList} (logging failed: ${msg})` };
  }

  const capped = notAttached.length
    ? ` ${notAttached.length} particulars weren't attached (${MAX_ATTACHMENTS} max per email).`
    : "";
  return { message: `Sent to ${recipientList}.${capped}` };
}
