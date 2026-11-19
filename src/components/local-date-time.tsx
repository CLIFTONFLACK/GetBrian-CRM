"use client";

import * as React from "react";

import { formatLondonDateTime, pgTimestampToIso } from "@/lib/format-date";

const noopSubscribe = () => () => {};

/**
 * An instant shown in the viewer's own time zone ("18 Nov 2026, 14:30").
 *
 * The server does not know the viewer's zone. The server render and the first
 * client render show the Europe/London time, so both match and there is no
 * hydration mismatch. After mount the browser zone replaces it. The server
 * snapshot (null) is used during hydration, then React switches to the
 * client snapshot.
 */
export function LocalDateTime({ iso, className }: { iso: string; className?: string }) {
  const local = React.useSyncExternalStore(
    noopSubscribe,
    () => {
      const d = new Date(pgTimestampToIso(iso));
      return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    },
    () => null,
  );
  return (
    <span className={className} suppressHydrationWarning>
      {local ?? formatLondonDateTime(iso)}
    </span>
  );
}
