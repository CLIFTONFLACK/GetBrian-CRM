// The sections of the Admin page. The active one lives in the URL (?section=),
// so the server renders only that section and queries only its data.

export const ADMIN_SECTIONS = [
  {
    slug: "team",
    label: "Team",
    title: "Team",
    intro: "Add agents, change roles and reset passwords.",
  },
  {
    slug: "lists",
    label: "Lists",
    title: "Lists",
    intro: "The company types and contact roles your team picks from, and how they are set automatically.",
  },
  {
    slug: "integrations",
    label: "Integrations",
    title: "Integrations",
    intro: "Keys and connections for AI research and identity checks.",
  },
  {
    slug: "notifications",
    label: "Notifications",
    title: "Notifications",
    intro: "When the team gets reminders about to-dos that are due.",
  },
  {
    slug: "data",
    label: "Data",
    title: "Data",
    intro: "Bring records in from a CSV file, and manage partner-agent stock.",
  },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["slug"];

export const DEFAULT_ADMIN_SECTION: AdminSection = "team";

/** Resolve a raw `section` param. Anything unknown gives the default. */
export function parseAdminSection(raw: unknown): AdminSection {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return ADMIN_SECTIONS.find((s) => s.slug === value)?.slug ?? DEFAULT_ADMIN_SECTION;
}
