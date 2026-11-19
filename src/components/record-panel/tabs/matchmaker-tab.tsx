import { EmptyNote, PanelLink, PanelSection } from "@/components/record-panel/fields";
import { Badge } from "@/components/ui/badge";
import { listingTypeBadge, matchScoreBadge } from "@/lib/badges";
import { listDisposalsForMatching } from "@/lib/db/queries/disposals";
import { listActiveRequirementsForEntity } from "@/lib/db/queries/entity-matching";
import { listMatchStatusesForRequirements } from "@/lib/db/queries/matches";
import {
  groupTopMatches,
  MAX_REQUIREMENTS,
  MIN_MATCH_SCORE,
  TOP_PER_REQUIREMENT,
} from "@/lib/matching/entity-matches";
import { DEFAULT_LOCATION_FLEX } from "@/lib/matching/score";
import { openRecordHref, type SearchParamsLike } from "@/lib/record-ref";

import type { RecordTabProps } from "./placeholder";

const gbp = (v: number | null) => (v != null ? `£${v.toLocaleString("en-GB")}` : null);

/**
 * Matchmaker tab for a company or a contact: for each of its active
 * requirements, the best live listings scoring 50 or more, CDG and Market Intel
 * alike. Read only. The deal, send and shortlist actions stay on the
 * requirement's own Matchmaker tab, one click away.
 *
 * Listings and match decisions are loaded once for the whole tab, not once per
 * requirement.
 */
export async function MatchmakerTab({
  entityType,
  entityId,
  agencyId,
  base,
}: RecordTabProps & { base: SearchParamsLike }) {
  if (entityType !== "company" && entityType !== "contact") return null;

  const { rows: requirements, total } = await listActiveRequirementsForEntity(
    agencyId,
    entityType,
    entityId,
    MAX_REQUIREMENTS,
  );

  if (requirements.length === 0) {
    return (
      <PanelSection title="Matchmaker">
        <EmptyNote>No active requirements.</EmptyNote>
      </PanelSection>
    );
  }

  const [listings, decisions] = await Promise.all([
    listDisposalsForMatching(agencyId),
    listMatchStatusesForRequirements(
      agencyId,
      requirements.map((r) => r.id),
    ),
  ]);
  const statusByPair = new Map(
    decisions.map((m) => [`${m.requirement_id}:${m.listing_id}`, m.status as string]),
  );
  const groups = groupTopMatches(requirements, listings, {
    locationFlex: DEFAULT_LOCATION_FLEX,
    statusByPair,
  });
  const anyMatch = groups.some((g) => g.top.length > 0);

  return (
    <PanelSection title="Matchmaker">
      <p className="text-sm text-muted-foreground">
        Live listings scoring {MIN_MATCH_SCORE}% or more against each active requirement. Top{" "}
        {TOP_PER_REQUIREMENT} per requirement.
      </p>
      {total > MAX_REQUIREMENTS ? (
        <p className="text-sm text-muted-foreground">
          This record has {total} active requirements. Showing the {MAX_REQUIREMENTS} most
          recently updated.
        </p>
      ) : null}
      {!anyMatch ? <EmptyNote>No matches at {MIN_MATCH_SCORE} or more.</EmptyNote> : null}
      <div className="space-y-4">
        {groups.map(({ requirement, top, further }) => {
          const reqRef = { type: "requirement", id: requirement.id } as const;
          const matchmakerHref = openRecordHref(base, reqRef, "matchmaker");
          return (
            <div key={requirement.id} className="space-y-2">
              <h4 className="text-sm">
                <PanelLink href={matchmakerHref}>{requirement.title}</PanelLink>
              </h4>
              {top.length === 0 ? (
                <EmptyNote>No matches at {MIN_MATCH_SCORE} or more.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {top.map(({ listing: d, score, shortlisted }) => {
                    const ms = matchScoreBadge(score);
                    const t = listingTypeBadge(d.listing_type);
                    const rent = gbp(d.rent_pa);
                    const details = [
                      d.area ?? d.city,
                      d.size_sqft != null
                        ? `${Number(d.size_sqft).toLocaleString("en-GB")} sq ft`
                        : null,
                      rent ? `${rent} pa` : null,
                    ].filter(Boolean);
                    return (
                      <li key={d.id} className="rounded-md border p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
                            <PanelLink href={openRecordHref(base, { type: "listing", id: d.id })}>
                              {d.title ?? "Untitled listing"}
                            </PanelLink>
                            <Badge tone={t.tone}>{t.label}</Badge>
                          </span>
                          <span className="flex items-center gap-1.5">
                            {shortlisted ? <Badge tone="sky">Shortlisted</Badge> : null}
                            <Badge tone={ms.tone}>{ms.label}</Badge>
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {details.length > 0 ? details.join(" · ") : "No size or rent listed"}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {further > 0 ? (
                <p className="text-xs text-muted-foreground">
                  <PanelLink href={matchmakerHref} className="text-info">
                    {further} further {further === 1 ? "match" : "matches"}
                  </PanelLink>{" "}
                  on this requirement
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </PanelSection>
  );
}
