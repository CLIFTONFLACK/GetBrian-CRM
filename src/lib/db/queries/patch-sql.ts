// Builds the UPDATE for a narrow field patch. Pure, so the rules can be tested:
// the table and every column must come from an allow-list, the values travel as
// parameters, and the row is always matched on the agency (tenant isolation).
// A caller that writes several columns at once (an address) also passes the
// updated_at it loaded, as an optimistic lock.

export const PATCHABLE_TABLES = ["companies", "contacts", "disposals", "requirements"] as const;
export type PatchableTable = (typeof PATCHABLE_TABLES)[number];

const COLUMN = /^[a-z][a-z0-9_]*$/;

/**
 * The statement and its parameters. The caller appends, in this order: the row
 * id, the agency id and, when `lock` is true, the expected updated_at.
 */
export function buildPatchSql(
  table: string,
  values: Record<string, unknown>,
  opts: { lock?: boolean } = {},
): { text: string; params: unknown[]; columns: string[] } {
  if (!(PATCHABLE_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Table is not patchable: ${table}`);
  }
  const columns = Object.keys(values);
  if (columns.length === 0) throw new Error("A patch needs at least one column.");
  for (const c of columns) {
    if (!COLUMN.test(c)) throw new Error(`Bad column name: ${c}`);
  }
  const params: unknown[] = columns.map((c) => values[c]);
  const sets = columns.map((c, i) => `${c} = $${i + 1}`).join(", ");
  const n = columns.length;
  const lock = opts.lock ? ` and updated_at = $${n + 3}` : "";
  return {
    text: `update public.${table} set ${sets} where id = $${n + 1} and agency_id = $${n + 2}${lock} returning id, updated_at::text as updated_at`,
    params,
    columns,
  };
}
