/**
 * Proves checkRateLimit fails OPEN when Upstash is configured but unreachable,
 * and still enforces the limit when Upstash answers.
 *
 * Redis is stubbed at the network layer (globalThis.fetch), which is how
 * @upstash/redis talks to Upstash, so the real client + ratelimit code runs.
 *
 *   node --import ./scripts/_alias-register.mjs scripts/verify-rate-limit.mjs
 *
 * Exit code 1 if any check fails. The last check is the negative control:
 * with a healthy stub answering "limit exceeded" the result MUST be
 * success=false, otherwise "always returns true" would pass every other check.
 */
// next/headers cannot load under plain Node (and is unused by checkRateLimit),
// so resolve it to an empty stub module.
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, n) {
         if (s === "next/headers") return { url: "data:text/javascript,export const headers = async () => new Headers()", shortCircuit: true };
         return n(s, c);
       }`,
    ),
);

process.env.KV_REST_API_URL ="https://example-test.upstash.io";
process.env.KV_REST_API_TOKEN = "test-token";

let mode = "down";
globalThis.fetch = async (_url, init) => {
  if (mode === "down") {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND example-test.upstash.io"), {
      code: "ENOTFOUND",
      errno: -3008,
    });
    throw new TypeError("fetch failed", { cause });
  }
  // Sliding-window script returns remaining requests; -1 means over the limit.
  const result = [mode === "over" ? -1 : 3, 5]; // [remainingTokens, effectiveLimit]
  // Auto-pipelined calls post an array of commands and expect an array back.
  const body = JSON.parse(init.body);
  const payload = Array.isArray(body[0]) ? body.map(() => ({ result })) : { result };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const errors = [];
console.error = (...args) => errors.push(args.map(String).join(" "));

const { checkRateLimit } = await import("@/lib/rate-limit");

let failed = 0;
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

mode = "down";
for (const bucket of ["login", "signup", "intake"]) {
  let res;
  let threw = null;
  try {
    res = await checkRateLimit(bucket, "1.2.3.4");
  } catch (e) {
    threw = e;
  }
  check(`${bucket}: Redis unreachable -> does not throw (${threw ? threw.message : "ok"})`, !threw);
  check(`${bucket}: Redis unreachable -> success=true`, res?.success === true);
}
check(
  "outage logged with [rate-limit] tag",
  errors.some((e) => e.includes("[rate-limit]") && e.includes("failing OPEN")),
);

const errorsBefore = errors.length;

mode = "ok";
check("Redis healthy, under limit -> success=true", (await checkRateLimit("login", "5.6.7.8")).success === true);

mode = "over";
check("Redis healthy, over limit -> success=false (control)", (await checkRateLimit("login", "5.6.7.8")).success === false);

// A healthy stub that is mis-shaped would be swallowed as an outage and still
// "pass" the under-limit check, so require that no outage was logged here.
check("healthy path logged no outage", errors.length === errorsBefore);

process.exit(failed ? 1 : 0);
