// Rules for the merged notes and to-dos (db/migrations/0049): one list per
// record. A to-do is an activity whose `status` is not null. A plain note has
// status null. Pure module (no database), so the rules can be tested.

import { pgTimestampToIso } from "./format-date.ts";

/** A Postgres timestamp text ("2026-11-27 12:00:00+00") or an ISO string, as milliseconds. NaN when it is neither. */
const ms = (value: string | null): number =>
  value ? new Date(pgTimestampToIso(value)).getTime() : Number.NaN;

export type EntryState = {
  status: string | null;
  due_at: string | null;
  occurred_at: string;
};

export type EntryFilter = "all" | "notes" | "open" | "done";
export const ENTRY_FILTERS: readonly EntryFilter[] = ["all", "notes", "open", "done"];

export const isTodo = (e: Pick<EntryState, "status">): boolean => e.status != null;
export const isOpenTodo = (e: Pick<EntryState, "status">): boolean => e.status === "open";
export const isDoneTodo = (e: Pick<EntryState, "status">): boolean => e.status === "done";

/** An open to-do whose due time has passed. Done to-dos and notes are never overdue. */
export function isOverdue(e: Pick<EntryState, "status" | "due_at">, now: Date): boolean {
  if (e.status !== "open" || !e.due_at) return false;
  const due = ms(e.due_at);
  return Number.isFinite(due) && due < now.getTime();
}

/**
 * True when two due times are the same minute. The due field has minute
 * precision, so a migrated to-do with seconds in its due time must not look
 * changed just because it was saved.
 */
export function sameDueMinute(a: string | null, b: string | null): boolean {
  const minute = (v: string | null) => (v ? Math.floor(ms(v) / 60_000) : null);
  const x = minute(a);
  const y = minute(b);
  return x === y || (Number.isNaN(x) && Number.isNaN(y));
}

/**
 * An entry with no record is found only through My to-dos, which lists to-dos.
 * So an entry with no record has to stay a to-do. Anything with a record shows
 * on that record whatever its status.
 */
export function staysFindable(e: { entity_type: string | null; status: string | null }): boolean {
  return e.entity_type != null || e.status != null;
}

/** isOverdue against the clock. Kept here so components do not read the time while rendering. */
export function isOverdueNow(e: Pick<EntryState, "status" | "due_at">): boolean {
  return isOverdue(e, new Date());
}

/**
 * The status a new or edited entry gets. Setting an assignee or a due date makes
 * it a to-do ("open"); `keep` is the status it already has, so editing never
 * turns a done to-do back into an open one. No assignee and no due date: a note
 * stays a note, and an existing to-do keeps its status.
 */
export function statusFor(
  input: { assigneeId: string | null; dueAt: string | null },
  keep: string | null = null,
): "open" | "done" | null {
  if (keep === "open" || keep === "done") return keep;
  return input.assigneeId || input.dueAt ? "open" : null;
}

export function filterEntries<T extends Pick<EntryState, "status">>(
  entries: readonly T[],
  filter: EntryFilter,
): T[] {
  switch (filter) {
    case "notes":
      return entries.filter((e) => !isTodo(e));
    case "open":
      return entries.filter(isOpenTodo);
    case "done":
      return entries.filter(isDoneTodo);
    default:
      return [...entries];
  }
}

/** Reads a filter from a query value; anything else is "all". */
export function parseEntryFilter(raw: unknown): EntryFilter {
  return typeof raw === "string" && (ENTRY_FILTERS as readonly string[]).includes(raw)
    ? (raw as EntryFilter)
    : "all";
}

/**
 * The order of one record's list: open to-dos first (soonest due first, no due
 * date last), then everything else newest first.
 */
export function sortEntries<T extends EntryState>(entries: readonly T[]): T[] {
  const time = ms;
  return [...entries].sort((a, b) => {
    const ao = isOpenTodo(a);
    const bo = isOpenTodo(b);
    if (ao !== bo) return ao ? -1 : 1;
    if (ao && bo) {
      const ad = time(a.due_at);
      const bd = time(b.due_at);
      const an = Number.isNaN(ad);
      const bn = Number.isNaN(bd);
      if (an !== bn) return an ? 1 : -1;
      if (!an && !bn && ad !== bd) return ad - bd;
    }
    return time(b.occurred_at) - time(a.occurred_at);
  });
}
