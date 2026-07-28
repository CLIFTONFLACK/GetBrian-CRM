"use server";

import { Resend } from "resend";

import { renderParticularsPdf } from "@/lib/pdf/build-particulars";
import { currentAgencyId } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/actions/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * Email addresses for the agency's contacts (RLS-scoped), so the Send Deal
 * wizard can hide contacts it could never email — the "that contact has no
 * email address" failure now surfaces before the send, not after.
 */
export async function listContactEmails(): Promise<
  { id: string; email: string | null }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase.from("contacts").select("id, email").limit(5000);
  return data ?? [];
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return {
      error:
        "Email sending isn't configured yet — set RESEND_API_KEY and EMAIL_FROM.",
    };
  }

  const contactId = str(formData, "contact_id");
  if (!contactId) return { error: "Pick a contact to send to." };
  const companyId = str(formData, "company_id") || null;
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

  const { data: contact } = await supabase
    .from("contacts")
    .select("first_name, last_name, email")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { error: "Contact not found." };
  if (!contact.email)
    return { error: "That contact has no email address — add one first." };

  // Attach a particulars PDF per listing, up to MAX_ATTACHMENTS.
  const attachments: { filename: string; content: Buffer }[] = [];
  const pdfKindOf = new Map<string, "branded" | "unbranded">();
  const notAttached: string[] = [];
  for (const id of listingIds) {
    const pdf = await renderParticularsPdf(id, supabase);
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
    const { data: reqRows } = await supabase
      .from("requirements")
      .select("id, title, target_towns, min_sqft, max_sqft, max_rent")
      .in("id", requirementIds);
    briefLines = (reqRows ?? []).map((r) => {
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
    const { data: listingRows } = await supabase
      .from("disposals")
      .select("id, title, city, size_sqft, rent_pa")
      .in("id", listingIds);
    listingLines = (listingRows ?? []).map((l) => {
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

  // Replies should land with the sending agent, not the shared from-address.
  const { data: me } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  // A network/SDK fault throws rather than returning `error` — catch it so the
  // agent sees why the send failed instead of a crashed action.
  const resend = new Resend(apiKey);
  let sent: { id: string } | null = null;
  try {
    const { data, error: sendError } = await resend.emails.send({
      from,
      to: contact.email,
      replyTo: me?.email ?? undefined,
      subject,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    if (sendError) return { error: `Email failed: ${sendError.message}` };
    sent = data;
  } catch (e) {
    return {
      error: `Email failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  // Log the send — one row per requirement × listing, so the "already sent"
  // chips on both records stay accurate for every pair in the batch.
  const baseRow = {
    agency_id: agencyId,
    deal_id: dealId,
    company_id: companyId,
    contact_id: contactId,
    recipient_email: contact.email,
    subject,
    body: body || null,
    provider_id: sent?.id ?? null,
    sent_by: user.id,
  };
  const rows = (requirementIds.length > 0 ? requirementIds : [null]).flatMap(
    (requirement_id) =>
      (listingIds.length > 0 ? listingIds : [null]).map((listing_id) => ({
        ...baseRow,
        requirement_id,
        listing_id,
        pdf_kind: listing_id ? (pdfKindOf.get(listing_id) ?? null) : null,
      })),
  );
  const { error: logError } = await supabase.from("external_sends").insert(rows);
  if (logError) {
    // The email is already out — surface success but note the logging failure.
    return { message: `Sent to ${contact.email} (logging failed: ${logError.message})` };
  }

  const capped = notAttached.length
    ? ` ${notAttached.length} particulars weren't attached (${MAX_ATTACHMENTS} max per email).`
    : "";
  return { message: `Sent to ${contact.email}.${capped}` };
}
