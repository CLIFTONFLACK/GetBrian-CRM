import { cache } from "react";

import { listCompanyTypes } from "@/lib/db/queries/lookups";

export type CompanyType = {
  id: string;
  slug: string;
  label: string;
  sort_order: number;
  is_system: boolean;
};

/**
 * The system-wide company-type list (editable in Admin → "Edit company types").
 * Cached per request so a page can call it from several spots without re-querying.
 */
export const getCompanyTypes = cache(async (): Promise<CompanyType[]> => {
  return listCompanyTypes();
});

/** Title-case a bare slug as a last-resort label for a type no longer in the list. */
export function prettifyTypeSlug(slug: string): string {
  return slug ? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
}

/** Resolve a stored slug to its editable display label (falls back to the slug). */
export function typeLabel(
  types: { slug: string; label: string }[],
  slug: string,
): string {
  return types.find((t) => t.slug === slug)?.label ?? prettifyTypeSlug(slug);
}
