"use client";

import * as React from "react";
import Link from "next/link";

import { CreateDealButton } from "@/components/create-deal-button";
import { MatchReasons } from "@/components/match-reasons";
import { SendDealModal } from "@/components/send-deal-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listingTypeBadge, matchScoreBadge } from "@/lib/badges";
import type { EntityOption } from "@/components/creatable-select";
import type { MatchReason } from "@/lib/matching/score";
import type { AgentOption } from "@/lib/db/queries/agencies";
import { cn } from "@/lib/utils";

export type Opportunity = {
  id: string;
  title: string;
  city: string | null;
  listingType: string | null;
  score: number;
  reasons: MatchReason[];
  /** Prior external sends of this exact requirement ↔ listing pair. */
  previousSends?: { name: string; at: string }[];
};

/**
 * A requirement's MatchMaker opportunities, each tickable so several listings
 * can go to the same contact in one email. Per-row "Send deal" still works for
 * the one-off case; the sticky bar takes over once anything is selected.
 */
export function MatchOpportunities({
  opportunities,
  requirementId,
  requirementTitle,
  agents,
  meId,
  companies,
  contacts,
  companyTypes,
}: {
  opportunities: Opportunity[];
  requirementId: string;
  requirementTitle: string;
  agents: AgentOption[];
  meId?: string;
  companies: EntityOption[];
  contacts: EntityOption[];
  companyTypes?: { slug: string; label: string }[];
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const allRef = React.useRef<HTMLInputElement>(null);

  // Drop selections for rows that disappeared after a flex-slider re-score.
  const ids = React.useMemo(
    () => new Set(opportunities.map((o) => o.id)),
    [opportunities],
  );
  const active = [...selected].filter((id) => ids.has(id));
  const allSelected = opportunities.length > 0 && active.length === opportunities.length;

  React.useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = active.length > 0 && !allSelected;
  }, [active.length, allSelected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedRows = opportunities.filter((o) => selected.has(o.id));
  // The wizard warns about double-sending — carry every prior send of the
  // selected pairs through, not just the first row's.
  const previousSends = selectedRows.flatMap((o) => o.previousSends ?? []);

  if (opportunities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No MatchMaker opportunities yet — add disposals to generate matches.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            ref={allRef}
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(allSelected ? new Set() : new Set(opportunities.map((o) => o.id)))
            }
            className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
          />
          Select all
        </label>
        {active.length > 0 ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            <span className="font-medium text-foreground">{active.length}</span> selected
          </p>
        ) : null}
      </div>

      {active.length > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-2 pl-3 shadow-sm">
          <p className="text-sm text-muted-foreground">
            Send{" "}
            <span className="font-medium text-foreground">{active.length}</span>{" "}
            {active.length === 1 ? "opportunity" : "opportunities"} to one contact
          </p>
          <div className="flex items-center gap-2">
            <SendDealModal
              agents={agents}
              meId={meId}
              companies={companies}
              contacts={contacts}
              companyTypes={companyTypes}
              requirementId={requirementId}
              requirementTitle={requirementTitle}
              listings={selectedRows.map((o) => ({ id: o.id, title: o.title }))}
              previousSends={previousSends.length > 0 ? previousSends : undefined}
              label={`Send ${active.length}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {opportunities.map((o) => {
          const ms = matchScoreBadge(o.score);
          const t = listingTypeBadge(o.listingType);
          const isSelected = selected.has(o.id);
          return (
            <li
              key={o.id}
              className={cn(
                "rounded-md border p-3 transition-colors duration-150",
                isSelected ? "border-primary/40 bg-primary/5" : undefined,
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${o.title}`}
                    checked={isSelected}
                    onChange={() => toggle(o.id)}
                    className="mr-1 h-4 w-4 cursor-pointer rounded border-input accent-primary"
                  />
                  <Link
                    href={`/listings/${o.id}`}
                    className="font-medium text-foreground hover:text-info hover:underline"
                  >
                    {o.title}
                    {o.city ? ` · ${o.city}` : ""}
                  </Link>
                  <Badge tone={t.tone}>{t.label}</Badge>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {o.previousSends ? (
                    <Badge tone="violet">
                      Sent{o.previousSends.length > 1 ? ` ×${o.previousSends.length}` : ""}
                      {" · "}
                      {new Date(o.previousSends[0].at).toLocaleDateString("en-GB")}
                    </Badge>
                  ) : null}
                  <Badge tone={ms.tone}>{ms.label}</Badge>
                  <SendDealModal
                    agents={agents}
                    meId={meId}
                    companies={companies}
                    contacts={contacts}
                    companyTypes={companyTypes}
                    requirementId={requirementId}
                    listingId={o.id}
                    requirementTitle={requirementTitle}
                    listingTitle={o.title}
                    previousSends={o.previousSends}
                  />
                  <CreateDealButton requirementId={requirementId} listingId={o.id} />
                </div>
              </div>
              <div className="mt-2">
                <MatchReasons reasons={o.reasons} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
