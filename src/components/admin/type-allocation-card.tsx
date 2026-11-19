"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import {
  applyTypeAllocationAction,
  previewTypeAllocationAction,
} from "@/lib/actions/type-allocation";
import type { TypeAllocationPreview } from "@/lib/db/queries/type-allocation";

type Lookup = { slug: string; label: string }[];

const labelOf = (list: Lookup, slug: string) =>
  list.find((x) => x.slug === slug)?.label ?? slug;

function CountList({ counts, lookup }: { counts: Record<string, number>; lookup: Lookup }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing to change.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map(([slug, n]) => (
        <li key={slug} className="flex justify-between gap-4">
          <span>{labelOf(lookup, slug)}</span>
          <span className="font-medium tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  );
}

export function TypeAllocationCard({
  companyTypes,
  contactRoles,
}: {
  companyTypes: Lookup;
  contactRoles: Lookup;
}) {
  const [pending, startTransition] = React.useTransition();
  const [preview, setPreview] = React.useState<TypeAllocationPreview | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const changeCount = preview
    ? Object.values(preview.companies.bySlug).reduce((a, b) => a + b, 0) +
      Object.values(preview.contacts.bySlug).reduce((a, b) => a + b, 0)
    : 0;

  function runPreview() {
    setError(null);
    setMessage(null);
    setConfirmed(false);
    startTransition(async () => {
      const res = await previewTypeAllocationAction();
      if (res.error || !res.preview) {
        setPreview(null);
        setError(res.error ?? "Could not prepare the preview.");
        return;
      }
      setPreview(res.preview);
    });
  }

  function runApply() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await applyTypeAllocationAction();
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage(res.message ?? "Done.");
      // The preview is out of date now. Ask for a new one before another apply.
      setPreview(null);
      setConfirmed(false);
    });
  }

  return (
    <CollapsibleCard
      title="Auto-allocate types"
      description="Set company types and contact roles from names, web addresses and e-mail domains."
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Only records that are now &lsquo;Other&rsquo; are changed. Types you set are never
          overwritten. Date Updated is not changed.
        </p>

        <Button type="button" variant="secondary" onClick={runPreview} disabled={pending}>
          {pending && !preview ? "Working…" : "Preview"}
        </Button>

        <div aria-live="polite" className="space-y-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {message ? <Alert tone="success">{message}</Alert> : null}
        </div>

        {preview ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <section aria-labelledby="alloc-companies" className="space-y-2 rounded-md border p-3">
                <h3 id="alloc-companies" className="text-sm font-semibold">
                  Companies ({preview.companies.total} are &lsquo;Other&rsquo;)
                </h3>
                <CountList counts={preview.companies.bySlug} lookup={companyTypes} />
                <p className="text-xs text-muted-foreground">
                  Stay unchanged: {preview.companies.unchanged}
                </p>
              </section>
              <section aria-labelledby="alloc-contacts" className="space-y-2 rounded-md border p-3">
                <h3 id="alloc-contacts" className="text-sm font-semibold">
                  Contacts ({preview.contacts.total} are &lsquo;Other&rsquo;)
                </h3>
                <CountList counts={preview.contacts.bySlug} lookup={contactRoles} />
                <p className="text-xs text-muted-foreground">
                  Stay unchanged: {preview.contacts.unchanged}
                </p>
              </section>
            </div>

            {Object.keys(preview.companies.examples).length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Examples (companies)</h3>
                {Object.entries(preview.companies.examples).map(([slug, list]) => (
                  <div key={slug} className="space-y-1">
                    <p className="text-sm font-medium">{labelOf(companyTypes, slug)}</p>
                    <ul className="space-y-0.5 text-sm text-muted-foreground">
                      {list.map((ex, i) => (
                        <li key={i} className="break-words">
                          {ex.name} <span className="text-xs">({ex.reason})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-3 border-t pt-4">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>I have read the preview</span>
              </label>
              <Button
                type="button"
                onClick={runApply}
                disabled={pending || !confirmed || changeCount === 0}
              >
                {pending ? "Applying…" : "Apply"}
              </Button>
              {changeCount === 0 ? (
                <p className="text-xs text-muted-foreground">There is nothing to apply.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
