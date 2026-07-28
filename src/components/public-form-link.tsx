"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Link2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The public intake form's address, on the page that reviews what it produces —
 * the form is the whole reason submissions appear here, but there was no way to
 * reach or share it from inside the app.
 *
 * The absolute URL is resolved on the server (from the request host) and passed
 * in, so the shareable link is right there in the first paint rather than
 * appearing once JS lands.
 */
export function PublicFormLink({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the link is on screen to copy by hand */
    }
  }

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 sm:pt-6">
        <div className="flex min-w-0 items-start gap-3">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Public requirement form</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{url}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Link
            href={url}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <ExternalLink />
            Open
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
