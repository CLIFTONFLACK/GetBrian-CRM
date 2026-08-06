"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Thumb-zone CTA for phones.
 *
 * The landing page has no in-page section nav — the header is lockup, Sign in
 * and Start free — so there is nothing for a bottom tab bar to navigate to.
 * What a phone visitor does lose is the primary action, which scrolls away
 * with the hero and does not come back until the closing panel. This docks it.
 *
 * Hidden from `md` up, where the header CTA is in view for the whole page.
 */
export function StickyCta({
  href,
  label,
  watchId,
}: {
  href: string;
  label: string;
  /** Element whose passing out of view arms the bar — normally the hero CTA. */
  watchId: string;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target) return;

    // An observer rather than a scroll listener: no per-frame work, and it
    // self-corrects when the layout reflows as fonts and images land.
    const io = new IntersectionObserver(
      ([entry]) => {
        setShown(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [watchId]);

  return (
    <div
      // The bottom padding picks up the iPhone home-indicator inset and
      // collapses to 0.75rem on hardware without one. Depends on
      // viewport-fit=cover, set in layout.tsx.
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-brand-rule bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md transition-transform duration-300 md:hidden ${
        shown ? "translate-y-0" : "translate-y-full"
      }`}
      inert={!shown}
    >
      <Link
        href={href}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-brand-gold px-6 font-heading text-base font-semibold text-brand-ink transition-colors duration-200 hover:bg-brand-gold-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright focus-visible:ring-offset-2"
      >
        {label}
      </Link>
    </div>
  );
}
