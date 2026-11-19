"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Anything inside a row that already does something on click. A click on one of
// these keeps its own behaviour and does not open the panel. Put
// `data-no-row-click` on a cell to opt the whole cell out (the select checkbox).
const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, form, [role="button"], [role="checkbox"], [role="link"], [role="listbox"], [data-no-row-click]';

const isPlainLeftClick = (e: React.MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * Shared click rule for a row or a card: a plain left click that did not start
 * on something interactive, and did not end a text selection, opens the record.
 */
function shouldOpen(e: React.MouseEvent<HTMLElement>): boolean {
  if (e.defaultPrevented || !isPlainLeftClick(e)) return false;
  const target = e.target as Element;
  // Portalled content (a modal opened from a cell) bubbles here through React.
  if (!e.currentTarget.contains(target)) return false;
  const interactive = target.closest(INTERACTIVE);
  if (interactive && e.currentTarget.contains(interactive)) return false;
  // Selecting text to copy it is not a request to open the record.
  if (window.getSelection()?.toString()) return false;
  return true;
}

/**
 * A table row that opens a record in the panel on click and on Enter.
 *
 * `href` is the current page's URL plus `?record=`. The name cell keeps its own
 * real link (RecordLink), so keyboard users tab to that. The row itself is not
 * a tab stop; it can still hold focus after a click, and Enter then opens it.
 */
export function RowLink({
  href,
  active,
  className,
  children,
}: {
  href: string;
  /** This row's record is the one open in the panel. */
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const open = () => router.push(href, { scroll: false });

  const onClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    if (shouldOpen(e)) open();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key !== "Enter" || e.target !== e.currentTarget) return;
    e.preventDefault();
    open();
  };

  return (
    <TableRow
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      data-state={active ? "selected" : undefined}
      className={cn(
        "cursor-pointer focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active && "bg-muted/60",
        className,
      )}
    >
      {children}
    </TableRow>
  );
}

/**
 * The same as RowLink for a card (the pipeline board). Anything inside the card
 * that already does something on click, such as the inline title editor, the
 * stage select and the "View deal" link, keeps its own behaviour and does not
 * open the panel.
 */
export function CardLink({
  href,
  active,
  className,
  children,
}: {
  href: string;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const open = () => router.push(href, { scroll: false });

  return (
    <article
      tabIndex={-1}
      onClick={(e) => {
        if (shouldOpen(e)) open();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.target !== e.currentTarget) return;
        e.preventDefault();
        open();
      }}
      className={cn(
        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
        active && "border-primary/60 bg-muted/60",
      )}
    >
      {children}
    </article>
  );
}

/**
 * The link in a row's name cell. Its href is the full record page, so Ctrl,
 * Cmd, Shift and middle click open that page in a new tab or window. A plain
 * left click opens the panel instead.
 */
export function RecordLink({
  href,
  openHref,
  className,
  children,
}: {
  /** Full record page. */
  href: string;
  /** Current page plus `?record=`. */
  openHref: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={(e) => {
        if (e.defaultPrevented || !isPlainLeftClick(e)) return;
        e.preventDefault();
        router.push(openHref, { scroll: false });
      }}
      className={cn(
        "font-medium text-foreground hover:text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}
