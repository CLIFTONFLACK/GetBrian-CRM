import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  diditSignatureHeaders,
  verifyDiditSignature,
  type DiditSignatureHeaders,
} from "../kyc/didit-webhook.ts";

// The clock is a parameter, so every test fixes it and nothing reads Date.now.
// Expected signatures are built here with node:crypto and with the canonical
// JSON written out by hand, so a bug in the module cannot also be in the
// expected value.

const SECRET = "whsec_test_secret";
const NOW = 1_800_000_000;
const TS = String(NOW);

// Keys out of order, so the raw body and its canonical form differ.
const RAW = '{"status":"Approved","session_id":"s-1"}';
const CANONICAL = '{"session_id":"s-1","status":"Approved"}';

function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

function headersWith(extra: Partial<DiditSignatureHeaders>): DiditSignatureHeaders {
  return { timestamp: TS, signatureV2: null, signature: null, ...extra };
}

// ── Normal case ──

test("accepts a V2 signature over the canonical JSON of the body", () => {
  const headers = headersWith({ signatureV2: hmac(SECRET, CANONICAL) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

test("accepts a V1 signature over the raw body bytes", () => {
  const headers = headersWith({ signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

// ── Canonical JSON rules (V2) ──

test("sorts object keys at every depth before signing", () => {
  const raw = '{"b":{"y":1,"x":[{"d":1,"c":2}]},"a":"z"}';
  const canonical = '{"a":"z","b":{"x":[{"c":2,"d":1}],"y":1}}';
  const headers = headersWith({ signatureV2: hmac(SECRET, canonical) });

  assert.equal(verifyDiditSignature(raw, headers, SECRET, NOW), true);
});

test("writes a whole-valued float as an integer in the canonical form", () => {
  const headers = headersWith({ signatureV2: hmac(SECRET, '{"amount":1}') });

  assert.equal(verifyDiditSignature('{"amount":1.0}', headers, SECRET, NOW), true);
});

test("keeps a fractional number as written in the canonical form", () => {
  const headers = headersWith({ signatureV2: hmac(SECRET, '{"amount":1.5}') });

  assert.equal(verifyDiditSignature('{"amount":1.5}', headers, SECRET, NOW), true);
});

test("keeps non-ASCII characters unescaped in the canonical form", () => {
  const raw = '{"name":"José 😀"}';
  const headers = headersWith({ signatureV2: hmac(SECRET, raw) });

  assert.equal(verifyDiditSignature(raw, headers, SECRET, NOW), true);
});

test("keeps array order in the canonical form", () => {
  const headers = headersWith({ signatureV2: hmac(SECRET, '{"list":[3,1,2]}') });

  assert.equal(verifyDiditSignature('{"list":[3,1,2]}', headers, SECRET, NOW), true);
});

// ── Either header, both rotation twins, hex case and spacing ──

test("accepts when X-Signature-V2-Previous matches (rotated secret)", () => {
  const headers = headersWith({
    signatureV2: "0".repeat(64),
    signatureV2Previous: hmac(SECRET, CANONICAL),
  });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

test("accepts when X-Signature-Previous matches (rotated secret)", () => {
  const headers = headersWith({
    signature: "0".repeat(64),
    signaturePrevious: hmac(SECRET, RAW),
  });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

test("accepts an upper-case hex signature", () => {
  const headers = headersWith({ signature: hmac(SECRET, RAW).toUpperCase() });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

test("accepts a signature with spaces around it", () => {
  const headers = headersWith({ signature: `  ${hmac(SECRET, RAW)}  ` });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

// ── Timestamp window (300 s either side of the fixed clock) ──

test("accepts a timestamp exactly 300 s in the past", () => {
  const headers = headersWith({ timestamp: String(NOW - 300), signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

test("accepts a timestamp exactly 300 s in the future", () => {
  const headers = headersWith({ timestamp: String(NOW + 300), signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), true);
});

test("rejects a timestamp 301 s in the past, even with a valid signature", () => {
  const headers = headersWith({ timestamp: String(NOW - 301), signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a timestamp 301 s in the future, even with a valid signature", () => {
  const headers = headersWith({ timestamp: String(NOW + 301), signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a missing timestamp", () => {
  const headers = headersWith({ timestamp: null, signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects an empty timestamp", () => {
  const headers = headersWith({ timestamp: "", signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a timestamp that is not a number", () => {
  const headers = headersWith({ timestamp: "yesterday", signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a timestamp written as NaN", () => {
  const headers = headersWith({ timestamp: "NaN", signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects an infinite timestamp", () => {
  const headers = headersWith({ timestamp: "Infinity", signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a timestamp given in milliseconds", () => {
  const headers = headersWith({ timestamp: String(NOW * 1000), signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

// ── Wrong secret, tampering, and missing or malformed signatures ──

test("rejects an empty secret, even when the signature was made with an empty key", () => {
  const headers = headersWith({ signature: hmac("", RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, "", NOW), false);
});

test("rejects a signature made with a different secret", () => {
  const headers = headersWith({ signatureV2: hmac("whsec_other", CANONICAL) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a V2 signature when the body's values were changed", () => {
  const headers = headersWith({ signatureV2: hmac(SECRET, CANONICAL) });
  const tampered = '{"status":"Declined","session_id":"s-1"}';

  assert.equal(verifyDiditSignature(tampered, headers, SECRET, NOW), false);
});

test("rejects a V1 signature when the raw body changed by one space", () => {
  const headers = headersWith({ signature: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW + " ", headers, SECRET, NOW), false);
});

test("rejects a non-JSON body that only carries a V2 signature", () => {
  const body = "session=s-1";
  const headers = headersWith({ signatureV2: hmac(SECRET, body) });

  assert.equal(verifyDiditSignature(body, headers, SECRET, NOW), false);
});

test("accepts a non-JSON body that carries a V1 signature", () => {
  const body = "session=s-1";
  const headers = headersWith({ signature: hmac(SECRET, body) });

  assert.equal(verifyDiditSignature(body, headers, SECRET, NOW), true);
});

test("rejects a V1 signature placed in the X-Signature-V2 header", () => {
  const headers = headersWith({ signatureV2: hmac(SECRET, RAW) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects the deprecated X-Signature-Simple, which is never read", () => {
  const headers = diditSignatureHeaders(
    new Headers({ "X-Timestamp": TS, "X-Signature-Simple": hmac(SECRET, RAW) }),
  );

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a request with no signature headers at all", () => {
  const headers = headersWith({});

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects an empty signature header", () => {
  const headers = headersWith({ signatureV2: "", signature: "" });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects a signature that is a truncated hex string", () => {
  const headers = headersWith({ signature: hmac(SECRET, RAW).slice(0, 32) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

test("rejects an all-zero signature of the right length", () => {
  const headers = headersWith({ signature: "0".repeat(64) });

  assert.equal(verifyDiditSignature(RAW, headers, SECRET, NOW), false);
});

// ── diditSignatureHeaders: reads the five headers by their Didit names ──

test("reads the five signature headers by their Didit names", () => {
  const headers = diditSignatureHeaders(
    new Headers({
      "X-Timestamp": "1",
      "X-Signature-V2": "aa",
      "X-Signature-V2-Previous": "bb",
      "X-Signature": "cc",
      "X-Signature-Previous": "dd",
    }),
  );

  assert.deepEqual(headers, {
    timestamp: "1",
    signatureV2: "aa",
    signatureV2Previous: "bb",
    signature: "cc",
    signaturePrevious: "dd",
  });
});

test("returns null for every header that is absent", () => {
  const headers = diditSignatureHeaders(new Headers({}));

  assert.deepEqual(headers, {
    timestamp: null,
    signatureV2: null,
    signatureV2Previous: null,
    signature: null,
    signaturePrevious: null,
  });
});
