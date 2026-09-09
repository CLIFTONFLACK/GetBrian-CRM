import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil, Plus, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  companyTypeBadge,
  contactRoleBadge,
  kycRiskBadge,
  listingStatusBadge,
  requirementStatusBadge,
} from "@/lib/badges";
import { auth } from "@/lib/auth";
import { deleteCompany } from "@/lib/actions/companies";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ActivityTimeline } from "@/components/activity-timeline";
import { LocationMap } from "@/components/location-map";
import { LogActivityForm } from "@/components/log-activity-form";
import { SendToTeam } from "@/components/send-to-team";
import { DeepDiveView } from "@/components/deep-dive-view";
import { DeepDiveChat } from "@/components/deep-dive-chat";
import { QuickRequirementModal } from "@/components/quick-requirement-modal";
import { listDeepDiveMessages } from "@/lib/db/queries/deep-dive";
import { getContactRoles, roleLabel } from "@/lib/contact-roles";
import { getCompanyTypes, typeLabel } from "@/lib/company-types";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyAgentIds, getCompanyById } from "@/lib/db/queries/companies";
import { listContactsByCompany } from "@/lib/db/queries/contacts";
import { listRequirementsForCompany } from "@/lib/db/queries/requirements";
import { listDisposalsForCompany } from "@/lib/db/queries/disposals";
import { listActivitiesForEntity } from "@/lib/db/queries/activities";
import { getLatestKycSummary } from "@/lib/db/queries/kyc";
import { getLatestCompleteDeepDive } from "@/lib/db/queries/deep-dive";
import { cn } from "@/lib/utils";

// The Deep Dive action on this page calls a web-search model that researches
// the company live — the same reason the admin page raises its budget for the
// Market Intel resync. Server Actions inherit their route segment's config, so
// this is what actually governs `runDeepDive`.
export const maxDuration = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!isDbConfigured) return { title: "Company" };
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return { title: "Company" };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { title: "Company" };
  const company = await getCompanyById(agencyId, id);
  return { title: company?.name || "Company" };
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const agencyId = await currentAgencyId(userId);
  if (!agencyId) notFound();

  const company = await getCompanyById(agencyId, id);
  if (!company) notFound();

  const contactRoles = await getContactRoles();
  const [contacts, agentRows, members, requirements, listings, activities] = await Promise.all([
    listContactsByCompany(agencyId, id),
    getCompanyAgentIds(agencyId, id),
    getAgencyMembers(agencyId),
    listRequirementsForCompany(agencyId, id),
    listDisposalsForCompany(agencyId, id),
    listActivitiesForEntity(agencyId, "company", id, 20),
  ]);

  const [kycReport, deepDive, deepDiveMessages] = await Promise.all([
    getLatestKycSummary(agencyId, id),
    getLatestCompleteDeepDive(agencyId, id),
    listDeepDiveMessages(agencyId, id),
  ]);

  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgentName = company.lead_agent_id
    ? (nameOf.get(company.lead_agent_id) ?? "Unknown agent")
    : null;
  const additionalAgents = agentRows.map((agentId) => ({
    id: agentId,
    name: nameOf.get(agentId) ?? "Unknown agent",
  }));

  const companyTypes = await getCompanyTypes();
  const t = companyTypeBadge(company.type, typeLabel(companyTypes, company.type));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <Badge tone={t.tone}>{t.label}</Badge>
          </div>
          {company.sector_tags.length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {company.sector_tags.join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SendToTeam
            link={`/companies/${company.id}`}
            subject={company.name}
            agents={members}
            meId={userId}
          />
          <Link
            href={`/companies/${company.id}/edit`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Pencil />
            Edit
          </Link>
          <form action={deleteCompany}>
            <input type="hidden" name="id" value={company.id} />
            <ConfirmSubmitButton
              confirmMessage={`Delete “${company.name}”? This also removes its contacts' link, activity and deals, and can't be undone.`}
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail label="Website">
              {company.website ? (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-info hover:underline"
                >
                  {company.website}
                </a>
              ) : (
                "—"
              )}
            </Detail>
            <Detail label="Phone">{company.phone ?? "—"}</Detail>
            <Detail label="Address">
              {[company.address_line, company.city, company.postcode]
                .filter(Boolean)
                .join(", ") || "—"}
            </Detail>
            <Detail label="Lead agent">{leadAgentName ?? "—"}</Detail>
            <Detail label="Agents">
              {additionalAgents.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {additionalAgents.map((a) => (
                    <Badge key={a.id} tone="slate">
                      {a.name}
                    </Badge>
                  ))}
                </span>
              ) : (
                "—"
              )}
            </Detail>
            <Detail label="Notes">
              <span className="whitespace-pre-wrap">{company.notes ?? "—"}</span>
            </Detail>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Contacts</CardTitle>
            <Link
              href={`/contacts/new?company=${company.id}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <Plus />
              Add contact
            </Link>
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {contacts.map((ct) => {
                  const r = contactRoleBadge(ct.role, roleLabel(contactRoles, ct.role));
                  return (
                    <li
                      key={ct.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <Link
                        href={`/contacts/${ct.id}`}
                        className="font-medium text-foreground hover:text-info hover:underline"
                      >
                        {[ct.first_name, ct.last_name].filter(Boolean).join(" ")}
                      </Link>
                      <span className="flex items-center gap-2">
                        {/* Label, not colour alone — the primary is who the
                            send flows default to, so it has to be readable. */}
                        {ct.is_primary ? <Badge tone="teal">Primary</Badge> : null}
                        <Badge tone={r.tone}>{r.label}</Badge>
                        {ct.email ? (
                          <span className="text-muted-foreground">{ct.email}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Laid out to match the Deep Dive card below: description under the
          title, and the action as a full-size primary button at the top of the
          card body rather than a small secondary one in the header. */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>KYC</CardTitle>
          <CardDescription>
            Due diligence — company status, ownership and sanctions screening.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/kyc?company=${company.id}`} className={cn(buttonVariants())}>
              <ShieldCheck />
              {kycReport ? "View / refresh KYC" : "Run KYC report"}
            </Link>
          </div>
          {kycReport ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={kycRiskBadge(kycReport.risk_rating).tone}>
                  {kycRiskBadge(kycReport.risk_rating).label}
                </Badge>
                <span className="text-muted-foreground">
                  Last run{" "}
                  {new Date(kycReport.created_at).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              {(kycReport.flags ?? []).length > 0 ? (
                <ul className="space-y-1 text-muted-foreground">
                  {kycReport.flags.slice(0, 4).map((f: string, i: number) => (
                    <li key={i}>• {f}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No risk flags raised.</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No KYC report yet. Run one to verify status, ownership and sanctions.
            </p>
          )}
        </CardContent>
      </Card>

      {company.lat != null && company.lng != null ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationMap lat={company.lat} lng={company.lng} label={company.name} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Deep Dive</CardTitle>
          <CardDescription>
            AI company research — long-term client value and how to close.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <DeepDiveView companyId={company.id} report={deepDive} />
          {/* Follow-up Q&A, stored against the company so it persists on the
              profile and survives re-running the report. */}
          <div className="border-t pt-6">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Questions
            </h3>
            <DeepDiveChat
              companyId={company.id}
              messages={deepDiveMessages}
              disabled={!deepDive?.markdown}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Requirements</CardTitle>
          <QuickRequirementModal
            companyId={company.id}
            fullFormHref={`/requirements/new?company=${company.id}`}
          />
        </CardHeader>
        <CardContent>
          {requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requirements yet.
            </p>
          ) : (
            <ul className="divide-y">
              {requirements.map((rq) => {
                const rs = requirementStatusBadge(rq.status);
                return (
                  <li
                    key={rq.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <Link
                      href={`/requirements/${rq.id}`}
                      className="font-medium text-foreground hover:text-info hover:underline"
                    >
                      {rq.title}
                    </Link>
                    <Badge tone={rs.tone}>{rs.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Listings</CardTitle>
          <Link
            href={`/listings/new?company=${company.id}`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Plus />
            Add listing
          </Link>
        </CardHeader>
        <CardContent>
          {listings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No listings linked yet.</p>
          ) : (
            <ul className="divide-y">
              {listings.map((l) => {
                const ls = listingStatusBadge(l.status);
                return (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <Link
                      href={`/listings/${l.id}`}
                      className="font-medium text-foreground hover:text-info hover:underline"
                    >
                      {l.title ?? "Untitled listing"}
                      {l.city ? (
                        <span className="text-muted-foreground"> · {l.city}</span>
                      ) : null}
                    </Link>
                    <Badge tone={ls.tone}>{ls.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <LogActivityForm entityType="company" entityId={company.id} />
          <ActivityTimeline
            activities={activities}
            actorNames={Object.fromEntries(nameOf)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
