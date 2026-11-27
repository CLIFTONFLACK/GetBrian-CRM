import Link from "next/link";

import { ADMIN_SECTIONS, type AdminSection } from "@/lib/admin-sections";
import { cn } from "@/lib/utils";

/**
 * Section menu for the Admin page. A left column on wide screens and a row of
 * tabs on a phone. The sections are links, so a section can be bookmarked.
 */
export function AdminNav({ active }: { active: AdminSection }) {
  return (
    <nav
      aria-label="Admin sections"
      className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 md:mx-0 md:w-48 md:shrink-0 md:flex-col md:overflow-visible md:border-b-0 md:px-0"
    >
      {ADMIN_SECTIONS.map((s) => {
        const selected = s.slug === active;
        return (
          <Link
            key={s.slug}
            href={`/admin?section=${s.slug}`}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
