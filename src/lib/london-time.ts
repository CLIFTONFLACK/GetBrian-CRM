// Plain module. A datetime-local field sends "YYYY-MM-DDTHH:mm" with no zone.
// The server runs in UTC, so new Date(value) reads it as UTC, and a task due
// "09:00" in summer was stored an hour late. These helpers read the value as
// the wall clock in Europe/London and give the real instant. No packages: the
// zone rules come from Intl.

const LONDON = "Europe/London";

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The Europe/London wall clock of an instant, as a "YYYY-MM-DDTHH:mm:ss" string. */
function londonWall(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of parts.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Reads "YYYY-MM-DDTHH:mm" (seconds optional) as a wall-clock time in
 * Europe/London and returns the UTC instant, or null for anything else
 * (wrong shape, 31 February, hour 24).
 *
 * Two days a year the wall clock is not one-to-one:
 *  - Spring gap (clocks go 01:00 to 02:00): 01:30 never happens. It is read
 *    with the winter offset, so it lands on 02:30 BST, the usual forward shift.
 *  - Autumn overlap (clocks go 02:00 to 01:00): 01:30 happens twice. The first
 *    occurrence (still summer time) is used.
 */
export function londonWallClockToUtc(value: string): Date | null {
  const m = WALL.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const s = m[6] ? Number(m[6]) : 0;
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const wallText = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(s).padStart(2, "0")}`;
  // The wall clock itself must exist as written (rejects 02-31, hour 24, minute 60).
  const asUtc = new Date(wallUtc);
  if (
    asUtc.getUTCFullYear() !== y ||
    asUtc.getUTCMonth() !== mo - 1 ||
    asUtc.getUTCDate() !== d ||
    asUtc.getUTCHours() !== h ||
    asUtc.getUTCMinutes() !== mi
  ) {
    return null;
  }
  const HOUR = 3_600_000;
  // London is UTC+1 (summer) or UTC+0 (winter). Try summer first: that is the
  // earlier instant, so an overlap resolves to its first occurrence.
  const summer = wallUtc - HOUR;
  if (londonWall(summer) === wallText) return new Date(summer);
  if (londonWall(wallUtc) === wallText) return new Date(wallUtc);
  // Spring gap: neither reading round-trips.
  return new Date(wallUtc);
}

/**
 * Due date from a form or a direct post. A zone-less wall-clock value is read as
 * Europe/London. A value that carries its own zone ("...Z" or "+01:00") is taken
 * as sent. Anything else is null.
 */
export function parseDueInput(raw: string): Date | null {
  const v = raw.trim();
  if (!v) return null;
  if (WALL.test(v)) return londonWallClockToUtc(v);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
