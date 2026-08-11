import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EditableDealTitle } from "@/components/editable-deal-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealForm } from "@/components/deal-form";
import { DealReminders } from "@/components/deal-reminders";
import { DealShareActions } from "@/components/deal-share-actions";
import { ActivityTimeline } from "@/components/activity-timeline";
import { LogActivityForm } from "@/components/log-activity-form";
import { SendDealModal } from "@/components/send-deal-modal";
import { SendToTeam } from "@/components/send-to-team";
import { ExistingDealNotice } from "./existing-deal-notice";
import { dealStageBadge } from "@/lib/badges";
import { deleteDeal } from "@/lib/actions/deals";
import { isPast } from "@/lib/time";
import { getCompanyTypes } from "@/lib/company-types";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listActivitiesForEntity } from "@/lib/db/queries/activities";
import { getCompanyName, listCompanyOptions } from "@/lib/db/queries/companies";
import { listContactOptions } from "@/lib/db/queries/contacts";
import {
  getDealAgentIds,
  getDealById,
  getDealListingSummary,
  listDealReminders,
} from "@/lib/db/queries/deals";
import { getLinkedCompany, getLinkedContact, getUserNames } from "@/lib/db/queries/disposals";
import { getRequirementTitle } from "@/lib/db/queries/requirements";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!isDbConfigured) return { title: "Deal" };
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return { title: "Deal" };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { title: "Deal" };
  const deal = await getDealById(agencyId, id);
  return { title: deal?.title ?? "Deal" };
}

export default async function DealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ existing?: string; renamed?: string }>;
}) {
  if (!isDbConfigured) notFound();
  const { id } = await params;
  const { existing, renamed } = await searchParams;
  const session = await auth();
  if (!session?.user) notFound();
  const userId = session.user.id;
  const agencyId = await currentAgencyId(userId);
  if (!agencyId) notFound();

  const deal = await getDealById(agencyId, id);
  if (!deal) notFound();

  const members = await getAgencyMembers(agencyId);
  const memberNames = Object.fromEntries(members.map((m) => [m.id, m.name]));

  const [listing, requirementTitle, companyName] = await Promise.all([
    deal.listing_id ? getDealListingSummary(agencyId, deal.listing_id) : Promise.resolve(null),
    deal.requirement_id ? getRequirementTitle(agencyId, deal.requirement_id) : Promise.resolve(null),
    deal.company_id ? getCompanyName(agencyId, deal.company_id) : Promise.resolve(null),
  ]);
  const requirement =
    deal.requirement_id && requirementTitle ? { id: deal.requirement_id, title: requirementTitle } : null;
  const company = deal.company_id && companyName ? { id: deal.company_id, name: companyName } : null;

  // #6: pull the listing's own linked company + point-of-contact so the deal
  // shows every party's details with links.
  const [listingCompany, listingContact] = await Promise.all([
    listing?.company_id ? getLinkedCompany(agencyId, listing.company_id) : Promise.resolve(null),
    listing?.contact_id ? getLinkedContact(agencyId, listing.contact_id) : Promise.resolve(null),
  ]);

  // Deal lead + additional agents (for the assignment fields + summary).
  const additionalAgentIds = await getDealAgentIds(agencyId, id);

  const sb = dealStageBadge(deal.stage);

  let ownerName: string | null = null;
  if (deal.created_by) {
    const names = await getUserNames([deal.created_by]);
    ownerName = names.get(deal.created_by) ?? null;
  }

  const reminderRows = await listDealReminders(agencyId, id);
  const reminders = reminderRows.map((r) => ({
    ...r,
    overdue: isPast(r.due_at),
  }));

  const activities = await listActivitiesForEntity(agencyId, "deal", id, 30);

  // Pickers for the Send Deal wizard's external step — only needed when the
  // deal is linked to a requirement and/or listing (otherwise nothing to send).
  const canSendDeal = Boolean(deal.requirement_id || deal.listing_id);
  const [companyOptions, contactOptions, companyTypes] = canSendDeal
    ? await Promise.all([listCompanyOptions(agencyId), listContactOptions(agencyId), getCompanyTypes()])
    : [[], [], []];

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/deals"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to pipeline
      </Link>

      {existing === "1" ? (
        <ExistingDealNotice dealId={deal.id} renamed={renamed === "1"} />
      ) : null}

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              <EditableDealTitle dealId={deal.id} title={deal.title} />
            </h1>
            <Badge tone={sb.tone}>{sb.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {deal.value != null ? (
              <span className="font-mono tabular-nums text-foreground">
                £{deal.value.toLocaleString("en-GB")}
              </span>
            ) : (
              "No value set"
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Created {new Date(deal.created_at).toLocaleDateString("en-GB")}
            {ownerName ? ` · ${ownerName}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SendToTeam
            link={`/deals/${deal.id}`}
            subject={deal.title}
            agents={members}
            meId={userId}
          />
          {canSendDeal ? (
            <SendDealModal
              agents={members}
              meId={userId}
              companies={companyOptions}
              contacts={contactOptions}
              companyTypes={companyTypes}
              dealId={deal.id}
              requirementId={deal.requirement_id ?? undefined}
              listingId={deal.listing_id ?? undefined}
              requirementTitle={requirement?.title}
              listingTitle={listing?.title ?? undefined}
            />
          ) : null}
          <DealShareActions
            dealId={deal.id}
            title={deal.title}
            stage={sb.label}
            value={deal.value}
          />
          <form action={deleteDeal}>
            <input type="hidden" name="id" value={deal.id} />
            <ConfirmSubmitButton
              confirmMessage="Delete this deal? Its reminders and activity will be removed and this can't be undone."
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Listing
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {listing ? (
              <Link
                href={`/listings/${listing.id}`}
                className="font-medium text-foreground hover:text-info hover:underline"
              >
                {listing.title ?? "Untitled listing"}
                {listing.city ? ` · ${listing.city}` : ""}
              </Link>
            ) : (
              <span className="text-muted-foreground">Not linked</span>
            )}
            {company ? (
              <p className="mt-1 text-muted-foreground">
                Operator:{" "}
                <Link
                  href={`/companies/${company.id}`}
                  className="text-info hover:underline"
                >
                  {company.name}
                </Link>
              </p>
            ) : null}
            {listingCompany ? (
              <p className="mt-1 text-muted-foreground">
                Listing company:{" "}
                <Link
                  href={`/companies/${listingCompany.id}`}
                  className="text-info hover:underline"
                >
                  {listingCompany.name}
                </Link>
              </p>
            ) : null}
            {listingContact ? (
              <p className="mt-1 text-muted-foreground">
                Contact:{" "}
                <Link
                  href={`/contacts/${listingContact.id}`}
                  className="text-info hover:underline"
                >
                  {[listingContact.first_name, listingContact.last_name]
                    .filter(Boolean)
                    .join(" ") || "Unnamed contact"}
                </Link>
                {listingContact.email ? (
                  <>
                    {" · "}
                    <a
                      href={`mailto:${listingContact.email}`}
                      className="text-info hover:underline"
                    >
                      {listingContact.email}
                    </a>
                  </>
                ) : null}
                {listingContact.phone ? ` · ${listingContact.phone}` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              Requirement
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {requirement ? (
              <Link
                href={`/requirements/${requirement.id}`}
                className="font-medium text-foreground hover:text-info hover:underline"
              >
                {requirement.title}
              </Link>
            ) : (
              <span className="text-muted-foreground">Not linked</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deal details</CardTitle>
        </CardHeader>
        <CardContent>
          <DealForm
            deal={{
              id: deal.id,
              title: deal.title,
              stage: deal.stage,
              value: deal.value,
              hot_terms: deal.hot_terms,
              notes: deal.notes,
              lead_agent_id: deal.lead_agent_id,
              expected_close: deal.expected_close,
            }}
            agents={members}
            additionalAgentIds={additionalAgentIds}
          />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Reminders &amp; deadlines</CardTitle>
        </CardHeader>
        <CardContent>
          <DealReminders dealId={deal.id} reminders={reminders} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Updates &amp; notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <LogActivityForm entityType="deal" entityId={deal.id} />
          <ActivityTimeline activities={activities} actorNames={memberNames} />
        </CardContent>
      </Card>
    </div>
  );
}
