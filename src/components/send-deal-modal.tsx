"use client";

import * as React from "react";
import { useActionState } from "react";
import { ArrowLeft, Building2, Send, Users } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CompanyCreatableSelect,
  ContactCreatableSelect,
  type EntityOption,
} from "@/components/creatable-select";
import { listContactEmails, sendDealExternal } from "@/lib/actions/deal-send";
import { sendMessage } from "@/lib/actions/messages";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/supabase/agency";

type Step = "choose" | "internal" | "external";

/**
 * Contact option, optionally carrying the address the email would go to.
 * Callers that already select `email` can pass it; otherwise the wizard looks
 * the addresses up itself when the external step opens.
 */
export type ContactSendOption = EntityOption & { email?: string | null };

/**
 * "Send Deal" — a two-step wizard: pick Internal (teammates, via the existing
 * messages/notifications rails) or External (a company contact, via email with
 * the particulars PDF attached — branded for CDG stock, unbranded for intel).
 *
 * Opportunity mode (requirement ↔ listing pair) or bulk-requirements mode
 * (a set of requirement briefs, no listing/PDF).
 */
export function SendDealModal({
  agents,
  meId,
  companies,
  contacts,
  companyTypes,
  requirementId,
  listingId,
  listings,
  dealId,
  requirementTitle,
  listingTitle,
  requirements,
  previousSends,
  size = "sm",
  label = "Send deal",
}: {
  agents: AgentOption[];
  meId?: string;
  companies: EntityOption[];
  contacts: ContactSendOption[];
  /** Editable company_types list — feeds the "+ New company" quick-create modal. */
  companyTypes?: { slug: string; label: string }[];
  /** Opportunity mode — one matched pair. */
  requirementId?: string;
  listingId?: string;
  /** Multi-opportunity mode — several listings picked against one requirement. */
  listings?: { id: string; title: string }[];
  /** Set when the wizard is opened from a deal — logged on the send. */
  dealId?: string;
  requirementTitle?: string;
  listingTitle?: string;
  /** Bulk mode — a set of requirements (no listing attached). */
  requirements?: { id: string; title: string }[];
  /** Prior external sends of this exact pair — surfaced to prevent double-sending. */
  previousSends?: { name: string; at: string }[];
  size?: "sm" | "default";
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("choose");

  const bulk = requirements ?? [];
  const isBulk = bulk.length > 0;
  const requirementIds = isBulk
    ? bulk.map((r) => r.id)
    : requirementId
      ? [requirementId]
      : [];
  // One listing or many — everything downstream only ever sees the array.
  const picked = listings ?? [];
  const listingIds =
    picked.length > 0 ? picked.map((l) => l.id) : listingId ? [listingId] : [];
  const isMultiListing = picked.length > 1;

  const subject = isBulk
    ? `${bulk.length} property requirement${bulk.length === 1 ? "" : "s"}`
    : isMultiListing
      ? `${picked.length} opportunities${requirementTitle ? ` — ${requirementTitle}` : ""}`
      : [requirementTitle, listingTitle ?? picked[0]?.title]
          .filter(Boolean)
          .join(" ↔ ") || "Opportunity";
  const link = isBulk
    ? "/requirements"
    : requirementId
      ? `/requirements/${requirementId}`
      : listingIds.length === 1
        ? `/listings/${listingIds[0]}`
        : "/matches";
  const defaultBody = isBulk
    ? `Requirements:\n${bulk.map((r) => `• ${r.title}`).join("\n")}`
    : isMultiListing
      ? `A few opportunities that fit${requirementTitle ? ` ${requirementTitle}` : ""}:`
      : `Take a look at ${subject}.`;

  const close = () => {
    setOpen(false);
    setStep("choose");
  };

  return (
    <>
      <Button type="button" variant="secondary" size={size} onClick={() => setOpen(true)}>
        <Send />
        {label}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={
          step === "choose"
            ? "Send deal"
            : step === "internal"
              ? "Send deal — internal"
              : "Send deal — external"
        }
      >
        {step === "choose" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send{" "}
              {isBulk
                ? `${bulk.length} requirement${bulk.length === 1 ? "" : "s"}`
                : isMultiListing
                  ? `${picked.length} opportunities`
                  : subject}{" "}
              to your team, or to an outside company contact by email.
            </p>
            <PreviousSendsNote previousSends={previousSends} />
            <button
              type="button"
              onClick={() => setStep("internal")}
              className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/60"
            >
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-medium">Internal</span>
                <span className="block text-xs text-muted-foreground">
                  Message teammates — lands in their inbox and notification bell.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStep("external")}
              className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/60"
            >
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-medium">External</span>
                <span className="block text-xs text-muted-foreground">
                  Email a company contact
                  {listingIds.length === 1
                    ? " with the property particulars PDF attached"
                    : listingIds.length > 1
                      ? ` with ${listingIds.length} particulars PDFs attached`
                      : ""}
                  .
                </span>
              </span>
            </button>
          </div>
        ) : step === "internal" ? (
          <InternalStep
            agents={agents}
            meId={meId}
            link={link}
            subject={subject}
            defaultBody={defaultBody}
            onBack={() => setStep("choose")}
            onDone={close}
          />
        ) : (
          <ExternalStep
            companies={companies}
            contacts={contacts}
            companyTypes={companyTypes}
            listingIds={listingIds}
            dealId={dealId}
            requirementIds={requirementIds}
            defaultSubject={subject}
            defaultBody={isBulk || isMultiListing ? defaultBody : ""}
            previousSends={previousSends}
            onBack={() => setStep("choose")}
            onDone={close}
          />
        )}
      </Modal>
    </>
  );
}

function PreviousSendsNote({
  previousSends,
}: {
  previousSends?: { name: string; at: string }[];
}) {
  if (!previousSends || previousSends.length === 0) return null;
  const shown = previousSends.slice(0, 3);
  return (
    <Alert tone="warning">
      Already sent externally to{" "}
      {shown
        .map((p) => `${p.name} (${new Date(p.at).toLocaleDateString("en-GB")})`)
        .join(", ")}
      {previousSends.length > shown.length
        ? ` and ${previousSends.length - shown.length} more`
        : ""}
      .
    </Alert>
  );
}

function InternalStep({
  agents,
  meId,
  link,
  subject,
  defaultBody,
  onBack,
  onDone,
}: {
  agents: AgentOption[];
  meId?: string;
  link: string;
  subject: string;
  defaultBody: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    sendMessage,
    {},
  );
  const recipients = agents.filter((a) => a.id !== meId);

  React.useEffect(() => {
    if (!state.message) return;
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [state.message, onDone]);

  if (recipients.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No teammates to send to yet — add agents in Admin.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="link" value={link} />
      <input type="hidden" name="subject" value={subject} />

      <div className="space-y-2">
        <Label>Recipients</Label>
        <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
          {recipients.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/60"
            >
              <input
                type="checkbox"
                name="recipients"
                value={a.id}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className="truncate">{a.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sd-int-body">Message</Label>
        <Textarea id="sd-int-body" name="body" required defaultValue={defaultBody} />
      </div>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          Back
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function ExternalStep({
  companies,
  contacts,
  companyTypes,
  listingIds,
  dealId,
  requirementIds,
  defaultSubject,
  defaultBody,
  previousSends,
  onBack,
  onDone,
}: {
  companies: EntityOption[];
  contacts: ContactSendOption[];
  companyTypes?: { slug: string; label: string }[];
  listingIds: string[];
  dealId?: string;
  requirementIds: string[];
  defaultSubject: string;
  defaultBody: string;
  previousSends?: { name: string; at: string }[];
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    sendDealExternal,
    {},
  );

  // Contacts with no email address can't be sent to — hide them rather than
  // failing after submit. Addresses come from the caller when it selected them,
  // otherwise they're looked up once, here.
  const callerKnowsEmails = contacts.some((c) => c.email !== undefined);
  const [lookedUp, setLookedUp] = React.useState<Map<string, string | null> | null>(
    null,
  );
  React.useEffect(() => {
    if (callerKnowsEmails) return;
    let cancelled = false;
    listContactEmails()
      .then((rows) => {
        if (!cancelled) setLookedUp(new Map(rows.map((r) => [r.id, r.email])));
      })
      .catch(() => {
        // Lookup failed — fall back to showing every contact (previous behaviour).
      });
    return () => {
      cancelled = true;
    };
  }, [callerKnowsEmails]);

  const emailsKnown = callerKnowsEmails || lookedUp != null;
  const sendable = emailsKnown
    ? contacts.filter((c) => Boolean(c.email !== undefined ? c.email : lookedUp?.get(c.id)))
    : contacts;
  const hidden = contacts.length - sendable.length;

  React.useEffect(() => {
    if (!state.message) return;
    const t = setTimeout(onDone, 1200);
    return () => clearTimeout(t);
  }, [state.message, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      <PreviousSendsNote previousSends={previousSends} />
      {listingIds.map((id) => (
        <input key={id} type="hidden" name="listing_ids" value={id} />
      ))}
      {dealId ? <input type="hidden" name="deal_id" value={dealId} /> : null}
      {requirementIds.map((id) => (
        <input key={id} type="hidden" name="requirement_ids" value={id} />
      ))}

      <CompanyCreatableSelect
        name="company_id"
        label="Company"
        options={companies}
        types={companyTypes}
        placeholder="— Optional —"
      />
      <ContactCreatableSelect
        name="contact_id"
        label="Contact"
        required
        placeholder="Select a contact…"
        options={sendable}
        hint={
          hidden > 0
            ? `Only contacts with an email address are listed — ${hidden} hidden. Add an address to their record to email them.`
            : "The email goes to this contact — they need an email address on file."
        }
      />

      <div className="space-y-2">
        <Label htmlFor="sd-ext-subject">Subject</Label>
        <Input id="sd-ext-subject" name="subject" required defaultValue={defaultSubject} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sd-ext-body">Message</Label>
        <Textarea
          id="sd-ext-body"
          name="body"
          placeholder="Add a note for the recipient…"
          defaultValue={defaultBody}
        />
      </div>

      {listingIds.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {listingIds.length === 1
            ? "The property particulars PDF is attached automatically."
            : `Particulars PDFs for all ${listingIds.length} properties are attached automatically.`}
        </p>
      ) : null}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          Back
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send email"}
        </Button>
      </div>
    </form>
  );
}
