// Which Upstash REST credentials the rate limiter uses. Pure, so it can be tested.
//
// After the first database was archived (2026-11) a replacement was connected
// while the old KV_* variables still existed, so Vercel injected the new
// database under a NEW_ prefix (NEW_KV_REST_API_URL / NEW_KV_REST_API_TOKEN).
// The NEW_ pair wins when BOTH halves are set. The two halves always come from
// the same database, never one of each: a URL from one database with a token
// from another would fail every call.

export type KvCredentials = { url: string; token: string };

export function pickKvCredentials(env: Readonly<Record<string, string | undefined>>): KvCredentials {
  const newUrl = env.NEW_KV_REST_API_URL ?? "";
  const newToken = env.NEW_KV_REST_API_TOKEN ?? "";
  if (newUrl && newToken) return { url: newUrl, token: newToken };
  return { url: env.KV_REST_API_URL ?? "", token: env.KV_REST_API_TOKEN ?? "" };
}
