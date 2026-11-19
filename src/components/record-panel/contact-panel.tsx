import {
  EmptyNote,
  Field,
  PanelLink,
  PanelSection,
} from "@/components/record-panel/fields";
import { EmailLink } from "@/components/email-link";
import { PanelFrame, RecordNotFound } from "@/components/record-panel/panel-frame";
import { MapTab } from "@/components/record-panel/tabs/map-tab";
import { MatchmakerTab } from "@/components/record-panel/tabs/matchmaker-tab";
import { NotesActivityTab } from "@/components/record-panel/tabs/notes-tab";
import { TodoTab } from "@/components/record-panel/tabs/todo-tab";
import { UploadsTab } from "@/components/record-panel/tabs/uploads-tab";
import { QuickRequirementModal } from "@/components/quick-requirement-modal";
import { Badge } from "@/components/ui/badge";
import { contactRoleBadge, requirementStatusBadge } from "@/lib/badges";
import { getContactRoles, roleLabel } from "@/lib/contact-roles";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyName } from "@/lib/db/queries/companies";
import { getContactAgentIds, getContactById } from "@/lib/db/queries/contacts";
import { listRequirementsForContact } from "@/lib/db/queries/requirements";
import { formatDateUpdated } from "@/lib/format-date";
import {
  openRecordHref,
  type RecordRef,
  type SearchParamsLike,
} from "@/lib/record-ref";

type Contact = NonNullable<Awaited<ReturnType<typeof getContactById>>>;

export async function ContactPanel({
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
  const contact = await getContactById(agencyId, record.id);
  if (!contact) return <RecordNotFound />;

  const roles = await getContactRoles();
  const r = contactRoleBadge(contact.role, roleLabel(roles, contact.role));
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  const tabProps = { entityType: "contact", entityId: contact.id, agencyId } as const;

  let content: React.ReactNode;
  switch (tab) {
    case "notes":
      content = <NotesActivityTab {...tabProps} notes={contact.notes} />;
      break;
    case "requirements":
      content = <RequirementsTab agencyId={agencyId} contact={contact} base={base} />;
      break;
    case "map":
      content = <MapTab lat={contact.lat} lng={contact.lng} label={name} />;
      break;
    case "todo":
      content = <TodoTab {...tabProps} userId={userId} />;
      break;
    case "matchmaker":
      content = <MatchmakerTab {...tabProps} base={base} />;
      break;
    case "uploads":
      content = <UploadsTab {...tabProps} />;
      break;
    default:
      content = (
        <OverviewTab agencyId={agencyId} contact={contact} roleText={r.label} base={base} />
      );
  }

  return (
    <PanelFrame
      record={record}
      tab={tab}
      base={base}
      title={name || "Contact"}
      badge={<Badge tone={r.tone}>{r.label}</Badge>}
    >
      {content}
    </PanelFrame>
  );
}

async function OverviewTab({
  agencyId,
  contact,
  roleText,
  base,
}: {
  agencyId: string;
  contact: Contact;
  roleText: string;
  base: SearchParamsLike;
}) {
  const [companyName, agentIds, members] = await Promise.all([
    contact.company_id ? getCompanyName(agencyId, contact.company_id) : Promise.resolve(null),
    getContactAgentIds(agencyId, contact.id),
    getAgencyMembers(agencyId),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgent = contact.lead_agent_id
    ? (nameOf.get(contact.lead_agent_id) ?? "Unknown agent")
    : null;
  const agents = agentIds.map((id) => ({ id, name: nameOf.get(id) ?? "Unknown agent" }));
  const updated = formatDateUpdated(contact.date_updated);

  return (
    <PanelSection>
      <Field label="Role">{roleText}</Field>
      <Field label="Company">
        {contact.company_id ? (
          <PanelLink
            href={openRecordHref(base, { type: "company", id: contact.company_id })}
            className="text-info"
          >
            {companyName ?? "View company"}
          </PanelLink>
        ) : (
          "—"
        )}
      </Field>
      <Field label="Email">
        {contact.email ? (
          <EmailLink email={contact.email} className="text-info hover:underline" />
        ) : (
          "—"
        )}
      </Field>
      <Field label="Mobile">{contact.mobile ?? "—"}</Field>
      <Field label="Landline">{contact.phone ?? "—"}</Field>
      <Field label="Marketing">
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={contact.marketing_opt_in ? "emerald" : "slate"}>
            Marketing: {contact.marketing_opt_in ? "Yes" : "No"}
          </Badge>
          <Badge tone={contact.marketing_property_alerts ? "emerald" : "slate"}>
            Property alerts: {contact.marketing_property_alerts ? "Yes" : "No"}
          </Badge>
        </span>
      </Field>
      <Field label="Lead agent">{leadAgent ?? "—"}</Field>
      <Field label="Agents">
        {agents.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <Badge key={a.id} tone="slate">
                {a.name}
              </Badge>
            ))}
          </span>
        ) : (
          "—"
        )}
      </Field>
      <Field label="Date updated">
        <span title={updated.title}>{updated.text}</span>
      </Field>
    </PanelSection>
  );
}

async function RequirementsTab({
  agencyId,
  contact,
  base,
}: {
  agencyId: string;
  contact: Contact;
  base: SearchParamsLike;
}) {
  const requirements = await listRequirementsForContact(agencyId, contact.id);
  return (
    <PanelSection
      title="Requirements"
      action={
        <QuickRequirementModal
          contactId={contact.id}
          companyId={contact.company_id}
          fullFormHref={`/requirements/new?contact=${contact.id}${
            contact.company_id ? `&company=${contact.company_id}` : ""
          }`}
        />
      }
    >
      {requirements.length === 0 ? (
        <EmptyNote>No requirements briefed against this contact yet.</EmptyNote>
      ) : (
        <ul className="divide-y">
          {requirements.map((rq) => {
            const rs = requirementStatusBadge(rq.status);
            return (
              <li
                key={rq.id}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <PanelLink href={openRecordHref(base, { type: "requirement", id: rq.id })}>
                  {rq.title}
                </PanelLink>
                <Badge tone={rs.tone}>{rs.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}
