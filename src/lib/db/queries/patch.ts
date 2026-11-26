import { sql } from "@/lib/db/client";
import { buildPatchSql, PATCHABLE_TABLES, type PatchableTable } from "@/lib/db/queries/patch-sql";

/**
 * Write the given columns of one row, scoped to the agency. With
 * `expectedUpdatedAt` the write also needs the row to be unchanged since the
 * editor loaded it. The column names must come from a code allow-list (see
 * src/lib/panel-fields), never from a client; buildPatchSql checks their shape
 * as a second guard.
 *
 * Returns the new `updated_at`, or null when no row matched (missing, another
 * agency, or changed since it was loaded).
 */
export async function patchRow(
  table: PatchableTable,
  agencyId: string,
  id: string,
  values: Record<string, unknown>,
  expectedUpdatedAt?: string,
): Promise<{ updated_at: string } | null> {
  const lock = expectedUpdatedAt != null;
  const q = buildPatchSql(table, values, { lock });
  const params = [...q.params, id, agencyId, ...(lock ? [expectedUpdatedAt] : [])];
  const rows = (await sql.query(q.text, params)) as { id: string; updated_at: string }[];
  return rows[0] ? { updated_at: rows[0].updated_at } : null;
}

/** True when the row exists in this agency. Tells "gone" apart from "changed" after a null patch. */
export async function rowExists(table: PatchableTable, agencyId: string, id: string): Promise<boolean> {
  if (!(PATCHABLE_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Table is not patchable: ${table}`);
  }
  const rows = await sql.query(`select 1 from public.${table} where id = $1 and agency_id = $2 limit 1`, [
    id,
    agencyId,
  ]);
  return rows.length > 0;
}
