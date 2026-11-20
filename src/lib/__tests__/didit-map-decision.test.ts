import test from "node:test";
import assert from "node:assert/strict";
import { mapDecision } from "../kyc/providers/didit.ts";

// Each test changes only the name fields on one AML hit, so a failure points at
// the name rule that broke. The screened name is the query; the hit's name is
// what the watchlist matched.

function sessionDecisionWithHit(hit: Record<string, unknown>) {
  return {
    status: "Approved",
    aml_screenings: [
      {
        status: "Approved",
        total_hits: 1,
        hits: [hit],
        screened_data: { full_name: "Jane Doe" },
      },
    ],
  };
}

test("mapDecision reads an AML hit's matched name from caption on a session decision", () => {
  const result = mapDecision({
    status: "Approved",
    aml_screenings: [
      {
        status: "Approved",
        total_hits: 1,
        hits: [{ caption: "John Doe", match_score: 95, risk_score: 91 }],
        screened_data: { full_name: "Jane Doe" },
      },
    ],
  });

  assert.deepEqual(result.aml, [
    { query: "Jane Doe", matchedName: "John Doe", listName: "Didit AML", score: 0.95 },
  ]);
});

test("mapDecision prefers caption over matched_name and name when all three are present", () => {
  const result = mapDecision(
    sessionDecisionWithHit({ caption: "John Doe", matched_name: "Jon Doe", name: "J Doe" }),
  );

  assert.equal(result.aml[0].matchedName, "John Doe");
});

test("mapDecision falls back to matched_name when a hit has no caption", () => {
  const result = mapDecision(sessionDecisionWithHit({ matched_name: "Jon Doe", name: "J Doe" }));

  assert.equal(result.aml[0].matchedName, "Jon Doe");
});

test("mapDecision falls back to name when a hit has neither caption nor matched_name", () => {
  const result = mapDecision(sessionDecisionWithHit({ name: "J Doe" }));

  assert.equal(result.aml[0].matchedName, "J Doe");
});

test("mapDecision uses '(unnamed match)' when a hit carries no name field", () => {
  const result = mapDecision(sessionDecisionWithHit({ match_score: 95 }));

  assert.equal(result.aml[0].matchedName, "(unnamed match)");
});

test("mapDecision keeps the screened full name as the query, not the hit caption", () => {
  const result = mapDecision(sessionDecisionWithHit({ caption: "John Doe", match_score: 95 }));

  assert.equal(result.aml[0].query, "Jane Doe");
});

test("mapDecision reads caption on the standalone aml block too", () => {
  const result = mapDecision({
    aml: { total_hits: 1, hits: [{ caption: "John Doe", match_score: 95 }] },
  });

  assert.equal(result.aml[0].matchedName, "John Doe");
});

test("mapDecision keeps non-Latin and accented caption text exactly", () => {
  const result = mapDecision(sessionDecisionWithHit({ caption: "Zoë Ñúñez 李" }));

  assert.equal(result.aml[0].matchedName, "Zoë Ñúñez 李");
});

test("mapDecision skips a blank caption and uses the next name", () => {
  const result = mapDecision(sessionDecisionWithHit({ caption: "   ", matched_name: "Jon Doe" }));

  assert.equal(result.aml[0].matchedName, "Jon Doe");
});

test("mapDecision gives (unnamed match) when every name is empty", () => {
  const result = mapDecision(sessionDecisionWithHit({ caption: "", name: "" }));

  assert.equal(result.aml[0].matchedName, "(unnamed match)");
});

test("mapDecision does not throw on a non-string caption", () => {
  const result = mapDecision(sessionDecisionWithHit({ caption: 42, name: "Jon Doe" }));

  assert.equal(result.aml[0].matchedName, "Jon Doe");
});

test("mapDecision returns no AML hits for a null decision, without throwing", () => {
  const result = mapDecision(null);

  assert.deepEqual(result.aml, []);
  assert.equal(result.status, "NOT_STARTED");
});
