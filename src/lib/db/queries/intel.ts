import { sql } from "@/lib/db/client";

// DAO for the Market Intel bookkeeping that sits on top of public.disposals
// (the row-shape upsert itself lives in disposals.ts's `upsertDisposalFromSource`,
// shared with the CDG single-URL importer — see that function's doc comment).
// Every function here takes the caller's agencyId as a mandatory first
// parameter and filters on it explicitly — see the same note in companies.ts.
// There is no RLS backstop on this schema (see AGENTS.md).

export type IntelRefRow = { id: string; source_ref: string | null; source_url: string | null };

/** Current book for one partner source — used by resync to work out which
 *  refs disappeared from a fresh scrape. */
export async function listDisposalRefsBySource(
  agencyId: string,
  source: string,
): Promise<IntelRefRow[]> {
  return (await sql`
    select id, source_ref, source_url
    from public.disposals
    where agency_id = ${agencyId} and source = ${source}
  `) as IntelRefRow[];
}

/**
 * Marks a set of rows Withdrawn (never deletes — deals and send history keep
 * pointing at a real row). Excludes rows already Withdrawn so a repeat
 * resync doesn't inflate the caller's "N marked Withdrawn" count. Returns the
 * number of rows actually changed.
 */
export async function markDisposalsWithdrawn(agencyId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await sql`
    update public.disposals set status = 'Withdrawn'
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[]) and status <> 'Withdrawn'
    returning id
  `;
  return rows.length;
}

export type GeoTargetRow = {
  id: string;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
};

/** Rows from one partner source still lacking coordinates — fed through
 *  geocodeAddress best-effort after a resync. */
export async function listDisposalsMissingCoords(
  agencyId: string,
  source: string,
): Promise<GeoTargetRow[]> {
  return (await sql`
    select id, address_line, city, postcode
    from public.disposals
    where agency_id = ${agencyId} and source = ${source} and lat is null
  `) as GeoTargetRow[];
}

export async function updateDisposalCoords(
  agencyId: string,
  id: string,
  lat: number,
  lng: number,
): Promise<boolean> {
  const rows = await sql`
    update public.disposals set lat = ${lat}, lng = ${lng}
    where id = ${id} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

/** Every disposal id for one partner source — feeds the post-sync MatchMaker
 *  refresh (score the freshly-synced stock against live briefs). */
export async function listDisposalIdsBySource(
  agencyId: string,
  source: string,
): Promise<string[]> {
  const rows = await sql`
    select id from public.disposals where agency_id = ${agencyId} and source = ${source}
  `;
  return (rows as { id: string }[]).map((r) => r.id);
}

/** Removes every intel row for one partner source from the caller's agency.
 *  Scoped to listing_type = 'intel' so a source id can never collide with a
 *  manually-entered or CDG-imported row. Returns the number deleted. */
export async function deleteIntelDisposals(agencyId: string, source: string): Promise<number> {
  const rows = await sql`
    delete from public.disposals
    where agency_id = ${agencyId} and source = ${source} and listing_type = 'intel'
    returning id
  `;
  return rows.length;
}
