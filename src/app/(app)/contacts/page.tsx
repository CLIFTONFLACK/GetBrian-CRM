import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Users } from "lucide-react";

import { ConcentrationMap } from "@/components/concentration-map-lazy";
import type { MapPoint } from "@/components/concentration-map";
import { EmptyState } from "@/components/empty-state";
import { ExpandableInsights } from "@/components/expandable-insights";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { FilterTiles } from "@/components/filter-tiles";
import { Heatmap } from "@/components/heatmap";
import { PageHeader } from "@/components/page-header";
import { Pagination, resolvePage } from "@/components/pagination";
import { SortHeader } from "@/components/sort-header";
import { ViewOnMapButton } from "@/components/view-on-map-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contactRoleBadge } from "@/lib/badges";
import { auth } from "@/lib/auth";
import { getContactRoles, roleLabel } from "@/lib/contact-roles";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getCompaniesByIds, listCompanyFacetRows } from "@/lib/db/queries/companies";
import { getContactsByIds, listContactFacetRows } from "@/lib/db/queries/contacts";
import { deriveCounty, HOME_COUNTIES } from "@/lib/locations";
import { filterHref, resolveSort } from "@/lib/sort";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contacts" };

// Table rows per page. The tiles/heatmap/facets keep describing the whole
// filtered set — only the table below them is paginated.
const PAGE_SIZE = 25;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
    role?: string;
    town?: string;
    county?: string;
    page?: string;
  }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const { q, sort, dir, role, town, county, page: pageParam } = await searchParams;

  const session = await auth();
  if (!session?.user) redirect("/login");
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) redirect("/login");

  const { column, ascending } = resolveSort(
    sort,
    dir,
    { name: "first_name", role: "role" },
    { column: "first_name", ascending: true },
  );

  // Aggregate pass: only the columns the tiles, heatmap, facet dropdowns and
  // map layer need (plus the id, which is what the paginated row fetch keys
  // off). Ordered here so the page slice below is taken from the fully sorted
  // set.
  const facetRows = await listContactFacetRows(agencyId, {
    q,
    column: column as "first_name" | "role",
    ascending,
  });
  // `rows` is the tile base (q filtered). The role/town facets are applied to
  // the table in memory so the tile counts always show the full distribution.
  const rows = facetRows.map((c) => ({
    ...c,
    county: c.county ?? deriveCounty({ postcode: c.postcode, city: c.city }),
  }));
  const matchesCounty = (rowCounty: string | null) =>
    !county ||
    (county === "Home Counties"
      ? rowCounty != null && HOME_COUNTIES.includes(rowCounty)
      : (rowCounty ?? "—") === county);
  const listRows = rows.filter(
    (c) =>
      (!role || c.role === role) &&
      (!town || (c.city ?? "—") === town) &&
      matchesCounty(c.county),
  );

  const params = { q, sort, dir, role, town, county };

  const townOptions = [...new Set(rows.map((c) => c.city).filter(Boolean))]
    .sort()
    .map((v) => ({ value: v as string, label: v as string }));
  const countyValues = [...new Set(rows.map((c) => c.county).filter(Boolean))].sort();
  const countyOptions = [
    ...(countyValues.some((c) => HOME_COUNTIES.includes(c as string))
      ? [{ value: "Home Counties", label: "Home Counties" }]
      : []),
    ...countyValues.map((v) => ({ value: v as string, label: v as string })),
  ];

  const roles = await getContactRoles();
  const roleOptions = roles.map((r) => ({ value: r.slug, label: r.label }));
  const roleTiles = roleOptions.map((r) => ({
    ...r,
    count: rows.filter((c) => c.role === r.value).length,
  }));

  // Heatmap: town × role — rows are the top 8 towns, columns the roles present.
  // Both dimensions are clickable filters, matching the listings page's pattern.
  const townCounts = new Map<string, number>();
  for (const c of rows) {
    const t = c.city ?? "—";
    townCounts.set(t, (townCounts.get(t) ?? 0) + 1);
  }
  const heatTowns = [...townCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map((e) => e[0]);
  const roleCounts = new Map<string, number>();
  for (const c of rows) {
    const rSlug = c.role ?? "—";
    roleCounts.set(rSlug, (roleCounts.get(rSlug) ?? 0) + 1);
  }
  const heatRoles = [...roleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map((e) => e[0]);
  const cellCounts = new Map<string, number>();
  for (const c of rows) {
    const key = `${c.city ?? "—"}|${c.role ?? "—"}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }
  const heatMatrix = heatTowns.map((t) =>
    heatRoles.map((rSlug) => cellCounts.get(`${t}|${rSlug}`) ?? 0),
  );

  // Pagination: the facets above are computed from the full filtered set, so
  // the page total is exact; only the current page's rows are fetched in full.
  const total = listRows.length;
  const pageState = resolvePage(pageParam, total, PAGE_SIZE);
  const pageIds = listRows.slice(pageState.from, pageState.to).map((c) => c.id);

  const detail = await getContactsByIds(agencyId, pageIds);
  // `= ANY()` does not preserve the requested order — re-apply the sorted slice.
  const byId = new Map(detail.map((c) => [c.id, c]));
  const pageRows = pageIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c != null);

  const companyIds = [
    ...new Set(pageRows.map((r) => r.company_id).filter((v): v is string => Boolean(v))),
  ];
  const names = new Map<string, string>();
  if (companyIds.length) {
    const comps = await getCompaniesByIds(agencyId, companyIds);
    comps.forEach((c) => names.set(c.id, c.name));
  }

  // Map layer: built from the agency-scoped facet rows (own coords), falling
  // back to the linked company's pin when the contact has none of its own —
  // mirrors src/lib/supabase/map-points.ts's contact-falls-back-to-company
  // behavior, replicated here (agency-scoped) rather than reusing that
  // shared, not-yet-migrated helper.
  const companyPointIds = [
    ...new Set(rows.map((c) => c.company_id).filter((v): v is string => Boolean(v))),
  ];
  const companyGeoRows =
    companyPointIds.length > 0
      ? await listCompanyFacetRows(agencyId, { column: "name", ascending: true })
      : [];
  const companyCoord = new Map(
    companyGeoRows
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => [
        c.id,
        {
          lat: c.lat as number,
          lng: c.lng as number,
          address: [c.address_line, c.city, c.postcode].filter(Boolean).join(", "),
        },
      ]),
  );
  const addressOf = (c: (typeof rows)[number]) =>
    [c.address_line, c.city, c.postcode].filter(Boolean).join(", ");
  const contactPoints = new Map<string, MapPoint>();
  for (const c of rows) {
    const own = c.lat != null && c.lng != null;
    const fallback = !own && c.company_id ? companyCoord.get(c.company_id) : undefined;
    if (!own && !fallback) continue;
    contactPoints.set(c.id, {
      id: c.id,
      kind: "contact",
      name: [c.first_name, c.last_name].filter(Boolean).join(" "),
      subtitle: c.role,
      address: own ? addressOf(c) : (fallback?.address ?? null),
      lat: own ? (c.lat as number) : fallback!.lat,
      lng: own ? (c.lng as number) : fallback!.lng,
    });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Contacts"
        description="People at operators, landlords and agencies."
        action={
          <Link href="/contacts/new" className={cn(buttonVariants({ size: "sm" }))}>
            <Plus />
            New contact
          </Link>
        }
      />

      <FilterBar
        q={q}
        sort={sort}
        dir={dir}
        placeholder="Search contacts…"
        basePath="/contacts"
        hasActiveFilters={Boolean(role || town || county)}
      >
        <FilterSelect name="role" label="Role" value={role} options={roleOptions} />
        <FilterSelect name="town" label="Town" value={town} options={townOptions} />
        <FilterSelect name="county" label="County" value={county} options={countyOptions} />
      </FilterBar>

      {rows.length > 0 ? (
        <FilterTiles
          tiles={roleTiles}
          activeValue={role}
          hrefFor={(v) => filterHref(params, { role: v === role ? null : v })}
        />
      ) : null}

      {rows.length > 0 ? (
        <ExpandableInsights>
          <Card className="hidden sm:block">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Portfolio Spread — town × role</CardTitle>
            </CardHeader>
            <CardContent>
              <Heatmap
                compact
                rowLabels={heatTowns}
                colLabels={heatRoles.map((slug) => roleLabel(roles, slug))}
                matrix={heatMatrix}
                selectedRow={town}
                selectedCol={role ? roleLabel(roles, role) : undefined}
                cellHref={(t, _label, _ri, ci) => {
                  const slug = heatRoles[ci];
                  return filterHref(params, {
                    town: t === town ? null : t,
                    role: slug === role ? null : slug,
                  });
                }}
                rowHref={(t) =>
                  filterHref(params, { town: t === town ? null : t })
                }
                colHref={(_label, ci) => {
                  const slug = heatRoles[ci];
                  return filterHref(params, { role: slug === role ? null : slug });
                }}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Location heat-map</CardTitle>
            </CardHeader>
            <CardContent>
              <ConcentrationMap
                layers={{ listings: [], companies: [], contacts: [...contactPoints.values()] }}
                defaultActive="contact"
                compact
              />
            </CardContent>
          </Card>
        </ExpandableInsights>
      ) : null}

      {listRows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q || role || town || county ? "No matches" : "No contacts yet"}
          description={
            q || role || town || county
              ? "Try a different search or filter."
              : "Add the people behind your companies."
          }
          action={
            q || role || town || county ? undefined : (
              <Link href="/contacts/new" className={cn(buttonVariants({ size: "sm" }))}>
                New contact
              </Link>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader column="name" label="Name" params={params} />
              <SortHeader column="role" label="Role" params={params} />
              <TableHead className="hidden md:table-cell">Company</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="w-24 text-right">
                <span className="sr-only">Map</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((c) => {
              const r = contactRoleBadge(c.role, roleLabel(roles, c.role));
              const point = contactPoints.get(c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/contacts/${c.id}`}
                      className="font-medium text-foreground hover:text-info hover:underline"
                    >
                      {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge tone={r.tone}>{r.label}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {c.company_id ? (names.get(c.company_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {c.email ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {c.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {point ? <ViewOnMapButton point={point} /> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Pagination
        params={params}
        state={pageState}
        total={total}
        noun="contacts"
        unfilteredTotal={rows.length}
      />
    </div>
  );
}
