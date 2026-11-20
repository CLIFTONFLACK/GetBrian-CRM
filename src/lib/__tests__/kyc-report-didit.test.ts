import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { KycDiditPerson, KycReportData, SanctionsMatch } from "../kyc/types.ts";

// Database and the OFSI list are the boundaries. Everything else in runKycReport
// (risk scoring, the Didit mapping, the pending count) runs for real.
const createKycReport = mock.fn((_agencyId: string, _input: unknown) =>
  Promise.resolve({ id: "report-1" }),
);
const listLatestDiditSessionsForCompany = mock.fn((_agencyId: string, _companyId: string) =>
  Promise.resolve([] as unknown[]),
);
const screenNames = mock.fn((_names: unknown[]) =>
  Promise.resolve({ available: true, matches: [] as SanctionsMatch[] }),
);

mock.module("@/lib/db/queries/kyc", {
  namedExports: { createKycReport, listLatestDiditSessionsForCompany },
});
mock.module("../kyc/sanctions.ts", { namedExports: { screenNames } });

const { runKycReport } = await import("../kyc/report.ts");

// No registration number and no VAT number, so the only sources are the OFSI
// screen and whatever Didit adds. The notices that always appear are known.
const COMPANY = { id: "co-1", name: "Acme Ltd", company_number: null, vat_number: null };
const NO_CRN_NOTICE = "No company registration number (CRN) linked.";
const PENDING_NOTICE = "1 Didit identity check(s) started but not yet decided.";

// Required<> so a payload missing diditPeople fails at .map instead of passing.
type SavedInput = { sources: string[]; payload: Required<KycReportData> };

function savedInput(): SavedInput {
  return createKycReport.mock.calls[0].arguments[1] as SavedInput;
}

beforeEach(() => {
  createKycReport.mock.resetCalls();
  listLatestDiditSessionsForCompany.mock.resetCalls();
});

const APPROVED_WITH_HIT = {
  session_id: "s-approved",
  contact_id: "c-1",
  contact_name: "Jane Doe",
  verified_name: null,
  status: "APPROVED",
  updated_at: "2026-11-01 10:00:00",
  decision: {
    status: "APPROVED",
    id_verifications: [{ status: "Approved", full_name: "Jane Doe", document_type: "passport" }],
    aml_screenings: [
      {
        screened_data: { full_name: "Jane Doe" },
        hits: [{ matched_name: "JANE DOE", watchlist: "PEP list", match_score: 92 }],
      },
    ],
  },
};

test("an approved check is reported as a person, with the name read off the document", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([APPROVED_WITH_HIT]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  const expected: KycDiditPerson = {
    sessionId: "s-approved",
    contactId: "c-1",
    contactName: "Jane Doe",
    verifiedName: "Jane Doe",
    status: "APPROVED",
    documentType: "passport",
    faceMatchScore: null,
    livenessScore: null,
    amlHits: 1,
    warnings: [],
    checkedAt: "2026-11-01 10:00:00",
  };
  assert.deepEqual(savedInput().payload.diditPeople, [expected]);
});

test("an approved check adds didit to the sources", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([APPROVED_WITH_HIT]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().sources, ["ofsi_sanctions", "didit"]);
});

test("a watchlist hit from an approved check is added to the sanctions list", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([APPROVED_WITH_HIT]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  const expected: SanctionsMatch = {
    query: "Jane Doe",
    matchedName: "JANE DOE",
    listName: "PEP list",
    score: 0.92,
  };
  assert.deepEqual(savedInput().payload.sanctions, [expected]);
});

const AWAITING_USER_WITH_HIT = {
  session_id: "s-waiting",
  contact_id: "c-2",
  contact_name: "Sam Roe",
  verified_name: null,
  status: "AWAITING_USER",
  updated_at: "2026-11-02 09:00:00",
  decision: {
    status: "AWAITING_USER",
    aml_screenings: [
      {
        screened_data: { full_name: "Sam Roe" },
        hits: [{ matched_name: "SAM ROE", watchlist: "PEP list", match_score: 90 }],
      },
    ],
  },
};

test("a check still awaiting the user is not reported as a person", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([AWAITING_USER_WITH_HIT]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().payload.diditPeople, []);
});

test("a check still awaiting the user does not add didit to the sources", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([AWAITING_USER_WITH_HIT]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().sources, ["ofsi_sanctions"]);
});

test("a watchlist hit from a check still awaiting the user is not added to sanctions", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([AWAITING_USER_WITH_HIT]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().payload.sanctions, []);
});

test("a check still awaiting the user is counted in the not-yet-decided notice", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([AWAITING_USER_WITH_HIT]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().payload.notices, [NO_CRN_NOTICE, PENDING_NOTICE]);
});

test("a check in NOT_STARTED state is treated as not yet decided", async () => {
  const row = {
    session_id: "s-new",
    contact_id: "c-3",
    contact_name: "Kim Lee",
    verified_name: null,
    status: "NOT_STARTED",
    updated_at: "2026-11-03 08:00:00",
    decision: { status: "NOT_STARTED" },
  };
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([row]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().payload.diditPeople, []);
  assert.deepEqual(savedInput().payload.notices, [NO_CRN_NOTICE, PENDING_NOTICE]);
});

test("a check in IN_PROGRESS state is treated as not yet decided", async () => {
  const row = {
    session_id: "s-busy",
    contact_id: "c-4",
    contact_name: "Lee Park",
    verified_name: null,
    status: "IN_PROGRESS",
    updated_at: "2026-11-03 08:30:00",
    decision: { status: "IN_PROGRESS" },
  };
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([row]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().payload.diditPeople, []);
  assert.deepEqual(savedInput().sources, ["ofsi_sanctions"]);
});

test("a check with no decision payload yet is counted as not yet decided", async () => {
  const row = {
    session_id: "s-empty",
    contact_id: "c-5",
    contact_name: "Ari Stone",
    verified_name: null,
    status: "NOT_STARTED",
    updated_at: "2026-11-03 09:00:00",
    decision: null,
  };
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() => Promise.resolve([row]));

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().payload.diditPeople, []);
  assert.deepEqual(savedInput().payload.notices, [NO_CRN_NOTICE, PENDING_NOTICE]);
});

function decidedOrHeldRow(sessionId: string, contactId: string, status: string) {
  return {
    session_id: sessionId,
    contact_id: contactId,
    contact_name: "Pat Quinn",
    verified_name: null,
    status,
    updated_at: "2026-11-04 12:00:00",
    decision: { status },
  };
}

test("declined, in-review and expired checks all appear in diditPeople", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() =>
    Promise.resolve([
      decidedOrHeldRow("s-declined", "c-6", "DECLINED"),
      decidedOrHeldRow("s-review", "c-7", "IN_REVIEW"),
      decidedOrHeldRow("s-expired", "c-8", "EXPIRED"),
    ]),
  );

  await runKycReport(COMPANY, "agency-1", "user-1");

  const statuses = savedInput().payload.diditPeople.map((p) => p.status);
  assert.deepEqual(statuses, ["DECLINED", "IN_REVIEW", "EXPIRED"]);
});

test("declined, in-review and expired checks raise no not-yet-decided notice", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() =>
    Promise.resolve([
      decidedOrHeldRow("s-declined", "c-6", "DECLINED"),
      decidedOrHeldRow("s-review", "c-7", "IN_REVIEW"),
      decidedOrHeldRow("s-expired", "c-8", "EXPIRED"),
    ]),
  );

  await runKycReport(COMPANY, "agency-1", "user-1");

  assert.deepEqual(savedInput().payload.notices, [NO_CRN_NOTICE]);
});

test("with one approved and one awaiting check, only the approved one is reported and the other is counted as pending", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() =>
    Promise.resolve([APPROVED_WITH_HIT, AWAITING_USER_WITH_HIT]),
  );

  await runKycReport(COMPANY, "agency-1", "user-1");

  const sessionIds = savedInput().payload.diditPeople.map((p) => p.sessionId);
  assert.deepEqual(sessionIds, ["s-approved"]);
  assert.deepEqual(savedInput().payload.notices, [NO_CRN_NOTICE, PENDING_NOTICE]);
});

test("a status in another case ('Declined') is saved in the upper-case spelling the risk rules read", async () => {
  listLatestDiditSessionsForCompany.mock.mockImplementationOnce(() =>
    Promise.resolve([decidedOrHeldRow("s-declined", "c-9", "Declined")]),
  );

  await runKycReport(COMPANY, "agency-1", "user-1");

  const statuses = savedInput().payload.diditPeople.map((p) => p.status);
  assert.deepEqual(statuses, ["DECLINED"]);
});
