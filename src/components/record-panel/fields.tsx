import * as React from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Small display helpers shared by the three panels. Server-safe: no "use client".

/** Padding wrapper for one tab's content. */
export function PanelSection({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-3 px-4 py-4 sm:px-5", className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3">
          {title ? (
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Label and value on one row. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * A link that opens another record in the panel. `replace` keeps the panel one
 * history entry above the list, so Back closes it. `scroll={false}` keeps the
 * list where it is. The href is built by the caller (see record-ref.ts).
 */
export function PanelLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      replace
      scroll={false}
      prefetch={false}
      className={cn(
        "font-medium text-foreground hover:text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** A row of small badges for a plain string array, or an em dash when empty. */
export function ChipList({
  items,
  tone,
}: {
  items: readonly string[];
  tone: React.ComponentProps<typeof Badge>["tone"];
}) {
  if (items.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <Badge key={v} tone={tone}>
          {v}
        </Badge>
      ))}
    </span>
  );
}

export function BadgeList({
  items,
}: {
  items: { tone: React.ComponentProps<typeof Badge>["tone"]; label: string }[];
}) {
  if (items.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <Badge key={i} tone={it.tone}>
          {it.label}
        </Badge>
      ))}
    </span>
  );
}

export function band(min: number | null, max: number | null, unit = "") {
  if (min == null && max == null) return "—";
  if (min != null && max != null)
    return `${min.toLocaleString("en-GB")}–${max.toLocaleString("en-GB")}${unit}`;
  if (min != null) return `${min.toLocaleString("en-GB")}${unit}+`;
  return `up to ${max!.toLocaleString("en-GB")}${unit}`;
}

export const money = (v: number | null) =>
  v != null ? `£${v.toLocaleString("en-GB")}` : "—";
