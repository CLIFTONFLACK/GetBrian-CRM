import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Store } from "lucide-react";

import { ConcentrationMap } from "@/components/concentration-map-lazy";
import { EmptyState } from "@/components/empty-state";
import { ExpandableInsights } from "@/components/expandable-insights";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { FilterTiles } from "@/components/filter-tiles";
import { Heatmap } from "@/components/heatmap";
import { ListingsTable, type ListingTableRow } from "@/components/listings-table";
import { PageHeader } from "@/components/page-header";
import { Pagination, resolvePage } from "@/components/pagination";
import { SiloTabs } from "@/components/silo-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getMapLayers } from "@/lib/supabase/map-points";
import { intelSourceById } from "@/lib/intel/sources";
import { deriveCounty, HOME_COUNTIES } from "@/lib/locations";
import { ilikeTerm } from "@/lib/search";
import { filterHref, resolveSort } from "@/lib/sort";
import { currentAgencyId, getAgencyMembers } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Listings" };

// Filter value for the "Other" catch-all tile (statuses outside the canonical five).
const OTHER_STATUS = "__other__";

// Table rows per page. The silo tabs, status tiles, heatmap and facet
// dropdowns keep describing the whole filtered set — only the table is paged.
const PAGE_SIZE = 25;

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
    status?: string;
    disposal_type?: string;
    town?: string;
    county?: string;
    silo?: string;
    page?: string;
  }>;
}) {
  const {
    q,
    sort,
    dir,
    status,
    disposal_type,
    town,
    county,
    silo,
    page: pageParam,
  } = await searchParams;
  const supabase = await createClient();

  const { column, ascending } = resolveSort(
    sort,
    dir,
    {
      title: "title",
      city: "city",
      use_class: "use_class",
      source: "source",
      size_sqft: "size_sqft",
      rent_pa: "rent_pa",
      status: "status",
    },
    { column: "created_at", ascending: false },
  );

  // Aggregate pass: only the columns the silo tabs, status tiles, heatmap,
  // facet dropdowns and the source-label sort need (plus the id, which the
  // paginated row fetch keys off). Ordered here so the page slice below is
  // taken from the fully sorted set.
  let query = supabase
    .from("disposals")
    .select("id, city, postcode, county, status, listing_type, source")
    .order(column, { ascending });
  if (q) {
    // Sanitised: commas/parens are structural in `.or()` and would break the query.
    const term = ilikeTerm(q);
    if (term) query = query.or(`title.ilike.%${term}%,city.ilike.%${term}%`);
  }
  if (disposal_type) query = query.eq("disposal_type", disposal_type);
  const [{ data }, mapLayers, agencyId] = await Promise.all([
    query,
    getMapLayers(supabase, { include: ["listing"] }),
    currentAgencyId(supabase),
  ]);
  // Agency roster for the bulk "Assign lead agent…" action.
  const agents = agencyId ? await getAgencyMembers(supabase, agencyId) : [];
  // `rows` is the heatmap base (q + type filtered). The town/status facets that
  // the heatmap controls are applied to the table in memory, so the grid keeps
  // showing the full distribution for re-slicing.
  // County is stored on new saves and derived from postcode/town for legacy rows.
  // Source label: only registered intel partners get their own label — every
  // other source (manual entries, our own CDG scrape) is CDG Leisure's book.
  const rows = (data ?? []).map((r) => ({
    ...r,
    county: r.county ?? deriveCounty({ postcode: r.postcode, city: r.city }),
    source_label: intelSourceById.get(r.source)?.label ?? "CDG Leisure",
  }));
  const matchesCounty = (rowCounty: string | null) =>
    !county ||
    (county === "Home Counties"
      ? rowCounty != null && HOME_COUNTIES.includes(rowCounty)
      : (rowCounty ?? "—") === county);
  // The book opens on CDG's own instructions — that's the stock an agent works
  // day to day, and scraped Market Intel used to bulk it out by default. "All"
  // therefore needs an explicit value that survives in the URL.
  const activeSilo = silo ?? "cdg";
  // `rows` stays unscoped by silo so the tab counts reflect all three options;
  // `siloRows` is what the heatmap/tiles/table below actually render.
  const siloRows = rows.filter(
    (r) => activeSilo === "all" || (r.listing_type ?? "cdg") === activeSilo,
  );
  const siloCounts = {
    all: rows.length,
    cdg: rows.filter((r) => (r.listing_type ?? "cdg") === "cdg").length,
    intel: rows.filter((r) => r.listing_type === "intel").length,
  };

  const CANONICAL_STATUSES = ["Available", "Under Offer", "Let", "Sold", "Withdrawn"];
  const matchesStatus = (rowStatus: string | null) =>
    !status ||
    (status === OTHER_STATUS
      ? !CANONICAL_STATUSES.includes(rowStatus ?? "")
      : (rowStatus ?? "—") === status);

  const listRows = siloRows.filter(
    (r) =>
      (!town || (r.city ?? "—") === town) &&
      matchesStatus(r.status) &&
      matchesCounty(r.county),
  );
  // `sort=source` sorts by the displayed label (CDG Leisure / partner name),
  // not the raw slug — the DB order on `source` is meaningless to users.
  if (column === "source") {
    listRows.sort((a, b) =>
      ascending
        ? a.source_label.localeCompare(b.source_label)
        : b.source_label.localeCompare(a.source_label),
    );
  }

  const params = { q, sort, dir, status, disposal_type, town, county, silo: activeSilo };

  const townOptions = [...new Set(siloRows.map((r) => r.city).filter(Boolean))]
    .sort()
    .map((v) => ({ value: v as string, label: v as string }));
  const countyValues = [...new Set(siloRows.map((r) => r.county).filter(Boolean))].sort();
  const countyOptions = [
    ...(countyValues.some((c) => HOME_COUNTIES.includes(c as string))
      ? [{ value: "Home Counties", label: "Home Counties" }]
      : []),
    ...countyValues.map((v) => ({ value: v as string, label: v as string })),
  ];

  // Stats bar: counts per status (whole q + type filtered set), click to facet.
  const STATUS_TILES = [
    { value: "Available", label: "Available" },
    { value: "Under Offer", label: "Under Offer" },
    { value: "Let", label: "Let" },
    { value: "Sold", label: "Sold" },
    { value: "Withdrawn", label: "Withdrawn" },
  ];
  // Catch-all for scraped statuses outside the canonical five ("Sold STC",
  // "Let Agreed", blank, …) so they're countable and selectable, not invisible.
  const otherCount = siloRows.filter(
    (r) => !CANONICAL_STATUSES.includes(r.status ?? ""),
  ).length;
  const statusTiles = [
    { value: "", label: "All", count: siloRows.length },
    ...STATUS_TILES.map((t) => ({
      ...t,
      count: siloRows.filter((r) => (r.status ?? "") === t.value).length,
    })),
    ...(otherCount > 0
      ? [{ value: OTHER_STATUS, label: "Other", count: otherCount }]
      : []),
  ];

  // Heatmap: town × status — click a cell/label to filter the table below.
  const townCounts = new Map<string, number>();
  for (const r of siloRows) {
    const t = r.city ?? "—";
    townCounts.set(t, (townCounts.get(t) ?? 0) + 1);
  }
  const heatTowns = [...townCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map((e) => e[0]);
  const statusCounts = new Map<string, number>();
  for (const r of siloRows) {
    const sName = r.status ?? "—";
    statusCounts.set(sName, (statusCounts.get(sName) ?? 0) + 1);
  }
  const heatStatuses = [...statusCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map((e) => e[0]);
  const cellCounts = new Map<string, number>();
  for (const r of siloRows) {
    cellCounts.set(
      `${r.city ?? "—"}|${r.status ?? "—"}`,
      (cellCounts.get(`${r.city ?? "—"}|${r.status ?? "—"}`) ?? 0) + 1,
    );
  }
  const heatMatrix = heatTowns.map((t) =>
    heatStatuses.map((sName) => cellCounts.get(`${t}|${sName}`) ?? 0),
  );

  // Pagination: every summary above is computed from the full filtered set (and
  // the source-label sort was applied to it too), so the page total is exact and
  // the slice is a true window onto the sorted list.
  const total = listRows.length;
  const pageState = resolvePage(pageParam, total, PAGE_SIZE);
  const pageIds = listRows.slice(pageState.from, pageState.to).map((r) => r.id);

  const { data: detail } = pageIds.length
    ? await supabase
        .from("disposals")
        .select(
          "id, title, city, use_class, source, size_sqft, rent_pa, premium, status, listing_type",
        )
        .in("id", pageIds)
    : { data: [] };
  // `.in()` does not preserve the requested order — re-apply the sorted slice.
  const byId = new Map((detail ?? []).map((r) => [r.id, r]));
  const pageRows = pageIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null);

  const listingPoints = new Map(mapLayers.listings.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Listings"
        description="Leisure premises being marketed (disposals) — the supply side."
        action={
          <Link href="/listings/new" className={cn(buttonVariants({ size: "sm" }))}>
            <Plus />
            New listing
          </Link>
        }
      />

      <SiloTabs
        value={activeSilo}
        counts={siloCounts}
        hrefFor={(v) => filterHref(params, { silo: v })}
        allValue="all"
      />

      <FilterBar
        q={q}
        sort={sort}
        dir={dir}
        placeholder="Search by title or town…"
        basePath="/listings"
        hasActiveFilters={Boolean(status || disposal_type || town || county) || activeSilo !== "cdg"}
      >
        <FilterSelect name="town" label="Town" value={town} options={townOptions} />
        <FilterSelect name="county" label="County" value={county} options={countyOptions} />
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={[
            { value: "Available", label: "Available" },
            { value: "Under Offer", label: "Under Offer" },
            { value: "Let", label: "Let" },
            { value: "Sold", label: "Sold" },
            { value: "Withdrawn", label: "Withdrawn" },
            { value: OTHER_STATUS, label: "Other" },
          ]}
        />
        <FilterSelect
          name="disposal_type"
          label="Type"
          value={disposal_type}
          options={[
            { value: "freehold", label: "Freehold" },
            { value: "new_lease", label: "New lease" },
            { value: "lease_assignment", label: "Lease assignment" },
            { value: "sublease", label: "Sublease" },
            { value: "unknown", label: "Unspecified" },
          ]}
        />
      </FilterBar>

      {siloRows.length > 0 ? (
        <FilterTiles
          tiles={statusTiles}
          activeValue={status ?? ""}
          hrefFor={(v) => filterHref(params, { status: v === status ? null : v || null })}
        />
      ) : null}

      {siloRows.length > 0 ? (
        <ExpandableInsights>
          <Card className="hidden sm:block">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Portfolio Spread — town × status</CardTitle>
            </CardHeader>
            <CardContent>
              <Heatmap
                compact
                rowLabels={heatTowns}
                colLabels={heatStatuses}
                matrix={heatMatrix}
                selectedRow={town}
                selectedCol={status}
                cellHref={(t, s) => filterHref(params, { town: t, status: s })}
                rowHref={(t) => filterHref(params, { town: t === town ? null : t })}
                colHref={(s) => filterHref(params, { status: s === status ? null : s })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Location heat-map</CardTitle>
            </CardHeader>
            <CardContent>
              <ConcentrationMap layers={mapLayers} defaultActive="listing" compact />
            </CardContent>
          </Card>
        </ExpandableInsights>
      ) : null}

      {listRows.length === 0 ? (
        <EmptyState
          icon={Store}
          title={
            q || status || town || county || disposal_type || activeSilo !== "cdg"
              ? "No matches"
              : "No listings yet"
          }
          description={
            q || status || town || county || disposal_type || activeSilo !== "cdg"
              ? "Try a different search or filter."
              : "Click “New listing” to add your first premises."
          }
        />
      ) : (
        <ListingsTable
          rows={pageRows.map(
            (d): ListingTableRow => ({
              id: d.id,
              title: d.title,
              city: d.city,
              use_class: d.use_class,
              source_label: intelSourceById.get(d.source)?.label ?? "CDG Leisure",
              size_sqft: d.size_sqft,
              rent_pa: d.rent_pa,
              premium: d.premium,
              status: d.status,
              listing_type: d.listing_type,
              mapPoint: listingPoints.get(d.id) ?? null,
            }),
          )}
          params={params}
          agents={agents}
        />
      )}

      <Pagination
        params={params}
        state={pageState}
        total={total}
        noun="listings"
        unfilteredTotal={siloRows.length}
      />
    </div>
  );
}
