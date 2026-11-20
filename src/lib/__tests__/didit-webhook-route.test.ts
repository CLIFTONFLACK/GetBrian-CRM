import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// The route is the HTTP boundary. Its own checks run for real: the path, the
// body limit, the signature gate that calls the real verifier, and the routing
// after it. The database, the agency's Didit config and the Didit sync are
// stubbed, so each test can say whether they were reached.
//
// The clock is fixed with mock.timers (Date only), so the timestamps are exact.

const getAgencySettings = mock.fn((_agencyId: string) => Promise.resolve<unknown>(null));
const getDiditSession = mock.fn((_agencyId: string, _sessionId: string) =>
  Promise.resolve<unknown>(null),
);
const getAgencyDidit = mock.fn((_agencyId: string) => Promise.resolve<unknown>(null));
const syncDiditDecision = mock.fn((_agencyId: string, _row: unknown, _apiKey: string) =>
  Promise.resolve<{ status: string }>({ status: "APPROVED" }),
);
const consoleError = mock.method(console, "error", () => undefined);

mock.module("@/lib/db/client", { namedExports: { isDbConfigured: true } });
mock.module("@/lib/db/queries/admin", { namedExports: { getAgencySettings } });
mock.module("@/lib/db/queries/kyc", { namedExports: { getDiditSession } });
mock.module("@/lib/kyc/didit-config", { namedExports: { getAgencyDidit } });
mock.module("@/lib/kyc/didit-sync", { namedExports: { syncDiditDecision } });

const { POST } = await import("../../app/api/webhooks/didit/[agencyId]/route.ts");

const AGENCY = "3f2c9a1e-8b4d-4e6f-9a1b-2c3d4e5f6a7b";
const SECRET = "whsec_route_secret";
const NOW = 1_800_000_000;

// A signed, valid-looking body. Keys out of order, so V2 and V1 differ.
const RAW_OK = '{"status":"Approved","session_id":"s-1"}';

const ROW = {
  id: "row-1",
  agency_id: AGENCY,
  contact_id: "c-1",
  company_id: "co-1",
  session_id: "s-1",
};

function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** A delivery signed with the V1 header over the raw body. */
function signedDelivery(agencyId: string, raw: string, secret: string, timestamp: number): Request {
  return new Request(`https://crm.getbrian.xyz/api/webhooks/didit/${agencyId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": String(timestamp),
      "x-signature": hmac(secret, raw),
    },
    body: raw,
  });
}

/** A delivery with a raw body and no signature headers. */
function unsignedDelivery(agencyId: string, raw: string): Request {
  return new Request(`https://crm.getbrian.xyz/api/webhooks/didit/${agencyId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-timestamp": String(NOW) },
    body: raw,
  });
}

function call(agencyId: string, request: Request): Promise<Response> {
  return POST(request, { params: Promise.resolve({ agencyId }) });
}

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: NOW * 1000 });

  getAgencySettings.mock.resetCalls();
  getDiditSession.mock.resetCalls();
  getAgencyDidit.mock.resetCalls();
  syncDiditDecision.mock.resetCalls();
  consoleError.mock.resetCalls();

  getAgencySettings.mock.mockImplementation(() =>
    Promise.resolve({ didit_webhook_secret: SECRET }),
  );
  getDiditSession.mock.mockImplementation(() => Promise.resolve(ROW));
  getAgencyDidit.mock.mockImplementation(() =>
    Promise.resolve({ apiKey: "key-1", workflowId: "wf-1", source: "agency" }),
  );
  syncDiditDecision.mock.mockImplementation(() => Promise.resolve({ status: "APPROVED" }));
});

afterEach(() => {
  mock.timers.reset();
});

// ── Path ──

test("a path agency id that is not a UUID is refused before anything is read", async () => {
  const res = await call("not-a-uuid", signedDelivery("not-a-uuid", RAW_OK, SECRET, NOW));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Unknown destination." });
  assert.equal(getAgencySettings.mock.callCount(), 0);
});

test("an upper-case UUID in the path is accepted", async () => {
  const upper = AGENCY.toUpperCase();
  const res = await call(upper, signedDelivery(upper, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 200);
  assert.equal(getAgencySettings.mock.calls[0].arguments[0], upper);
});

// ── Body size: 1,000,000 bytes ──

test("a body of 1,000,001 bytes is refused as too large, before any secret is read", async () => {
  const raw = "x".repeat(1_000_001);
  const res = await call(AGENCY, unsignedDelivery(AGENCY, raw));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Body too large." });
  assert.equal(getAgencySettings.mock.callCount(), 0);
});

test("a body of exactly 1,000,000 bytes is not refused for size", async () => {
  const raw = "x".repeat(1_000_000);
  const res = await call(AGENCY, unsignedDelivery(AGENCY, raw));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid signature." });
});

test("the size limit counts UTF-8 bytes, not characters", async () => {
  // 500,001 characters of 2 bytes each: 1,000,002 bytes, over the limit.
  const raw = "é".repeat(500_001);
  const res = await call(AGENCY, unsignedDelivery(AGENCY, raw));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Body too large." });
  assert.equal(getAgencySettings.mock.callCount(), 0);
});

// ── Signature gate ──

test("an agency with no saved webhook secret gets Invalid signature, and no session is read", async () => {
  getAgencySettings.mock.mockImplementation(() => Promise.resolve({ didit_webhook_secret: null }));

  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid signature." });
  assert.equal(getDiditSession.mock.callCount(), 0);
  assert.equal(syncDiditDecision.mock.callCount(), 0);
});

test("an agency with no settings row at all gets Invalid signature", async () => {
  getAgencySettings.mock.mockImplementation(() => Promise.resolve(null));

  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid signature." });
});

test("a saved secret of spaces only is treated as no secret", async () => {
  getAgencySettings.mock.mockImplementation(() => Promise.resolve({ didit_webhook_secret: "   " }));

  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, "   ", NOW));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid signature." });
  assert.equal(syncDiditDecision.mock.callCount(), 0);
});

test("a saved secret with stray spaces verifies against the trimmed secret", async () => {
  getAgencySettings.mock.mockImplementation(() =>
    Promise.resolve({ didit_webhook_secret: `  ${SECRET}  ` }),
  );

  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 200);
});

test("a delivery signed with another secret is refused, and no session is read", async () => {
  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, "whsec_other", NOW));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid signature." });
  assert.equal(getDiditSession.mock.callCount(), 0);
});

test("a delivery with no signature header is refused", async () => {
  const res = await call(AGENCY, unsignedDelivery(AGENCY, RAW_OK));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid signature." });
});

test("a delivery with a timestamp 301 s old is refused, even with a valid signature", async () => {
  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW - 301));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid signature." });
});

test("a delivery with a valid V2 signature is accepted", async () => {
  const canonical = '{"session_id":"s-1","status":"Approved"}';
  const request = new Request(`https://crm.getbrian.xyz/api/webhooks/didit/${AGENCY}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": String(NOW),
      "x-signature-v2": hmac(SECRET, canonical),
    },
    body: RAW_OK,
  });

  const res = await call(AGENCY, request);

  assert.equal(res.status, 200);
  assert.equal(syncDiditDecision.mock.callCount(), 1);
});

// ── Body after the signature ──

test("a signed body that is not JSON is refused with Body is not JSON", async () => {
  const raw = "session=s-1";
  const res = await call(AGENCY, signedDelivery(AGENCY, raw, SECRET, NOW));

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Body is not JSON." });
  assert.equal(getDiditSession.mock.callCount(), 0);
});

test("a signed body with no session_id is ignored with 200, and no session is read", async () => {
  const raw = '{"status":"Approved"}';
  const res = await call(AGENCY, signedDelivery(AGENCY, raw, SECRET, NOW));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ignored: "no session_id" });
  assert.equal(getDiditSession.mock.callCount(), 0);
  assert.equal(syncDiditDecision.mock.callCount(), 0);
});

test("a blank session_id is ignored the same as a missing one", async () => {
  const raw = '{"session_id":"   "}';
  const res = await call(AGENCY, signedDelivery(AGENCY, raw, SECRET, NOW));

  assert.deepEqual(await res.json(), { ok: true, ignored: "no session_id" });
  assert.equal(getDiditSession.mock.callCount(), 0);
});

test("a numeric session_id is ignored rather than turned into text", async () => {
  const raw = '{"session_id":123}';
  const res = await call(AGENCY, signedDelivery(AGENCY, raw, SECRET, NOW));

  assert.deepEqual(await res.json(), { ok: true, ignored: "no session_id" });
  assert.equal(getDiditSession.mock.callCount(), 0);
});

test("the session_id is trimmed before the lookup", async () => {
  const raw = '{"session_id":"  s-1  "}';
  await call(AGENCY, signedDelivery(AGENCY, raw, SECRET, NOW));

  assert.equal(getDiditSession.mock.calls[0].arguments[1], "s-1");
});

// ── Session lookup and the sync ──

test("the session is looked up under the agency named in the path, not one named in the body", async () => {
  const raw = '{"session_id":"s-1","agency_id":"some-other-agency"}';
  await call(AGENCY, signedDelivery(AGENCY, raw, SECRET, NOW));

  assert.deepEqual(getDiditSession.mock.calls[0].arguments, [AGENCY, "s-1"]);
});

test("an unknown session is ignored with 200, and the sync is not called", async () => {
  getDiditSession.mock.mockImplementation(() => Promise.resolve(null));

  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ignored: "unknown session" });
  assert.equal(syncDiditDecision.mock.callCount(), 0);
});

test("an agency with no Didit configuration is ignored with 200, and the sync is not called", async () => {
  getAgencyDidit.mock.mockImplementation(() => Promise.resolve(null));

  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ignored: "Didit not configured" });
  assert.equal(syncDiditDecision.mock.callCount(), 0);
});

test("a verified delivery syncs the stored row with the agency's API key and returns the status", async () => {
  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: "APPROVED" });
  assert.equal(syncDiditDecision.mock.callCount(), 1);
  assert.deepEqual(syncDiditDecision.mock.calls[0].arguments, [AGENCY, ROW, "key-1"]);
});

test("the status comes from the sync, never from the decision in the body", async () => {
  const raw = '{"session_id":"s-1","status":"Approved","decision":{"status":"APPROVED"}}';
  syncDiditDecision.mock.mockImplementation(() => Promise.resolve({ status: "DECLINED" }));

  const res = await call(AGENCY, signedDelivery(AGENCY, raw, SECRET, NOW));

  assert.deepEqual(await res.json(), { ok: true, status: "DECLINED" });
});

test("a failed sync returns 500 with a fixed message, and the Didit error text is not sent back", async () => {
  syncDiditDecision.mock.mockImplementation(() =>
    Promise.reject(new Error("Didit key revoked for agency 3f2c")),
  );

  const res = await call(AGENCY, signedDelivery(AGENCY, RAW_OK, SECRET, NOW));

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "Could not fetch the decision." });
  assert.equal(consoleError.mock.callCount(), 1);
});
