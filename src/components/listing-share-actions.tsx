"use client";

import * as React from "react";
import { Printer, Send, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Share / Print / Post-to-CDG actions for a listing (#4). All client-side and
 * genuinely wired: Share uses the Web Share API (falling back to copy-link),
 * Print opens the browser print dialog, and Post to CDG copies a formatted
 * particulars summary to the clipboard for pasting into CDG's submission form.
 */
export function ListingShareActions({
  title,
  summary,
}: {
  title: string;
  summary?: string;
}) {
  const [copied, setCopied] = React.useState<null | "link" | "cdg">(null);

  function flash(which: "link" | "cdg") {
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flash("link");
    } catch {
      /* clipboard unavailable */
    }
  }

  async function handlePostToCdg() {
    const url = window.location.href;
    const text = [title, summary, "", url, "", "Submitted via Brian | CRM for listing on CDG Leisure."]
      .filter((line) => line !== undefined)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      flash("cdg");
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={handleShare}>
        <Share2 />
        {copied === "link" ? "Link copied" : "Share"}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
        <Printer />
        Print
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={handlePostToCdg}>
        <Send />
        {copied === "cdg" ? "Copied" : "Post to CDG"}
      </Button>
    </>
  );
}
