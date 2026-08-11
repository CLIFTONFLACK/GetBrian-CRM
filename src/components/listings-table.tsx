"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { ListingStatusSelect } from "@/components/listing-status-select";
import { SortHeader } from "@/components/sort-header";
import { ViewOnMapButton } from "@/components/view-on-map-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listingTypeBadge } from "@/lib/badges";
import {
  bulkAssignDisposalLead,
  bulkUpdateDisposalStatus,
} from "@/lib/actions/disposals";
import type { AgentOption } from "@/lib/db/queries/agencies";
import type { MapPoint } from "@/components/concentration-map";

const STATUSES = ["Available", "Under Offer", "Let", "Sold", "Withdrawn"] as const;

export type ListingTableRow = {
  id: string;
  title: string | null;
  city: string | null;
  use_class: string | null;
  source_label: string;
  size_sqft: number | null;
  rent_pa: number | null;
  premium: number | null;
  status: string | null;
  listing_type: string | null;
  mapPoint: MapPoint | null;
};

const fmtMoney = (v: number | null) =>
  v != null ? `£${Number(v).toLocaleString("en-GB")}` : "—";

/**
 * Listings table with per-row checkboxes and a floating bulk bar ("Set
 * status…" / "Assign lead agent…") — mirrors the requirements-table
 * bulk-select pattern. Each row also carries the quick status popover.
 */
export function ListingsTable({
  rows,
  params,
  agents,
}: {
  rows: ListingTableRow[];
  params: Record<string, string | undefined>;
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const allRef = React.useRef<HTMLInputElement>(null);

  // Drop selections that no longer exist after a filter/search change.
  const rowIds = React.useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const active = [...selected].filter((id) => rowIds.has(id));
  const allSelected = rows.length > 0 && active.length === rows.length;

  React.useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = active.length > 0 && !allSelected;
    }
  }, [active.length, allSelected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  function run(action: () => Promise<{ error?: string; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res?.error) {
        setError(res.error);
      } else {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {active.length > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-2 pl-3 shadow-sm">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{active.length}</span>{" "}
            listing{active.length === 1 ? "" : "s"} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Set status for selected listings"
              value=""
              disabled={pending}
              onChange={(e) => {
                const status = e.target.value;
                if (status) run(() => bulkUpdateDisposalStatus(active, status));
              }}
              className="h-8 w-auto text-xs"
            >
              <option value="">Set status…</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Assign lead agent to selected listings"
              value=""
              disabled={pending || agents.length === 0}
              onChange={(e) => {
                const agentId = e.target.value;
                if (agentId) run(() => bulkAssignDisposalLead(active, agentId));
              }}
              className="h-8 w-auto text-xs"
            >
              <option value="">Assign lead agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setSelected(new Set());
                setError(null);
              }}
            >
              Clear
            </Button>
          </div>
          {error ? (
            <p className="w-full text-xs text-destructive">{error}</p>
          ) : null}
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                ref={allRef}
                type="checkbox"
                aria-label="Select all listings"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-input accent-primary"
              />
            </TableHead>
            <SortHeader column="title" label="Title" params={params} />
            <SortHeader
              column="city"
              label="Town"
              params={params}
              className="hidden md:table-cell"
            />
            <SortHeader
              column="use_class"
              label="Use class"
              params={params}
              className="hidden md:table-cell"
            />
            <SortHeader
              column="source"
              label="Source"
              params={params}
              className="hidden lg:table-cell"
            />
            <SortHeader
              column="size_sqft"
              label="Size (sq ft)"
              params={params}
              className="hidden text-right md:table-cell"
            />
            <SortHeader
              column="rent_pa"
              label="Rent / Premium"
              params={params}
              className="hidden text-right md:table-cell"
            />
            <SortHeader column="status" label="Status" params={params} />
            <TableHead className="w-24 text-right">
              <span className="sr-only">Map</span>
            </TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Edit</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => {
            const t = listingTypeBadge(d.listing_type);
            return (
              <TableRow key={d.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${d.title ?? "listing"}`}
                    checked={selected.has(d.id)}
                    onChange={() => toggle(d.id)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/listings/${d.id}`}
                      className="font-medium text-foreground hover:text-info hover:underline"
                    >
                      {d.title ?? "Untitled listing"}
                    </Link>
                    <Badge tone={t.tone}>{t.label}</Badge>
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {d.city ?? "—"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {d.use_class ?? "—"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {d.source_label}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                  {d.size_sqft != null
                    ? Number(d.size_sqft).toLocaleString("en-GB")
                    : "—"}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                  {d.rent_pa != null
                    ? `${fmtMoney(d.rent_pa)} pa`
                    : d.premium != null
                      ? fmtMoney(d.premium)
                      : "—"}
                </TableCell>
                <TableCell>
                  <ListingStatusSelect
                    id={d.id}
                    status={d.status}
                    aria-label={`Change status of ${d.title ?? "listing"}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  {d.mapPoint ? <ViewOnMapButton point={d.mapPoint} /> : null}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/listings/${d.id}/edit`}
                    aria-label={`Edit ${d.title ?? "listing"}`}
                    className="inline-flex text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
