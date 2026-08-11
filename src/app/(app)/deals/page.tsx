import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Handshake,
  Layers,
  PoundSterling,
} from "lucide-react";

import { EditableDealTitle } from "@/components/editable-deal-title";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatsBar } from "@/components/stats-bar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DealStageSelect } from "@/components/deal-stage-select";
import { NewDealButton } from "@/components/new-deal-button";
import { dealStageBadge } from "@/lib/badges";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { listDealAgentRows, listDealsForBoard, listLatestStageEventPerDeal } from "@/lib/db/queries/deals";
import { getUserNames } from "@/lib/db/queries/disposals";
import { daysSince, isPast } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pipeline" };

const STAGE_ORDER = [
  "lead",
  "viewing",
  "offer",
  "heads_of_terms",
  "legal",
  "completed",
  "fell_through",
] as const;

const CLOSED = new Set<string>(["completed", "fell_through"]);
const STUCK_AFTER_DAYS = 14;

const money = (v: number | null) =>
  v != null ? `£${v.toLocaleString("en-GB")}` : null;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) redirect("/login");

  const { agent } = await searchParams;

  const allDeals = await listDealsForBoard(agencyId);

  // Additional-agent collaborators (deal_agents) — the agent filter matches a
  // deal when the agent created it, leads it, OR collaborates on it.
  const dealAgentRows = await listDealAgentRows(agencyId);
  const collaboratorsByDeal = new Map<string, Set<string>>();
  for (const r of dealAgentRows) {
    const set = collaboratorsByDeal.get(r.deal_id) ?? new Set<string>();
    set.add(r.user_id);
    collaboratorsByDeal.set(r.deal_id, set);
  }

  const agentIds = [
    ...new Set([
      ...allDeals.map((d) => d.created_by),
      ...allDeals.map((d) => d.lead_agent_id),
      ...dealAgentRows.map((r) => r.user_id),
    ]),
  ].filter((v): v is string => Boolean(v));
  const agentName = agentIds.length ? await getUserNames(agentIds) : new Map<string, string>();

  if (allDeals.length === 0) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Pipeline"
          description="Listings + requirements + parties, through the pipeline to Heads of Terms."
        />
        <EmptyState
          icon={Handshake}
          title="No deals yet"
          description="Open a match on the MatchMaker page (or a requirement/listing) and click “Create deal” to start the pipeline."
        />
      </div>
    );
  }

  const agentOptions = agentIds
    .map((id) => ({ value: id, label: agentName.get(id) ?? "Agent" }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const deals = agent
    ? allDeals.filter(
        (d) =>
          d.created_by === agent ||
          d.lead_agent_id === agent ||
          collaboratorsByDeal.get(d.id)?.has(agent),
      )
    : allDeals;

  // Latest stage event per deal → "in stage Xd" + Stuck badges. Falls back to
  // updated_at for deals created before stage history existed.
  const stageEvents = await listLatestStageEventPerDeal(agencyId);
  const stageSince = new Map(stageEvents.map((e) => [e.deal_id, e.created_at]));
  const daysInStage = (d: (typeof deals)[number]) =>
    daysSince(stageSince.get(d.id) ?? d.updated_at);

  // Key pipeline stats (respect the agent filter).
  const openDeals = deals.filter((d) => !CLOSED.has(d.stage));
  const pipelineValue = openDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const wonCount = deals.filter((d) => d.stage === "completed").length;
  const stats = [
    { label: "Total deals", value: deals.length, icon: Handshake },
    { label: "Open", value: openDeals.length, icon: Layers },
    {
      label: "Pipeline value",
      value: money(pipelineValue) ?? "£0",
      icon: PoundSterling,
      hint: "open deals",
    },
    { label: "Won", value: wonCount, icon: CheckCircle2 },
  ];

  const byStage = new Map<string, typeof deals>();
  for (const s of STAGE_ORDER) byStage.set(s, []);
  for (const d of deals) (byStage.get(d.stage) ?? byStage.set(d.stage, []).get(d.stage)!).push(d);

  return (
    <div className="mx-auto max-w-[100rem]">
      <PageHeader
        title="Pipeline"
        description={`${deals.length} deal${deals.length === 1 ? "" : "s"} across the pipeline — move a card with its stage selector.`}
        action={<NewDealButton />}
      />

      {agentOptions.length > 0 ? (
        <form className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Agent
            <select
              name="agent"
              defaultValue={agent ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All agents</option>
              {agentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            Apply
          </button>
          {agent ? (
            <Link
              href="/deals"
              className="self-center text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </Link>
          ) : null}
        </form>
      ) : null}

      <StatsBar stats={stats} className="mb-6" />

      {deals.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          No deals for this agent.
        </p>
      ) : (
        <div className="space-y-6">
          {STAGE_ORDER.map((stage) => {
            const col = byStage.get(stage) ?? [];
            if (col.length === 0) return null;
            const sb = dealStageBadge(stage);
            return (
              <section key={stage} aria-label={`${sb.label} stage`}>
                <div className="mb-2.5 flex items-center gap-2">
                  <Badge tone={sb.tone}>{sb.label}</Badge>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {col.length}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {col.map((d) => {
                    const days = daysInStage(d);
                    const stuck = !CLOSED.has(d.stage) && days > STUCK_AFTER_DAYS;
                    // Red once the whole expected-close day has passed (date-only column).
                    const closePast =
                      d.expected_close != null &&
                      !CLOSED.has(d.stage) &&
                      isPast(`${d.expected_close}T23:59:59`);
                    return (
                      <article
                        key={d.id}
                        className="flex flex-col rounded-lg border bg-card p-3 transition-colors hover:border-primary/40"
                      >
                        <EditableDealTitle
                          dealId={d.id}
                          title={d.title}
                          href={`/deals/${d.id}`}
                          className="text-sm font-medium leading-snug text-foreground hover:text-info hover:underline"
                        />
                        <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {d.company_name ? (
                            <div className="truncate">{d.company_name}</div>
                          ) : null}
                          {money(d.value) ? (
                            <div className="font-mono tabular-nums text-foreground">
                              {money(d.value)}
                            </div>
                          ) : null}
                        </dl>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            in stage {days}d
                          </span>
                          {stuck ? <Badge tone="amber">Stuck</Badge> : null}
                          {d.expected_close ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-[11px]",
                                closePast
                                  ? "font-medium text-red-600 dark:text-red-400"
                                  : "text-muted-foreground",
                              )}
                              title="Expected close"
                            >
                              <CalendarClock className="h-3 w-3" />
                              {new Date(d.expected_close).toLocaleDateString("en-GB")}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] text-muted-foreground">
                            {new Date(d.created_at).toLocaleDateString("en-GB")}
                            {(() => {
                              const owner = d.lead_agent_id ?? d.created_by;
                              return owner && agentName.get(owner)
                                ? ` · ${agentName.get(owner)}`
                                : "";
                            })()}
                          </span>
                          <Link
                            href={`/deals/${d.id}`}
                            className={cn(
                              buttonVariants({ variant: "secondary", size: "sm" }),
                              "h-7 shrink-0 px-2 text-xs",
                            )}
                          >
                            View deal
                          </Link>
                        </div>
                        <div className="mt-2.5">
                          <DealStageSelect
                            id={d.id}
                            stage={d.stage}
                            className="h-8 text-xs"
                            aria-label={`Move “${d.title}” to another stage`}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
