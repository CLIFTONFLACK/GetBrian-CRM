// KYC report orchestrator. Runs the enabled providers (Companies House in
// parallel, then OFSI sanctions + VAT), assembles the normalised report, scores
// risk, and persists a kyc_reports row. Mirrors the orchestration style of
// importDisposalFromUrl: thin coordination over the provider modules.

import {
  createKycReport,
  listLatestDiditSessionsForCompany,
  type KycReport,
} from "@/lib/db/queries/kyc";
import { isKycConfigured } from "./config";
import {
  getCharges,
  getInsolvencyCount,
  getOfficers,
  getProfile,
  getPsc,
} from "./companies-house";
import { screenNames } from "./sanctions";
import { checkVat } from "./vat";
import { scoreRisk } from "./risk";
import { isAwaitingDecision, mapDecision, normaliseStatus } from "./providers/didit";
import type { KycDiditPerson, KycReportData, KycSummary } from "./types";

type CompanyInput = {
  id: string;
  name: string;
  company_number: string | null;
  vat_number: string | null;
};

export async function runKycReport(
  company: CompanyInput,
  agencyId: string,
  userId: string,
): Promise<KycReport> {
  const sources: string[] = [];
  const notices: string[] = [];
  const num = company.company_number?.trim() || null;

  // ── Companies House (core) ────────────────────────────────────────────────
  let profile: KycReportData["profile"] = null;
  let officers: KycReportData["officers"] = [];
  let pscs: KycReportData["pscs"] = [];
  let charges: KycReportData["charges"] = [];
  let insolvencyCases = 0;

  if (num && isKycConfigured) {
    sources.push("companies_house");
    [profile, officers, pscs, charges, insolvencyCases] = await Promise.all([
      getProfile(num),
      getOfficers(num),
      getPsc(num),
      getCharges(num),
      getInsolvencyCount(num),
    ]);
    if (!profile) {
      notices.push(`No Companies House record found for number ${num}.`);
    }
  } else if (!num) {
    notices.push("No company registration number (CRN) linked.");
  } else if (!isKycConfigured) {
    notices.push("Companies House API key not configured.");
  }

  // ── OFSI / UK sanctions screening (company + active officers + PSCs) ───────
  const screenTargets = [
    { value: company.name, isCompany: true },
    ...(profile ? [{ value: profile.name, isCompany: true }] : []),
    ...officers.filter((o) => !o.resignedOn).map((o) => ({ value: o.name })),
    ...pscs.filter((p) => !p.ceasedOn).map((p) => ({ value: p.name })),
  ];
  const screen = await screenNames(screenTargets);
  if (screen.available) sources.push("ofsi_sanctions");
  else notices.push("Sanctions screening unavailable (could not load OFSI list).");

  // ── VAT validation ────────────────────────────────────────────────────────
  let vat: KycReportData["vat"] = null;
  if (company.vat_number?.trim()) {
    vat = await checkVat(company.vat_number);
    sources.push("vat");
    if (vat === null) notices.push("VAT number could not be verified.");
  }

  // ── Didit identity checks — READ ONLY, from the database ─────────────────
  // Deliberately not an API call. A Didit session is billed to the agency and
  // is started explicitly (startIdentityCheck), so generating a report folds in
  // whatever decisions have already been fetched for this company's contacts
  // and never spends money on its own. No checks, or checks still waiting on
  // the person, simply contribute nothing.
  const diditPeople: KycDiditPerson[] = [];
  const diditRows = await listLatestDiditSessionsForCompany(agencyId, company.id);
  for (const row of diditRows) {
    if (!row.decision) continue;
    const mapped = mapDecision(row.decision);
    // A decision payload is stored as soon as a session is created, so its
    // presence does not mean the check is decided. The status decides that. A
    // check that still waits on the person is counted as pending below, and
    // adds no person, no source and no watchlist hit.
    if (isAwaitingDecision(mapped.status || row.status)) continue;
    // Watchlist hits join the sanctions list so the existing risk rules score
    // them — same kind of finding as an OFSI hit, from a commercial list, and
    // the list name on each match says which.
    screen.matches.push(...mapped.aml);
    diditPeople.push({
      sessionId: row.session_id,
      contactId: row.contact_id,
      contactName: row.contact_name,
      verifiedName: mapped.document?.fullName ?? row.verified_name,
      // One spelling for the risk rules and the report view, which compare
      // against the upper-case names.
      status: normaliseStatus(mapped.status || row.status),
      documentType: mapped.document?.documentType ?? null,
      faceMatchScore: mapped.faceMatchScore,
      livenessScore: mapped.livenessScore,
      amlHits: mapped.aml.length,
      warnings: mapped.warnings,
      checkedAt: row.updated_at,
    });
  }
  if (diditPeople.length > 0) sources.push("didit");
  const pendingChecks = diditRows.length - diditPeople.length;
  if (pendingChecks > 0) {
    notices.push(
      `${pendingChecks} Didit identity check(s) started but not yet decided.`,
    );
  }

  const outstandingCharges = charges.filter(
    (c) => (c.status ?? "").toLowerCase() !== "satisfied",
  ).length;

  const summary: KycSummary = {
    companyNumber: num,
    companyName: profile?.name ?? company.name,
    status: profile?.status ?? null,
    incorporatedOn: profile?.incorporatedOn ?? null,
    officersActive: officers.filter((o) => !o.resignedOn).length,
    pscCount: pscs.filter((p) => !p.ceasedOn).length,
    chargesOutstanding: outstandingCharges,
    insolvencyCases,
    sanctionsHits: screen.matches.length,
    accountsOverdue: profile?.accountsOverdue ?? false,
    confirmationStatementOverdue: profile?.confirmationStatementOverdue ?? false,
    vatValid: vat ? vat.valid : null,
  };

  const base = {
    profile,
    officers,
    pscs,
    charges,
    insolvencyCases,
    sanctions: screen.matches,
    vat,
    summary,
    sources,
    notices,
    diditPeople,
  };
  const { riskRating, flags } = scoreRisk(base);
  const data: KycReportData = { ...base, riskRating, flags };

  return createKycReport(agencyId, {
    companyId: company.id,
    companyNumber: num,
    status: "complete",
    riskRating,
    sources,
    flags,
    summary,
    payload: data,
    createdBy: userId,
  });
}
