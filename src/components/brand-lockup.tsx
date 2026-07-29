import { cn } from "@/lib/utils";

/**
 * The "Brian | CRM" lockup — the mark, the name, a navy rule, the tool.
 *
 * Two brand-book rules are load-bearing here and easy to break by accident:
 *
 *  1. The mark comes in three cuts and the *size* decides which. The display
 *     cut silts into mud below 40px, so anything smaller takes the compact cut,
 *     which is the same geometry with the traces thickened. Never reach for
 *     `brian-mark-solo.svg`: without its traces the B reads as a "3".
 *  2. The wordmark proper is drawn artwork. Setting it as live text in Space
 *     Grotesk Semibold, as here, is a deliberate near-match so the name stays
 *     selectable and indexable. Anywhere the wordmark is presentational —
 *     decks, social, print, favicons — use `brian-wordmark.svg` instead.
 *
 * `tone="brand"` pins ink navy for the always-light public pages; `tone="app"`
 * follows the theme and swaps in the reversed mark on dark grounds.
 */
export function BrandLockup({
  size = "sm",
  tone = "brand",
  className,
}: {
  size?: "sm" | "lg";
  tone?: "brand" | "app";
  className?: string;
}) {
  const lg = size === "lg";
  // 40px is the brand-book threshold between the display and compact cuts.
  const markSrc = lg ? "/brand/brian-mark.svg" : "/brand/brian-mark-compact.svg";
  const markSrcReversed = lg
    ? "/brand/brian-mark-white.svg"
    : "/brand/brian-mark-compact-white.svg";
  const markClass = lg ? "h-11 w-auto" : "h-7 w-auto";

  return (
    <span className={cn("inline-flex items-center gap-2.5", lg && "gap-3", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={markSrc}
        alt=""
        aria-hidden="true"
        className={cn(markClass, tone === "app" && "dark:hidden")}
      />
      {tone === "app" && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={markSrcReversed}
          alt=""
          aria-hidden="true"
          className={cn(markClass, "hidden dark:block")}
        />
      )}
      <span
        className={cn(
          "flex items-baseline font-heading font-semibold leading-none",
          lg ? "text-2xl" : "text-lg",
          tone === "brand" ? "text-brand-ink" : "text-foreground",
        )}
      >
        Brian
        <span
          aria-hidden="true"
          className={cn(
            "mx-2 inline-block h-[0.9em] w-0.5 self-center",
            tone === "brand" ? "bg-brand-navy-bright" : "bg-primary",
          )}
        />
        <span
          className={cn(
            "font-medium tracking-tight",
            tone === "brand" ? "text-brand-ink-muted" : "text-muted-foreground",
          )}
        >
          CRM
        </span>
      </span>
    </span>
  );
}
