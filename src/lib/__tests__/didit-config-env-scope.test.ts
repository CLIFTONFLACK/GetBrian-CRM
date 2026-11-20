import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// config.ts reads the DIDIT_* env vars once, at import time. So the env is set
// here, before the dynamic import below. node --test runs each test file in its
// own process, so these values do not leak into other test files. The agency
// settings row (the database) is the boundary and is stubbed.

process.env.DIDIT_API_KEY = "env-key";
process.env.DIDIT_WORKFLOW_ID = "env-wf";
process.env.DIDIT_ENV_AGENCY_ID = "agency-env";

const getAgencySettings = mock.fn((_agencyId: string) => Promise.resolve<unknown>(null));

mock.module("@/lib/db/queries/admin", { namedExports: { getAgencySettings } });

const { getAgencyDidit, getAgencyDiditKey } = await import("../kyc/didit-config.ts");

beforeEach(() => {
  getAgencySettings.mock.resetCalls();
  getAgencySettings.mock.mockImplementation(() => Promise.resolve(null));
});

test("the named agency with no row of its own gets the env credentials, source env", async () => {
  const config = await getAgencyDidit("agency-env");

  assert.deepEqual(config, { apiKey: "env-key", workflowId: "env-wf", source: "env" });
});

test("an agency other than the named one with no row of its own gets null", async () => {
  const config = await getAgencyDidit("agency-other");

  assert.equal(config, null);
});

test("an agency with its own complete row gets that row, not the env credentials", async () => {
  getAgencySettings.mock.mockImplementation(() =>
    Promise.resolve({ didit_api_key: "own-key", didit_workflow_id: "own-wf" }),
  );

  const config = await getAgencyDidit("agency-env");

  assert.deepEqual(config, { apiKey: "own-key", workflowId: "own-wf", source: "agency" });
});

test("another agency's own complete row is used, with source agency", async () => {
  getAgencySettings.mock.mockImplementation(() =>
    Promise.resolve({ didit_api_key: "own-key", didit_workflow_id: "own-wf" }),
  );

  const config = await getAgencyDidit("agency-other");

  assert.deepEqual(config, { apiKey: "own-key", workflowId: "own-wf", source: "agency" });
});

test("the named agency with its own key but no workflow gets null, never the env account", async () => {
  getAgencySettings.mock.mockImplementation(() =>
    Promise.resolve({ didit_api_key: "own-key", didit_workflow_id: null }),
  );

  const config = await getAgencyDidit("agency-env");

  assert.equal(config, null);
});

test("a whitespace-only row key counts as no key, so the named agency gets the env credentials", async () => {
  getAgencySettings.mock.mockImplementation(() =>
    Promise.resolve({ didit_api_key: "   ", didit_workflow_id: "own-wf" }),
  );

  const config = await getAgencyDidit("agency-env");

  assert.deepEqual(config, { apiKey: "env-key", workflowId: "env-wf", source: "env" });
});

test("the API-key-only lookup gives the env key to the named agency with no row", async () => {
  const key = await getAgencyDiditKey("agency-env");

  assert.equal(key, "env-key");
});

test("the API-key-only lookup gives null to an agency other than the named one", async () => {
  const key = await getAgencyDiditKey("agency-other");

  assert.equal(key, null);
});

test("the API-key-only lookup gives the agency's own key over the env key", async () => {
  getAgencySettings.mock.mockImplementation(() => Promise.resolve({ didit_api_key: "own-key" }));

  const key = await getAgencyDiditKey("agency-env");

  assert.equal(key, "own-key");
});
