/**
 * Field rules for a requirement, shared by every writer: the form actions
 * (src/lib/actions/requirements.ts), the CSV/XLS importer
 * (src/lib/actions/import-data.ts) and the public intake form. Keeping the rule
 * in one plain module means a bulk upload can't create rows the form would
 * reject.
 *
 * This is deliberately NOT in the "use server" actions file — a "use server"
 * module may only export async functions, so a synchronous validator exported
 * from there fails the build (tsc stays quiet about it; see tasks/lessons.md on
 * the equivalent "use client" trap).
 */

export type RequirementLinkFields = {
  title: string;
  companyId: string | null;
  contactId: string | null;
};

/**
 * A requirement must be linked to a company or a contact — either alone is
 * fine, and both together is the normal case (the contact is the operator's
 * point of contact). A brief attached to neither is orphaned: it can't be sent
 * anywhere and appears under no company or contact.
 *
 * Replaces the older "a contact is required for every requirement" rule, which
 * forced a contact even when only the operating company was known.
 *
 * Returns an error message, or null when the row is acceptable.
 */
export function requirementLinkError(data: RequirementLinkFields): string | null {
  if (!data.title) return "A requirement title is required.";
  if (!data.companyId && !data.contactId) {
    return "Link this requirement to a company or a contact — at least one is required.";
  }
  return null;
}
