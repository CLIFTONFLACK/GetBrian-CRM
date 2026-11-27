// Pure rule for whether a stored brochure preview can be used. No imports, so it
// is testable and safe to use from a server component.

/** A failed try is not repeated for this long. */
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * "ready": a stored image drawn from the listing's current link.
 * "recent-failure": a try for this link failed lately; do not repeat it yet.
 * "needed": nothing usable (no row, the link changed, or the failure is old).
 */
export function previewIsCurrent(
  row: { source_url: string; preview_url: string | null; checked_at: string } | null,
  brochureUrl: string | null,
  now = Date.now(),
): "ready" | "recent-failure" | "needed" {
  if (!row || !brochureUrl || row.source_url !== brochureUrl) return "needed";
  if (row.preview_url) return "ready";
  const at = Date.parse(row.checked_at);
  return Number.isFinite(at) && now - at < RETRY_AFTER_MS ? "recent-failure" : "needed";
}
