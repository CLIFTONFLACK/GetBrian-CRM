// Pure mapping from an activity or task `entity_type` value to the record kind
// whose "date updated" a child write should touch. Kept free of imports so it
// can be unit-tested without a database client.
//
// activities.entity_type is the enum company | contact | listing | requirement
// | deal (db/migrations/0001_init.sql); tasks.entity_type is free text
// (0029_tasks.sql). Only company, contact and requirement carry a
// date_updated column (0044). Everything else, including values this code has
// never seen, maps to null: nothing to touch.

export type TouchTarget = "company" | "contact" | "requirement";

export function resolveTouchTarget(entityType: unknown): TouchTarget | null {
  switch (entityType) {
    case "company":
    case "contact":
    case "requirement":
      return entityType;
    default:
      return null;
  }
}
