import test from "node:test";
import assert from "node:assert/strict";
import { createIdentitySession } from "../kyc/providers/didit.ts";

// Didit reads field names from the JSON body it receives, so each test parses
// the body the provider sent and asserts on the parsed object. fetch is the
// only thing mocked; the provider module runs for real.

function sessionReply(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("createIdentitySession sends the workflow and vendor data in the body", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    sessionReply({ session_id: "s-1", url: "https://verify.didit.me/s/abc", status: "Not Started" }),
  );

  await createIdentitySession("key-1", { workflowId: "wf-1", vendorData: "c-1" });

  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1].body));
  assert.equal(body.workflow_id, "wf-1");
  assert.equal(body.vendor_data, "c-1");
});

test("createIdentitySession sends the callback URL under the key callback", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    sessionReply({ session_id: "s-1", url: "https://verify.didit.me/s/abc" }),
  );

  await createIdentitySession("key-1", {
    workflowId: "wf-1",
    vendorData: "c-1",
    callbackUrl: "https://crm.example.test/verified",
  });

  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1].body));
  assert.equal(body.callback, "https://crm.example.test/verified");
  assert.equal("callback_url" in body, false);
});

test("createIdentitySession omits the callback key when callbackUrl is null", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    sessionReply({ session_id: "s-1", url: "https://verify.didit.me/s/abc" }),
  );

  await createIdentitySession("key-1", { workflowId: "wf-1", vendorData: "c-1", callbackUrl: null });

  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1].body));
  assert.equal("callback" in body, false);
  assert.equal("callback_url" in body, false);
});

test("createIdentitySession omits the callback key when callbackUrl is an empty string", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    sessionReply({ session_id: "s-1", url: "https://verify.didit.me/s/abc" }),
  );

  await createIdentitySession("key-1", { workflowId: "wf-1", vendorData: "c-1", callbackUrl: "" });

  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1].body));
  assert.equal("callback" in body, false);
});

test("createIdentitySession sends the email as contact_details when one is given", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    sessionReply({ session_id: "s-1", url: "https://verify.didit.me/s/abc" }),
  );

  await createIdentitySession("key-1", {
    workflowId: "wf-1",
    vendorData: "c-1",
    email: "jane@example.com",
  });

  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1].body));
  assert.deepEqual(body.contact_details, { email: "jane@example.com" });
});

test("createIdentitySession sends no name or date of birth, only the fields it was given", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    sessionReply({ session_id: "s-1", url: "https://verify.didit.me/s/abc" }),
  );

  await createIdentitySession("key-1", {
    workflowId: "wf-1",
    vendorData: "c-1",
    callbackUrl: "https://crm.example.test/verified",
  });

  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1].body));
  assert.deepEqual(Object.keys(body).sort(), ["callback", "vendor_data", "workflow_id"]);
});

test("createIdentitySession returns the session id and link from Didit's reply", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    sessionReply({ session_id: "s-42", url: "https://verify.didit.me/s/xyz", status: "Not Started" }),
  );

  const session = await createIdentitySession("key-1", { workflowId: "wf-1", vendorData: "c-1" });

  assert.equal(session.sessionId, "s-42");
  assert.equal(session.url, "https://verify.didit.me/s/xyz");
  assert.equal(session.status, "Not Started");
});

test("createIdentitySession throws when Didit's reply has no session id", async (t) => {
  t.mock.method(globalThis, "fetch", async () => sessionReply({ url: "https://verify.didit.me/s/xyz" }));

  await assert.rejects(
    createIdentitySession("key-1", { workflowId: "wf-1", vendorData: "c-1" }),
    { message: "Didit did not return a session id." },
  );
});
