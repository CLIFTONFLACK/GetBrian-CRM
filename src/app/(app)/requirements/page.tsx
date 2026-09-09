import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, CalendarPlus, Layers, Plus, Target } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { FilterTiles } from "@/components/filter-tiles";
import { PageHeader } from "@/components/page-header";
import { Pagination, resolvePage } from "@/components/pagination";
import { RequirementsTable } from "@/components/requirements-table";
import { StatsBar } from "@/components/stats-bar";
import { buttonVariants } from "@/components/ui/button";
import { propertyUseBadge } from "@/lib/badges";
import { getCompanyTypes } from "@/lib/company-types";
import { HOME_COUNTIES } from "@/lib/locations";
import { filterHref, resolveSort } from "@/lib/sort";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import {
  getDefaultSendContactsForRequirements,
  listContactOptions,
} from "@/lib/db/queries/contacts";
import {
  getRequirementsByIds,
  listRequirementFacetRows,
} from "@/lib/db/queries/requirements";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Requirements" };

// Table rows per page. The status tiles and the key-stats bar keep describing
// the whole filtered set — only the table below them is paginated.
const PAGE_SIZE = 25;

export default async function RequirementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
    status?: string;
    loc?: string;
    page?: string;
  }>;
}) {
  const { q, sort, dir, status, loc, page: pageParam } = await searchParams;

  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const agencyId = await currentAgencyId(session.user.id);

  const { column, ascending } = resolveSort(
    sort,
    dir,
    { title: "title", max_rent: "max_rent", status: "status" },
    { column: "title", ascending: true },
  );

  // Aggregate pass: only the columns the status tiles, the stats bar and the
  // target-location facet need (plus the id, which the paginated row fetch
  // keys off). Ordered here so the page slice below comes from the sorted set.
  const rows = agencyId
    ? await listRequirementFacetRows(agencyId, {
        q,
        column: column as "title" | "max_rent" | "status",
        ascending,
      })
    : [];
  // `rows` is the tile base (q filtered). The status facet is applied to the
  // table in memory so the tile counts always show the full distribution.
  const targetsOf = (r: (typeof rows)[number]) => [
    ...(r.target_towns ?? []),
    ...(r.target_regions ?? []),
    ...(r.target_counties ?? []),
    ...(r.target_postcode_districts ?? []),
    ...(r.target_neighbourhoods ?? []),
    ...(r.target_london_zones ?? []),
  ];
  const matchesLoc = (r: (typeof rows)[number]) => {
    if (!loc) return true;
    const targets = targetsOf(r).map((t) => t.toLowerCase());
    if (loc === "Home Counties") {
      return (
        targets.includes("home counties") ||
        HOME_COUNTIES.some((hc) => targets.includes(hc.toLowerCase()))
      );
    }
    return targets.includes(loc.toLowerCase());
  };
  const listRows = rows.filter((r) => (!status || r.status === status) && matchesLoc(r));

  const params = { q, sort, dir, status, loc };

  const locOptions = [...new Set(rows.flatMap(targetsOf).filter(Boolean))]
    .sort()
    .map((v) => ({ value: v, label: v }));

  const STATUS_TILES = [
    { value: "active", label: "Active" },
    { value: "on_hold", label: "On hold" },
    { value: "satisfied", label: "Satisfied" },
    { value: "withdrawn", label: "Withdrawn" },
  ];
  const statusTiles = STATUS_TILES.map((s) => ({
    ...s,
    count: rows.filter((r) => r.status === s.value).length,
  }));

  // Key stats bar — a quick read on the requirement book.
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const newThisMonth = rows.filter(
    (r) => new Date(r.created_at) >= startOfMonth,
  ).length;

  const countDistinct = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { distinct: counts.size, top: top?.[0] };
  };
  // "Property types" left the requirement form — the equivalent read on the
  // book is now how widely spread its target locations are.
  const locStats = countDistinct(rows.flatMap(targetsOf));
  const useStats = countDistinct(rows.flatMap((r) => r.use_classes ?? []));

  const stats = [
    { label: "New this month", value: newThisMonth, icon: CalendarPlus },
    { label: "Total", value: rows.length, icon: Target },
    {
      label: "Target locations",
      value: locStats.distinct,
      icon: Building2,
      hint: locStats.top ?? "—",
    },
    {
      label: "Use classes",
      value: useStats.distinct,
      icon: Layers,
      hint: useStats.top ? propertyUseBadge(useStats.top).label : "—",
    },
  ];

  // Pagination: the tiles and stats above are computed from the full filtered
  // set, so the page total is exact; only this page's rows are fetched in full.
  const total = listRows.length;
  const pageState = resolvePage(pageParam, total, PAGE_SIZE);
  const pageIds = listRows.slice(pageState.from, pageState.to).map((r) => r.id);

  const detail = agencyId && pageIds.length ? await getRequirementsByIds(agencyId, pageIds) : [];
  // `= ANY()` does not preserve the requested order — re-apply the sorted slice.
  const byId = new Map(detail.map((r) => [r.id, r]));
  const pageRows = pageIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null);

  // Companies double as the operator-name lookup and the Send Deal company picker.
  const [members, companies, contacts, companyTypes, defaultContacts] = await Promise.all([
    agencyId ? getAgencyMembers(agencyId) : Promise.resolve([]),
    agencyId ? listCompanyOptions(agencyId) : Promise.resolve([]),
    agencyId ? listContactOptions(agencyId) : Promise.resolve([]),
    getCompanyTypes(),
    // Who the Send Deal wizard pre-ticks per row (contact, else company primary).
    agencyId
      ? getDefaultSendContactsForRequirements(agencyId, pageIds)
      : Promise.resolve(new Map<string, string>()),
  ]);
  const names = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Requirements"
        description="Operator requirements — the criteria matched against disposals."
        action={
          <Link href="/requirements/new" className={cn(buttonVariants({ size: "sm" }))}>
            <Plus />
            New requirement
          </Link>
        }
      />

      <FilterBar
        q={q}
        sort={sort}
        dir={dir}
        placeholder="Search requirements…"
        basePath="/requirements"
        hasActiveFilters={Boolean(status || loc)}
      >
        <FilterSelect
          name="loc"
          label="Target location"
          value={loc}
          options={locOptions}
        />
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={[
            { value: "active", label: "Active" },
            { value: "on_hold", label: "On hold" },
            { value: "satisfied", label: "Satisfied" },
            { value: "withdrawn", label: "Withdrawn" },
          ]}
        />
      </FilterBar>

      {rows.length > 0 ? (
        <FilterTiles
          tiles={statusTiles}
          activeValue={status}
          hrefFor={(v) => filterHref(params, { status: v === status ? null : v })}
        />
      ) : null}

      {rows.length > 0 ? <StatsBar stats={stats} className="mb-5" /> : null}

      {listRows.length === 0 ? (
        <EmptyState
          icon={Target}
          title={q || status ? "No matches" : "No requirements yet"}
          description={
            q || status
              ? "Try a different search or filter."
              : "Capture an operator's requirement to match against disposals."
          }
          action={
            q || status ? undefined : (
              <Link
                href="/requirements/new"
                className={cn(buttonVariants({ size: "sm" }))}
              >
                New requirement
              </Link>
            )
          }
        />
      ) : (
        <RequirementsTable
          rows={pageRows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            operatorName: r.company_id ? (names.get(r.company_id) ?? null) : null,
            towns: r.target_towns.join(", "),
            maxRent: r.max_rent,
            defaultContactIds: defaultContacts.has(r.id) ? [defaultContacts.get(r.id)!] : undefined,
          }))}
          params={params}
          agents={members}
          meId={session.user.id}
          companies={companies}
          contacts={contacts}
          companyTypes={companyTypes}
        />
      )}

      <Pagination
        params={params}
        state={pageState}
        total={total}
        noun="requirements"
        unfilteredTotal={rows.length}
      />
    </div>
  );
}
