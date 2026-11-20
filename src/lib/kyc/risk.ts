// Risk scoring — a small, transparent rules engine over the normalised report.
// Returns an overall rating plus human-readable flags shown in the report. Kept
// deliberately conservative: sanctions hits and insolvency dominate; bookkeeping
// lapses (overdue filings) are medium; healthy active companies are low.

import type { KycRisk, KycReportData } from "./types";

const SEVERITY: Record<KycRisk, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
const worse = (a: KycRisk, b: KycRisk): KycRisk =>
  SEVERITY[a] >= SEVERITY[b] ? a : b;

const DISSOLVED = /dissolved/i;
const INSOLVENT = /liquidation|administration|receivership|insolvency|voluntary-arrangement/i;

export function scoreRisk(
  data: Omit<KycReportData, "riskRating" | "flags">,
): { riskRating: KycRisk; flags: string[] } {
  const flags: string[] = [];
  let risk: KycRisk = "low";

  const { profile } = data;

  if (!profile) {
    // No Companies House record means we can't assess the core entity.
    flags.push("No Companies House record linked — identity unverified.");
    risk = "unknown";
  } else {
    const status = (profile.status ?? "").toLowerCase();
    if (DISSOLVED.test(status)) {
      flags.push("Company is dissolved.");
      risk = worse(risk, "high");
    } else if (INSOLVENT.test(status)) {
      flags.push(`Company status: ${profile.status}.`);
      risk = worse(risk, "high");
    } else if (status && status !== "active") {
      flags.push(`Company status: ${profile.status}.`);
      risk = worse(risk, "medium");
    }

    if (profile.accountsOverdue) {
      flags.push("Annual accounts are overdue.");
      risk = worse(risk, "medium");
    }
    if (profile.confirmationStatementOverdue) {
      flags.push("Confirmation statement is overdue.");
      risk = worse(risk, "medium");
    }
  }

  if (data.insolvencyCases > 0) {
    flags.push(`${data.insolvencyCases} insolvency case(s) on record.`);
    risk = worse(risk, "high");
  }

  const outstanding = data.charges.filter(
    (c) => (c.status ?? "").toLowerCase() !== "satisfied",
  ).length;
  if (outstanding > 0) {
    flags.push(`${outstanding} outstanding charge(s) / mortgage(s) registered.`);
    risk = worse(risk, "medium");
  }

  if (data.sanctions.length > 0) {
    flags.push(
      `${data.sanctions.length} potential sanctions match(es) — manual review required.`,
    );
    risk = worse(risk, "high");
  }

  if (data.pscs.filter((p) => !p.ceasedOn).length === 0 && profile) {
    flags.push("No active Persons with Significant Control listed.");
  }

  // Identity checks on the people behind the company. A declined check is a
  // provider saying someone's document failed verification; a name that does
  // not match the document is not a verdict at all, but it is exactly the kind
  // of thing a reviewer must see. Their watchlist hits are already counted
  // above, via data.sanctions.
  const declined = (data.diditPeople ?? []).filter((p) => p.status === "DECLINED");
  if (declined.length > 0) {
    flags.push(
      `Identity verification declined for ${declined.map((p) => p.contactName).join(", ")}.`,
    );
    risk = worse(risk, "high");
  }
  const inReview = (data.diditPeople ?? []).filter((p) => p.status === "IN_REVIEW");
  if (inReview.length > 0) {
    flags.push(
      `Identity verification held for manual review: ${inReview
        .map((p) => p.contactName)
        .join(", ")}.`,
    );
    risk = worse(risk, "medium");
  }
  for (const person of data.diditPeople ?? []) {
    if (person.status !== "APPROVED" || !person.verifiedName) continue;
    // Compare loosely: case, punctuation and word order all differ innocently
    // between a CRM record and a passport ("Jane A. Doe" vs "DOE, Jane Ann").
    // Only a genuinely different set of name words is worth flagging.
    const words = (value: string) =>
      new Set(
        value
          .toLowerCase()
          .replace(/[^a-z\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 1),
      );
    const crm = words(person.contactName);
    const doc = words(person.verifiedName);
    const shared = [...crm].filter((w) => doc.has(w)).length;
    if (crm.size > 0 && shared === 0) {
      flags.push(
        `Verified document name "${person.verifiedName}" does not match contact "${person.contactName}".`,
      );
      risk = worse(risk, "medium");
    }
  }

  if (data.vat && data.vat.valid === false) {
    flags.push("Supplied VAT number is not valid.");
    risk = worse(risk, "medium");
  }

  return { riskRating: risk, flags };
}
