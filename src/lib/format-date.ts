// Plain module (not "use client"): server pages and client components can both import it.

const LONDON = "Europe/London";

const PG_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Turns a Postgres `::text` timestamp ("2026-11-18 14:30:00.123456+00") into an
 * ISO 8601 string ("2026-11-18T14:30:00.123Z"). Browsers do not agree on the
 * space, the six fraction digits or the two-digit offset, so a client that
 * parses the raw text can get an Invalid Date, and then render something other
 * than the server did (a hydration mismatch). A value with no zone is read as
 * UTC. Anything that is not that shape is returned as it came in.
 */
export function pgTimestampToIso(raw: string): string {
  const m = PG_TIMESTAMP.exec(raw.trim());
  if (!m) return raw;
  const ms = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
  let zone = m[4] ?? "Z";
  if (zone.toUpperCase() === "Z") zone = "Z";
  else {
    const digits = zone.slice(1).replace(":", "");
    zone = `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2, 4).padEnd(2, "0")}`;
  }
  return `${m[1]}T${m[2]}.${ms}${zone}`;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(pgTimestampToIso(value));
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const fullFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Shows a Date Updated timestamp as "18 Nov 2026" (Europe/London). `title` is
 * the full date and time, for a tooltip. Empty or invalid input gives "—".
 */
export function formatDateUpdated(value: string | Date | null | undefined): {
  text: string;
  title: string | undefined;
} {
  if (value == null || value === "") return { text: "—", title: undefined };
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return { text: "—", title: undefined };
  return { text: dayFormat.format(d).replace(/\./g, ""), title: fullFormat.format(d) };
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  dateStyle: "medium",
  timeStyle: "short",
});

/** "18 Nov 2026, 14:30" in Europe/London. Invalid input gives "—". The server
 *  runs in UTC, so a plain toLocaleString would show the wrong hour in summer. */
export function formatLondonDateTime(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = toDate(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormat.format(d);
}
