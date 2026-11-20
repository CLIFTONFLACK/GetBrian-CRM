import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// saveDiditSettings writes to the database through the admin queries. Those
// queries are the boundary, so they are stubbed and each test asserts which
// ones were reached. The auth session and the agency lookups are stubbed too.

const auth = mock.fn(() => Promise.resolve({ user: { id: "user-1" } }));
const currentAgencyId = mock.fn((_userId: string) => Promise.resolve<string | null>("agency-1"));
const isAgencyAdmin = mock.fn((_userId: string, _agencyId: string) => Promise.resolve(true));
const upsertDiditSettings = mock.fn((..._args: unknown[]) => Promise.resolve(undefined));
const setDiditWebhookSecret = mock.fn((..._args: unknown[]) => Promise.resolve(undefined));
const revalidatePath = mock.fn((_path: string) => undefined);

mock.module("next/cache", { namedExports: { revalidatePath } });
mock.module("@/lib/auth", { namedExports: { auth } });
mock.module("@/lib/auth/password", {
  namedExports: { hashPassword: mock.fn((_p: string) => Promise.resolve("hash")) },
});
mock.module("@/lib/db/client", { namedExports: { isDbConfigured: true } });
mock.module("@/lib/db/queries/agencies", { namedExports: { currentAgencyId, isAgencyAdmin } });
mock.module("@/lib/db/queries/admin", {
  namedExports: {
    clearDiditKey: mock.fn(() => Promise.resolve(undefined)),
    createAgent: mock.fn(() => Promise.resolve(undefined)),
    emailExists: mock.fn(() => Promise.resolve(false)),
    removeMember: mock.fn(() => Promise.resolve(undefined)),
    setAgentPassword: mock.fn(() => Promise.resolve(undefined)),
    setDiditWebhookSecret,
    updateAgentProfile: mock.fn(() => Promise.resolve(true)),
    updateMemberRole: mock.fn(() => Promise.resolve(undefined)),
    upsertAgencySettings: mock.fn(() => Promise.resolve(undefined)),
    upsertDiditSettings,
  },
});
mock.module("@/lib/deep-dive/prompt", {
  namedExports: { DEFAULT_DEEP_DIVE_PROMPT: "default prompt" },
});

const { saveDiditSettings } = await import("../actions/admin.ts");

function form(fields: { workflow?: string; key?: string; secret?: string }): FormData {
  const fd = new FormData();
  fd.set("didit_workflow_id", fields.workflow ?? "wf-1");
  fd.set("didit_api_key", fields.key ?? "");
  if (fields.secret !== undefined) fd.set("didit_webhook_secret", fields.secret);
  return fd;
}

beforeEach(() => {
  auth.mock.resetCalls();
  currentAgencyId.mock.resetCalls();
  isAgencyAdmin.mock.resetCalls();
  upsertDiditSettings.mock.resetCalls();
  setDiditWebhookSecret.mock.resetCalls();
  revalidatePath.mock.resetCalls();

  auth.mock.mockImplementation(() => Promise.resolve({ user: { id: "user-1" } }));
  currentAgencyId.mock.mockImplementation(() => Promise.resolve("agency-1"));
  isAgencyAdmin.mock.mockImplementation(() => Promise.resolve(true));
});

// ── Normal case ──

test("a new webhook secret is saved for the caller's agency", async () => {
  const result = await saveDiditSettings({}, form({ secret: "whsec_new_0123456789" }));

  assert.equal(result.message, "Didit settings saved.");
  assert.deepEqual(setDiditWebhookSecret.mock.calls[0].arguments, ["agency-1", "whsec_new_0123456789"]);
});

test("the webhook secret is trimmed before it is saved", async () => {
  await saveDiditSettings({}, form({ secret: "  whsec_new_0123456789  " }));

  assert.equal(setDiditWebhookSecret.mock.calls[0].arguments[1], "whsec_new_0123456789");
});

test("a webhook secret under 16 characters is refused and nothing is saved", async () => {
  const result = await saveDiditSettings({}, form({ secret: "short" }));

  assert.match(result.error ?? "", /too short/);
  assert.equal(setDiditWebhookSecret.mock.callCount(), 0);
});

// ── Blank keeps the saved secret ──

test("a blank webhook secret saves no secret, and the other Didit settings still save", async () => {
  const result = await saveDiditSettings({}, form({ secret: "" }));

  assert.equal(result.message, "Didit settings saved.");
  assert.equal(setDiditWebhookSecret.mock.callCount(), 0);
  assert.equal(upsertDiditSettings.mock.callCount(), 1);
});

test("a webhook secret of spaces only saves no secret", async () => {
  await saveDiditSettings({}, form({ secret: "   " }));

  assert.equal(setDiditWebhookSecret.mock.callCount(), 0);
});

test("a form with no webhook secret field saves no secret", async () => {
  await saveDiditSettings({}, form({}));

  assert.equal(setDiditWebhookSecret.mock.callCount(), 0);
});

// ── Refusals save nothing ──

test("a missing workflow refuses the save and saves no webhook secret", async () => {
  const result = await saveDiditSettings({}, form({ workflow: "", secret: "whsec_new_0123456789" }));

  assert.equal(result.error, "Pick a workflow — Didit needs one to know what to check.");
  assert.equal(setDiditWebhookSecret.mock.callCount(), 0);
  assert.equal(upsertDiditSettings.mock.callCount(), 0);
});

test("a caller who is not an agency admin saves no webhook secret", async () => {
  isAgencyAdmin.mock.mockImplementation(() => Promise.resolve(false));

  const result = await saveDiditSettings({}, form({ secret: "whsec_new_0123456789" }));

  assert.equal(result.error, "Only an agency admin can do that.");
  assert.equal(setDiditWebhookSecret.mock.callCount(), 0);
  assert.equal(upsertDiditSettings.mock.callCount(), 0);
});
