"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type LinkTab = { slug: string; label: string; href: string };

/**
 * Tabs that are links. The active tab lives in the URL (`?tab=`), so the server
 * renders only the active tab's content and only queries its data.
 *
 * Switching uses `replace`, so Back leaves the panel instead of stepping back
 * through every tab. Arrow keys, Home and End move focus between tabs;
 * Enter follows the link (manual activation, so an arrow press costs no request).
 */
export function LinkTabs({
  tabs,
  active,
  label,
  panelId,
  className,
}: {
  tabs: LinkTab[];
  active: string;
  label: string;
  /** The id of the element that holds the active tab's content. */
  panelId: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLAnchorElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex shrink-0 overflow-x-auto border-b px-2 sm:px-3", className)}
    >
      {tabs.map((t, i) => {
        const selected = t.slug === active;
        return (
          <Link
            key={t.slug}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`tab-${t.slug}`}
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            href={t.href}
            replace
            scroll={false}
            prefetch={false}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selected
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
