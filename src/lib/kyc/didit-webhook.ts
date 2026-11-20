import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature check for Didit verification webhooks
 * (docs.didit.me/integration/webhooks, "Recommended verification order").
 *
 * Didit signs each delivery with HMAC-SHA256 and the destination's shared
 * secret, and sends:
 *  - X-Signature-V2: over the canonical JSON of the body (keys sorted, compact,
 *    Unicode kept, whole-valued floats written as integers). Recommended.
 *  - X-Signature:    over the raw body bytes.
 *  - X-Timestamp:    Unix seconds. A delivery more than 5 minutes off is a
 *    replay and is refused.
 * Each header can come with a "-Previous" twin while a secret is rotated.
 *
 * The deprecated X-Signature-Simple is NOT accepted: it signs only the
 * envelope, so it would let a forged body through.
 *
 * Pure: no I/O, and the clock is a parameter, so the tests control it.
 */

/** Didit's replay window, in seconds. */
export const DIDIT_WEBHOOK_TOLERANCE_S = 300;

export type DiditSignatureHeaders = {
  timestamp: string | null;
  signatureV2: string | null;
  signatureV2Previous?: string | null;
  signature: string | null;
  signaturePrevious?: string | null;
};

/** Didit's float rule: a whole-valued number is written as an integer. In JS
 *  JSON.stringify already writes 1.0 as 1, so this only has to recurse. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonical((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** Constant-time compare of two hex strings. Unequal length is a plain false:
 *  the length of an HMAC is public. */
function sameHex(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyDiditSignature(
  rawBody: string,
  headers: DiditSignatureHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret) return false;

  const ts = Number(headers.timestamp);
  if (!headers.timestamp || !Number.isFinite(ts)) return false;
  if (Math.abs(nowSeconds - ts) > DIDIT_WEBHOOK_TOLERANCE_S) return false;

  // V1 first: over the raw body exactly as received. It is cheap and does not
  // parse anything an unauthenticated caller sent.
  const v1 = hmacHex(secret, rawBody);
  if (sameHex(v1, headers.signature) || sameHex(v1, headers.signaturePrevious)) {
    return true;
  }

  // V2: over the canonical JSON. Only tried when a V2 header is present. A body
  // that is not JSON, or one nested so deep that canonical() overflows the
  // stack, cannot match: any throw here is a refusal, not a 500.
  if (!headers.signatureV2 && !headers.signatureV2Previous) return false;
  try {
    const v2 = hmacHex(secret, JSON.stringify(canonical(JSON.parse(rawBody))));
    return sameHex(v2, headers.signatureV2) || sameHex(v2, headers.signatureV2Previous);
  } catch {
    return false;
  }
}

/** Reads the signature headers from a request. */
export function diditSignatureHeaders(headers: Headers): DiditSignatureHeaders {
  return {
    timestamp: headers.get("x-timestamp"),
    signatureV2: headers.get("x-signature-v2"),
    signatureV2Previous: headers.get("x-signature-v2-previous"),
    signature: headers.get("x-signature"),
    signaturePrevious: headers.get("x-signature-previous"),
  };
}
