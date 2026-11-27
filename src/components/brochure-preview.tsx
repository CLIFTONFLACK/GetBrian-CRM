"use client";

import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Page 1 of the brochure as a thumbnail that opens the PDF. When no image is
 * stored yet, it asks the server to make one once (the first time a panel is
 * opened for the listing) and shows a placeholder meanwhile. The caller sets a
 * `key` built from the props, so a new link or image remounts it with fresh state.
 */
export function BrochurePreview({
  disposalId,
  brochureUrl,
  previewUrl,
  tryOnMount,
}: {
  disposalId: string;
  brochureUrl: string;
  /** The stored, current image, or null. */
  previewUrl: string | null;
  /** False when a recent try already failed: show the link only. */
  tryOnMount: boolean;
}) {
  const [url, setUrl] = React.useState<string | null>(previewUrl);
  const [state, setState] = React.useState<"idle" | "loading" | "failed">(
    previewUrl || !tryOnMount ? "idle" : "loading",
  );

  React.useEffect(() => {
    if (url || !tryOnMount) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/listings/${encodeURIComponent(disposalId)}/brochure-preview`, {
          method: "POST",
          signal: ctrl.signal,
        });
        const body = (await res.json().catch(() => null)) as { url?: string | null } | null;
        if (ctrl.signal.aborted) return;
        if (res.ok && body?.url) {
          setUrl(body.url);
          setState("idle");
        } else {
          setState("failed");
        }
      } catch {
        if (!ctrl.signal.aborted) setState("failed");
      }
    })();
    return () => ctrl.abort();
  }, [url, tryOnMount, disposalId, brochureUrl]);

  if (url) {
    return (
      <a
        href={brochureUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open the brochure"
        className="block w-40 overflow-hidden rounded-md border bg-muted transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored Blob image of unknown size */}
        <img src={url} alt="Brochure, page 1" className="h-auto w-full" loading="lazy" />
      </a>
    );
  }
  if (state === "loading") {
    return (
      <div className="w-40" aria-busy="true" aria-label="Preparing the brochure preview">
        <Skeleton className="aspect-[3/4] w-full" />
      </div>
    );
  }
  return (
    <a
      href={brochureUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-info hover:underline"
    >
      Open the brochure
    </a>
  );
}
