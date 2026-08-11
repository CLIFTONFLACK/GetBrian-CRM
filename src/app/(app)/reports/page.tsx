import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  CheckCircle2,
  Handshake,
  Hourglass,
  PoundSterling,
  Target,
  TrendingUp,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Heatmap } from "@/components/heatmap";
import { PageHeader } from "@/components/page-header";
import { StatsBar } from "@/components/stats-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dealStageBadge, isListingMatchable } from "@/lib/badges";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers, getMemberRole } from "@/lib/db/queries/agencies";
import {
  listDealsForReports,
  listStageEventsForReports,
  type DealReportRow,
} from "@/lib/db/queries/deals";
import { listRequirementsForReports } from "@/lib/db/queries/requirements";
import { listDisposalsForReports } from "@/lib/db/queries/disposals";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

const STAGE_ORDER = [
  "lead",
  "viewing",
  "offer",
  "heads_of_terms",
  "legal",
  "completed",
  "fell_through",
] as const;

const OPEN_STAGES = STAGE_ORDER.filter(
  (s) => s !== "completed" && s !== "fell_through",
);

const CLOSED = new Set<string>(["completed", "fell_through"]);
const DAY_MS = 86_400_000;
/** A deal that hasn't changed stage in this long is flagged as stalled. */
const STUCK_AFTER_DAYS = 14;
/** An active requirement this old with no deal attached is flagged as cold. */
const COLD_REQUIREMENT_DAYS = 30;

const money = (v: number) => `£${Math.round(v).toLocaleString("en-GB")}`;
const days = (fromIso: string, to = Date.now()) =>
  Math.max(0, Math.floor((to - new Date(fromIso).getTime()) / DAY_MS));

function NotAllowed() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Reports"
        description="Team performance and pipeline health."
      />
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Reports are available to agency admins and managers. Ask an admin to
          change your role if you need access.
        </CardContent>
      </Card>
    </div>
  );
}

export default async function ReportsPage() {
  if (!isDbConfigured) return <NotAllowed />;
  const session = await auth();
  const user = session?.user ?? null;
  const agencyId = user ? await currentAgencyId(user.id) : null;

  // Role gate — scope to the caller's OWN membership row (no RLS backstop on
  // this schema, see AGENTS.md — an unscoped role check would leak the page
  // to anyone whose agency merely HAS an admin/manager).
  let elevated = false;
  if (user && agencyId) {
    const role = await getMemberRole(agencyId, user.id);
    elevated = role === "admin" || role === "manager";
  }
  if (!user || !agencyId || !elevated) return <NotAllowed />;

  const [deals, stageEvents, requirements, listings, members] = await Promise.all([
    listDealsForReports(agencyId),
    // Empty until deals start moving — every derived figure falls back to
    // "—" rather than lying.
    listStageEventsForReports(agencyId),
    listRequirementsForReports(agencyId),
    listDisposalsForReports(agencyId),
    getAgencyMembers(agencyId),
  ]);

  const openDeals = deals.filter((d) => !CLOSED.has(d.stage));
  const wonDeals = deals.filter((d) => d.stage === "completed");
  const lostDeals = deals.filter((d) => d.stage === "fell_through");
  const pipelineValue = openDeals.reduce((s, d) => s + (d.value ?? 0), 0);
  const wonValue = wonDeals.reduce((s, d) => s + (d.value ?? 0), 0);
  const decided = wonDeals.length + lostDeals.length;
  const winRate = decided ? Math.round((wonDeals.length / decided) * 100) : null;

  const headline = [
    { label: "Open deals", value: openDeals.length, icon: Handshake, href: "/deals" },
    {
      label: "Pipeline value",
      value: money(pipelineValue),
      icon: PoundSterling,
      hint: "open deals only",
      href: "/deals",
    },
    {
      label: "Won",
      value: wonDeals.length,
      icon: CheckCircle2,
      hint: wonDeals.length ? money(wonValue) : "nothing completed yet",
      href: "/deals",
    },
    {
      label: "Win rate",
      value: winRate == null ? "—" : `${winRate}%`,
      icon: TrendingUp,
      hint: decided ? `${wonDeals.length} of ${decided} decided` : "no closed deals yet",
    },
  ];

  // ── Funnel: count + value by stage ─────────────────────────────
  const funnel = STAGE_ORDER.map((stage) => {
    const rows = deals.filter((d) => d.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((s, d) => s + (d.value ?? 0), 0),
    };
  });
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));

  // ── Average time in stage, from deal_stage_events ──────────────
  // Events are ordered oldest-first: consecutive events on the same deal bound
  // one completed spell in `to_stage`. Deals sitting in their current stage are
  // not counted (the spell hasn't finished), so the number is a true average of
  // observed transitions. No events -> every stage reads "—".
  const eventsByDeal = new Map<string, { to: string; at: string }[]>();
  for (const e of stageEvents) {
    const list = eventsByDeal.get(e.deal_id) ?? [];
    list.push({ to: e.to_stage as string, at: e.created_at });
    eventsByDeal.set(e.deal_id, list);
  }
  const stageDurations = new Map<string, number[]>();
  for (const list of eventsByDeal.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      const spell =
        (new Date(list[i + 1].at).getTime() - new Date(list[i].at).getTime()) /
        DAY_MS;
      if (spell < 0) continue;
      const arr = stageDurations.get(list[i].to) ?? [];
      arr.push(spell);
      stageDurations.set(list[i].to, arr);
    }
  }
  const avgDaysInStage = (stage: string): string => {
    const arr = stageDurations.get(stage);
    if (!arr || arr.length === 0) return "—";
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return `${avg < 1 ? avg.toFixed(1) : Math.round(avg)}d`;
  };
  const hasStageHistory = stageDurations.size > 0;

  // ── Per-agent performance ──────────────────────────────────────
  // A deal belongs to its lead agent; unassigned deals fall back to the creator
  // so nothing silently disappears from the team totals.
  const ownerOf = (d: DealReportRow) => d.lead_agent_id ?? d.created_by ?? null;
  const perAgent = members.map((m) => {
    const mine = deals.filter((d) => ownerOf(d) === m.id);
    const open = mine.filter((d) => !CLOSED.has(d.stage));
    return {
      id: m.id,
      name: m.name,
      open: open.length,
      openValue: open.reduce((s, d) => s + (d.value ?? 0), 0),
      won: mine.filter((d) => d.stage === "completed").length,
      listings: listings.filter(
        (l) => l.lead_agent_id === m.id && isListingMatchable(l.status),
      ).length,
      requirements: requirements.filter(
        (r) => r.lead_agent_id === m.id && r.status === "active",
      ).length,
    };
  });
  const ranked = [...perAgent].sort(
    (a, b) => b.open - a.open || b.won - a.won || a.name.localeCompare(b.name),
  );

  // Agents × open stages, as a workload heatmap.
  const heatAgents = ranked.filter(
    (a) => a.open + a.won + a.listings + a.requirements > 0,
  );
  const heatMatrix = heatAgents.map((a) =>
    OPEN_STAGES.map(
      (stage) =>
        deals.filter((d) => ownerOf(d) === a.id && d.stage === stage).length,
    ),
  );

  // ── Aging ──────────────────────────────────────────────────────
  // Last stage move per deal; pre-history deals fall back to updated_at (same
  // convention as the pipeline board).
  const lastMove = new Map<string, string>();
  for (const [dealId, list] of eventsByDeal) {
    lastMove.set(dealId, list[list.length - 1].at);
  }
  const stalled = openDeals
    .map((d) => ({ deal: d, idle: days(lastMove.get(d.id) ?? d.updated_at) }))
    .filter((x) => x.idle > STUCK_AFTER_DAYS)
    .sort((a, b) => b.idle - a.idle)
    .slice(0, 15);

  const requirementIdsWithDeal = new Set(
    deals.map((d) => d.requirement_id).filter((v): v is string => !!v),
  );
  const coldRequirements = requirements
    .filter(
      (r) =>
        r.status === "active" &&
        !requirementIdsWithDeal.has(r.id) &&
        days(r.created_at) > COLD_REQUIREMENT_DAYS,
    )
    .map((r) => ({ req: r, age: days(r.created_at) }))
    .sort((a, b) => b.age - a.age)
    .slice(0, 15);

  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Reports"
        description="Pipeline health, team performance and what's going stale — admin & manager view."
      />

      <StatsBar stats={headline} className="mb-6" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Funnel ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Pipeline funnel
            </CardTitle>
            <CardDescription>
              Deal count and value by stage, with average time spent in each.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deals.length === 0 ? (
              <EmptyState
                icon={Handshake}
                title="No deals yet"
                description="Create a deal from a match and the funnel fills in."
              />
            ) : (
              <>
                <ul className="space-y-2.5">
                  {funnel.map((f) => {
                    const b = dealStageBadge(f.stage);
                    return (
                      <li key={f.stage}>
                        <div className="flex items-center justify-between gap-3">
                          <Badge tone={b.tone}>{b.label}</Badge>
                          <div className="flex shrink-0 items-baseline gap-3 font-mono text-xs tabular-nums text-muted-foreground">
                            <span className="text-sm font-semibold text-foreground">
                              {f.count}
                            </span>
                            <span>{f.value ? money(f.value) : "—"}</span>
                            <span
                              className="w-10 text-right"
                              title="Average time in stage"
                            >
                              {avgDaysInStage(f.stage)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{
                              width: `${Math.round((f.count / funnelMax) * 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {!hasStageHistory ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Average time in stage shows “—” until deals start moving —
                    it is derived from stage-change history, which only records
                    moves made from now on.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Agent workload heatmap ──────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Handshake className="h-4 w-4 text-muted-foreground" />
              Open deals by agent &amp; stage
            </CardTitle>
            <CardDescription>
              Where each agent&rsquo;s live pipeline is sitting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Heatmap
              rowLabels={heatAgents.map((a) => a.name)}
              colLabels={OPEN_STAGES.map((s) => dealStageBadge(s).label)}
              matrix={heatMatrix}
              compact
              empty="No open deals to chart yet."
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Per-agent performance ─────────────────────────────── */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Per-agent performance
          </CardTitle>
          <CardDescription>
            Deals count against the lead agent (falling back to whoever created
            them); listings and requirements count where the agent is lead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ranked.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title="No team members found"
              description="Invite agents from the Admin page to see per-agent numbers."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 text-left font-medium">Agent</th>
                    <th className="py-2 px-3 text-right font-medium">Open</th>
                    <th className="py-2 px-3 text-right font-medium">Pipeline</th>
                    <th className="py-2 px-3 text-right font-medium">Won</th>
                    <th className="py-2 px-3 text-right font-medium">Listings</th>
                    <th className="py-2 pl-3 text-right font-medium">Requirements</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ranked.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 pr-3 font-medium text-foreground">
                        {a.name}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {a.open}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-foreground">
                        {a.openValue ? money(a.openValue) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {a.won}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-foreground">
                        {a.listings}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-muted-foreground">
                        {a.requirements}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Aging ─────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-muted-foreground" />
              Stalled deals
            </CardTitle>
            <CardDescription>
              Open deals with no stage movement for more than {STUCK_AFTER_DAYS}{" "}
              days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stalled.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing stalled — every open deal has moved in the last{" "}
                {STUCK_AFTER_DAYS} days.
              </p>
            ) : (
              <ul className="divide-y">
                {stalled.map(({ deal, idle }) => {
                  const b = dealStageBadge(deal.stage);
                  const owner = ownerOf(deal);
                  return (
                    <li key={deal.id}>
                      <Link
                        href={`/deals/${deal.id}`}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {deal.title}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {owner ? (nameOf.get(owner) ?? "Unassigned") : "Unassigned"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone={b.tone}>{b.label}</Badge>
                          <span
                            className={cn(
                              "font-mono text-xs tabular-nums",
                              idle > STUCK_AFTER_DAYS * 2
                                ? "font-medium text-destructive"
                                : "text-muted-foreground",
                            )}
                          >
                            {idle}d
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              Cold requirements
            </CardTitle>
            <CardDescription>
              Active briefs older than {COLD_REQUIREMENT_DAYS} days with no deal
              attached.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {coldRequirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every active requirement older than {COLD_REQUIREMENT_DAYS} days
                has a deal against it.
              </p>
            ) : (
              <ul className="divide-y">
                {coldRequirements.map(({ req, age }) => (
                  <li key={req.id}>
                    <Link
                      href={`/requirements/${req.id}`}
                      className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {req.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {req.lead_agent_id
                            ? (nameOf.get(req.lead_agent_id) ?? "Unassigned")
                            : "Unassigned"}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {age}d old
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
