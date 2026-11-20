import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// The billed call is an HTTP POST to Didit, so the network is the boundary that
// matters: a test that says "no session was created" asserts that no request
// reached Didit. The database, the session check and the agency lookup are
// stubbed. The Didit provider module itself runs for real.

const revalidatePath = mock.fn((_path: string) => undefined);
const currentAgencyId = mock.fn((_userId: string) => Promise.resolve<string | null>("agency-1"));
const getContactById = mock.fn((_agencyId: string, _contactId: string) =>
  Promise.resolve<unknown>(null),
);
const getAgencyDidit = mock.fn((_agencyId: string) =>
  Promise.resolve<unknown>({ apiKey: "test-key", workflowId: "wf-1" }),
);
const getLatestDiditSessionForContact = mock.fn((_agencyId: string, _contactId: string) =>
  Promise.resolve<unknown>(null),
);
const createDiditSession = mock.fn((_agencyId: string, _input: { sessionId: string }) =>
  Promise.resolve<unknown>({ session_id: "s-123" }),
);
const updateDiditDecision = mock.fn((..._args: unknown[]) => Promise.resolve(undefined));
const getDiditSession = mock.fn((_agencyId: string, _sessionId: string) =>
  Promise.resolve<unknown>(null),
);
const setDiditSessionError = mock.fn((..._args: unknown[]) => Promise.resolve(undefined));
const getKycCompany = mock.fn((_agencyId: string, _companyId: string) =>
  Promise.resolve<unknown>(null),
);
const updateCompanyRegistration = mock.fn((..._args: unknown[]) => Promise.resolve(true));
const runKycReport = mock.fn((..._args: unknown[]) => Promise.resolve({ id: "report-1" }));
const checkRateLimit = mock.fn((_bucket: string, _identifier: string) =>
  Promise.resolve<{ success: boolean }>({ success: true }),
);

mock.module("next/cache", { namedExports: { revalidatePath } });
mock.module("next/headers", {
  namedExports: { headers: async () => new Headers({ host: "crm.getbrian.xyz" }) },
});
mock.module("@/lib/auth", {
  namedExports: { auth: async () => ({ user: { id: "user-1" } }) },
});
const getMemberRole = mock.fn((_agencyId: string, _userId: string) =>
  Promise.resolve<string | null>("admin"),
);
mock.module("@/lib/db/queries/agencies", { namedExports: { currentAgencyId, getMemberRole } });
mock.module("@/lib/db/queries/contacts", { namedExports: { getContactById } });
mock.module("@/lib/db/queries/kyc", {
  namedExports: {
    createDiditSession,
    getDiditSession,
    getKycCompany,
    getLatestDiditSessionForContact,
    setDiditSessionError,
    updateCompanyRegistration,
    updateDiditDecision,
  },
});
mock.module("@/lib/kyc/didit-config", { namedExports: { getAgencyDidit } });
mock.module("@/lib/kyc/report", { namedExports: { runKycReport } });
mock.module("@/lib/rate-limit", { namedExports: { checkRateLimit } });

const { startIdentityCheck } = await import("../actions/kyc.ts");
const { canStartIdentityCheck } = await import("../kyc/providers/didit.ts");

// Silences the expected console.error on the saved-session failure path, and
// lets the tests count what reaches Didit. Installed once; reset before each test.
const fetchSpy = mock.method(globalThis, "fetch", async () => new Response("{}", { status: 500 }));
const consoleSpy = mock.method(console, "error", () => undefined);

const CONTACT = {
  id: "c-1",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  company_id: "co-1",
};

function sessionCreated(sessionId: string, url: string): Response {
  return new Response(JSON.stringify({ session_id: sessionId, url, status: "Not Started" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function decisionReturns(status: string): Response {
  return new Response(JSON.stringify({ status }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchSpy.mock.resetCalls();
  consoleSpy.mock.resetCalls();
  revalidatePath.mock.resetCalls();
  createDiditSession.mock.resetCalls();
  updateDiditDecision.mock.resetCalls();
  checkRateLimit.mock.resetCalls();
  getMemberRole.mock.resetCalls();

  currentAgencyId.mock.mockImplementation(() => Promise.resolve("agency-1"));
  getMemberRole.mock.mockImplementation(() => Promise.resolve("admin"));
  checkRateLimit.mock.mockImplementation(() => Promise.resolve({ success: true }));
  getContactById.mock.mockImplementation(() => Promise.resolve(CONTACT));
  getAgencyDidit.mock.mockImplementation(() =>
    Promise.resolve({ apiKey: "test-key", workflowId: "wf-1" }),
  );
  getLatestDiditSessionForContact.mock.mockImplementation(() => Promise.resolve(null));
  createDiditSession.mock.mockImplementation(() => Promise.resolve({ session_id: "s-123" }));
  fetchSpy.mock.mockImplementation(async (input) => {
    const url = String(input);
    return url.endsWith("/decision/")
      ? decisionReturns("NOT_STARTED")
      : sessionCreated("s-123", "https://verify.didit.me/s/abc");
  });
});

function formFor(contactId: string, confirmRecheck?: string): FormData {
  const fd = new FormData();
  fd.set("contact_id", contactId);
  if (confirmRecheck !== undefined) fd.set("confirm_recheck", confirmRecheck);
  return fd;
}

function latestCheck(status: string) {
  return Promise.resolve({ session_id: "s-old", status });
}

test("an open check (AWAITING_USER) blocks a new session, and nothing reaches Didit", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("AWAITING_USER"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /already has an identity check in progress/);
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("an open check written in another case ('In Progress') still blocks a new session", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("In Progress"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /already has an identity check in progress/);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("a check held in review (IN_REVIEW) blocks a new session", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("IN_REVIEW"));

  const result = await startIdentityCheck({}, formFor("c-1", "1"));

  assert.match(result.error ?? "", /already has an identity check in progress/);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("an open check is not re-run even when confirm_recheck is ticked", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("AWAITING_USER"));

  await startIdentityCheck({}, formFor("c-1", "1"));

  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a decided check (APPROVED) is refused without confirm_recheck, and nothing reaches Didit", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("APPROVED"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /Start a new paid check/);
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a decided check is refused when confirm_recheck is anything other than 1", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("DECLINED"));

  const result = await startIdentityCheck({}, formFor("c-1", "true"));

  assert.match(result.error ?? "", /Start a new paid check/);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("a decided check is run again when confirm_recheck is 1", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("APPROVED"));

  const result = await startIdentityCheck({}, formFor("c-1", "1"));

  assert.equal(result.error, undefined);
  assert.match(result.message ?? "", /^Identity check started for Jane Doe/);
  assert.equal(createDiditSession.mock.callCount(), 1);
  assert.equal(createDiditSession.mock.calls[0].arguments[1].sessionId, "s-123");
});

test("a lapsed check (EXPIRED) starts a new session without confirm_recheck", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("EXPIRED"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
});

test("a contact with no previous check starts a new session", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => Promise.resolve(null));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
});

test("a session created at Didit but not saved returns its id and link instead of throwing", async () => {
  fetchSpy.mock.mockImplementation(async (input) =>
    String(input).endsWith("/decision/")
      ? decisionReturns("NOT_STARTED")
      : sessionCreated("s-999", "https://verify.didit.me/s/xyz"),
  );
  createDiditSession.mock.mockImplementation(() => Promise.reject(new Error("db unavailable")));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.ok(result.error?.includes("s-999"), result.error);
  assert.ok(result.error?.includes("https://verify.didit.me/s/xyz"), result.error);
  assert.equal(result.message, undefined);
});

test("a session created but not saved makes no decision request", async () => {
  fetchSpy.mock.mockImplementation(async (input) =>
    String(input).endsWith("/decision/")
      ? decisionReturns("NOT_STARTED")
      : sessionCreated("s-999", "https://verify.didit.me/s/xyz"),
  );
  createDiditSession.mock.mockImplementation(() => Promise.reject(new Error("db unavailable")));

  await startIdentityCheck({}, formFor("c-1"));

  assert.equal(fetchSpy.mock.callCount(), 1);
});

test("a Didit refusal returns Didit's message and saves no row", async () => {
  fetchSpy.mock.mockImplementation(async () =>
    new Response(JSON.stringify({ detail: "API key is not valid" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, "API key is not valid");
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a failed first decision poll still reports the check as started", async () => {
  fetchSpy.mock.mockImplementation(async (input) =>
    String(input).endsWith("/decision/")
      ? new Response("upstream error", { status: 500 })
      : sessionCreated("s-123", "https://verify.didit.me/s/abc"),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.match(result.message ?? "", /^Identity check started for Jane Doe/);
  assert.equal(updateDiditDecision.mock.callCount(), 0);
});

// ── Review follow-ups: age limit on the open-check block, and the recheck flag ──

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** The text Postgres returns for created_at::text, e.g. "2026-11-19 18:20:00.123456+00". */
function postgresText(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "000+00");
}

test("an open check from 30 days ago no longer blocks a new session", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() =>
    Promise.resolve({
      session_id: "s-old",
      status: "AWAITING_USER",
      created_at: postgresText(daysAgo(30)),
    }),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
});

test("an open check from 1 day ago, in Postgres timestamp text, still blocks", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() =>
    Promise.resolve({
      session_id: "s-old",
      status: "AWAITING_USER",
      created_at: postgresText(daysAgo(1)),
    }),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /already has an identity check in progress/);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("an open check with an unreadable timestamp still blocks", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() =>
    Promise.resolve({ session_id: "s-old", status: "AWAITING_USER", created_at: "not a date" }),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /already has an identity check in progress/);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("a decided check without the tick returns the flag that shows the tick box", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("APPROVED"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.needsRecheckConfirm, true);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

// ── Role gate: only an agency admin or manager may start a billed check ──

test("an agent is refused, and no request reaches Didit", async () => {
  getMemberRole.mock.mockImplementation(() => Promise.resolve("agent"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /Only an agency admin or manager/);
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a user with no membership role is refused, and no request reaches Didit", async () => {
  getMemberRole.mock.mockImplementation(() => Promise.resolve(null));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /Only an agency admin or manager/);
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("an admin's check reaches Didit and is saved", async () => {
  getMemberRole.mock.mockImplementation(() => Promise.resolve("admin"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
  assert.equal(fetchSpy.mock.callCount(), 2);
});

test("a manager's check reaches Didit and is saved", async () => {
  getMemberRole.mock.mockImplementation(() => Promise.resolve("manager"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
  assert.equal(fetchSpy.mock.callCount(), 2);
});

test("the role is looked up for the signed-in user in the current agency", async () => {
  await startIdentityCheck({}, formFor("c-1"));

  assert.equal(getMemberRole.mock.callCount(), 1);
  assert.deepEqual(getMemberRole.mock.calls[0].arguments, ["agency-1", "user-1"]);
});

test("a role refusal does not use up the rate limit", async () => {
  getMemberRole.mock.mockImplementation(() => Promise.resolve("agent"));

  await startIdentityCheck({}, formFor("c-1"));

  assert.equal(checkRateLimit.mock.callCount(), 0);
});

// ── Rate limit: the last check before the billed call ──

test("the rate limit is checked once per billed start, keyed by agency and user", async () => {
  await startIdentityCheck({}, formFor("c-1"));

  assert.equal(checkRateLimit.mock.callCount(), 1);
  assert.deepEqual(checkRateLimit.mock.calls[0].arguments, ["diditStart", "agency-1:user-1"]);
});

test("a refused rate limit returns the limit message, and no request reaches Didit", async () => {
  checkRateLimit.mock.mockImplementation(() => Promise.resolve({ success: false }));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /Too many identity checks were started in the last hour/);
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("an open check blocked by the duplicate guard does not use up the rate limit", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("AWAITING_USER"));

  await startIdentityCheck({}, formFor("c-1"));

  assert.equal(checkRateLimit.mock.callCount(), 0);
});

test("a decided check refused for want of the tick does not use up the rate limit", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => latestCheck("APPROVED"));

  await startIdentityCheck({}, formFor("c-1"));

  assert.equal(checkRateLimit.mock.callCount(), 0);
});

// ── canStartIdentityCheck: the pure role rule the action and the card share ──

test("canStartIdentityCheck allows an admin", () => {
  assert.equal(canStartIdentityCheck("admin"), true);
});

test("canStartIdentityCheck allows a manager", () => {
  assert.equal(canStartIdentityCheck("manager"), true);
});

test("canStartIdentityCheck refuses an agent", () => {
  assert.equal(canStartIdentityCheck("agent"), false);
});

test("canStartIdentityCheck refuses null", () => {
  assert.equal(canStartIdentityCheck(null), false);
});

test("canStartIdentityCheck refuses undefined", () => {
  assert.equal(canStartIdentityCheck(undefined), false);
});

test("canStartIdentityCheck refuses an empty string", () => {
  assert.equal(canStartIdentityCheck(""), false);
});

test("canStartIdentityCheck refuses a role written in capitals", () => {
  assert.equal(canStartIdentityCheck("Admin"), false);
});

// ── Stale open check: Didit is asked before an old open row blocks anything ──

function staleCheck(status: string) {
  return Promise.resolve({ session_id: "s-old", status, created_at: postgresText(daysAgo(8)) });
}

test("an open check from 6 days ago still blocks, and no decision is requested", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() =>
    Promise.resolve({
      session_id: "s-old",
      status: "AWAITING_USER",
      created_at: postgresText(daysAgo(6)),
    }),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /already has an identity check in progress/);
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a stale open check that Didit now reports as approved is refused without the tick", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => staleCheck("AWAITING_USER"));
  fetchSpy.mock.mockImplementation(async () => decisionReturns("APPROVED"));

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.match(result.error ?? "", /already has an identity result/);
  assert.equal(result.needsRecheckConfirm, true);
  assert.equal(fetchSpy.mock.callCount(), 1);
  assert.ok(String(fetchSpy.mock.calls[0].arguments[0]).endsWith("/decision/"));
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a stale open check saves Didit's decision against the old session id", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => staleCheck("AWAITING_USER"));
  fetchSpy.mock.mockImplementation(async () => decisionReturns("APPROVED"));

  await startIdentityCheck({}, formFor("c-1"));

  assert.equal(updateDiditDecision.mock.callCount(), 1);
  assert.equal(updateDiditDecision.mock.calls[0].arguments[1], "s-old");
  assert.equal(updateDiditDecision.mock.calls[0].arguments[2], "APPROVED");
});

test("a stale open check that Didit reports as approved starts a new session when the tick is set", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => staleCheck("AWAITING_USER"));
  fetchSpy.mock.mockImplementation(async (input) =>
    String(input).endsWith("/decision/")
      ? decisionReturns("APPROVED")
      : sessionCreated("s-123", "https://verify.didit.me/s/abc"),
  );

  const result = await startIdentityCheck({}, formFor("c-1", "1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
  assert.equal(createDiditSession.mock.calls[0].arguments[1].sessionId, "s-123");
});

test("a stale open check that Didit still reports as open starts a new session without the tick", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => staleCheck("AWAITING_USER"));
  fetchSpy.mock.mockImplementation(async (input) =>
    String(input).endsWith("/decision/")
      ? decisionReturns("AWAITING_USER")
      : sessionCreated("s-123", "https://verify.didit.me/s/abc"),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
  assert.equal(updateDiditDecision.mock.calls[0].arguments[1], "s-old");
});

test("a stale open check whose decision call fails starts a new session as before", async () => {
  getLatestDiditSessionForContact.mock.mockImplementation(() => staleCheck("AWAITING_USER"));
  fetchSpy.mock.mockImplementation(async (input) =>
    String(input).endsWith("/decision/")
      ? new Response("upstream error", { status: 500 })
      : sessionCreated("s-123", "https://verify.didit.me/s/abc"),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, undefined);
  assert.equal(createDiditSession.mock.callCount(), 1);
  assert.equal(updateDiditDecision.mock.callCount(), 0);
});

// ── No reply from Didit: the session may exist and be billed, so say so ──

const NO_REPLY_TAIL =
  " The check may have been started and billed. Look in the Didit dashboard before you press the button again.";

test("a session create that times out says the check may have been billed", async () => {
  fetchSpy.mock.mockImplementation(async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, "No reply from Didit (timed out)." + NO_REPLY_TAIL);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a session create with a dropped connection says the check may have been billed", async () => {
  fetchSpy.mock.mockImplementation(async () => {
    throw new TypeError("fetch failed");
  });

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, "No reply from Didit (network error)." + NO_REPLY_TAIL);
  assert.equal(createDiditSession.mock.callCount(), 0);
});

test("a session create is sent to the create endpoint with an abort signal", async () => {
  await startIdentityCheck({}, formFor("c-1"));

  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  const init = fetchSpy.mock.calls[0].arguments[1];
  assert.ok(url.endsWith("/v3/session/"));
  assert.ok(init.signal instanceof AbortSignal);
});

test("a Didit HTTP error reply does not say the check may have been billed", async () => {
  fetchSpy.mock.mockImplementation(async () =>
    new Response(JSON.stringify({ detail: "API key is not valid" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );

  const result = await startIdentityCheck({}, formFor("c-1"));

  assert.equal(result.error, "API key is not valid");
  assert.doesNotMatch(result.error ?? "", /billed/);
});

// ── Callback: the person returns to the public verified page, never to a CRM page ──

test("the Didit callback is the public verified page when the contact has a company", async () => {
  await startIdentityCheck({}, formFor("c-1"));

  const body = JSON.parse(String(fetchSpy.mock.calls[0].arguments[1].body));
  assert.equal(body.callback, "https://crm.getbrian.xyz/verified");
});

test("the Didit callback is the public verified page when the contact has no company", async () => {
  getContactById.mock.mockImplementation(() => Promise.resolve({ ...CONTACT, company_id: null }));

  await startIdentityCheck({}, formFor("c-1"));

  const body = JSON.parse(String(fetchSpy.mock.calls[0].arguments[1].body));
  assert.equal(body.callback, "https://crm.getbrian.xyz/verified");
});
