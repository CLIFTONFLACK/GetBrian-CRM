import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Same boundary as didit-config-env-scope.test.ts, but with DIDIT_ENV_AGENCY_ID
// unset. config.ts reads it at import time, so it is removed here, before the
// dynamic import. Each test file runs in its own process, so this does not leak.

process.env.DIDIT_API_KEY = "env-key";
process.env.DIDIT_WORKFLOW_ID = "env-wf";
delete process.env.DIDIT_ENV_AGENCY_ID;

const getAgencySettings = mock.fn((_agencyId: string) => Promise.resolve<unknown>(null));

mock.module("@/lib/db/queries/admin", { namedExports: { getAgencySettings } });

const { getAgencyDidit, getAgencyDiditKey } = await import("../kyc/didit-config.ts");

beforeEach(() => {
  getAgencySettings.mock.resetCalls();
  getAgencySettings.mock.mockImplementation(() => Promise.resolve(null));
});

test("with DIDIT_ENV_AGENCY_ID unset, an agency with no row gets null", async () => {
  const config = await getAgencyDidit("agency-env");

  assert.equal(config, null);
});

test("with DIDIT_ENV_AGENCY_ID unset, an empty agency id gets null", async () => {
  const config = await getAgencyDidit("");

  assert.equal(config, null);
});

test("with DIDIT_ENV_AGENCY_ID unset, the API-key-only lookup gives null", async () => {
  const key = await getAgencyDiditKey("agency-env");

  assert.equal(key, null);
});

test("with DIDIT_ENV_AGENCY_ID unset, an agency's own complete row still works", async () => {
  getAgencySettings.mock.mockImplementation(() =>
    Promise.resolve({ didit_api_key: "own-key", didit_workflow_id: "own-wf" }),
  );

  const config = await getAgencyDidit("agency-other");

  assert.deepEqual(config, { apiKey: "own-key", workflowId: "own-wf", source: "agency" });
});
