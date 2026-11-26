import {
  EmptyNote,
  Field,
  PanelLink,
  PanelSection,
} from "@/components/record-panel/fields";
import { EmailLink } from "@/components/email-link";
import {
  EditableAddress,
  EditableAgents,
  EditableContactCompany,
  EditableField,
} from "@/components/record-panel/inline-edit";
import { PanelFrame, RecordNotFound } from "@/components/record-panel/panel-frame";
import { MapTab } from "@/components/record-panel/tabs/map-tab";
import { MatchmakerTab } from "@/components/record-panel/tabs/matchmaker-tab";
import { NotesActivityTab } from "@/components/record-panel/tabs/notes-tab";
import { UploadsTab } from "@/components/record-panel/tabs/uploads-tab";
import { QuickRequirementModal } from "@/components/quick-requirement-modal";
import { Badge } from "@/components/ui/badge";
import {
  patchContactAddress,
  patchContactAgents,
  patchContactCompany,
  patchContactField,
} from "@/lib/actions/panel-edit";
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
      content = (
        <NotesActivityTab
          {...tabProps}
          userId={userId}
          notes={contact.notes}
          summaryEdit={{ action: patchContactField }}
        />
      );
      break;
    case "requirements":
      content = <RequirementsTab agencyId={agencyId} contact={contact} base={base} />;
      break;
    case "map":
      content = (
        <MapTab
          lat={contact.lat}
          lng={contact.lng}
          label={name}
          recordId={contact.id}
          address={{
            address_line: contact.address_line,
            city: contact.city,
            postcode: contact.postcode,
            county: contact.county,
          }}
          addressAction={patchContactAddress}
        />
      );
      break;
    case "matchmaker":
      content = <MatchmakerTab {...tabProps} base={base} />;
      break;
    case "uploads":
      content = <UploadsTab {...tabProps} />;
      break;
    default:
      content = (
        <OverviewTab
          agencyId={agencyId}
          contact={contact}
          roleText={r.label}
          roles={roles}
          base={base}
        />
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
  roles,
  base,
}: {
  agencyId: string;
  contact: Contact;
  roleText: string;
  roles: { slug: string; label: string }[];
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

  const edit = { recordId: contact.id, action: patchContactField } as const;

  return (
    <PanelSection>
      <Field label="First name">
        <EditableField
          {...edit}
          field="first_name"
          label="First name"
          kind="text"
          value={contact.first_name}
        />
      </Field>
      <Field label="Last name">
        <EditableField
          {...edit}
          field="last_name"
          label="Last name"
          kind="text"
          value={contact.last_name ?? ""}
        />
      </Field>
      <Field label="Role">
        <EditableField
          {...edit}
          field="role"
          label="Role"
          kind="select"
          value={contact.role}
          display={roleText}
          options={roles.map((x) => ({ value: x.slug, label: x.label }))}
        />
      </Field>
      <Field label="Company">
        <EditableContactCompany
          action={patchContactCompany}
          contactId={contact.id}
          companyId={contact.company_id}
          isPrimary={contact.is_primary}
          display={
            contact.company_id ? (
              <>
                <PanelLink
                  href={openRecordHref(base, { type: "company", id: contact.company_id })}
                  className="text-info"
                >
                  {companyName ?? "View company"}
                </PanelLink>
                {contact.is_primary ? <span className="text-muted-foreground"> · primary contact</span> : null}
              </>
            ) : (
              "—"
            )
          }
        />
      </Field>
      <Field label="Email">
        <EditableField
          {...edit}
          field="email"
          label="Email"
          kind="email"
          value={contact.email ?? ""}
          display={
            contact.email ? (
              <EmailLink email={contact.email} className="text-info hover:underline" />
            ) : undefined
          }
        />
      </Field>
      <Field label="Mobile">
        <EditableField {...edit} field="mobile" label="Mobile" kind="phone" value={contact.mobile ?? ""} />
      </Field>
      <Field label="Landline">
        <EditableField {...edit} field="phone" label="Landline" kind="phone" value={contact.phone ?? ""} />
      </Field>
      <Field label="Address">
        <EditableAddress
          action={patchContactAddress}
          recordId={contact.id}
          address={{
            address_line: contact.address_line,
            city: contact.city,
            postcode: contact.postcode,
            county: contact.county,
          }}
        />
      </Field>
      <Field label="Marketing">
        <EditableField
          {...edit}
          field="marketing_opt_in"
          label="Marketing: latest news"
          kind="boolean"
          value={String(contact.marketing_opt_in === true)}
        />
      </Field>
      <Field label="Alerts">
        <EditableField
          {...edit}
          field="marketing_property_alerts"
          label="Marketing: property alerts"
          kind="boolean"
          value={String(contact.marketing_property_alerts === true)}
        />
      </Field>
      <Field label="Agents">
        <EditableAgents
          action={patchContactAgents}
          recordId={contact.id}
          agents={members}
          leadAgentId={contact.lead_agent_id}
          additionalAgentIds={agentIds}
          display={
            <>
              <span>Lead: {leadAgent ?? "—"}</span>
              {agents.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {agents.map((a) => (
                    <Badge key={a.id} tone="slate">
                      {a.name}
                    </Badge>
                  ))}
                </span>
              ) : null}
            </>
          }
        />
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
