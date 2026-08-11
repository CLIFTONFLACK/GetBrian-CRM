import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity as ActivityIcon,
  AlarmClock,
  Building2,
  CalendarClock,
  CheckCircle2,
  Handshake,
  ListTodo,
  Mail,
  MessageSquare,
  PoundSterling,
  Sparkles,
  Store,
  Target,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { redirect } from "next/navigation";

import { ConcentrationMap } from "@/components/concentration-map-lazy";
import { EmptyState } from "@/components/empty-state";
import { StatsBar } from "@/components/stats-bar";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isListingMatchable } from "@/lib/badges";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyName } from "@/lib/db/queries/agencies";
import { countCompanies } from "@/lib/db/queries/companies";
import { listDisposalStatuses } from "@/lib/db/queries/disposals";
import { countActiveRequirements } from "@/lib/db/queries/requirements";
import { listDealsForReports, listOpenDealReminders } from "@/lib/db/queries/deals";
import { listRecentActivitiesForAgency } from "@/lib/db/queries/dashboard";
import { countOpenAssignedTasks, countOverdueAssignedTasks } from "@/lib/db/queries/tasks";
import { countUnreadMessages } from "@/lib/db/queries/messages";
import { getUserNames } from "@/lib/db/queries/disposals";
import { getMapLayers } from "@/lib/db/queries/map-points";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

// All quick actions share one style (uniform secondary buttons in a grid).
const QUICK_ACTIONS = [
  { href: "/companies/new", label: "Add company", icon: Building2 },
  { href: "/contacts/new", label: "Add contact", icon: UserPlus },
  { href: "/listings/new", label: "Add listing", icon: Store },
  { href: "/requirements/new", label: "Add requirement", icon: Target },
  { href: "/matches", label: "Matchmake now", icon: Sparkles },
];

// Terminal stages — never part of "open" pipeline (mirrors /deals).
const CLOSED_STAGES = new Set<string>(["completed", "fell_through"]);

/** Where an activity's entity link points, per entity_type. */
const ENTITY_PATHS: Record<string, string> = {
  company: "/companies",
  contact: "/contacts",
  listing: "/listings",
  requirement: "/requirements",
  deal: "/deals",
};

const ENTITY_LABELS: Record<string, string> = {
  company: "Company",
  contact: "Contact",
  listing: "Listing",
  requirement: "Requirement",
  deal: "Deal",
};

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  call: MessageSquare,
  email: Mail,
  viewing: Store,
  note: ActivityIcon,
  meeting: CalendarClock,
  task: ListTodo,
};

const fmtMoney = (v: number) => `£${Math.round(v).toLocaleString("en-GB")}`;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function DashboardPage() {
  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const me = session.user.id;
  const nowIso = new Date().toISOString();

  const agencyId = await currentAgencyId(me);

  const [
    companiesCount,
    listingStatusRows,
    activeRequirementsCount,
    allDeals,
    activities,
    myTasksCount,
    overdueTasksCount,
    reminderRows,
    unreadCount,
    mapLayers,
    agencyName,
  ] = agencyId
    ? await Promise.all([
        countCompanies(agencyId),
        // Status is free text (scraped feeds), so "matchable" can't be a SQL
        // filter — pull the column and classify with the same helper the
        // listings UI uses.
        listDisposalStatuses(agencyId),
        countActiveRequirements(agencyId),
        listDealsForReports(agencyId),
        listRecentActivitiesForAgency(agencyId, 10),
        countOpenAssignedTasks(agencyId, me),
        countOverdueAssignedTasks(agencyId, me, nowIso),
        listOpenDealReminders(agencyId, 200),
        countUnreadMessages(agencyId, me),
        getMapLayers(agencyId, { include: ["listing"] }),
        getAgencyName(agencyId),
      ])
    : [0, [], 0, [], [], 0, 0, [], 0, { listings: [], companies: [], contacts: [] }, null];

  const openDeals = allDeals.filter((d) => !CLOSED_STAGES.has(d.stage));
  const wonDeals = allDeals.filter((d) => d.stage === "completed");
  const pipelineValue = openDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const wonValue = wonDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);

  const activeListings = listingStatusRows.filter((l) => isListingMatchable(l.status)).length;

  // Overdue = my open tasks past due + open reminders past due that are mine
  // (set by me, or sitting on a deal I lead). listOpenDealReminders returns
  // every not-done reminder sorted by due_at asc (agencies.ts's convention);
  // the due-date filter is applied here rather than in SQL.
  const myLeadDealIds = new Set(
    allDeals.filter((d) => d.lead_agent_id === me).map((d) => d.id),
  );
  const myOverdueReminders = reminderRows.filter(
    (r) => r.due_at < nowIso && (r.created_by === me || myLeadDealIds.has(r.deal_id)),
  ).length;
  const overdueCount = overdueTasksCount + myOverdueReminders;

  // Actor names for the activity feed (resolved through public.users — the
  // merged profiles+auth.users table, see db/migrations/0001_init.sql).
  const actorIds = [
    ...new Set(activities.map((a) => a.created_by).filter((v): v is string => !!v)),
  ];
  const actorName = actorIds.length ? await getUserNames(actorIds) : new Map<string, string>();

  const kpis: {
    label: string;
    value: string | number;
    hint?: string;
    icon: LucideIcon;
    href: string;
  }[] = [
    { label: "Companies", value: companiesCount, icon: Building2, href: "/companies" },
    {
      label: "Active listings",
      value: activeListings,
      hint: "available or in play",
      icon: Store,
      href: "/listings",
    },
    { label: "Live requirements", value: activeRequirementsCount, icon: Target, href: "/requirements" },
    {
      label: "Open deals",
      value: openDeals.length,
      hint: "excludes completed & fell through",
      icon: Handshake,
      href: "/deals",
    },
    {
      label: "Pipeline value",
      value: fmtMoney(pipelineValue),
      hint: "open deals only",
      icon: PoundSterling,
      href: "/deals",
    },
    {
      label: "Won",
      value: wonDeals.length,
      hint: wonDeals.length ? fmtMoney(wonValue) : "no completed deals yet",
      icon: CheckCircle2,
      href: "/deals",
    },
  ];

  const myWork = [
    {
      label: "My open tasks",
      value: myTasksCount,
      icon: ListTodo,
      href: "/tasks",
    },
    {
      label: "Overdue",
      value: overdueCount,
      icon: AlarmClock,
      hint: "tasks & reminders past due",
      href: "/tasks",
    },
    {
      label: "Unread messages",
      value: unreadCount,
      icon: MessageSquare,
      href: "/messages",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-12 flex items-center gap-4">
        {/* CDG Leisure brand mark — identifies the agency account. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cdg-logo.svg"
          alt="CDG Leisure"
          className="h-10 w-auto shrink-0"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {agencyName ?? "Your agency"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your agency at a glance.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Link
              key={kpi.label}
              href={kpi.href}
              className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-all hover:border-primary/40">
                <CardContent className="flex items-center justify-between gap-3 p-5 sm:p-5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {kpi.label}
                    </p>
                    <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                      {typeof kpi.value === "number"
                        ? kpi.value.toLocaleString("en-GB")
                        : kpi.value}
                    </p>
                    {kpi.hint ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {kpi.hint}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* ── My work ───────────────────────────────────────────── */}
      <div className="mt-8">
        <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          My work
        </p>
        <StatsBar stats={myWork} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Add records, then find matches.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className={cn(
                    buttonVariants({ variant: "secondary" }),
                    "h-auto min-h-14 flex-1 justify-start gap-3 text-base",
                  )}
                >
                  <Icon className="!size-5" />
                  {action.label}
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Listings map</CardTitle>
            <CardDescription>Where your listings are across the UK.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConcentrationMap
              layers={mapLayers}
              defaultActive="listing"
              compact
              hideToggles
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Recent activity ───────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            The last {activities.length || 10} things logged across the agency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="No activity logged yet"
              description="Log a call, email or viewing on any company, contact or deal and it shows up here."
            />
          ) : (
            <ul className="divide-y">
              {activities.map((a) => {
                const Icon = ACTIVITY_ICONS[a.type] ?? ActivityIcon;
                const base = a.entity_type ? ENTITY_PATHS[a.entity_type] : undefined;
                const href = base && a.entity_id ? `${base}/${a.entity_id}` : undefined;
                const who = a.created_by ? actorName.get(a.created_by) : null;
                const row = (
                  <div className="flex items-start gap-3 py-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {a.subject ?? a.type}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {who ?? "Someone"}
                        {a.entity_type
                          ? ` · ${ENTITY_LABELS[a.entity_type] ?? a.entity_type}`
                          : ""}
                        {` · ${fmtWhen(a.occurred_at)}`}
                      </p>
                    </div>
                  </div>
                );
                return (
                  <li key={a.id}>
                    {href ? (
                      <Link
                        href={href}
                        className="-mx-2 block rounded-md px-2 transition-colors hover:bg-muted/60"
                      >
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
