import * as React from "react";

import { SheetBody, SheetHeader } from "@/components/ui/sheet";
import { LinkTabs } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fullRecordHref,
  RECORD_TABS,
  tabHref,
  type RecordRef,
  type SearchParamsLike,
} from "@/lib/record-ref";

export const TABPANEL_ID = "record-tabpanel";

/** Header, tab strip and the scrolling content of the active tab. */
export function PanelFrame({
  record,
  tab,
  base,
  title,
  badge,
  children,
}: {
  record: RecordRef;
  tab: string;
  base: SearchParamsLike;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tabs = RECORD_TABS[record.type].map((t) => ({
    ...t,
    href: tabHref(base, record, t.slug),
  }));
  return (
    <>
      <SheetHeader title={title} badge={badge} fullHref={fullRecordHref(record)} />
      <LinkTabs
        tabs={tabs}
        active={tab}
        label={`${title} sections`}
        panelId={TABPANEL_ID}
      />
      <SheetBody>
        <div role="tabpanel" id={TABPANEL_ID} aria-labelledby={`tab-${tab}`}>
          {/* Only the tab content waits. The header and the tab strip stay
              mounted when the tab changes, so keyboard focus stays on the tab
              that was activated. */}
          <React.Suspense key={tab} fallback={<TabSkeleton />}>
            {children}
          </React.Suspense>
        </div>
      </SheetBody>
    </>
  );
}

/**
 * One panel for a missing record, a record in another agency, and a record the
 * caller cannot read. The text is the same for all three, so it cannot be used
 * to find out whether an id exists somewhere else.
 */
export function RecordNotFound() {
  return (
    <>
      <SheetHeader title="Record not found" />
      <SheetBody>
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          This record does not exist, or you do not have access to it.
        </p>
      </SheetBody>
    </>
  );
}

/** Shown in the tab area while one tab's data loads. */
export function TabSkeleton() {
  return (
    <div className="space-y-3 px-4 py-4 sm:px-5" aria-busy="true">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

/** Shown while the panel's data loads. Same header and tab height as the real panel, so nothing jumps. */
export function PanelSkeleton({ record }: { record: RecordRef }) {
  return (
    <>
      <SheetHeader title="Loading…" fullHref={fullRecordHref(record)} />
      <div className="h-11 shrink-0 border-b" />
      <SheetBody>
        <TabSkeleton />
      </SheetBody>
    </>
  );
}
