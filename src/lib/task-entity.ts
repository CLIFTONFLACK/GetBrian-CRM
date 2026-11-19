import { isUuid } from "@/lib/uuid";

// The record a task can be attached to (tasks.entity_type / entity_id,
// db/migrations/0029). tasks.entity_type is free text in the database, so the
// allow-list lives here: a value outside it never reaches an insert.
// Pure module (no database), so it can be unit-tested.

export const TASK_ENTITY_TYPES = [
  "company",
  "contact",
  "requirement",
  "listing",
  "deal",
] as const;
export type TaskEntityType = (typeof TASK_ENTITY_TYPES)[number];
export type TaskEntity = { type: TaskEntityType; id: string };

export type TaskEntityParse =
  | { ok: true; entity: TaskEntity | null }
  | { ok: false; error: string };

/**
 * Reads the two form fields. Both blank means "a task with no record", which is
 * how the /tasks page form works. One of them blank, an unknown type, or an id
 * that is not a uuid is an error, never a silent "no record", so a task cannot
 * lose its record because of a malformed request.
 */
export function parseTaskEntity(typeRaw: unknown, idRaw: unknown): TaskEntityParse {
  const type = typeof typeRaw === "string" ? typeRaw.trim() : "";
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!type && !id) return { ok: true, entity: null };
  if (!type || !id) return { ok: false, error: "The task record is incomplete." };
  if (!(TASK_ENTITY_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "That record type cannot have tasks." };
  }
  if (!isUuid(id)) return { ok: false, error: "The task record is not valid." };
  return { ok: true, entity: { type: type as TaskEntityType, id: id.toLowerCase() } };
}
