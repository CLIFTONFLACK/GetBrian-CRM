import { ActivityTimeline } from "@/components/activity-timeline";
import { DealForm } from "@/components/deal-form";
import { DealReminders } from "@/components/deal-reminders";
import { LogActivityForm } from "@/components/log-activity-form";
import { Field, money, PanelLink, PanelSection } from "@/components/record-panel/fields";
import { PanelFrame, RecordNotFound } from "@/components/record-panel/panel-frame";
import { TodoTab } from "@/components/record-panel/tabs/todo-tab";
import { Badge } from "@/components/ui/badge";
import { dealStageBadge } from "@/lib/badges";
import { listActivitiesForEntity } from "@/lib/db/queries/activities";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyName } from "@/lib/db/queries/companies";
import {
  getDealAgentIds,
  getDealById,
  getDealListingSummary,
  listDealReminders,
} from "@/lib/db/queries/deals";
import { getRequirementTitle } from "@/lib/db/queries/requirements";
import { formatDateUpdated } from "@/lib/format-date";
import { openRecordHref, type RecordRef, type SearchParamsLike } from "@/lib/record-ref";
import { isPast } from "@/lib/time";

type Deal = NonNullable<Awaited<ReturnType<typeof getDealById>>>;

export async function DealPanel({
  agencyId,
  userId,
  record,
  tab,
  base,
}: {
  agencyId: string;
  userId: string;
  record: RecordRef;
  tab: string;
  base: SearchParamsLike;
}) {
  const deal = await getDealById(agencyId, record.id);
  if (!deal) return <RecordNotFound />;

  const sb = dealStageBadge(deal.stage);
  const tabProps = { entityType: "deal", entityId: deal.id, agencyId } as const;

  let content: React.ReactNode;
  switch (tab) {
    case "reminders":
      content = <RemindersTab agencyId={agencyId} dealId={deal.id} />;
      break;
    case "updates":
      content = <UpdatesTab agencyId={agencyId} dealId={deal.id} />;
      break;
    case "todo":
      content = <TodoTab {...tabProps} userId={userId} />;
      break;
    default:
      content = <OverviewTab agencyId={agencyId} deal={deal} base={base} />;
  }

  return (
    <PanelFrame
      record={record}
      tab={tab}
      base={base}
      title={deal.title}
      badge={<Badge tone={sb.tone}>{sb.label}</Badge>}
    >
      {content}
    </PanelFrame>
  );
}

/**
 * The deal's links to its listing, requirement and operator, then the same
 * DealForm the full page uses. The form saves with updateDeal, which does not
 * redirect, so it works inside the panel. Send, share and delete stay on the
 * full page, which the panel header links to.
 */
async function OverviewTab({
  agencyId,
  deal,
  base,
}: {
  agencyId: string;
  deal: Deal;
  base: SearchParamsLike;
}) {
  const [listing, requirementTitle, companyName, members, additionalAgentIds] =
    await Promise.all([
      deal.listing_id ? getDealListingSummary(agencyId, deal.listing_id) : Promise.resolve(null),
      deal.requirement_id
        ? getRequirementTitle(agencyId, deal.requirement_id)
        : Promise.resolve(null),
      deal.company_id ? getCompanyName(agencyId, deal.company_id) : Promise.resolve(null),
      getAgencyMembers(agencyId),
      getDealAgentIds(agencyId, deal.id),
    ]);

  return (
    <>
      <PanelSection>
        <Field label="Value">
          {deal.value != null ? (
            <span className="font-mono tabular-nums">{money(deal.value)}</span>
          ) : (
            "No value set"
          )}
        </Field>
        <Field label="Listing">
          {listing ? (
            <PanelLink
              href={openRecordHref(base, { type: "listing", id: listing.id })}
              className="text-info"
            >
              {listing.title ?? "Untitled listing"}
              {listing.city ? ` · ${listing.city}` : ""}
            </PanelLink>
          ) : (
            "Not linked"
          )}
        </Field>
        <Field label="Requirement">
          {deal.requirement_id && requirementTitle ? (
            <PanelLink
              href={openRecordHref(base, { type: "requirement", id: deal.requirement_id })}
              className="text-info"
            >
              {requirementTitle}
            </PanelLink>
          ) : (
            "Not linked"
          )}
        </Field>
        <Field label="Operator">
          {deal.company_id && companyName ? (
            <PanelLink
              href={openRecordHref(base, { type: "company", id: deal.company_id })}
              className="text-info"
            >
              {companyName}
            </PanelLink>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Created">{formatDateUpdated(deal.created_at).text}</Field>
      </PanelSection>
      <PanelSection title="Deal details" className="border-t">
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
      </PanelSection>
    </>
  );
}

async function RemindersTab({ agencyId, dealId }: { agencyId: string; dealId: string }) {
  const rows = await listDealReminders(agencyId, dealId);
  const reminders = rows.map((r) => ({ ...r, overdue: isPast(r.due_at) }));
  return (
    <PanelSection title="Reminders & deadlines">
      <DealReminders dealId={dealId} reminders={reminders} />
    </PanelSection>
  );
}

async function UpdatesTab({ agencyId, dealId }: { agencyId: string; dealId: string }) {
  const [activities, members] = await Promise.all([
    listActivitiesForEntity(agencyId, "deal", dealId, 30),
    getAgencyMembers(agencyId),
  ]);
  const actorNames = Object.fromEntries(members.map((m) => [m.id, m.name]));
  return (
    <PanelSection title="Updates & notes">
      <LogActivityForm entityType="deal" entityId={dealId} />
      <ActivityTimeline activities={activities} actorNames={actorNames} />
    </PanelSection>
  );
}
