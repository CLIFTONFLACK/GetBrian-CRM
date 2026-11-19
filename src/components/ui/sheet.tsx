"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";

import { cn } from "@/lib/utils";

/** The id the dialog points at with aria-labelledby. SheetHeader renders it. */
export const SHEET_TITLE_ID = "sheet-title";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const subscribeNever = () => () => {};

const CloseContext =React.createContext<() => void>(() => {});

/**
 * Right-side panel, modelled on ui/modal.tsx: portalled to <body>, Escape and
 * backdrop click close it, focus moves in and returns to the opener, the body
 * does not scroll behind it.
 *
 * It is controlled by the URL, not by state. The server renders it only while
 * `?record=` is valid, and closing is a navigation to `closeHref`. Because it
 * stays mounted while the record or tab changes, focus and the slide-in run
 * once, not on every tab click.
 */
export function Sheet({
  closeHref,
  children,
}: {
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const panelRef = React.useRef<HTMLDivElement>(null);
  // Rendered only on the client: the server cannot make a portal, and a portal
  // on the first client render would not match the server HTML.
  const mounted = React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [entered, setEntered] = React.useState(false);

  // Close REPLACES the current history entry. Opening the panel pushed one
  // entry (`?record=`), and moving inside the panel (tabs, record links) replaces
  // it, so the panel is always exactly one entry above the list. Replacing that
  // entry with the list URL leaves no entry that reopens the panel on Back. A
  // push here would add the list entry after it, and Back would reopen the panel.
  // The same holds when the page was loaded directly on a panel URL: the entry
  // is replaced and Back goes to whatever came before the page.
  const close = React.useCallback(() => {
    router.replace(closeHref, { scroll: false });
  }, [router, closeHref]);
  const closeRef = React.useRef(close);
  React.useEffect(() => {
    closeRef.current = close;
  });

  React.useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    if (!panel) return;

    const opener = document.activeElement as HTMLElement | null;

    // Slide in. Reading offsetWidth flushes the starting transform first.
    void panel.offsetWidth;
    setEntered(true);
    panel.focus({ preventScroll: true });

    // Lock page scroll, and keep the width the scrollbar used to take so the
    // list behind the backdrop does not shift.
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const otherDialogOpen = () =>
      Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
        (el) => el !== panel,
      );

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A Modal opened from inside the panel closes first.
      if (otherDialogOpen()) return;
      closeRef.current();
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (!target || panel.contains(target)) return;
      if (target.closest('[aria-modal="true"]')) return;
      panel.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      if (opener && opener.isConnected && opener !== document.body) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [mounted]);

  // Keep Tab inside the panel. A Modal portalled out of the panel bubbles its
  // key events here through React, so only handle keys from inside the panel.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel || !panel.contains(e.target as Node)) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0,
    );
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <CloseContext.Provider value={close}>
      <div className="fixed inset-0 z-50">
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none",
            entered ? "opacity-100" : "opacity-0",
          )}
          onClick={close}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={SHEET_TITLE_ID}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn(
            "absolute inset-y-0 right-0 flex w-full flex-col border-l bg-card text-sm text-card-foreground shadow-xl outline-none",
            "sm:w-[640px] sm:max-w-[90vw]",
            "transition-transform duration-200 motion-reduce:transition-none",
            entered ? "translate-x-0" : "translate-x-full",
          )}
        >
          {children}
        </div>
      </div>
    </CloseContext.Provider>,
    document.body,
  );
}

/** Title, type badge, link to the full page and the close button. */
export function SheetHeader({
  title,
  badge,
  fullHref,
}: {
  title: string;
  badge?: React.ReactNode;
  fullHref?: string;
}) {
  const close = React.useContext(CloseContext);
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <h2
          id={SHEET_TITLE_ID}
          className="truncate text-base font-semibold text-foreground"
        >
          {title}
        </h2>
        {badge}
      </div>
      {fullHref ? (
        <Link
          href={fullHref}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-info transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          <span className="max-sm:sr-only">Open full page</span>
          <span className="sm:hidden" aria-hidden="true">
            Full page
          </span>
        </Link>
      ) : null}
      <button
        type="button"
        onClick={close}
        aria-label="Close panel"
        className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The scrolling part below the header. */
export function SheetBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}>
      {children}
    </div>
  );
}
