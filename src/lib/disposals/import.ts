/**
 * Orchestrates a single CDG URL → persisted `disposals` row:
 *   fetch + extract + map  →  (optional) re-host media to Blob  →  upsert.
 *
 * Framework-agnostic: no client object to thread through (`rehostMedia`
 * needs only `BLOB_READ_WRITE_TOKEN` from `process.env` — see storage.ts),
 * so this can be driven from a Server Action, a Route Handler, or a script.
 * The DB write itself goes through the Neon DAO (disposals.ts's
 * `upsertDisposalFromSource`). Directive-free, so it may also export the
 * shared action-state type (a "use server" module can only export async
 * functions).
 */
import { upsertDisposalFromSource } from "@/lib/db/queries/disposals";
import { fetchAndExtractCdg, type DisposalInsert } from "./cdg";
import { rehostMedia, type RehostResult } from "./storage";

export const DISPOSALS_TABLE = "disposals";

/** Result state for the import Server Action / form. */
export type DisposalImportState = {
  error?: string;
  message?: string;
  /** Id of the upserted row, present on success. */
  id?: string;
  /** Non-fatal media re-host failures, if any. */
  warnings?: string[];
};

export interface ImportOptions {
  /** Download + re-host media into Storage (default true). */
  rehost?: boolean;
  includeBrochure?: boolean;
  signal?: AbortSignal;
  /** User id stamped as `created_by` on the row. */
  createdBy?: string;
}

export interface ImportResult {
  id: string;
  row: DisposalInsert;
  rehost?: RehostResult;
}

/** Lightweight guard: only CDG Leisure property URLs are accepted. */
export function isCdgPropertyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      /(^|\.)cdgleisure\.com$/i.test(u.hostname) &&
      /\/find-a-property\/properties\//i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Fetches a CDG property page, maps it to a `disposals` row, optionally re-hosts its
 * media to Storage, then upserts on `(source, source_ref)`. Returns the row id.
 * Throws on fetch/parse/DB errors; media failures are non-fatal (see `rehost`).
 */
export async function importDisposalFromUrl(
  url: string,
  agencyId: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const shouldRehost = opts.rehost ?? true;

  let row = await fetchAndExtractCdg(url, { signal: opts.signal });

  let rehost: RehostResult | undefined;
  if (shouldRehost && row.images.length > 0) {
    rehost = await rehostMedia(row, {
      includeBrochure: opts.includeBrochure,
      signal: opts.signal,
    });
    row = rehost.row;
  }

  const { id } = await upsertDisposalFromSource(
    agencyId,
    opts.createdBy ?? null,
    "cdg",
    row,
  );
  return { id, row, rehost };
}
