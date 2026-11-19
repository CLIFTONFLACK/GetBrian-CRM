import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import { sortHref, type SortDir } from "@/lib/sort";
import { cn } from "@/lib/utils";

/** A sortable table column header — a Link that toggles the URL sort/dir params. */
export function SortHeader({
  column,
  label,
  params,
  className,
  firstDir = "asc",
}: {
  column: string;
  label: string;
  params: Record<string, string | undefined>;
  className?: string;
  /** Direction of the first click when this column is not the active sort. */
  firstDir?: SortDir;
}) {
  const active = params.sort === column;
  const asc = params.dir !== "desc";
  const Icon = active ? (asc ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <TableHead className={className}>
      <Link
        href={sortHref(params, column, firstDir)}
        aria-label={`Sort by ${label}`}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : "",
        )}
      >
        {label}
        <Icon className="h-3.5 w-3.5 opacity-60" />
      </Link>
    </TableHead>
  );
}
