import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KycReportView } from "@/components/kyc/kyc-report-view";
import { KycRunner } from "@/components/kyc/kyc-runner";
import { kycRiskBadge } from "@/lib/badges";
import { isKycConfigured } from "@/lib/kyc/config";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import {
  getLatestKycReport,
  listCompaniesForKyc,
  listRecentKycReports,
} from "@/lib/db/queries/kyc";

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

  const latest = selectedId ? await getLatestKycReport(agencyId, selectedId) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">KYC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Know-Your-Customer / Know-Your-Business checks against UK official
          registers — Companies House, OFSI sanctions and HMRC VAT.
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
