import { WebsiteLink } from "@/components/website-link";
import { Plus } from "lucide-react";
import Link from "next/link";

import {
  EmptyNote,
  Field,
  PanelLink,
  PanelSection,
} from "@/components/record-panel/fields";
import {
  EditableAddress,
  EditableAgents,
  EditableField,
} from "@/components/record-panel/inline-edit";
import { PanelFrame, RecordNotFound } from "@/components/record-panel/panel-frame";
import { MapTab } from "@/components/record-panel/tabs/map-tab";
import { MatchmakerTab } from "@/components/record-panel/tabs/matchmaker-tab";
import { NotesActivityTab } from "@/components/record-panel/tabs/notes-tab";
import { UploadsTab } from "@/components/record-panel/tabs/uploads-tab";
import { QuickRequirementModal } from "@/components/quick-requirement-modal";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  companyTypeBadge,
  contactRoleBadge,
  listingStatusBadge,
  requirementStatusBadge,
} from "@/lib/badges";
import {
  patchCompanyAddress,
  patchCompanyAgents,
  patchCompanyField,
} from "@/lib/actions/panel-edit";
import { getCompanyTypes, typeLabel } from "@/lib/company-types";
import { getContactRoles, roleLabel } from "@/lib/contact-roles";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyAgentIds, getCompanyById } from "@/lib/db/queries/companies";
import { listDisposalsForCompany } from "@/lib/db/queries/disposals";
import { listContactsByCompany } from "@/lib/db/queries/contacts";
import { listRequirementsForCompany } from "@/lib/db/queries/requirements";
import { formatDateUpdated } from "@/lib/format-date";
import {
  openRecordHref,
  type RecordRef,
  type SearchParamsLike,
} from "@/lib/record-ref";
import { cn } from "@/lib/utils";

export async function CompanyPanel({
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
  const company = await getCompanyById(agencyId, record.id);
  if (!company) return <RecordNotFound />;

  const companyTypes = await getCompanyTypes();
  const t = companyTypeBadge(company.type, typeLabel(companyTypes, company.type));
  const tabProps = { entityType: "company", entityId: company.id, agencyId } as const;

  let content: React.ReactNode;
  switch (tab) {
    case "notes":
      content = (
        <NotesActivityTab
          {...tabProps}
          userId={userId}
          notes={company.notes}
          summaryEdit={{ action: patchCompanyField }}
        />
      );
      break;
    case "requirements":
      content = <RequirementsTab agencyId={agencyId} companyId={company.id} base={base} />;
      break;
    case "listings":
      content = <ListingsTab agencyId={agencyId} companyId={company.id} base={base} />;
      break;
    case "map":
      content = (
        <MapTab
          lat={company.lat}
          lng={company.lng}
          label={company.name}
          recordId={company.id}
          address={{
            address_line: company.address_line,
            city: company.city,
            postcode: company.postcode,
            county: company.county,
          }}
          addressAction={patchCompanyAddress}
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
        <>
          <OverviewTab
            agencyId={agencyId}
            company={company}
            typeText={t.label}
            types={companyTypes}
          />
          <ContactsSection agencyId={agencyId} companyId={company.id} base={base} />
        </>
      );
  }

  return (
    <PanelFrame
      record={record}
      tab={tab}
      base={base}
      title={company.name}
      badge={<Badge tone={t.tone}>{t.label}</Badge>}
    >
      {content}
    </PanelFrame>
  );
}

async function OverviewTab({
  agencyId,
  company,
  typeText,
  types,
}: {
  agencyId: string;
  company: NonNullable<Awaited<ReturnType<typeof getCompanyById>>>;
  typeText: string;
  types: { slug: string; label: string }[];
}) {
  const [agentIds, members] = await Promise.all([
    getCompanyAgentIds(agencyId, company.id),
    getAgencyMembers(agencyId),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgentName = company.lead_agent_id
    ? (nameOf.get(company.lead_agent_id) ?? "Unknown agent")
    : null;
  const agents = agentIds.map((id) => ({ id, name: nameOf.get(id) ?? "Unknown agent" }));
  const updated = formatDateUpdated(company.date_updated);

  const edit = { recordId: company.id, action: patchCompanyField } as const;

  return (
    <PanelSection className="space-y-3">
      <Field label="Name">
        <EditableField {...edit} field="name" label="Name" kind="text" value={company.name} />
      </Field>
      <Field label="Type">
        <EditableField
          {...edit}
          field="type"
          label="Type"
          kind="select"
          value={company.type}
          display={typeText}
          options={types.map((x) => ({ value: x.slug, label: x.label }))}
        />
      </Field>
      <Field label="Tags">
        <EditableField
          {...edit}
          field="sector_tags"
          label="Tags"
          kind="tags"
          value={company.sector_tags.join(", ")}
          display={
            company.sector_tags.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {company.sector_tags.map((tag) => (
                  <Badge key={tag} tone="slate">
                    {tag}
                  </Badge>
                ))}
              </span>
            ) : undefined
          }
        />
      </Field>
      <Field label="Website">
        <EditableField
          {...edit}
          field="website"
          label="Website"
          kind="url"
          value={company.website ?? ""}
          display={
            company.website ? (
              <WebsiteLink url={company.website} className="text-info hover:underline" />
            ) : undefined
          }
        />
      </Field>
      <Field label="Phone">
        <EditableField {...edit} field="phone" label="Phone" kind="phone" value={company.phone ?? ""} />
      </Field>
      <Field label="Address">
        <EditableAddress
          action={patchCompanyAddress}
          recordId={company.id}
          address={{
            address_line: company.address_line,
            city: company.city,
            postcode: company.postcode,
            county: company.county,
          }}
        />
      </Field>
      <Field label="Company number">
        <EditableField
          {...edit}
          field="company_number"
          label="Company number"
          kind="text"
          value={company.company_number ?? ""}
        />
      </Field>
      <Field label="VAT number">
        <EditableField
          {...edit}
          field="vat_number"
          label="VAT number"
          kind="text"
          value={company.vat_number ?? ""}
        />
      </Field>
      <Field label="Agents">
        <EditableAgents
          action={patchCompanyAgents}
          recordId={company.id}
          agents={members}
          leadAgentId={company.lead_agent_id}
          additionalAgentIds={agentIds}
          display={
            <>
              <span>Lead: {leadAgentName ?? "—"}</span>
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

async function ContactsSection({
  agencyId,
  companyId,
  base,
}: {
  agencyId: string;
  companyId: string;
  base: SearchParamsLike;
}) {
  const [contacts, roles] = await Promise.all([
    listContactsByCompany(agencyId, companyId),
    getContactRoles(),
  ]);
  return (
    <PanelSection
      title="Contacts"
      className="border-t"
      action={
        <Link
          href={`/contacts/new?company=${companyId}`}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          <Plus />
          Add contact
        </Link>
      }
    >
      {contacts.length === 0 ? (
        <EmptyNote>No contacts yet.</EmptyNote>
      ) : (
        <ul className="divide-y">
          {contacts.map((ct) => {
            const r = contactRoleBadge(ct.role, roleLabel(roles, ct.role));
            return (
              <li
                key={ct.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <PanelLink href={openRecordHref(base, { type: "contact", id: ct.id })}>
                  {[ct.first_name, ct.last_name].filter(Boolean).join(" ")}
                </PanelLink>
                <span className="flex flex-wrap items-center gap-2">
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
    </PanelSection>
  );
}

async function RequirementsTab({
  agencyId,
  companyId,
  base,
}: {
  agencyId: string;
  companyId: string;
  base: SearchParamsLike;
}) {
  const requirements = await listRequirementsForCompany(agencyId, companyId);
  return (
    <PanelSection
      title="Requirements"
      action={
        <QuickRequirementModal
          companyId={companyId}
          fullFormHref={`/requirements/new?company=${companyId}`}
        />
      }
    >
      {requirements.length === 0 ? (
        <EmptyNote>No requirements yet.</EmptyNote>
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

async function ListingsTab({
  agencyId,
  companyId,
  base,
}: {
  agencyId: string;
  companyId: string;
  base: SearchParamsLike;
}) {
  const listings = await listDisposalsForCompany(agencyId, companyId);
  return (
    <PanelSection
      title="Listings"
      action={
        <Link
          href={`/listings/new?company=${companyId}`}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          <Plus />
          Add listing
        </Link>
      }
    >
      {listings.length === 0 ? (
        <EmptyNote>No listings linked yet.</EmptyNote>
      ) : (
        <ul className="divide-y">
          {listings.map((l) => {
            const ls = listingStatusBadge(l.status);
            return (
              <li
                key={l.id}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <PanelLink href={openRecordHref(base, { type: "listing", id: l.id })}>
                  {l.title ?? "Untitled listing"}
                  {l.city ? <span className="text-muted-foreground"> · {l.city}</span> : null}
                </PanelLink>
                <Badge tone={ls.tone}>{ls.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}
