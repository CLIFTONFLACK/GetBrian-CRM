"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { refreshIdentityCheck, startIdentityCheck } from "@/lib/actions/kyc";
import { emailLinkHref, safeLink } from "@/lib/kyc/verification-link";
import type { FormState } from "@/lib/actions/types";

export type ContactOption = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
};

export type IdentityCheck = {
  sessionId: string;
  contactId: string;
  contactName: string;
  verifiedName: string | null;
  status: string;
  url: string | null;
  amlHits: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
};

/** Didit's statuses, in the CRM's own words. A raw APPROVED / AWAITING_USER is
 *  clear enough to Didit and not to an agent reading a company record. */
const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  AWAITING_USER: "Waiting on the person",
  IN_REVIEW: "Held for manual review",
  APPROVED: "Verified",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  ABANDONED: "Abandoned",
  KYC_EXPIRED: "Expired",
};

function statusTone(status: string): "emerald" | "amber" | "red" | "slate" {
  if (status === "APPROVED") return "emerald";
  if (status === "DECLINED") return "red";
  if (status === "EXPIRED" || status === "ABANDONED" || status === "KYC_EXPIRED")
    return "slate";
  return "amber";
}

/** Copies the verification link. Falls back to a plain message when the browser refuses. */
function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear the reset timer on unmount, and before each new click starts one.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setState("copied");
        } catch {
          setState("failed");
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2500);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy link"}
    </Button>
  );
}

function fmt(d: string): string {
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime())
    ? d
    : parsed.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * The Didit panel on /kyc: identity checks on the company's people.
 *
 * Didit verifies a person, not a company — so this lists the company's contacts
 * and their check status, and the "KYC Didit" button always names who is being
 * verified. The free Companies House search sits above it and answers a
 * different question (what the register says about the company).
 */
export function DiditKycCard({
  configured,
  canStart,
  contacts,
  checks,
}: {
  /** Whether the agency has a Didit key + workflow saved in Admin. */
  configured: boolean;
  /** Whether this user may start a paid check (admin or manager). The server
   *  action checks the role again; this only hides the button. */
  canStart: boolean;
  contacts: ContactOption[];
  /** Latest check per contact, for the selected company. */
  checks: IdentityCheck[];
}) {
  const [startState, startAction, starting] = useActionState<FormState, FormData>(
    startIdentityCheck,
    {},
  );
  const [refreshState, refreshAction, refreshing] = useActionState<
    FormState,
    FormData
  >(refreshIdentityCheck, {});
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");

  const byContact = new Map(checks.map((c) => [c.contactId, c]));
  // Mirrors the server guard in startIdentityCheck: a person with a result
  // needs an explicit tick before a new, billed check replaces it.
  const selectedStatus = (byContact.get(contactId)?.status ?? "").toUpperCase();
  const hasResult = selectedStatus === "APPROVED" || selectedStatus === "DECLINED";

  return (
    <Card>
      <CardHeader>
        <CardTitle>KYC Didit — identity verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Verifies a <strong>person</strong>: their ID document, a liveness check,
          and a face match against the document. A watchlist screen of their name
          runs only if the agency&apos;s Didit workflow includes AML.
          Results are folded into the next Companies House report you run for this
          company.
        </p>

        {!configured ? (
          <p className="text-sm text-muted-foreground">
            Not configured. An agency admin can add a Didit API key and pick a
            workflow on the Admin page.
          </p>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This company has no contacts yet. Add one to verify their identity.
          </p>
        ) : !canStart ? (
          <p className="text-sm text-muted-foreground">
            Only an agency admin or manager can start a paid identity check. You
            can still refresh the checks below.
          </p>
        ) : (
          <form action={startAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1">
              <label
                htmlFor="didit-contact"
                className="text-xs text-muted-foreground"
              >
                Person to verify
              </label>
              <Select
                id="didit-contact"
                name="contact_id"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
              >
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.role ? ` — ${c.role}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={starting}>
              {starting ? "Starting…" : "KYC Didit"}
            </Button>
            {hasResult || startState.needsRecheckConfirm ? (
              // The key gives each person a fresh, unticked box: a tick for one
              // person must never carry over to the next one selected.
              <label
                key={contactId}
                className="flex w-full items-center gap-2 text-xs text-muted-foreground"
              >
                <input type="checkbox" name="confirm_recheck" value="1" />
                Start a new paid check. This person already has a result, and the
                new check replaces it in this list.
              </label>
            ) : null}
          </form>
        )}

        {startState.message ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            {startState.message}
          </p>
        ) : null}
        {startState.error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{startState.error}</p>
        ) : null}
        {refreshState.message ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            {refreshState.message}
          </p>
        ) : null}
        {refreshState.error ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {refreshState.error}
          </p>
        ) : null}

        {checks.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {checks.map((c) => {
              const contact = contacts.find((p) => p.id === c.contactId);
              return (
                <li key={c.sessionId} className="space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {contact?.name ?? c.contactName}
                    </span>
                    <Badge tone={statusTone(c.status)}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Started {fmt(c.startedAt)}</span>
                    {c.verifiedName ? (
                      <span>
                        Document name:{" "}
                        <span className="text-foreground">{c.verifiedName}</span>
                      </span>
                    ) : null}
                    {c.amlHits > 0 ? (
                      <span className="text-red-700 dark:text-red-300">
                        {c.amlHits} watchlist hit{c.amlHits === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>

                  {c.error ? (
                    <p className="text-xs text-red-700 dark:text-red-300">
                      Last refresh failed: {c.error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3">
                    <form action={refreshAction}>
                      <input type="hidden" name="session_id" value={c.sessionId} />
                      <Button type="submit" size="sm" variant="secondary" disabled={refreshing}>
                        {refreshing ? "Checking…" : "Refresh"}
                      </Button>
                    </form>
                    {(() => {
                      const link = safeLink(c.url);
                      if (!link) return null;
                      const mail = emailLinkHref(contact?.email, link);
                      return (
                        <>
                          <a
                            className="text-xs text-info hover:underline"
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Verification link →
                          </a>
                          <CopyLinkButton url={link} />
                          {mail ? (
                            <a className="text-xs text-info hover:underline" href={mail}>
                              Email link
                            </a>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
