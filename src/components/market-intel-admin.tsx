"use client";

import * as React from "react";
import { useActionState } from "react";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteIntelSource, resyncIntelSource } from "@/lib/actions/intel";
import type { FormState } from "@/lib/actions/types";

export interface IntelSourceStatus {
  id: string;
  label: string;
  website: string;
  hasScraper: boolean;
  /** Why this source is narrowed or unscrapeable, shown under the name. */
  note?: string | null;
  count: number;
  lastSynced: string | null; // ISO
}

function SourceRow({ source }: { source: IntelSourceStatus }) {
  const [resyncState, resyncAction, resyncPending] = useActionState<FormState, FormData>(
    resyncIntelSource,
    {},
  );
  const [deleteState, deleteAction, deletePending] = useActionState<FormState, FormData>(
    deleteIntelSource,
    {},
  );
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const pending = resyncPending || deletePending;
  const state: FormState = deleteState.error || deleteState.message ? deleteState : resyncState;

  // Collapse the confirm step once a delete lands (adjust-during-render
  // pattern — reacting to a new action result, not an external system).
  const [seenDeleteMsg, setSeenDeleteMsg] = React.useState(deleteState.message);
  if (deleteState.message !== seenDeleteMsg) {
    setSeenDeleteMsg(deleteState.message);
    if (deleteState.message) setConfirmingDelete(false);
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {source.label}
            <a
              href={source.website}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Open ${source.label} website`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {!source.hasScraper ? <Badge tone="slate">No public book</Badge> : null}
          </p>
          {source.note ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{source.note}</p>
          ) : null}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {source.count} listing{source.count === 1 ? "" : "s"}
            {source.lastSynced
              ? ` · last synced ${new Date(source.lastSynced).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : source.count === 0
                ? " · never synced"
                : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {source.hasScraper ? (
            <form action={resyncAction}>
              <input type="hidden" name="source" value={source.id} />
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                <RefreshCw className={resyncPending ? "animate-spin" : ""} />
                {resyncPending ? "Syncing…" : "Resync"}
              </Button>
            </form>
          ) : null}
          {confirmingDelete ? (
            <form action={deleteAction}>
              <input type="hidden" name="source" value={source.id} />
              <Button type="submit" size="sm" variant="destructive" disabled={pending}>
                {deletePending ? "Deleting…" : `Really delete ${source.count}?`}
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || source.count === 0}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 />
              Delete data
            </Button>
          )}
          {confirmingDelete && !deletePending ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {resyncPending ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Scraping {source.label} live — this can take a minute…
        </p>
      ) : null}
      {state.error ? (
        <div className="mt-2">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      {state.message ? (
        <div className="mt-2">
          <Alert tone="success">{state.message}</Alert>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Admin → Market Intel: one row per partner source with live count, last
 * synced date, and Resync (live re-scrape) / Delete (drop this source's intel
 * rows) actions.
 */
export function MarketIntelAdmin({ sources }: { sources: IntelSourceStatus[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Partner-agent stock scraped into the Market Intel silo. Resync replaces a
        source&apos;s listings with its current live book; existing data is kept if a
        scrape fails.
      </p>
      {sources.map((s) => (
        <SourceRow key={s.id} source={s} />
      ))}
    </div>
  );
}
