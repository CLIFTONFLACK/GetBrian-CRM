// Plain module (not "use client"): server pages and client components both import it.
// A "use client" module's exports reach the server as references, not values.
//
// The records panel lives in the URL of the current list page:
//   ?record=<type>:<uuid>&tab=<slug>
// Everything here is pure string work so it can be unit-tested with node --test.

export const RECORD_TYPES = ["company", "contact", "requirement", "listing", "deal"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export type RecordRef = { type: RecordType; id: string };

export type SearchParamsLike = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Parse a raw `record` search param. Strict: a known type, a colon, a UUID.
 * Anything else (array, wrong type, bad id, extra text) gives null, so a
 * hand-edited URL opens no panel instead of reaching a query.
 */
export function parseRecordRef(raw: unknown): RecordRef | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const [type, id] = parts;
  if (!(RECORD_TYPES as readonly string[]).includes(type)) return null;
  const lower = id.toLowerCase();
  if (!UUID.test(lower)) return null;
  return { type: type as RecordType, id: lower };
}

export function formatRecordRef(ref: RecordRef): string {
  return `${ref.type}:${ref.id}`;
}

export type TabDef = { slug: string; label: string };

export const DEFAULT_TAB = "overview";

/** Tab order per record type. The slug is what `?tab=` carries. */
export const RECORD_TABS: Record<RecordType, readonly TabDef[]> = {
  company: [
    { slug: "overview", label: "Overview" },
    { slug: "contacts", label: "Contacts" },
    { slug: "notes", label: "Notes & activity" },
    { slug: "requirements", label: "Requirements" },
    { slug: "listings", label: "Listings" },
    { slug: "map", label: "Map" },
    { slug: "todo", label: "To-do" },
    { slug: "matchmaker", label: "Matchmaker" },
    { slug: "uploads", label: "Uploads" },
  ],
  contact: [
    { slug: "overview", label: "Overview" },
    { slug: "notes", label: "Notes & activity" },
    { slug: "requirements", label: "Requirements" },
    { slug: "map", label: "Map" },
    { slug: "todo", label: "To-do" },
    { slug: "matchmaker", label: "Matchmaker" },
    { slug: "uploads", label: "Uploads" },
  ],
  requirement: [
    { slug: "overview", label: "Overview" },
    { slug: "contacts", label: "Contacts" },
    { slug: "notes", label: "Notes & activity" },
    { slug: "matchmaker", label: "Matchmaker" },
    { slug: "uploads", label: "Uploads" },
    { slug: "send-history", label: "Send history" },
    { slug: "todo", label: "To-do" },
  ],
  listing: [
    { slug: "overview", label: "Overview" },
    { slug: "media", label: "Images & documents" },
    { slug: "map", label: "Map" },
    { slug: "matchmaker", label: "Matchmaker" },
    { slug: "deals", label: "Deals" },
    { slug: "todo", label: "To-do" },
  ],
  deal: [
    { slug: "overview", label: "Overview" },
    { slug: "reminders", label: "Reminders" },
    { slug: "updates", label: "Updates" },
    { slug: "todo", label: "To-do" },
  ],
};

/** Resolve a raw `tab` param against the tabs of `type`. Unknown gives the default. */
export function parseTab(type: RecordType, raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_TAB;
  return RECORD_TABS[type].some((t) => t.slug === raw) ? raw : DEFAULT_TAB;
}

function build(
  base: SearchParamsLike,
  extra: Record<string, string | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    // `record` and `tab` always come from `extra`, never from the base.
    if (v && k !== "record" && k !== "tab") sp.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "?";
}

/** Href that opens `ref` on the current page, keeping every other param. */
export function openRecordHref(
  base: SearchParamsLike,
  ref: RecordRef,
  tab?: string,
): string {
  return build(base, {
    record: formatRecordRef(ref),
    tab: tab && tab !== DEFAULT_TAB ? tab : undefined,
  });
}

/** Href that switches the open record to `tab`. Same as open, kept for readability. */
export function tabHref(base: SearchParamsLike, ref: RecordRef, tab: string): string {
  return openRecordHref(base, ref, tab);
}

/** Href of the current page without the panel. */
export function closeRecordHref(base: SearchParamsLike): string {
  return build(base, {});
}

const PAGE_ROOT: Record<RecordType, string> = {
  company: "/companies",
  contact: "/contacts",
  requirement: "/requirements",
  listing: "/listings",
  deal: "/deals",
};

/**
 * Every page that can host the records panel. A server action that changes
 * something shown in a panel revalidates all of these, because the panel can be
 * open on any of them (a company opens from the contacts list, a task opens
 * from /tasks).
 */
export const PANEL_HOST_PATHS = [
  "/companies",
  "/contacts",
  "/requirements",
  "/listings",
  "/deals",
  "/matches",
  "/tasks",
  "/dashboard",
] as const;

/** The full record page, which stays reachable from the panel and from the name link. */
export function fullRecordHref(ref: RecordRef): string {
  return `${PAGE_ROOT[ref.type]}/${ref.id}`;
}
