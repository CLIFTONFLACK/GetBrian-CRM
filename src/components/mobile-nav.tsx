"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { NAV, visibleItems } from "@/components/app-sidebar";
import { BrandLockup } from "@/components/brand-lockup";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

/**
 * Mobile navigation — a hamburger + slide-in drawer that mirrors AppSidebar.
 * The sidebar itself is `hidden md:flex`, so without this an agent on a phone
 * has no navigation at all. Reuses the same NAV config so labels never drift.
 */
export function MobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  // Lock body scroll + Esc-to-close while the drawer is open; move focus into
  // the drawer on open and restore it to the trigger on close.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      trigger?.focus();
    };
  }, [open]);

  // The drawer is portaled to <body> so its `fixed inset-0` is sized against the
  // viewport. Rendering it inside the sticky TopBar — which has `backdrop-blur`,
  // a containing block for fixed descendants — collapsed it to the header's
  // 56px height, hiding all nav links on mobile. `open` is only ever set by a
  // client click, so createPortal never runs during SSR.
  const drawer = open
    ? createPortal(
          <div
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div
              className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground shadow-lg">
            <div className="flex h-16 items-center justify-between gap-2 border-b px-4">
              <BrandLockup tone="app" />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
              {NAV.map((group) => {
                const items = visibleItems(group.items, isAdmin);
                if (items.length === 0) return null;
                return (
                  <div key={group.label}>
                    <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </p>
                    <ul className="space-y-0.5">
                      {items.map((item) => {
                        const Icon = item.icon;
                        if (item.action === "signout") {
                          return (
                            <li key={item.label}>
                              <form action={signOut}>
                                <button
                                  type="submit"
                                  className="flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
                                >
                                  <Icon className="h-[18px] w-[18px] shrink-0" />
                                  {item.label}
                                </button>
                              </form>
                            </li>
                          );
                        }
                        const active =
                          pathname === item.href ||
                          pathname.startsWith(item.href + "/");
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                              onClick={() => setOpen(false)}
                              className={cn(
                                "flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                                active
                                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                              )}
                            >
                              <Icon className="h-[18px] w-[18px] shrink-0" />
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </nav>
          </aside>
        </div>,
          document.body,
        )
      : null;

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Menu className="h-5 w-5" />
      </button>
      {drawer}
    </div>
  );
}
