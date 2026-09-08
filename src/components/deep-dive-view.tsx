"use client";

import * as React from "react";
import { useActionState } from "react";
import dynamic from "next/dynamic";
import { FileDown, Sparkles } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { runDeepDive } from "@/lib/actions/deep-dive";
import type { FormState } from "@/lib/actions/types";
import { cn } from "@/lib/utils";

export type DeepDiveReport = {
  markdown: string | null;
  created_at: string;
  model: string | null;
};

// react-markdown + remark-gfm only ship to the browser once a report actually
// needs rendering, instead of on every company detail page load.
const DeepDiveMarkdown = dynamic(() => import("./deep-dive-markdown"), {
  loading: () => <Skeleton className="h-24" />,
});

export function DeepDiveView({
  companyId,
  report,
}: {
  companyId: string;
  report: DeepDiveReport | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    runDeepDive,
    {},
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form action={action}>
          <input type="hidden" name="company_id" value={companyId} />
          <Button type="submit" disabled={pending}>
            <Sparkles />
            {pending ? "Researching…" : report?.markdown ? "Refresh Deep Dive" : "Run Deep Dive"}
          </Button>
        </form>
        {report?.markdown ? (
          <a
            href={`/companies/${companyId}/deep-dive`}
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            <FileDown />
            Download PDF
          </a>
        ) : null}
      </div>

      {pending ? (
        <p className="text-sm text-muted-foreground">
          Researching the web with AI — this usually takes 20–60 seconds.
        </p>
      ) : null}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      {report?.markdown ? (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Generated {new Date(report.created_at).toLocaleString("en-GB")}
            {report.model ? ` · ${report.model}` : ""}
          </p>
          <DeepDiveMarkdown markdown={report.markdown} />
        </div>
      ) : !pending ? (
        <p className="text-sm text-muted-foreground">
          No Deep Dive yet. Click “Run Deep Dive” to research this company with AI —
          useful for gauging long-term client value and finding an angle to close.
        </p>
      ) : null}
    </div>
  );
}
