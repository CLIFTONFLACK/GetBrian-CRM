import { EntityDocuments } from "@/components/entity-documents";
import { EmptyNote, PanelSection } from "@/components/record-panel/fields";
import { listEntityDocuments } from "@/lib/db/queries/entity-documents";
import { signEntityDocUrl } from "@/lib/entity-doc-sign";
import { isEntityDocType } from "@/lib/entity-docs";

import type { RecordTabProps } from "./placeholder";

/**
 * Uploads tab for a company or a contact. A requirement keeps its own
 * (RequirementDocuments). `file_path`, the raw Blob URL, stays on the server:
 * only the signed one-hour proxy link goes to the browser.
 */
export async function UploadsTab({ entityType, entityId, agencyId }: RecordTabProps) {
  if (!isEntityDocType(entityType)) return null;
  let docs: { id: string; name: string; size_bytes: number | null; url: string | null }[];
  try {
    const rows = await listEntityDocuments(agencyId, entityType, entityId);
    docs = await Promise.all(
      rows.map(async (d) => ({
        id: d.id,
        name: d.file_name,
        size_bytes: d.size_bytes,
        url: await signEntityDocUrl(agencyId, d.id),
      })),
    );
  } catch (err) {
    // A missing DOC_SIGNING_SECRET, or the table not created yet (migration
    // 0045 not applied). The rest of the panel keeps working.
    console.error("Uploads tab: documents could not be loaded", err);
    return (
      <PanelSection title="Documents">
        <EmptyNote>Documents are not available.</EmptyNote>
      </PanelSection>
    );
  }
  return (
    <PanelSection title="Documents">
      <p className="text-sm text-muted-foreground">
        Files held against this record. Download links are private and expire after an hour.
      </p>
      <EntityDocuments entityType={entityType} entityId={entityId} docs={docs} />
    </PanelSection>
  );
}
