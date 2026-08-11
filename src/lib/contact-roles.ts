import { cache } from "react";

import { listContactRoles } from "@/lib/db/queries/lookups";

export type ContactRole = {
  id: string;
  slug: string;
  label: string;
  sort_order: number;
  is_system: boolean;
};

/**
 * The system-wide contact-role list (editable in Admin → "Edit roles").
 * Cached per request so a page can call it from several spots without re-querying.
 */
export const getContactRoles = cache(async (): Promise<ContactRole[]> => {
  return listContactRoles();
});

/** Title-case a bare slug as a last-resort label for a role no longer in the list. */
export function prettifyRoleSlug(slug: string): string {
  return slug ? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
}

/** Resolve a stored slug to its editable display label (falls back to the slug). */
export function roleLabel(
  roles: { slug: string; label: string }[],
  slug: string,
): string {
  return roles.find((r) => r.slug === slug)?.label ?? prettifyRoleSlug(slug);
}
