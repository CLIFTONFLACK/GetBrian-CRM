import { Suspense } from "react";

import { CompanyPanel } from "@/components/record-panel/company-panel";
import { ContactPanel } from "@/components/record-panel/contact-panel";
import { DealPanel } from "@/components/record-panel/deal-panel";
import PanelErrorBoundary from "@/components/record-panel/panel-error-boundary";
import { ListingPanel } from "@/components/record-panel/listing-panel";
import {
  PanelSkeleton,
  RecordNotFound,
} from "@/components/record-panel/panel-frame";
import { RequirementPanel } from "@/components/record-panel/requirement-panel";
import { Sheet } from "@/components/ui/sheet";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  closeRecordHref,
  fullRecordHref,
  parseRecordRef,
  parseTab,
  type RecordRef,
  type SearchParamsLike,
} from "@/lib/record-ref";

/**
 * Mounted by the list pages. Reads the raw `record` and `tab` search params,
 * validates them, and renders nothing unless `record` is a known type and a
 * uuid. `base` is the page's other params (no `record`, no `tab`), used to build
 * every link in the panel. The shell (backdrop, slide-in, focus) stays mounted
 * while the data under it streams in. An error in the panel shows a message
 * inside the sheet and leaves the page alone.
 */
export function RecordPanelHost({
  recordParam,
  tabParam,
  flexParam,
  base,
}: {
  recordParam: unknown;
  tabParam: unknown;
  flexParam?: string;
  base: SearchParamsLike;
}) {
  const record = parseRecordRef(recordParam);
  if (!record) return null;
  const tab = parseTab(record.type, tabParam);
  return (
    <Sheet closeHref={closeRecordHref(base)}>
      <PanelErrorBoundary
        closeHref={closeRecordHref(base)}
        fullHref={fullRecordHref(record)}
      >
        {/* Keyed by record only. A tab change keeps the header and the tab strip
            mounted (PanelFrame has its own Suspense for the tab content). */}
        <Suspense
          key={`${record.type}:${record.id}`}
          fallback={<PanelSkeleton record={record} />}
        >
          <RecordPanel record={record} tab={tab} base={base} flexParam={flexParam} />
        </Suspense>
      </PanelErrorBoundary>
    </Sheet>
  );
}

/**
 * Checks the session and agency the same way the record pages do, then picks the
 * panel for the record type. No session, no agency and a record in another
 * agency all end in the same "Record not found" panel.
 */
export async function RecordPanel({
  record,
  tab,
  base,
  flexParam,
}: {
  record: RecordRef;
  tab: string;
  base: SearchParamsLike;
  flexParam?: string;
}) {
  if (!isDbConfigured) return <RecordNotFound />;
  const session = await auth();
  if (!session?.user) return <RecordNotFound />;
  const userId = session.user.id;
  const agencyId = await currentAgencyId(userId);
  if (!agencyId) return <RecordNotFound />;

  switch (record.type) {
    case "company":
      return (
        <CompanyPanel agencyId={agencyId} userId={userId} record={record} tab={tab} base={base} />
      );
    case "contact":
      return (
        <ContactPanel agencyId={agencyId} userId={userId} record={record} tab={tab} base={base} />
      );
    case "listing":
      return (
        <ListingPanel
          agencyId={agencyId}
          userId={userId}
          record={record}
          tab={tab}
          base={base}
          flexParam={flexParam}
        />
      );
    case "deal":
      return (
        <DealPanel agencyId={agencyId} userId={userId} record={record} tab={tab} base={base} />
      );
    case "requirement":
      return (
        <RequirementPanel
          agencyId={agencyId}
          userId={userId}
          record={record}
          tab={tab}
          base={base}
          flexParam={flexParam}
        />
      );
  }
}
