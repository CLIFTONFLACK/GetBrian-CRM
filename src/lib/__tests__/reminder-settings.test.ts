import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INTERVAL,
  INTERVAL_OPTIONS,
  describeSetting,
  isRunDue,
  parseInterval,
} from "../reminder-settings.ts";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

test("parseInterval accepts only the allowed values", () => {
  for (const o of INTERVAL_OPTIONS) {
    assert.equal(parseInterval(String(o.minutes)), o.minutes);
    assert.equal(parseInterval(o.minutes), o.minutes);
  }
  for (const bad of ["7", "0", "-5", "15.5", "abc", "", " ", null, undefined, "1e3", "0x0f", 7, NaN]) {
    assert.equal(parseInterval(bad), null, `should reject ${String(bad)}`);
  }
  assert.equal(parseInterval(" 30 "), 30);
});

test("the default interval is an allowed option", () => {
  assert.equal(parseInterval(DEFAULT_INTERVAL), DEFAULT_INTERVAL);
});

test("a disabled agency is never due", () => {
  assert.equal(isRunDue({ enabled: false, intervalMinutes: 1, lastRunAt: null }, NOW), false);
  assert.equal(isRunDue({ enabled: false, intervalMinutes: 1, lastRunAt: ago(86_400) }, NOW), false);
});

test("an enabled agency with no earlier run is due", () => {
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 1440, lastRunAt: null }, NOW), true);
});

test("a run is due at exactly the interval", () => {
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 15, lastRunAt: ago(15 * 60) }, NOW), true);
});

test("a run 31 seconds early passes with the 30 second slack, 31 seconds too early fails", () => {
  // 15 minutes = 900 s. Slack is 30 s, so 870 s is the earliest accepted.
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 15, lastRunAt: ago(870) }, NOW), true);
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 15, lastRunAt: ago(869) }, NOW), false);
  // 31 s early (869 s elapsed) fails; 29 s early (871 s) passes.
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 15, lastRunAt: ago(871) }, NOW), true);
});

test("an every-minute setting runs on each cron call, not on the same second", () => {
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 1, lastRunAt: ago(60) }, NOW), true);
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 1, lastRunAt: ago(30) }, NOW), true);
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 1, lastRunAt: ago(29) }, NOW), false);
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 1, lastRunAt: ago(0) }, NOW), false);
});

test("a daily setting is not due after one hour", () => {
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 1440, lastRunAt: ago(3600) }, NOW), false);
  assert.equal(isRunDue({ enabled: true, intervalMinutes: 1440, lastRunAt: ago(86_400) }, NOW), true);
});

test("describeSetting states off clearly and names the interval when on", () => {
  assert.equal(describeSetting({ enabled: false, intervalMinutes: 5 }), "Reminders are off");
  assert.match(describeSetting({ enabled: true, intervalMinutes: 60 }), /Every hour/);
  assert.match(describeSetting({ enabled: true, intervalMinutes: 1440 }), /Once a day/);
});
