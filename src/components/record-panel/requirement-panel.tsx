import {
  band,
  BadgeList,
  ChipList,
  EmptyNote,
  Field,
  money,
  PanelLink,
  PanelSection,
} from "@/components/record-panel/fields";
import { PanelFrame, RecordNotFound } from "@/components/record-panel/panel-frame";
import { RequirementMatchmaker } from "@/components/record-panel/requirement-matchmaker";
import { NotesActivityTab } from "@/components/record-panel/tabs/notes-tab";
import { RequirementRatingSlot } from "@/components/record-panel/tabs/requirement-rating-slot";
import { TodoTab } from "@/components/record-panel/tabs/todo-tab";
import { RequirementDocuments } from "@/components/requirement-documents";
import { SendHistoryCard } from "@/components/send-history-card";
import { Badge } from "@/components/ui/badge";
import { propertyUseBadge, requirementStatusBadge, tenureBadge } from "@/lib/badges";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyName } from "@/lib/db/queries/companies";
import { getContactById } from "@/lib/db/queries/contacts";
import {
  getRequirementAgentIds,
  getRequirementById,
  listRequirementDocuments,
} from "@/lib/db/queries/requirements";
import { formatDateUpdated } from "@/lib/format-date";
import {
  openRecordHref,
  type RecordRef,
  type SearchParamsLike,
} from "@/lib/record-ref";
import { signRequirementDocUrl } from "@/lib/requirement-docs";
import { getSendHistory } from "@/lib/send-history";

type Requirement = NonNullable<Awaited<ReturnType<typeof getRequirementById>>>;

export async function RequirementPanel({
  agencyId,
  userId,
  record,
  tab,
  base,
  flexParam,
}: {
  agencyId: string;
  userId: string;
  record: RecordRef;
  tab: string;
  base: SearchParamsLike;
  flexParam: string | undefined;
}) {
  const r = await getRequirementById(agencyId, record.id);
  if (!r) return <RecordNotFound />;

  const s = requirementStatusBadge(r.status);
  const tabProps = { entityType: "requirement", entityId: r.id, agencyId } as const;

  let content: React.ReactNode;
  switch (tab) {
    case "contacts":
      content = <ContactsTab agencyId={agencyId} r={r} base={base} />;
      break;
    case "notes":
      content = <NotesActivityTab {...tabProps} notes={r.notes} />;
      break;
    case "matchmaker":
      content = (
        <RequirementMatchmaker
          agencyId={agencyId}
          userId={userId}
          requirement={r}
          record={record}
          base={base}
          flexParam={flexParam}
        />
      );
      break;
    case "uploads":
      content = <UploadsTab agencyId={agencyId} requirementId={r.id} />;
      break;
    case "send-history":
      content = <SendHistoryTab agencyId={agencyId} requirementId={r.id} />;
      break;
    case "todo":
      content = <TodoTab {...tabProps} userId={userId} />;
      break;
    default:
      content = <OverviewTab agencyId={agencyId} r={r} statusText={s.label} />;
  }

  return (
    <PanelFrame
      record={record}
      tab={tab}
      base={base}
      title={r.title}
      badge={<Badge tone={s.tone}>{s.label}</Badge>}
    >
      {content}
    </PanelFrame>
  );
}

async function OverviewTab({
  agencyId,
  r,
  statusText,
}: {
  agencyId: string;
  r: Requirement;
  statusText: string;
}) {
  const [agentIds, members] = await Promise.all([
    getRequirementAgentIds(agencyId, r.id),
    getAgencyMembers(agencyId),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgent = r.lead_agent_id ? (nameOf.get(r.lead_agent_id) ?? "Unknown agent") : null;
  const agents = agentIds.map((id) => ({ id, name: nameOf.get(id) ?? "Unknown agent" }));
  const updated = formatDateUpdated(r.date_updated);

  return (
    <>
      <PanelSection>
        <Field label="Status">{statusText}</Field>
        <Field label="Date updated">
          <span title={updated.title}>{updated.text}</span>
        </Field>
        <RequirementRatingSlot requirementId={r.id} />
      </PanelSection>
      <PanelSection title="Location" className="border-t">
        <Field label="Zones">
          <ChipList items={r.target_london_zones} tone="indigo" />
        </Field>
        <Field label="Areas">{r.target_neighbourhoods.join(", ") || "—"}</Field>
        <Field label="Towns">{r.target_towns.join(", ") || "—"}</Field>
        <Field label="Counties">{r.target_counties.join(", ") || "—"}</Field>
        <Field label="Regions">{r.target_regions.join(", ") || "—"}</Field>
        <Field label="Districts">
          <ChipList items={r.target_postcode_districts} tone="sky" />
        </Field>
      </PanelSection>
      <PanelSection title="Property" className="border-t">
        <Field label="Use class">
          <BadgeList items={r.use_classes.map((u) => propertyUseBadge(u))} />
        </Field>
        <Field label="Size">{band(r.min_sqft, r.max_sqft, " sq ft")}</Field>
        <Field label="Covers">{band(r.min_covers, r.max_covers)}</Field>
      </PanelSection>
      <PanelSection title="Structure & budget" className="border-t">
        <Field label="Tenure">
          <BadgeList items={r.tenure_prefs.map((t) => tenureBadge(t))} />
        </Field>
        <Field label="Max rent">
          <span className="font-mono tabular-nums">{money(r.max_rent)}</span>
          {r.max_rent != null ? <span className="text-muted-foreground"> pa</span> : null}
        </Field>
        <Field label="Max premium">
          <span className="font-mono tabular-nums">{money(r.max_premium)}</span>
        </Field>
        <Field label="Max guide">
          <span className="font-mono tabular-nums">{money(r.max_guide_price)}</span>
        </Field>
      </PanelSection>
      <PanelSection title="Agents" className="border-t">
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
      </PanelSection>
    </>
  );
}

async function ContactsTab({
  agencyId,
  r,
  base,
}: {
  agencyId: string;
  r: Requirement;
  base: SearchParamsLike;
}) {
  const [companyName, contact] = await Promise.all([
    r.company_id ? getCompanyName(agencyId, r.company_id) : Promise.resolve(null),
    r.contact_id ? getContactById(agencyId, r.contact_id) : Promise.resolve(null),
  ]);
  const contactName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "View contact"
    : null;
  return (
    <PanelSection title="Company and contact">
      {r.company_id || r.contact_id ? (
        <>
          <Field label="Operator">
            {r.company_id ? (
              <PanelLink
                href={openRecordHref(base, { type: "company", id: r.company_id })}
                className="text-info"
              >
                {companyName ?? "View company"}
              </PanelLink>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Contact">
            {r.contact_id ? (
              <PanelLink
                href={openRecordHref(base, { type: "contact", id: r.contact_id })}
                className="text-info"
              >
                {contactName ?? "View contact"}
              </PanelLink>
            ) : (
              "—"
            )}
          </Field>
        </>
      ) : (
        <EmptyNote>No company or contact linked to this requirement.</EmptyNote>
      )}
    </PanelSection>
  );
}

async function UploadsTab({
  agencyId,
  requirementId,
}: {
  agencyId: string;
  requirementId: string;
}) {
  // `file_path` (the raw, never-expiring Blob URL) stays on the server: only the
  // signed, 1-hour proxy link goes to the client. See src/lib/requirement-docs.ts.
  let docs: Awaited<ReturnType<typeof loadDocs>>;
  try {
    docs = await loadDocs(agencyId, requirementId);
  } catch (err) {
    // A missing DOC_SIGNING_SECRET or a missing table. The panel keeps working.
    console.error("Uploads tab: documents could not be loaded", err);
    return (
      <PanelSection title="Landlord pack">
        <EmptyNote>Documents are not available.</EmptyNote>
      </PanelSection>
    );
  }
  return (
    <PanelSection title="Landlord pack">
      <p className="text-sm text-muted-foreground">
        Documents held against this brief. Download links are private and expire after an
        hour.
      </p>
      <RequirementDocuments requirementId={requirementId} docs={docs} />
    </PanelSection>
  );
}

async function loadDocs(agencyId: string, requirementId: string) {
  const rows = await listRequirementDocuments(agencyId, requirementId);
  return Promise.all(
    rows.map(async (d) => ({
      id: d.id,
      name: d.name,
      doc_type: d.doc_type,
      size_bytes: d.size_bytes,
      url: await signRequirementDocUrl(agencyId, d.id),
    })),
  );
}

async function SendHistoryTab({
  agencyId,
  requirementId,
}: {
  agencyId: string;
  requirementId: string;
}) {
  const sends = await getSendHistory(agencyId, { requirementId });
  if (sends.length === 0) {
    return (
      <PanelSection title="Send history">
        <EmptyNote>No deals sent for this requirement yet.</EmptyNote>
      </PanelSection>
    );
  }
  return (
    <PanelSection>
      <SendHistoryCard sends={sends} />
    </PanelSection>
  );
}
