import test from "node:test";
import assert from "node:assert/strict";

import { pickKvCredentials } from "../kv-credentials.ts";

test("the NEW_ pair wins when both halves are set", () => {
  const c = pickKvCredentials({
    NEW_KV_REST_API_URL: "https://new.example",
    NEW_KV_REST_API_TOKEN: "new-token",
    KV_REST_API_URL: "https://old.example",
    KV_REST_API_TOKEN: "old-token",
  });
  assert.deepEqual(c, { url: "https://new.example", token: "new-token" });
});

test("only the old pair set: the old pair is used", () => {
  const c = pickKvCredentials({ KV_REST_API_URL: "https://old.example", KV_REST_API_TOKEN: "old-token" });
  assert.deepEqual(c, { url: "https://old.example", token: "old-token" });
});

test("a half-set NEW_ pair is ignored: URL and token never come from two databases", () => {
  const urlOnly = pickKvCredentials({
    NEW_KV_REST_API_URL: "https://new.example",
    KV_REST_API_URL: "https://old.example",
    KV_REST_API_TOKEN: "old-token",
  });
  assert.deepEqual(urlOnly, { url: "https://old.example", token: "old-token" });
  const tokenOnly = pickKvCredentials({
    NEW_KV_REST_API_TOKEN: "new-token",
    KV_REST_API_URL: "https://old.example",
    KV_REST_API_TOKEN: "old-token",
  });
  assert.deepEqual(tokenOnly, { url: "https://old.example", token: "old-token" });
});

test("nothing set gives empty strings (the limiter then fails open)", () => {
  assert.deepEqual(pickKvCredentials({}), { url: "", token: "" });
});
