"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { unstable_catchError, type ErrorInfo } from "next/error";

import { SheetBody, SheetHeader } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { closeHref: string; fullHref: string };

/**
 * What the panel shows when its server render or a client part throws: the
 * sheet stays, the page behind it stays, and the user gets a way out.
 *
 * The boundary is Next's documented component-level one (`unstable_catchError`,
 * node_modules/next/dist/docs/.../catchError.md), not a hand-written class: it
 * lets redirect() and notFound() through. Next clears its state on a route
 * change, but `?record=` and `?tab=` changes stay on the same route, so the
 * view below watches those two params and calls `reset()` when either changes.
 * A different record or tab then renders normally again.
 */
function PanelError({ closeHref, fullHref }: Props, { error, reset }: ErrorInfo) {
  return (
    <PanelErrorView error={error} reset={reset} closeHref={closeHref} fullHref={fullHref} />
  );
}

function PanelErrorView({
  error,
  reset,
  closeHref,
  fullHref,
}: Props & { error: Error; reset: () => void }) {
  const params = useSearchParams();
  const current = `${params.get("record") ?? ""}|${params.get("tab") ?? ""}`;
  const [failedAt] = React.useState(current);

  React.useEffect(() => {
    console.error("Records panel failed to load:", error);
  }, [error]);

  React.useEffect(() => {
    if (current !== failedAt) reset();
  }, [current, failedAt, reset]);

  return (
    <>
      <SheetHeader title="Record not available" />
      <SheetBody>
        <div className="space-y-4 px-4 py-6 sm:px-5" role="alert">
          <p className="text-sm text-foreground">This record could not be loaded.</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={closeHref}
              replace
              scroll={false}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              Close
            </Link>
            <Link
              href={fullHref}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Open full page
            </Link>
          </div>
        </div>
      </SheetBody>
    </>
  );
}

export default unstable_catchError(PanelError);
