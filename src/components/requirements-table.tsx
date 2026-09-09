"use client";

import * as React from "react";
import Link from "next/link";

import { SendDealModal } from "@/components/send-deal-modal";
import { SortHeader } from "@/components/sort-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirementStatusBadge } from "@/lib/badges";
import type { EntityOption } from "@/components/creatable-select";
import type { AgentOption } from "@/lib/db/queries/agencies";

export type RequirementRow = {
  id: string;
  title: string;
  status: string;
  operatorName: string | null;
  towns: string;
  maxRent: number | null;
  /** Pre-ticked recipient(s) when this row is sent — its contact, else its
   *  company's primary contact. Resolved server-side. */
  defaultContactIds?: string[];
};

/**
 * Requirements table with per-row checkboxes and a bulk "Send deal" action —
 * tick rows (or select all) and send the whole batch internally or externally
 * through the Send Deal wizard.
 */
export function RequirementsTable({
  rows,
  params,
  agents,
  meId,
  companies,
  contacts,
  companyTypes,
}: {
  rows: RequirementRow[];
  params: Record<string, string | undefined>;
  agents: AgentOption[];
  meId?: string;
  companies: EntityOption[];
  contacts: EntityOption[];
  companyTypes?: { slug: string; label: string }[];
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
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

  const selectedRows = rows.filter((r) => selected.has(r.id));
  // Union of the selected briefs' default recipients, de-duplicated — every
  // ticked requirement's operator contact starts ticked in the wizard.
  const defaultContactIds = [
    ...new Set(selectedRows.flatMap((r) => r.defaultContactIds ?? [])),
  ];

  return (
    <div className="space-y-3">
      {active.length > 0 ? (
        <div className="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-md border bg-card p-2 pl-3 shadow-sm">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{active.length}</span>{" "}
            requirement{active.length === 1 ? "" : "s"} selected
          </p>
          <div className="flex items-center gap-2">
            <SendDealModal
              agents={agents}
              meId={meId}
              companies={companies}
              contacts={contacts}
              companyTypes={companyTypes}
              requirements={selectedRows.map((r) => ({ id: r.id, title: r.title }))}
              defaultContactIds={defaultContactIds.length > 0 ? defaultContactIds : undefined}
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                ref={allRef}
                type="checkbox"
                aria-label="Select all requirements"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-input accent-primary"
              />
            </TableHead>
            <SortHeader column="title" label="Title" params={params} />
            <TableHead className="hidden md:table-cell">Operator</TableHead>
            <TableHead className="hidden md:table-cell">Towns</TableHead>
            <SortHeader
              column="max_rent"
              label="Max rent"
              params={params}
              className="hidden md:table-cell"
            />
            <SortHeader column="status" label="Status" params={params} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const s = requirementStatusBadge(r.status);
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.title}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/requirements/${r.id}`}
                    className="font-medium text-foreground hover:text-info hover:underline"
                  >
                    {r.title}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {r.operatorName ?? "—"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {r.towns || "—"}
                </TableCell>
                <TableCell className="hidden font-mono tabular-nums text-muted-foreground md:table-cell">
                  {r.maxRent != null ? `£${r.maxRent.toLocaleString("en-GB")}` : "—"}
                </TableCell>
                <TableCell>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
