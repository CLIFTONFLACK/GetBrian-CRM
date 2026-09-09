const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `id` is shaped like a Postgres uuid. Route handlers check this
 *  before querying so a junk id gets a uniform 404/400 instead of a 500 from
 *  `invalid input syntax for type uuid`. */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}
