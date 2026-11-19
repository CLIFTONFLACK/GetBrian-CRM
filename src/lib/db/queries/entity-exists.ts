import { sql } from "@/lib/db/client";
import type { TaskEntityType } from "@/lib/task-entity";

/**
 * True when the record exists in the caller's agency. Used before a task or an
 * upload is attached to a record, so a caller cannot point work at another
 * agency's id. One explicit statement per table: no table name is ever built
 * from input. An unknown type is false.
 */
export async function entityExistsInAgency(
  agencyId: string,
  entityType: TaskEntityType,
  entityId: string,
): Promise<boolean> {
  let rows: unknown[];
  switch (entityType) {
    case "company":
      rows = await sql`select 1 from public.companies where id = ${entityId} and agency_id = ${agencyId} limit 1`;
      break;
    case "contact":
      rows = await sql`select 1 from public.contacts where id = ${entityId} and agency_id = ${agencyId} limit 1`;
      break;
    case "requirement":
      rows = await sql`select 1 from public.requirements where id = ${entityId} and agency_id = ${agencyId} limit 1`;
      break;
    case "listing":
      rows = await sql`select 1 from public.disposals where id = ${entityId} and agency_id = ${agencyId} limit 1`;
      break;
    case "deal":
      rows = await sql`select 1 from public.deals where id = ${entityId} and agency_id = ${agencyId} limit 1`;
      break;
    default:
      return false;
  }
  return rows.length > 0;
}
