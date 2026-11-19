"use client";

import * as React from "react";
import Link from "next/link";
import { Mail, NotebookPen, PanelRightOpen, Phone, Sparkles } from "lucide-react";

import { LogActivityForm } from "@/components/log-activity-form";
import { RecordLink } from "@/components/record-panel/row-link";
import { StarRating } from "@/components/star-rating";
import { Modal } from "@/components/ui/modal";
import type { PriorityRowData } from "@/lib/priority-list";

/** A shaped row plus the links the server built from the page's own URL. */
export type PriorityRowView = PriorityRowData & {
  /** Dashboard URL plus `?record=requirement:<id>`. */
  openHref: string;
  /** Same, on the Matchmaker tab. */
  matchmakerHref: string;
  companyOpenHref: string | null;
  contactOpenHref: string | null;
};

const ACTION =
  "inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Priority requirements: a table from lg up, stacked cards below. Every row
 * action is a real control: Open and Matchmaker open the panel (links), Email
 * and Call are mailto: and tel: links (absent when the contact has no address
 * or number), Log note opens a modal with the same form as the record pages.
 * "Send deal" needs a listing picked first, so it lives on the Matchmaker tab.
 */
export function PriorityRequirements({ rows }: { rows: PriorityRowView[] }) {
  const [noteFor, setNoteFor] = React.useState<PriorityRowView | null>(null);

  return (
    <>
      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-lg border lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Active requirements rated 4 or 5 stars, best rating first
          </caption>
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="px-3 py-2">Rating</th>
              <th scope="col" className="px-3 py-2">Requirement</th>
              <th scope="col" className="px-3 py-2">Size and budget</th>
              <th scope="col" className="px-3 py-2">Locations</th>
              <th scope="col" className="px-3 py-2">Lead agent</th>
              <th scope="col" className="px-3 py-2">Updated</th>
              <th scope="col" className="px-3 py-2">Matches</th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              return (
                <tr key={r.id} className="border-b align-top last:border-b-0 hover:bg-muted/40">
                  <td className="px-3 py-3">
                    <StarRating value={r.rating} readOnly compact />
                  </td>
                  <td className="min-w-0 px-3 py-3">
                    <RecordLink href={`/requirements/${r.id}`} openHref={r.openHref}>
                      {r.title}
                    </RecordLink>
                    <PeopleLine r={r} />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    <div>{r.sizeText}</div>
                    <div className="font-mono tabular-nums">{r.budgetText}</div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    <Locations r={r} />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{r.leadAgentName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                    <span title={r.updatedTitle}>{r.updatedText}</span>
                  </td>
                  <td className="px-3 py-3">
                    <MatchCount r={r} />
                  </td>
                  <td className="px-3 py-1">
                    <Actions r={r} onLogNote={() => setNoteFor(r)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Below lg: cards */}
      <ul className="space-y-3 lg:hidden">
        {rows.map((r) => {
          return (
            <li key={r.id} className="rounded-lg border bg-card p-4">
              <StarRating value={r.rating} readOnly />
              <div className="mt-2 break-words">
                <RecordLink href={`/requirements/${r.id}`} openHref={r.openHref}>
                  {r.title}
                </RecordLink>
              </div>
              <PeopleLine r={r} />
              <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Size</dt>
                <dd>{r.sizeText}</dd>
                <dt className="text-muted-foreground">Budget</dt>
                <dd className="font-mono tabular-nums">{r.budgetText}</dd>
                <dt className="text-muted-foreground">Locations</dt>
                <dd className="min-w-0 break-words">
                  <Locations r={r} />
                </dd>
                <dt className="text-muted-foreground">Lead agent</dt>
                <dd>{r.leadAgentName ?? "—"}</dd>
                <dt className="text-muted-foreground">Updated</dt>
                <dd title={r.updatedTitle}>{r.updatedText}</dd>
                <dt className="text-muted-foreground">Matches</dt>
                <dd>
                  <MatchCount r={r} />
                </dd>
              </dl>
              <div className="-mx-2 mt-2 flex flex-wrap">
                <Actions r={r} onLogNote={() => setNoteFor(r)} />
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        title={noteFor ? `Log a note: ${noteFor.title}` : "Log a note"}
      >
        {noteFor ? <LogActivityForm entityType="requirement" entityId={noteFor.id} /> : null}
      </Modal>
    </>
  );
}

function PeopleLine({ r }: { r: PriorityRowView }) {
  const showCompany = Boolean(r.companyName && r.companyId && r.companyOpenHref);
  const showContact = Boolean(r.contactName && r.contactId && r.contactOpenHref);
  if (!showCompany && !showContact) return null;
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {showCompany ? (
        <RecordLink
          href={`/companies/${r.companyId}`}
          openHref={r.companyOpenHref!}
          className="font-normal text-muted-foreground"
        >
          {r.companyName}
        </RecordLink>
      ) : null}
      {showCompany && showContact ? <span aria-hidden="true"> · </span> : null}
      {showContact ? (
        <RecordLink
          href={`/contacts/${r.contactId}`}
          openHref={r.contactOpenHref!}
          className="font-normal text-muted-foreground"
        >
          {r.contactName}
        </RecordLink>
      ) : null}
    </p>
  );
}

function Locations({ r }: { r: PriorityRowView }) {
  if (r.locations.shown.length === 0) return <>—</>;
  return (
    <>
      {r.locations.shown.join(", ")}
      {r.locations.more > 0 ? (
        <span className="text-xs"> +{r.locations.more}</span>
      ) : null}
    </>
  );
}

function MatchCount({ r }: { r: PriorityRowView }) {
  return (
    <Link
      href={r.matchmakerHref}
      scroll={false}
      prefetch={false}
      className="font-mono tabular-nums text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Listings scoring 50 or more. Open Matchmaker."
    >
      {r.matchCount}
      <span className="sr-only"> listings score 50 or more</span>
    </Link>
  );
}

function Actions({ r, onLogNote }: { r: PriorityRowView; onLogNote: () => void }) {
  const who = r.contactName ?? "the contact";
  return (
    <div className="flex flex-wrap items-center">
      <Link
        href={r.openHref}
        scroll={false}
        prefetch={false}
        className={ACTION}
        aria-label={`Open ${r.title}`}
        title="Open"
      >
        <PanelRightOpen className="h-5 w-5" aria-hidden="true" />
      </Link>
      {r.emailHref ? (
        <a
          href={r.emailHref}
          className={ACTION}
          aria-label={`Email ${who} about ${r.title}`}
          title="Email"
        >
          <Mail className="h-5 w-5" aria-hidden="true" />
        </a>
      ) : null}
      {r.call ? (
        <a
          href={r.call.href}
          className={ACTION}
          aria-label={`Call ${who} on ${r.call.display}`}
          title={`Call ${r.call.display}`}
        >
          <Phone className="h-5 w-5" aria-hidden="true" />
        </a>
      ) : null}
      <button
        type="button"
        onClick={onLogNote}
        className={ACTION}
        aria-label={`Log a note on ${r.title}`}
        title="Log note"
      >
        <NotebookPen className="h-5 w-5" aria-hidden="true" />
      </button>
      <Link
        href={r.matchmakerHref}
        scroll={false}
        prefetch={false}
        className={ACTION}
        aria-label={`Matchmaker for ${r.title}: find a listing and send a deal`}
        title="Matchmaker and send deal"
      >
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </Link>
    </div>
  );
}
