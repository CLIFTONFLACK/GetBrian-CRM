// URL-driven table sorting helpers (server-component friendly; no "use server").

export type SortDir = "asc" | "desc";

/** Build the href that sorts by `column`, toggling direction if already active. */
export function sortHref(
  params: Record<string, string | undefined>,
  column: string,
): string {
  const sameCol = params.sort === column;
  const dir: SortDir = sameCol && params.dir !== "desc" ? "desc" : "asc";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  sp.set("sort", column);
  sp.set("dir", dir);
  return `?${sp.toString()}`;
}

/**
 * Build an href that keeps the current params and applies a `patch`. A patch
 * value of null/"" clears that key. Used by the click-to-filter grids so a grid
 * click preserves the active search (`q`), sort, and any other filters.
 */
export function filterHref(
  params: Record<string, string | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "?";
}

/**
 * Resolve a requested sort column against a whitelist → the DB column + ascending
 * flag. Falls back to `fallback` when the requested column isn't allowed.
 */
export function resolveSort(
  sort: string | undefined,
  dir: string | undefined,
  allowed: Record<string, string>,
  fallback: { column: string; ascending: boolean },
): { column: string; ascending: boolean } {
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so `?sort=constructor`
  // (or toString, hasOwnProperty, …) would pass the check and pull a Function off
  // Object.prototype into `allowed[sort]`, which then stringifies into the ORDER BY
  // and 500s the page. hasOwn only matches the whitelist's own keys.
  if (sort && Object.hasOwn(allowed, sort)) {
    return { column: allowed[sort], ascending: dir !== "desc" };
  }
  return fallback;
}
