// KYC report orchestrator. Runs the enabled providers (Companies House in
// parallel, then OFSI sanctions + VAT), assembles the normalised report, scores
// risk, and persists a kyc_reports row. Mirrors the orchestration style of
// importDisposalFromUrl: thin coordination over the provider modules.

import { createKycReport, type KycReport } from "@/lib/db/queries/kyc";
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
import { diditProvider } from "./providers/didit";
import type { KycReportData, KycSummary } from "./types";

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

  // ── Optional paid provider (Didit KYB/AML) — no-op unless configured ───────
  if (diditProvider.enabled && num) {
    const didit = await diditProvider.screenBusiness(num);
    if (didit) {
      sources.push("didit");
      screen.matches.push(...didit.aml);
    }
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
