import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A prominent CDG / Market Intel toggle — deliberately not another dropdown
 * inside the filter bar, since that's easy to miss. Sits directly under the
 * page header on /listings and /matches.
 */
export function SiloTabs({
  value,
  hrefFor,
  counts,
  allValue = null,
}: {
  value?: string;
  hrefFor: (value: string | null) => string;
  counts: { all: number; cdg: number; intel: number };
  /**
   * What "All" posts as. Null (the default) drops the param — right where the
   * unfiltered view is the default. /listings defaults to CDG instead, so it
   * passes an explicit "all" that has to survive in the URL.
   */
  allValue?: string | null;
}) {
  const tabs: { value: string | null; label: string; count: number }[] = [
    { value: allValue, label: "All", count: counts.all },
    { value: "cdg", label: "CDG listings", count: counts.cdg },
    { value: "intel", label: "Market Intel", count: counts.intel },
  ];
  return (
    <div className="mb-4 inline-flex rounded-lg border bg-muted/40 p-1">
      {tabs.map((t) => {
        const active = (value ?? null) === t.value;
        return (
          <Link
            key={t.label}
            href={hrefFor(t.value)}
            aria-pressed={active}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="ml-1.5 font-mono text-xs tabular-nums opacity-70">
              {t.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
