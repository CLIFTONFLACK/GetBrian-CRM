import { sql } from "@/lib/db/client";
import { resolveTouchTarget } from "@/lib/date-updated-target";

// "Touch" a record's date_updated (db/migrations/0044) after a child write —
// an activity logged, a document attached, an agent added, a contact linked.
//
// Only date_updated is set. The 0044 trigger sees that no data column changed
// and leaves updated_at alone, which matters: updated_at is the optimistic
// lock the edit forms save against, so a child write must never move it.
//
// Best effort by design. A failed touch is logged and swallowed, so it can
// never fail the parent write that already succeeded. An unknown entity type
// (deal, listing, null, anything else) is ignored. One explicit statement per
// table: no table name is ever interpolated.

export async function touchDateUpdated(
  entityType: string | null | undefined,
  id: string | null | undefined,
  agencyId: string,
): Promise<void> {
  const target = resolveTouchTarget(entityType);
  if (!target || !id) return;
  try {
    if (target === "company") {
      await sql`update public.companies set date_updated = now() where id = ${id} and agency_id = ${agencyId}`;
    } else if (target === "contact") {
      await sql`update public.contacts set date_updated = now() where id = ${id} and agency_id = ${agencyId}`;
    } else {
      await sql`update public.requirements set date_updated = now() where id = ${id} and agency_id = ${agencyId}`;
    }
  } catch (err) {
    console.error(`touchDateUpdated(${target}, ${id}) failed`, err);
  }
}
