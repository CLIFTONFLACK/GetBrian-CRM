import test from "node:test";
import assert from "node:assert/strict";

import { emailLinkHref, safeLink } from "../kyc/verification-link.ts";

test("safeLink keeps an https URL", () => {
  assert.equal(safeLink("https://verify.didit.me/session/abc"), "https://verify.didit.me/session/abc");
});

test("safeLink rejects other schemes, junk and empty values", () => {
  for (const bad of ["javascript:alert(1)", "http://verify.example", "data:text/html,x", "not a url", "", null, undefined]) {
    assert.equal(safeLink(bad as string | null | undefined), null, String(bad));
  }
});

test("emailLinkHref puts the link and a subject in the draft", () => {
  const href = emailLinkHref("jo@example.co.uk", "https://verify.didit.me/s/1?x=1&y=2");
  assert.ok(href);
  const url = new URL(href);
  assert.equal(url.protocol, "mailto:");
  assert.equal(decodeURIComponent(url.pathname), "jo@example.co.uk");
  assert.equal(url.searchParams.get("subject"), "Please verify your identity");
  assert.match(url.searchParams.get("body") ?? "", /https:\/\/verify\.didit\.me\/s\/1\?x=1&y=2$/);
});

test("emailLinkHref gives null for a missing or unsafe address", () => {
  assert.equal(emailLinkHref(null, "https://v.example/1"), null);
  assert.equal(emailLinkHref("a@b.co?bcc=x@y.co", "https://v.example/1"), null);
});
