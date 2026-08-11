import * as React from "react";
import { ExternalLink } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { kycRiskBadge } from "@/lib/badges";
import type { KycReport } from "@/lib/db/queries/kyc";

const SOURCE_LABELS: Record<string, string> = {
  companies_house: "Companies House",
  ofsi_sanctions: "OFSI sanctions",
  vat: "VAT (HMRC)",
  didit: "Didit KYB/AML",
};

const CH_BASE = "https://find-and-update.company-information.service.gov.uk";

/** Build a Companies House public-register URL for a company (optionally a sub-page). */
function chUrl(crn: string, sub?: string): string {
  return `${CH_BASE}/company/${encodeURIComponent(crn)}${sub ? `/${sub}` : ""}`;
}

/** A small "source" link out to the Companies House public register. */
function ChLink({
  crn,
  sub,
  label = "Companies House",
}: {
  crn: string;
  sub?: string;
  label?: string;
}) {
  return (
    <a
      href={chUrl(crn, sub)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime())
    ? d
    : parsed.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

export function KycReportView({ report }: { report: KycReport }) {
  const data = report.payload;
  const risk = kycRiskBadge(report.risk_rating);
  const profile = data?.profile ?? null;
  const flags = report.flags ?? [];
  const notices = data?.notices ?? [];
  const crn = report.company_number ?? profile?.companyNumber ?? null;

  return (
    <div className="space-y-4">
      {/* Header / risk */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>{data?.summary.companyName ?? "KYC report"}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Run {fmtDate(report.created_at)}
              {crn ? " · CRN " : ""}
              {crn ? (
                <a
                  href={chUrl(crn)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-info hover:underline"
                >
                  {crn}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </p>
          </div>
          <Badge tone={risk.tone}>{risk.label}</Badge>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {flags.length > 0 ? (
            <ul className="space-y-1.5">
              {flags.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-muted-foreground">
                    •
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No risk flags raised.</p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(report.sources ?? []).map((s) => (
              <Badge key={s} tone="slate">
                {SOURCE_LABELS[s] ?? s}
              </Badge>
            ))}
          </div>
          {notices.length > 0 ? (
            <ul className="space-y-1 pt-1 text-xs text-muted-foreground">
              {notices.map((n, i) => (
                <li key={i}>⚠ {n}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* Company profile */}
      {profile ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Company</CardTitle>
            {crn ? (
              <div className="flex flex-wrap items-center gap-3">
                <ChLink crn={crn} label="Register" />
                <ChLink crn={crn} sub="filing-history" label="Filing history" />
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Status">{profile.status ?? "—"}</Row>
            <Row label="Type">{profile.type ?? "—"}</Row>
            <Row label="Incorporated">{fmtDate(profile.incorporatedOn)}</Row>
            {profile.dissolvedOn ? (
              <Row label="Dissolved">{fmtDate(profile.dissolvedOn)}</Row>
            ) : null}
            <Row label="Registered office">{profile.registeredOffice ?? "—"}</Row>
            <Row label="SIC codes">
              {profile.sicCodes.length ? profile.sicCodes.join(", ") : "—"}
            </Row>
            <Row label="Accounts due">
              {fmtDate(profile.accountsNextDue)}
              {profile.accountsOverdue ? (
                <Badge tone="red" className="ml-2">
                  Overdue
                </Badge>
              ) : null}
            </Row>
            <Row label="Conf. statement">
              {fmtDate(profile.confirmationStatementNextDue)}
              {profile.confirmationStatementOverdue ? (
                <Badge tone="red" className="ml-2">
                  Overdue
                </Badge>
              ) : null}
            </Row>
          </CardContent>
        </Card>
      ) : null}

      {/* Sanctions */}
      <Card>
        <CardHeader>
          <CardTitle>Sanctions screening</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {data && data.sanctions.length > 0 ? (
            <div className="space-y-3">
              <Alert tone="error">
                Potential matches found — these require manual review. A name match
                is not proof of a sanctioned entity.
              </Alert>
              <ul className="divide-y">
                {data.sanctions.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{m.matchedName}</span>
                      <span className="text-muted-foreground"> — matched “{m.query}”</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone="slate">{m.listName}</Badge>
                      <span className="text-muted-foreground">
                        {Math.round(m.score * 100)}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (report.sources ?? []).includes("ofsi_sanctions") ? (
            <p className="text-emerald-700 dark:text-emerald-300">
              No sanctions-list matches for the company, its officers or PSCs.
            </p>
          ) : (
            <p className="text-muted-foreground">Screening not run.</p>
          )}
        </CardContent>
      </Card>

      {/* Officers + PSCs */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Officers</CardTitle>
            {crn ? <ChLink crn={crn} sub="officers" label="View" /> : null}
          </CardHeader>
          <CardContent className="text-sm">
            {data && data.officers.length > 0 ? (
              <ul className="space-y-2.5">
                {data.officers.map((o, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{o.name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {o.role ? <span>{o.role}</span> : null}
                      {o.resignedOn ? (
                        <Badge tone="slate">Resigned</Badge>
                      ) : (
                        <Badge tone="emerald">Active</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No officers on record.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Significant control (PSC)</CardTitle>
            {crn ? (
              <ChLink crn={crn} sub="persons-with-significant-control" label="View" />
            ) : null}
          </CardHeader>
          <CardContent className="text-sm">
            {data && data.pscs.length > 0 ? (
              <ul className="space-y-2.5">
                {data.pscs.map((p, i) => (
                  <li key={i}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.ceasedOn ? <Badge tone="slate">Ceased</Badge> : null}
                    </div>
                    {p.naturesOfControl.length ? (
                      <p className="text-xs text-muted-foreground">
                        {p.naturesOfControl.join(", ").replace(/-/g, " ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No PSCs on record.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charges / insolvency / VAT */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Charges &amp; insolvency</CardTitle>
            {crn ? <ChLink crn={crn} sub="charges" label="View" /> : null}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Outstanding charges">
              {data?.summary.chargesOutstanding ?? 0}
            </Row>
            <Row label="Insolvency cases">{data?.insolvencyCases ?? 0}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>VAT</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data?.vat ? (
              <>
                <Row label="VAT number">{data.vat.vatNumber}</Row>
                <Row label="Valid">
                  {data.vat.valid ? (
                    <Badge tone="emerald">Valid</Badge>
                  ) : (
                    <Badge tone="red">Invalid</Badge>
                  )}
                </Row>
                {data.vat.name ? <Row label="Registered name">{data.vat.name}</Row> : null}
              </>
            ) : (
              <p className="text-muted-foreground">No VAT number checked.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
