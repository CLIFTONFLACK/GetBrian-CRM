import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Didit's decision endpoint is the network boundary, so fetch is stubbed. The
// database writes and the cache revalidation are stubbed too, so each test can
// say what was saved. The provider (getDecision, mapDecision) runs for real.

const revalidatePath = mock.fn((_path: string) => undefined);
const updateDiditDecision = mock.fn((..._args: unknown[]) => Promise.resolve(undefined));
const setDiditSessionError = mock.fn((..._args: unknown[]) => Promise.resolve(undefined));

mock.module("next/cache", { namedExports: { revalidatePath } });
mock.module("@/lib/db/queries/kyc", {
  namedExports: { setDiditSessionError, updateDiditDecision },
});

const { syncDiditDecision } = await import("../kyc/didit-sync.ts");

const fetchSpy = mock.method(globalThis, "fetch", async () => new Response("{}", { status: 500 }));

const AGENCY = "agency-1";
const ROW = { session_id: "s-1", company_id: "co-1" };
const ROW_NO_COMPANY = { session_id: "s-1", company_id: null };

// One verified person with two AML hits on one screening.
const APPROVED = {
  status: "APPROVED",
  id_verifications: [{ status: "Approved", first_name: "Jane", last_name: "Doe" }],
  aml_screenings: [{ hits: [{ caption: "Hit A" }, { caption: "Hit B" }] }],
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchSpy.mock.resetCalls();
  revalidatePath.mock.resetCalls();
  updateDiditDecision.mock.resetCalls();
  setDiditSessionError.mock.resetCalls();
  fetchSpy.mock.mockImplementation(async () => reply(APPROVED));
});

// ── Normal case ──

test("asks Didit for the decision of that session, with the agency's API key", async () => {
  await syncDiditDecision(AGENCY, ROW, "key-1");

  assert.equal(fetchSpy.mock.callCount(), 1);
  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  const init = fetchSpy.mock.calls[0].arguments[1];
  assert.ok(url.endsWith("/v3/session/s-1/decision/"), url);
  assert.equal(init.headers["x-api-key"], "key-1");
});

test("saves the status, the AML hit count and the document name for that session", async () => {
  await syncDiditDecision(AGENCY, ROW, "key-1");

  assert.equal(updateDiditDecision.mock.callCount(), 1);
  const args = updateDiditDecision.mock.calls[0].arguments;
  assert.deepEqual(args.slice(0, 6), [AGENCY, "s-1", "APPROVED", APPROVED, 2, "Jane Doe"]);
});

test("passes the time the fetch started, taken before the Didit call", async () => {
  let callStartedAt = 0;
  fetchSpy.mock.mockImplementation(async () => {
    callStartedAt = Date.now();
    return reply(APPROVED);
  });

  await syncDiditDecision(AGENCY, ROW, "key-1");

  const fetchedAt = updateDiditDecision.mock.calls[0].arguments[6];
  assert.ok(fetchedAt instanceof Date, "the fetch time is passed as a Date");
  assert.ok(fetchedAt.getTime() <= callStartedAt, "it is taken before the call");
});

test("returns the status Didit reports", async () => {
  const result = await syncDiditDecision(AGENCY, ROW, "key-1");

  assert.deepEqual(result, { status: "APPROVED" });
});

test("revalidates the KYC page and then the company page when the row has a company", async () => {
  await syncDiditDecision(AGENCY, ROW, "key-1");

  assert.deepEqual(
    revalidatePath.mock.calls.map((call) => call.arguments[0]),
    ["/kyc", "/companies/co-1"],
  );
});

test("revalidates only the KYC page when the row has no company", async () => {
  await syncDiditDecision(AGENCY, ROW_NO_COMPANY, "key-1");

  assert.deepEqual(
    revalidatePath.mock.calls.map((call) => call.arguments[0]),
    ["/kyc"],
  );
});

// ── Thin decisions ──

test("a decision with no status is refused and saves nothing", async () => {
  fetchSpy.mock.mockImplementation(async () => reply({}));

  await assert.rejects(syncDiditDecision(AGENCY, ROW, "key-1"), /no status/);

  assert.equal(updateDiditDecision.mock.callCount(), 0);
});

test("a decision with no identity or AML blocks saves a null name and zero AML hits", async () => {
  fetchSpy.mock.mockImplementation(async () => reply({ status: "IN_REVIEW" }));

  await syncDiditDecision(AGENCY, ROW, "key-1");

  assert.equal(updateDiditDecision.mock.calls[0].arguments[4], 0);
  assert.equal(updateDiditDecision.mock.calls[0].arguments[5], null);
});

// ── Failure paths: the error is saved on the row, then thrown again ──

test("a Didit HTTP 500 without a detail message saves the HTTP status on the row and rethrows", async () => {
  fetchSpy.mock.mockImplementation(async () => new Response("oops", { status: 500 }));

  await assert.rejects(syncDiditDecision(AGENCY, ROW, "key-1"), {
    message: "Didit request failed (HTTP 500).",
  });

  assert.deepEqual(setDiditSessionError.mock.calls[0].arguments, [
    AGENCY,
    "s-1",
    "Didit request failed (HTTP 500).",
  ]);
});

test("a Didit 401 saves Didit's detail message on the row and rethrows", async () => {
  fetchSpy.mock.mockImplementation(async () => reply({ detail: "API key is not valid" }, 401));

  await assert.rejects(syncDiditDecision(AGENCY, ROW, "key-1"), {
    message: "API key is not valid",
  });

  assert.deepEqual(setDiditSessionError.mock.calls[0].arguments, [
    AGENCY,
    "s-1",
    "API key is not valid",
  ]);
});

test("a failed Didit call saves no decision and revalidates nothing", async () => {
  fetchSpy.mock.mockImplementation(async () => reply({ detail: "nope" }, 500));

  await assert.rejects(syncDiditDecision(AGENCY, ROW, "key-1"));

  assert.equal(updateDiditDecision.mock.callCount(), 0);
  assert.equal(revalidatePath.mock.callCount(), 0);
});

test("a dropped connection saves the no-reply message on the row and rethrows", async () => {
  fetchSpy.mock.mockImplementation(async () => {
    throw new TypeError("fetch failed");
  });

  await assert.rejects(syncDiditDecision(AGENCY, ROW, "key-1"), {
    message: "No reply from Didit (network error).",
  });

  assert.deepEqual(setDiditSessionError.mock.calls[0].arguments, [
    AGENCY,
    "s-1",
    "No reply from Didit (network error).",
  ]);
});

test("a timed-out call saves the timeout message on the row and rethrows", async () => {
  fetchSpy.mock.mockImplementation(async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });

  await assert.rejects(syncDiditDecision(AGENCY, ROW, "key-1"), {
    message: "No reply from Didit (timed out).",
  });

  assert.deepEqual(setDiditSessionError.mock.calls[0].arguments, [
    AGENCY,
    "s-1",
    "No reply from Didit (timed out).",
  ]);
});

test("a 200 reply that is not JSON does not overwrite a settled status with NOT_STARTED", async () => {
  // Setup: the reply is HTML from a proxy with HTTP 200. Expected: the sync
  // fails and saves nothing, so the stored status is kept. Actual (suspected):
  // getDecision reads a null body as NOT_STARTED and the sync saves it.
  fetchSpy.mock.mockImplementation(async () => new Response("<html>bad gateway</html>", { status: 200 }));

  await assert.rejects(syncDiditDecision(AGENCY, ROW, "key-1"));

  assert.equal(updateDiditDecision.mock.callCount(), 0);
});
