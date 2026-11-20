import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DiditKycCard,
  type ContactOption,
  type IdentityCheck,
} from "@/components/kyc/didit-kyc-card";
import { KycReportView } from "@/components/kyc/kyc-report-view";
import { KycRunner } from "@/components/kyc/kyc-runner";
import { kycRiskBadge } from "@/lib/badges";
import { isKycConfigured } from "@/lib/kyc/config";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getMemberRole } from "@/lib/db/queries/agencies";
import { listContactsByCompany } from "@/lib/db/queries/contacts";
import {
  getLatestKycReport,
  listCompaniesForKyc,
  listLatestDiditSessionsForCompany,
  listRecentKycReports,
} from "@/lib/db/queries/kyc";
import { getAgencyDidit } from "@/lib/kyc/didit-config";
import { canStartIdentityCheck } from "@/lib/kyc/providers/didit";

function fmtDate(d: string): string {
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime())
    ? d
    : parsed.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

export default async function KycPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const { company: selectedId } = await searchParams;

  const session = await auth();
  if (!session?.user) redirect("/login");

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) redirect("/login");

  const [list, recent] = await Promise.all([
    listCompaniesForKyc(agencyId),
    listRecentKycReports(agencyId),
  ]);
  const nameById = new Map(list.map((c) => [c.id, c.name]));

  const [latest, diditConfig, diditRows, contactRows, role] = await Promise.all([
    selectedId ? getLatestKycReport(agencyId, selectedId) : null,
    getAgencyDidit(agencyId),
    selectedId ? listLatestDiditSessionsForCompany(agencyId, selectedId) : [],
    selectedId ? listContactsByCompany(agencyId, selectedId) : [],
    getMemberRole(agencyId, session.user.id),
  ]);

  const contacts: ContactOption[] = contactRows.map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim(),
    role: c.role,
    email: c.email,
  }));

  // Only what the panel renders — the decision payload itself stays server-side;
  // its findings reach the user through the KYC report, which is where they are
  // scored and explained.
  const identityChecks: IdentityCheck[] = diditRows.map((d) => ({
    sessionId: d.session_id,
    contactId: d.contact_id,
    contactName: d.contact_name,
    verifiedName: d.verified_name,
    status: d.status,
    url: d.session_url,
    amlHits: d.aml_hits,
    error: d.error,
    startedAt: d.created_at,
    updatedAt: d.updated_at,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">KYC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Two checks. <strong>KYC Companies House Search</strong> is free and
          covers the company — Companies House, OFSI sanctions and HMRC VAT.{" "}
          <strong>KYC Didit</strong> is paid and covers a person — their ID
          document, liveness, face match and watchlist screen.
        </p>
      </div>

      {!isKycConfigured ? (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm sm:p-6">
            <p className="font-medium">Companies House is not configured.</p>
            <p className="text-muted-foreground">
              Add a free <code>COMPANIES_HOUSE_API_KEY</code> (from{" "}
              <a
                className="text-info hover:underline"
                href="https://developer.company-information.service.gov.uk"
                target="_blank"
                rel="noopener noreferrer"
              >
                developer.company-information.service.gov.uk
              </a>
              ) to enable company profile, officers, PSC, charges and insolvency
              data. Sanctions and VAT checks still run without it.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <KycRunner key={selectedId ?? "none"} companies={list} selectedId={selectedId} />

      {selectedId ? (
        <DiditKycCard
          // A fresh card per company, so the selected person resets too.
          key={selectedId}
          configured={diditConfig !== null}
          canStart={canStartIdentityCheck(role)}
          contacts={contacts}
          checks={identityChecks}
        />
      ) : null}

      {latest ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Latest report</h2>
            {selectedId ? (
              <Link
                href={`/companies/${selectedId}`}
                className="text-sm text-info hover:underline"
              >
                View company →
              </Link>
            ) : null}
          </div>
          <KycReportView report={latest} />
        </div>
      ) : selectedId ? (
        <p className="text-sm text-muted-foreground">
          No report yet for this company — run one above.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent reports</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No KYC reports yet.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((r) => {
                const risk = kycRiskBadge(r.risk_rating);
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <Link
                      href={`/kyc?company=${r.company_id}`}
                      className="font-medium text-foreground hover:text-info hover:underline"
                    >
                      {nameById.get(r.company_id) ?? "Unknown company"}
                    </Link>
                    <span className="flex items-center gap-3">
                      <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
                      <Badge tone={risk.tone}>{risk.label}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
