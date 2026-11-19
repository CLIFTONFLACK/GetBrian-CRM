// Plain module: used by client forms. A datetime-local field sends
// "YYYY-MM-DDTHH:mm" with no zone. Only the browser knows the viewer's zone, so
// the form turns the value into an absolute instant (ISO with Z) before it
// posts. The server then reads that instant as sent (see parseDueInput).

const LOCAL_WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/**
 * Reads a datetime-local value as the wall clock of the machine it runs on and
 * returns the UTC instant as an ISO string ("2026-07-01T08:00:00.000Z").
 * Empty input, a value that is not a zone-less wall clock (it may already carry
 * a zone) and an impossible date are returned as they came in.
 */
export function datetimeLocalToIso(value: string): string {
  const v = value.trim();
  if (!LOCAL_WALL.test(v)) return value;
  // A date-time string without a zone is local time (ECMAScript spec).
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return value;
  // 31 February must not roll into March. Only the date is compared: the hour
  // may move when the clocks change (a time inside the spring gap).
  const [y, mo, day] = [v.slice(0, 4), v.slice(5, 7), v.slice(8, 10)].map(Number);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return value;
  return d.toISOString();
}

/**
 * Replaces a datetime-local field of a form post with its UTC instant, in place.
 * Returns the same FormData so a form can wrap its action:
 * `action={(fd) => formAction(withIsoDueAt(fd))}`.
 */
export function withIsoDueAt(formData: FormData, field = "due_at"): FormData {
  const raw = formData.get(field);
  if (typeof raw === "string" && raw) formData.set(field, datetimeLocalToIso(raw));
  return formData;
}
