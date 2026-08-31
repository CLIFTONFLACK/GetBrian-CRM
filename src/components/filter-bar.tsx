import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A GET filter form: a search box + page-specific filter controls (passed as
 * children), with the current sort/dir preserved via hidden inputs. Fully
 * server-rendered — submitting reloads the page with the new query string.
 */
export function FilterBar({
  q,
  sort,
  dir,
  placeholder,
  basePath,
  hasActiveFilters,
  children,
}: {
  q?: string;
  sort?: string;
  dir?: string;
  placeholder: string;
  basePath: string;
  hasActiveFilters?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-3">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {children}
      {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      {dir ? <input type="hidden" name="dir" value={dir} /> : null}
      <Button type="submit" size="sm" variant="secondary">
        Apply
      </Button>
      {q || hasActiveFilters ? (
        <Link
          href={basePath}
          className="self-center text-sm text-muted-foreground hover:text-foreground"
        >
          Clear
        </Link>
      ) : null}
    </form>
  );
}

/**
 * A labelled filter <select> for use inside FilterBar.
 *
 * `tone="teal"` marks a control that belongs to the Market Intel silo rather
 * than to the page as a whole. It reuses the domain teal from MASTER.md §2
 * (the same ramp as the teal badges) rather than the brand ramp: app chrome is
 * navy, and CDG's own `#1ab6b6` is reserved for client-facing PDFs. The label
 * still says "Agent", so the colour is reinforcement, never the only signal.
 */
export function FilterSelect({
  name,
  label,
  value,
  options,
  tone = "default",
}: {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
  tone?: "default" | "teal";
}) {
  const teal = tone === "teal";
  return (
    <label
      className={cn(
        "flex flex-col gap-1 text-xs",
        teal ? "text-teal-700 dark:text-teal-300" : "text-muted-foreground",
      )}
    >
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className={cn(
          "h-9 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2",
          teal
            ? "border-teal-300 bg-teal-50 text-teal-900 focus-visible:ring-teal-500 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100"
            : "border-input bg-background text-foreground focus-visible:ring-ring",
        )}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
