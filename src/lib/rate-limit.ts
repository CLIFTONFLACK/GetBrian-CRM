import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";

// Centralised Upstash Redis rate limiting — the rate-limit-layer equivalent
// of src/lib/db/client.ts's isDbConfigured. Kept here so every caller can
// fail *open* (always allow) when Upstash hasn't been provisioned locally,
// rather than breaking login/intake entirely.
//
// Named KV_REST_API_* because that's what Vercel's KV wrapper integration
// injects (its own naming, not the raw UPSTASH_REDIS_REST_URL/TOKEN names
// @upstash/redis's `Redis.fromEnv()` looks for) — so the client is
// constructed explicitly with `{ url, token }` instead of using fromEnv().
const KV_REST_API_URL = process.env.KV_REST_API_URL ?? "";
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN ?? "";

/** True once both Upstash REST vars are present. */
export const isRateLimitConfigured = Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);

/**
 * Rate-limit buckets. Each gets its own Ratelimit instance (Upstash key
 * prefix = the bucket name below), so hitting one bucket's limit never
 * touches another bucket's counter for the same identifier.
 */
const LIMITS = {
  // Brute-force protection on /login. Strict: 5 attempts/min/IP — enough for
  // a genuine typo or two, tight enough to blunt credential stuffing.
  login: { requests: 5, window: "1 m" as const },
  // Spam protection on the public /submit-requirement intake form. More
  // lenient than login (it's not guarding a password), but still real: the
  // form isn't meant to be submitted repeatedly by the same visitor, and
  // this is on top of — not instead of — the existing honeypot + timing
  // check in submitPublicRequirement.
  intake: { requests: 3, window: "10 m" as const },
  // Anti-abuse on public /sign-up. Each call creates a user + a new agency +
  // an admin membership row and runs a cost-12 bcrypt hash, so an unthrottled
  // endpoint is a resource-exhaustion / junk-tenant vector. A handful per IP
  // per hour covers genuine retries; anything past that is abuse.
  signup: { requests: 5, window: "1 h" as const },
} satisfies Record<string, { requests: number; window: `${number} ${"s" | "m" | "h"}` }>;

export type RateLimitBucket = keyof typeof LIMITS;

let redis: Redis | null = null;
const limiters = new Map<RateLimitBucket, Ratelimit>();

function limiterFor(bucket: RateLimitBucket): Ratelimit {
  const cached = limiters.get(bucket);
  if (cached) return cached;

  redis ??= new Redis({ url: KV_REST_API_URL, token: KV_REST_API_TOKEN });

  const { requests, window } = LIMITS[bucket];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    // Distinct key namespace per bucket, so `login` and `intake` never share
    // a counter for the same identifier even though both key off caller IP.
    prefix: `ratelimit:${bucket}`,
  });
  limiters.set(bucket, limiter);
  return limiter;
}

/**
 * Checks (and consumes) one request against a bucket's sliding-window limit
 * for `identifier` (normally the caller's IP — see getClientIp()).
 *
 * Fails OPEN: if Upstash isn't configured (e.g. local dev without KV_REST_API_*
 * set), this always returns `{ success: true }` rather than throwing, mirroring
 * isDbConfigured-style graceful degradation elsewhere in this codebase. Rate
 * limiting is defense-in-depth, not something login/intake should hard-depend on.
 */
let warnedUnconfigured = false;

export async function checkRateLimit(
  bucket: RateLimitBucket,
  identifier: string,
): Promise<{ success: boolean }> {
  if (!isRateLimitConfigured) {
    // Failing open is intended for local dev, but if it happens in production
    // it means login + intake are silently unthrottled — surface that loudly
    // (once) rather than letting it pass unnoticed.
    if (process.env.NODE_ENV === "production" && !warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[rate-limit] KV_REST_API_URL/KV_REST_API_TOKEN are unset in production — " +
          "rate limiting is DISABLED (failing open). /login and /submit-requirement are unthrottled.",
      );
    }
    return { success: true };
  }

  const { success } = await limiterFor(bucket).limit(identifier);
  return { success };
}

/** Used when no forwarded-IP header is present (e.g. local dev). */
const UNKNOWN_IP = "unknown";

/**
 * Best-effort caller IP for rate-limit identifiers, read from real request
 * headers only — never from anything client-supplied (e.g. a form field),
 * since that would let a caller pick their own rate-limit bucket.
 *
 * `x-forwarded-for` (first entry) first, then `x-real-ip`, then a constant
 * fallback so rate limiting still runs (just bucketed together) when neither
 * header is present, as in local dev without a proxy in front.
 *
 * SECURITY DEPENDENCY: this is only trustworthy behind a proxy that OVERWRITES
 * these headers with the true client IP — which Vercel's edge network does (it
 * replaces any client-sent x-forwarded-for). This app runs on Vercel, so the
 * value can't be spoofed here. If it is ever deployed behind an ingress that
 * merely appends to x-forwarded-for, an attacker could rotate the header per
 * request to evade the login/intake limits — derive the IP from a
 * platform-trusted header there instead.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || UNKNOWN_IP;
}
