import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPhase,
  isAwaitingDecision,
  normaliseStatus,
} from "../kyc/providers/didit.ts";

test("normaliseStatus turns the mixed-case and padded spellings into the canonical status", () => {
  assert.equal(normaliseStatus("In Review"), "IN_REVIEW");
  assert.equal(normaliseStatus("approved"), "APPROVED");
  assert.equal(normaliseStatus(" Declined "), "DECLINED");
});

test("normaliseStatus treats hyphens and runs of spaces as one underscore", () => {
  assert.equal(normaliseStatus("awaiting-user"), "AWAITING_USER");
  assert.equal(normaliseStatus("kyc   expired"), "KYC_EXPIRED");
});

test("normaliseStatus maps null, undefined, empty and whitespace-only input to NOT_STARTED", () => {
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(normaliseStatus(v), "NOT_STARTED", String(v));
  }
});

test("normaliseStatus keeps an unknown status, upper-cased", () => {
  assert.equal(normaliseStatus("something odd"), "SOMETHING_ODD");
});

test("checkPhase reports APPROVED and DECLINED as decided, in any casing", () => {
  assert.equal(checkPhase("APPROVED"), "decided");
  assert.equal(checkPhase("declined"), "decided");
  assert.equal(checkPhase(" Declined "), "decided");
});

test("checkPhase reports EXPIRED, ABANDONED and KYC_EXPIRED as lapsed, in any spelling", () => {
  assert.equal(checkPhase("EXPIRED"), "lapsed");
  assert.equal(checkPhase("abandoned"), "lapsed");
  assert.equal(checkPhase("kyc expired"), "lapsed");
});

test("checkPhase reports IN_REVIEW, AWAITING_USER, IN_PROGRESS and NOT_STARTED as open", () => {
  assert.equal(checkPhase("IN_REVIEW"), "open");
  assert.equal(checkPhase("AWAITING_USER"), "open");
  assert.equal(checkPhase("In Progress"), "open");
  assert.equal(checkPhase("NOT_STARTED"), "open");
});

test("checkPhase treats null, undefined and empty input as open", () => {
  for (const v of [null, undefined, ""]) {
    assert.equal(checkPhase(v), "open", String(v));
  }
});

test("checkPhase treats an unknown status as open, so it is never billed twice or shown as a result", () => {
  assert.equal(checkPhase("SOMETHING_NEW"), "open");
});

test("isAwaitingDecision is true for a check the person has not finished", () => {
  assert.equal(isAwaitingDecision("AWAITING_USER"), true);
  assert.equal(isAwaitingDecision("NOT_STARTED"), true);
  assert.equal(isAwaitingDecision("in progress"), true);
  assert.equal(isAwaitingDecision(null), true);
});

test("isAwaitingDecision is false for IN_REVIEW, because a held check is a finding to show", () => {
  assert.equal(isAwaitingDecision("IN_REVIEW"), false);
  assert.equal(isAwaitingDecision("In Review"), false);
  assert.equal(isAwaitingDecision(" in-review "), false);
});

test("isAwaitingDecision is false for every decided or lapsed check", () => {
  for (const s of ["APPROVED", "DECLINED", "EXPIRED", "ABANDONED", "KYC_EXPIRED"]) {
    assert.equal(isAwaitingDecision(s), false, s);
  }
});
