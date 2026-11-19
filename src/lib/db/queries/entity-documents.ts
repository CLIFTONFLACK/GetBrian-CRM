import { sql } from "@/lib/db/client";
import { touchDateUpdated } from "@/lib/db/queries/date-updated";
import type { EntityDocType } from "@/lib/entity-docs";

// DAO for public.entity_documents (db/migrations/0045): files attached to a
// company or a contact. Mirrors the requirement-document functions in
// requirements.ts. Every function takes the caller's agencyId first and filters
// on it. `file_path` is the raw Blob URL: it stays on the server, and only the
// signed proxy link (src/lib/entity-doc-sign.ts) reaches the browser.

export type EntityDocumentRow = {
  id: string;
  entity_type: EntityDocType;
  entity_id: string;
  file_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
};

const COLUMNS = `id, entity_type, entity_id, file_path, file_name, content_type, size_bytes::float8 as size_bytes`;

export async function listEntityDocuments(
  agencyId: string,
  entityType: EntityDocType,
  entityId: string,
): Promise<EntityDocumentRow[]> {
  return (await sql`
    select ${sql.unsafe(COLUMNS)}
    from public.entity_documents
    where agency_id = ${agencyId} and entity_type = ${entityType} and entity_id = ${entityId}
    order by created_at desc
  `) as EntityDocumentRow[];
}

/** Agency-scoped single lookup. Null for "no such document" and for "another
 *  agency's document", so a probe cannot tell the two apart. */
export async function getEntityDocumentById(
  agencyId: string,
  id: string,
): Promise<EntityDocumentRow | null> {
  const rows = await sql`
    select ${sql.unsafe(COLUMNS)}
    from public.entity_documents
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as EntityDocumentRow | undefined) ?? null;
}

/**
 * NOT agency-scoped. Safe only after the caller proved access another way: the
 * download route's signed-token path, where the HMAC can only have been made by
 * signEntityDocUrl, which did the agency-scoped check. Never call this anywhere
 * that has not checked access first.
 */
export async function getEntityDocumentByIdUnsafe(
  id: string,
): Promise<EntityDocumentRow | null> {
  const rows = await sql`
    select ${sql.unsafe(COLUMNS)}
    from public.entity_documents
    where id = ${id}
    limit 1
  `;
  return (rows[0] as EntityDocumentRow | undefined) ?? null;
}

export async function addEntityDocumentRow(
  agencyId: string,
  entityType: EntityDocType,
  entityId: string,
  uploadedBy: string,
  input: {
    fileName: string;
    filePath: string;
    contentType: string | null;
    sizeBytes: number | null;
  },
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.entity_documents
      (agency_id, entity_type, entity_id, file_path, file_name, content_type, size_bytes, uploaded_by)
    values
      (${agencyId}, ${entityType}, ${entityId}, ${input.filePath}, ${input.fileName},
       ${input.contentType}, ${input.sizeBytes}, ${uploadedBy})
    returning id
  `;
  await touchDateUpdated(entityType, entityId, agencyId);
  return rows[0] as { id: string };
}

/** Deletes the row, scoped to the caller's agency, FIRST. The caller removes
 *  the Blob object only when a row it owned came back. */
export async function deleteEntityDocumentRow(
  agencyId: string,
  id: string,
): Promise<{ file_path: string; entity_type: EntityDocType; entity_id: string } | null> {
  const rows = await sql`
    delete from public.entity_documents
    where id = ${id} and agency_id = ${agencyId}
    returning file_path, entity_type, entity_id
  `;
  const row = rows[0] as
    | { file_path: string; entity_type: EntityDocType; entity_id: string }
    | undefined;
  if (!row) return null;
  await touchDateUpdated(row.entity_type, row.entity_id, agencyId);
  return row;
}
