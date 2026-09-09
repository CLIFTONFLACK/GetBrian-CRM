import type * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Gauge, RotateCcw, Sparkles, Star, Store, Target, X } from "lucide-react";

import { CreateDealButton } from "@/components/create-deal-button";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { MatchReasons } from "@/components/match-reasons";
import { PageHeader } from "@/components/page-header";
import { SendDealModal } from "@/components/send-deal-modal";
import { SiloTabs } from "@/components/silo-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LocationFlexSlider } from "@/components/location-flex-slider";
import { setMatchStatus } from "@/lib/actions/matches";
import { isListingMatchable, listingTypeBadge, matchScoreBadge } from "@/lib/badges";
import { USE_CLASS_OPTIONS } from "@/lib/use-classes";
import type { Database } from "@/lib/database.types";
import { byMatchQuality, DEFAULT_LOCATION_FLEX, scoreMatch } from "@/lib/matching/score";
import { getCompanyTypes } from "@/lib/company-types";
import { getPairSendHistory } from "@/lib/send-history";
import { filterHref } from "@/lib/sort";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import {
  getDefaultSendContactsForRequirements,
  listContactOptions,
} from "@/lib/db/queries/contacts";
import { listDealPairs } from "@/lib/db/queries/deals";
import { listDisposalsForMatching } from "@/lib/db/queries/disposals";
import { listMatches } from "@/lib/db/queries/matches";
import { listActiveRequirementsForMatching } from "@/lib/db/queries/requirements";
import { cn } from "@/lib/utils";

type MatchStatus = Database["public"]["Enums"]["match_status"];

export const metadata: Metadata = { title: "MatchMaker Opportunities" };

// Score-tier accent (left border + chip fill), keyed off the same tones
// matchScoreBadge already uses — no new colours, just a bolder application.
const SCORE_ACCENT: Record<string, { border: string; chip: string }> = {
  emerald: {
    border: "border-l-emerald-500 dark:border-l-emerald-600",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  teal: {
    border: "border-l-teal-500 dark:border-l-teal-600",
    chip: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  },
  amber: {
    border: "border-l-amber-500 dark:border-l-amber-600",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  slate: {
    border: "border-l-slate-300 dark:border-l-slate-700",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400",
  },
};

/** The filter list is the picker list — the planning-class slugs it retired
 *  (Class E, A3–A5) were migrated away in 0034, so filtering on them would only
 *  ever return nothing. */
const USE_CLASS_FILTERS = USE_CLASS_OPTIONS.map(([value, label]) => ({ value, label }));

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    min?: string;
    use_class?: string;
    flex?: string;
    silo?: string;
    rejected?: string;
    shortlisted?: string;
  }>;
}) {
  const { q, min, use_class, flex, silo, rejected, shortlisted } = await searchParams;
  const showRejected = rejected === "1";
  const shortlistedOnly = shortlisted === "1";
  const minScore = Math.min(95, Math.max(0, Number(min ?? "50") || 50));
  const flexParsed = Number(flex ?? DEFAULT_LOCATION_FLEX);
  const locationFlex = Math.min(
    100,
    Math.max(0, Number.isFinite(flexParsed) ? flexParsed : DEFAULT_LOCATION_FLEX),
  );

  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const agencyId = await currentAgencyId(user.id);

  const [requirements, disposals] = agencyId
    ? await Promise.all([
        listActiveRequirementsForMatching(agencyId),
        listDisposalsForMatching(agencyId),
      ])
    : [[], []];
  // Only pitch live stock — never surface let/sold/withdrawn listings as matches.
  // The silo tabs split CDG's own instructions from scraped Market Intel stock;
  // `matchable` (unscoped) powers the tab counts, `supply` is what's shown.
  const matchable = disposals.filter((d) => isListingMatchable(d.status));
  const supply = matchable.filter((d) => !silo || (d.listing_type ?? "cdg") === silo);
  const siloCounts = {
    all: matchable.length,
    cdg: matchable.filter((d) => (d.listing_type ?? "cdg") === "cdg").length,
    intel: matchable.filter((d) => d.listing_type === "intel").length,
  };

  const [members, companies, contacts, companyTypes] = await Promise.all([
    agencyId ? getAgencyMembers(agencyId) : Promise.resolve([]),
    agencyId ? listCompanyOptions(agencyId) : Promise.resolve([]),
    agencyId ? listContactOptions(agencyId) : Promise.resolve([]),
    getCompanyTypes(),
  ]);
  const operatorName = new Map(companies.map((c) => [c.id, c.name]));

  // Persisted decisions. Scores stay live (cheap and always current); the
  // `matches` table only carries what a human decided about a pair. A pair that
  // already has a deal counts as converted whether or not its row says so —
  // deal creation lives in another action that doesn't write here.
  const [matchRows, dealPairs] = await Promise.all([
    agencyId ? listMatches(agencyId) : Promise.resolve([]),
    agencyId ? listDealPairs(agencyId) : Promise.resolve([]),
  ]);
  const statusByPair = new Map<string, MatchStatus>(
    matchRows.map((m) => [`${m.requirement_id}:${m.listing_id}`, m.status]),
  );
  const convertedPairs = new Set(
    dealPairs.map((d) => `${d.requirement_id}:${d.listing_id}`),
  );

  const term = (q ?? "").trim().toLowerCase();
  let pairs = requirements
    .flatMap((rq) => supply.map((d) => ({ rq, d, ...scoreMatch(rq, d, { locationFlex }) })))
    .filter((p) => p.score >= minScore);
  if (term) {
    pairs = pairs.filter(
      (p) =>
        (p.d.city ?? "").toLowerCase().includes(term) ||
        (p.d.title ?? "").toLowerCase().includes(term) ||
        p.rq.title.toLowerCase().includes(term) ||
        p.rq.target_towns.some((t) => t.toLowerCase().includes(term)),
    );
  }
  if (use_class) {
    pairs = pairs.filter((p) => p.rq.use_classes.includes(use_class as never));
  }

  // Decisions applied last, so the toggle counts describe the current filters.
  const statusOf = (p: { rq: { id: string }; d: { id: string } }) =>
    statusByPair.get(`${p.rq.id}:${p.d.id}`);
  const rejectedCount = pairs.filter((p) => statusOf(p) === "rejected").length;
  const shortlistedCount = pairs.filter((p) => statusOf(p) === "shortlisted").length;
  pairs = pairs.filter((p) => {
    const status = statusOf(p);
    if (shortlistedOnly) return status === "shortlisted";
    return status !== "rejected" || showRejected;
  });
  // Shortlisted pairs float to the top; everything else by match quality.
  // The board shows the first 50, so tie order decides what is on screen.
  const byQuality = byMatchQuality<(typeof pairs)[number]>((p) => `${p.rq.id}:${p.d.id}`);
  pairs.sort((a, b) => {
    const rank = (p: typeof a) => (statusOf(p) === "shortlisted" ? 1 : 0);
    return rank(b) - rank(a) || byQuality(a, b);
  });

  const avgScore = pairs.length
    ? Math.round(pairs.reduce((s, p) => s + p.score, 0) / pairs.length)
    : 0;
  const shown = pairs.slice(0, 50);

  // Prior external sends — powers the "Sent" chip and the wizard's double-send
  // warning. Looked up for exactly the pairs on screen, so the counts stay
  // correct however much send history the agency accumulates.
  const sentByPair = agencyId
    ? await getPairSendHistory(
        agencyId,
        shown.map((p) => ({ requirementId: p.rq.id, listingId: p.d.id })),
      )
    : new Map<string, { name: string; at: string }[]>();
  // Who the Send Deal wizard pre-ticks per requirement on screen (its contact,
  // else its company's primary contact).
  const defaultContacts = agencyId
    ? await getDefaultSendContactsForRequirements(agencyId, [...new Set(shown.map((p) => p.rq.id))])
    : new Map<string, string>();

  const params = { q, min, use_class, flex, silo, rejected, shortlisted };

  const stats = [
    { label: "Active requirements", value: requirements.length, icon: Target },
    { label: "Live listings", value: supply.length, icon: Store },
    { label: "Opportunities", value: pairs.length, icon: Sparkles },
    { label: "Avg score", value: `${avgScore}%`, icon: Gauge },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="MatchMaker Opportunities"
        description={`Active requirement ↔ listing pairs scoring ${minScore}%+ across your agency.`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="flex items-center justify-between p-4 sm:p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                    {stat.value}
                  </p>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SiloTabs
        value={silo}
        counts={siloCounts}
        hrefFor={(v) => filterHref(params, { silo: v })}
      />

      <FilterBar
        q={q}
        placeholder="Filter by town or name…"
        basePath="/matches"
        hasActiveFilters={
          Boolean(use_class) ||
          Boolean(silo) ||
          (min != null && min !== "50") ||
          locationFlex !== DEFAULT_LOCATION_FLEX
        }
      >
        <LocationFlexSlider defaultValue={locationFlex} />
        <FilterSelect
          name="min"
          label="Min score"
          value={min}
          options={[
            { value: "50", label: "50%+" },
            { value: "60", label: "60%+" },
            { value: "70", label: "70%+" },
            { value: "80", label: "80%+" },
          ]}
        />
        <FilterSelect
          name="use_class"
          label="Use class"
          value={use_class}
          options={USE_CLASS_FILTERS}
        />
      </FilterBar>

      {/* Decision filters. Rejected pairs are hidden by default — dismissing a
          bad suggestion has to stick, or the list never gets quieter. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <ToggleLink
          href={filterHref(params, {
            shortlisted: shortlistedOnly ? null : "1",
            rejected: null,
          })}
          active={shortlistedOnly}
        >
          <Star className="h-3.5 w-3.5" />
          Shortlisted{shortlistedCount > 0 ? ` (${shortlistedCount})` : ""}
        </ToggleLink>
        <ToggleLink
          href={filterHref(params, {
            rejected: showRejected ? null : "1",
            shortlisted: null,
          })}
          active={showRejected}
        >
          <X className="h-3.5 w-3.5" />
          {showRejected ? "Hide rejected" : "Show rejected"}
          {rejectedCount > 0 && !showRejected ? ` (${rejectedCount})` : ""}
        </ToggleLink>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No strong opportunities yet"
          description="Adjust the filters above, or add active requirements and listings — pairs surface here automatically."
        />
      ) : (
        <div className="space-y-3">
          {shown.map(({ rq, d, score, reasons }) => {
            const ms = matchScoreBadge(score);
            const accent = SCORE_ACCENT[ms.tone] ?? SCORE_ACCENT.slate;
            const pairKey = `${rq.id}:${d.id}`;
            const previousSends = sentByPair.get(pairKey);
            const defaultContact = defaultContacts.get(rq.id);
            const converted = convertedPairs.has(pairKey);
            const status = statusByPair.get(pairKey);
            return (
              <Card
                key={`${rq.id}-${d.id}`}
                className={cn(
                  "overflow-hidden border-l-4",
                  accent.border,
                  status === "rejected" && "opacity-60",
                )}
              >
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:p-4">
                  <div
                    className={cn(
                      "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg",
                      accent.chip,
                    )}
                  >
                    <span className="font-mono text-lg font-bold leading-none tabular-nums">
                      {score}%
                    </span>
                    <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide opacity-80">
                      match
                    </span>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1 text-sm">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <Link
                            href={`/requirements/${rq.id}`}
                            className="font-medium text-foreground hover:text-info hover:underline"
                          >
                            {rq.title}
                          </Link>
                          {rq.company_id && operatorName.has(rq.company_id) ? (
                            <span className="text-xs text-muted-foreground">
                              <span className="font-medium uppercase tracking-wide">
                                Operator
                              </span>{" "}
                              <Link
                                href={`/companies/${rq.company_id}`}
                                className="hover:text-info hover:underline"
                              >
                                {operatorName.get(rq.company_id)}
                              </Link>
                            </span>
                          ) : null}
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5">
                          <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <Link
                            href={`/listings/${d.id}`}
                            className="font-medium text-foreground hover:text-info hover:underline"
                          >
                            {d.title ?? "Untitled listing"}
                            {d.city ? ` · ${d.city}` : ""}
                          </Link>
                          {(() => {
                            const t = listingTypeBadge(d.listing_type);
                            return <Badge tone={t.tone}>{t.label}</Badge>;
                          })()}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {converted ? (
                          <Badge tone="emerald">Deal created</Badge>
                        ) : status === "shortlisted" ? (
                          <>
                            <Badge tone="sky">Shortlisted</Badge>
                            <MatchStatusButton
                              requirementId={rq.id}
                              listingId={d.id}
                              score={score}
                              intent="reopen"
                            >
                              <RotateCcw />
                              Unshortlist
                            </MatchStatusButton>
                          </>
                        ) : status === "rejected" ? (
                          <>
                            <Badge tone="slate">Rejected</Badge>
                            <MatchStatusButton
                              requirementId={rq.id}
                              listingId={d.id}
                              score={score}
                              intent="reopen"
                            >
                              <RotateCcw />
                              Reopen
                            </MatchStatusButton>
                          </>
                        ) : (
                          <>
                            <MatchStatusButton
                              requirementId={rq.id}
                              listingId={d.id}
                              score={score}
                              intent="shortlist"
                            >
                              <Star />
                              Shortlist
                            </MatchStatusButton>
                            <MatchStatusButton
                              requirementId={rq.id}
                              listingId={d.id}
                              score={score}
                              intent="reject"
                            >
                              <X />
                              Reject
                            </MatchStatusButton>
                          </>
                        )}
                        {previousSends ? (
                          <Badge
                            tone="violet"
                            title={`Sent to ${previousSends[0].name} on ${new Date(previousSends[0].at).toLocaleDateString("en-GB")}`}
                          >
                            Sent{previousSends.length > 1 ? ` ×${previousSends.length}` : ""}
                            {" · "}
                            {new Date(previousSends[0].at).toLocaleDateString("en-GB")}
                          </Badge>
                        ) : null}
                        <SendDealModal
                          agents={members}
                          meId={user?.id}
                          companies={companies}
                          contacts={contacts}
                          companyTypes={companyTypes}
                          requirementId={rq.id}
                          listingId={d.id}
                          requirementTitle={rq.title}
                          listingTitle={d.title ?? "Untitled listing"}
                          previousSends={previousSends}
                          defaultContactIds={defaultContact ? [defaultContact] : undefined}
                        />
                        <CreateDealButton requirementId={rq.id} listingId={d.id} />
                      </div>
                    </div>
                    <div className="border-t pt-2">
                      <MatchReasons reasons={reasons} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A filter pill that reads as pressed when its param is on. */
function ToggleLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Shortlist / reject / reopen one pairing. A plain server-action form — the
 * persisted row is created on first click (the pair may until then exist only
 * as a live score), which is why the current score rides along.
 */
function MatchStatusButton({
  requirementId,
  listingId,
  score,
  intent,
  children,
}: {
  requirementId: string;
  listingId: string;
  score: number;
  intent: "shortlist" | "reject" | "reopen";
  children: React.ReactNode;
}) {
  return (
    <form action={setMatchStatus}>
      <input type="hidden" name="requirement_id" value={requirementId} />
      <input type="hidden" name="listing_id" value={listingId} />
      <input type="hidden" name="score" value={score} />
      <input type="hidden" name="intent" value={intent} />
      <Button type="submit" variant="ghost" size="sm">
        {children}
      </Button>
    </form>
  );
}
