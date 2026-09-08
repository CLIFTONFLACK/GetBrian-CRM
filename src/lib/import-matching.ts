/**
 * The decision rules the bulk CSV/XLS importer uses to tell "this row is a
 * record we already hold" from "this row is new", and how repeated rows within
 * one file combine.
 *
 * Kept out of src/lib/actions/import-data.ts for two reasons: that file is
 * "use server", which may only export async functions, and these are the rules
 * most worth testing directly (see scripts/verify-import-upsert.mjs).
 */

/** Map keys are trimmed and lower-cased everywhere, so matching is
 *  case- and whitespace-insensitive on both sides. */
export function normaliseKey(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Fold a later row's patch into an earlier one for the same record.
 *
 * Only values that were actually supplied (non-null) overwrite, so a file that
 * mentions one company across several lines accumulates all of it rather than
 * the last, sparsest line blanking what the earlier lines provided. Among
 * supplied values the later row wins, which matches how people expect a
 * spreadsheet to read — top to bottom.
 */
export function mergePatch<T extends object>(into: T, from: T): void {
  for (const [k, v] of Object.entries(from)) {
    if (v !== null && v !== undefined) (into as Record<string, unknown>)[k] = v;
  }
}

/**
 * Which existing company a row refers to.
 *
 * Companies House number first: a company can be renamed and still be the same
 * company, so the registration number is the stronger claim. Name is the
 * fallback for the (common) case where the spreadsheet has no CRN column.
 *
 * Returns null when neither matches — the row is then a new company.
 */
export function matchCompanyId(
  companyNumber: string,
  name: string,
  byNumber: ReadonlyMap<string, string>,
  byName: ReadonlyMap<string, string>,
): string | null {
  if (companyNumber) {
    const hit = byNumber.get(normaliseKey(companyNumber));
    if (hit) return hit;
  }
  return byName.get(normaliseKey(name)) ?? null;
}

/**
 * The in-file identity for a company row.
 *
 * Prefers whatever matched an existing record, so "ABC Ltd" written with a CRN
 * on one line and without on another still resolve to one record. Falls back to
 * the CRN, then the name, so two rows for the same new company still merge.
 */
export function companyFileKey(
  existingId: string | null,
  companyNumber: string,
  name: string,
): string {
  if (existingId) return existingId;
  if (companyNumber) return `crn:${normaliseKey(companyNumber)}`;
  return `name:${normaliseKey(name)}`;
}

/**
 * Key for the contact name fallback, used when a spreadsheet carries no email
 * address: first + last name scoped to the owning company, so two people with
 * the same name at different companies stay distinct records.
 */
export function contactNameKey(
  firstName: string,
  lastName: string | null,
  companyId: string | null,
): string {
  return [
    firstName.trim().toLowerCase(),
    (lastName ?? "").trim().toLowerCase(),
    companyId ?? "",
  ].join("|");
}
