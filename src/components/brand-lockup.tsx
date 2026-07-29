import { cn } from "@/lib/utils";

/**
 * The "GetBrian | CRM" lockup — the mark, the wordmark, a navy rule, the tool.
 *
 * Three brand-book rules are load-bearing here and easy to break by accident:
 *
 *  1. The mark comes in three cuts and the *size* decides which. The display
 *     cut silts into mud below 40px, so anything smaller takes the compact cut,
 *     which is the same geometry with the traces thickened. Never reach for
 *     `brian-mark-solo.svg`: without its traces the B reads as a "3".
 *  2. The wordmark proper is drawn artwork. Setting it as live text in Space
 *     Grotesk Semibold, as here, is a deliberate near-match so the name stays
 *     selectable and indexable. Anywhere the wordmark is presentational —
 *     decks, social, print, favicons — use `brian-wordmark.svg` instead.
 *  3. "Get" is navy and "Brian" is gold, matching the drawn wordmark. This is
 *     the one place Brian Gold may sit on white at display size: it measures
 *     3.1:1, which WCAG exempts for logotypes but which would fail for any
 *     other text. Don't copy this colour pairing onto headings or labels — and
 *     on navy grounds it becomes Gold Light, because the on-white gold ramp
 *     goes muddy there.
 *
 * `tone="brand"` pins ink navy for the always-light public pages; `tone="app"`
 * follows the theme and swaps in the reversed mark and Gold Light on dark.
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
          "flex items-baseline font-heading font-semibold leading-none tracking-[-0.02em]",
          lg ? "text-2xl" : "text-lg",
        )}
      >
        <span className={tone === "brand" ? "text-brand-navy" : "text-foreground"}>
          Get
        </span>
        <span
          className={
            tone === "brand"
              ? "text-brand-gold"
              : "text-brand-gold dark:text-brand-gold-light"
          }
        >
          Brian
        </span>
        {/* Below 520px the product word drops and the masterbrand stands alone,
            matching ContentFlow. On a 375px header, "GetBrian | CRM" beside the
            mark crowds out the nav. */}
        <span className="flex items-baseline max-[519px]:hidden">
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
    </span>
  );
}
