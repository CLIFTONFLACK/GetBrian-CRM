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
import {
  EditableAgents,
  EditableAnchor,
  EditableField,
  EditableLinks,
  EditableMulti,
  type InlineKind,
} from "@/components/record-panel/inline-edit";
import { PanelFrame, RecordNotFound } from "@/components/record-panel/panel-frame";
import { RequirementMatchmaker } from "@/components/record-panel/requirement-matchmaker";
import { NotesActivityTab } from "@/components/record-panel/tabs/notes-tab";
import { RequirementRatingSlot } from "@/components/record-panel/tabs/requirement-rating-slot";
import { RequirementDocuments } from "@/components/requirement-documents";
import { SendHistoryCard } from "@/components/send-history-card";
import { Badge } from "@/components/ui/badge";
import { propertyUseBadge, requirementStatusBadge, tenureBadge } from "@/lib/badges";
import {
  patchRequirementAgents,
  patchRequirementAnchor,
  patchRequirementChoices,
  patchRequirementField,
  patchRequirementLinks,
} from "@/lib/actions/panel-edit-requirement";
import { REQUIREMENT_STATUSES, REQUIREMENT_TENURES } from "@/lib/panel-fields/requirement";
import { USE_CLASS_OPTIONS } from "@/lib/use-classes";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyName } from "@/lib/db/queries/companies";
import { getContactById } from "@/lib/db/queries/contacts";
import {
  getRequirementAgentIds,
  getRequirementById,
  listRequirementDocuments,
} from "@/lib/db/queries/requirements";
import { formatDateUpdated } from "@/lib/format-date";
import { describeAnchor, formatRentPsf } from "@/lib/requirement-display";
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
      content = (
        <NotesActivityTab
          {...tabProps}
          userId={userId}
          notes={r.notes}
          summaryEdit={{ action: patchRequirementField }}
        />
      );
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
    default:
      content = <OverviewTab agencyId={agencyId} r={r} statusText={s.label} base={base} />;
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

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_hold: "On hold",
  satisfied: "Satisfied",
  withdrawn: "Withdrawn",
};
const TENURE_LABELS: Record<string, string> = {
  freehold: "Freehold",
  leasehold: "Leasehold",
  assignment: "Assignment",
  new_letting: "New letting",
};

async function OverviewTab({
  agencyId,
  r,
  statusText,
  base,
}: {
  agencyId: string;
  r: Requirement;
  statusText: string;
  base: SearchParamsLike;
}) {
  const [agentIds, members, companyName, contact] = await Promise.all([
    getRequirementAgentIds(agencyId, r.id),
    getAgencyMembers(agencyId),
    r.company_id ? getCompanyName(agencyId, r.company_id) : Promise.resolve(null),
    r.contact_id ? getContactById(agencyId, r.contact_id) : Promise.resolve(null),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgent = r.lead_agent_id ? (nameOf.get(r.lead_agent_id) ?? "Unknown agent") : null;
  const agents = agentIds.map((id) => ({ id, name: nameOf.get(id) ?? "Unknown agent" }));
  const updated = formatDateUpdated(r.date_updated);
  const anchor = describeAnchor(r);
  const contactName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "View contact"
    : null;

  // One editable row. `value` is the stored value as text; `display` replaces it in the read view.
  const row = (
    label: string,
    field: string,
    kind: InlineKind,
    value: string | number | null | undefined,
    display?: React.ReactNode,
    options?: { value: string; label: string }[],
  ) => (
    <Field label={label}>
      <EditableField
        action={patchRequirementField}
        recordId={r.id}
        field={field}
        label={label}
        kind={kind}
        value={value == null ? "" : String(value)}
        display={display}
        options={options}
      />
    </Field>
  );
  const cash = (label: string, field: string, value: number | null, suffix = "") =>
    row(
      label,
      field,
      "number",
      value,
      value != null ? (
        <>
          <span className="font-mono tabular-nums">{money(value)}</span>
          {suffix ? <span className="text-muted-foreground"> {suffix}</span> : null}
        </>
      ) : undefined,
    );
  const places = (label: string, field: string, items: string[]) =>
    row(label, field, "tags", items.join(", "));

  return (
    <>
      <PanelSection>
        {row("Title", "title", "text", r.title)}
        {row(
          "Status",
          "status",
          "select",
          r.status,
          statusText,
          REQUIREMENT_STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] ?? v })),
        )}
        <Field label="Company">
          <EditableLinks
            action={patchRequirementLinks}
            recordId={r.id}
            companyId={r.company_id}
            contactId={r.contact_id}
            hint="A requirement needs a company or a contact. Both is normal."
            display={
              <span className="flex flex-col gap-0.5">
                <span>
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
                </span>
                <span className="text-xs text-muted-foreground">
                  Contact:{" "}
                  {r.contact_id && contactName ? (
                    <PanelLink
                      href={openRecordHref(base, { type: "contact", id: r.contact_id })}
                      className="text-info"
                    >
                      {contactName}
                    </PanelLink>
                  ) : (
                    "—"
                  )}
                </span>
              </span>
            }
          />
        </Field>
        <Field label="Date updated">
          <span title={updated.title}>{updated.text}</span>
        </Field>
        <RequirementRatingSlot requirementId={r.id} />
      </PanelSection>

      <PanelSection title="Location" className="border-t">
        {places("Zones", "target_london_zones", r.target_london_zones)}
        {places("Areas", "target_neighbourhoods", r.target_neighbourhoods)}
        {places("Towns", "target_towns", r.target_towns)}
        {places("Counties", "target_counties", r.target_counties)}
        {places("Regions", "target_regions", r.target_regions)}
        {places("Districts", "target_postcode_districts", r.target_postcode_districts)}
        <Field label="Radius">
          <EditableAnchor
            action={patchRequirementAnchor}
            recordId={r.id}
            text={r.location_anchor_text}
            miles={r.location_radius_miles != null ? Number(r.location_radius_miles) : null}
            display={
              anchor ? (
                <>
                  {anchor.text}
                  {anchor.located ? null : (
                    <span className="block text-xs text-amber-600 dark:text-amber-400">
                      Place not found: not used for matching.
                    </span>
                  )}
                </>
              ) : (
                "—"
              )
            }
          />
        </Field>
      </PanelSection>

      <PanelSection title="Property" className="border-t">
        <Field label="Use class">
          <EditableMulti
            action={patchRequirementChoices}
            recordId={r.id}
            field="use_classes"
            label="Use class"
            options={USE_CLASS_OPTIONS.map(([value, label]) => ({ value, label }))}
            values={r.use_classes}
            display={
              r.use_classes.length > 0 ? (
                <BadgeList items={r.use_classes.map((u) => propertyUseBadge(u))} />
              ) : undefined
            }
          />
        </Field>
        {row("Smallest (sq ft)", "min_sqft", "number", r.min_sqft)}
        {row("Largest (sq ft)", "max_sqft", "number", r.max_sqft)}
        {row("Fewest covers", "min_covers", "number", r.min_covers)}
        {row("Most covers", "max_covers", "number", r.max_covers)}
      </PanelSection>

      <PanelSection title="Structure & budget" className="border-t">
        <Field label="Tenure">
          <EditableMulti
            action={patchRequirementChoices}
            recordId={r.id}
            field="tenure_prefs"
            label="Tenure"
            options={REQUIREMENT_TENURES.map((v) => ({ value: v, label: TENURE_LABELS[v] ?? v }))}
            values={r.tenure_prefs}
            display={
              r.tenure_prefs.length > 0 ? (
                <BadgeList items={r.tenure_prefs.map((t) => tenureBadge(t))} />
              ) : undefined
            }
          />
        </Field>
        {cash("Max rent", "max_rent", r.max_rent, "pa")}
        {row(
          "Max rent / sq ft",
          "max_rent_psf",
          "number",
          r.max_rent_psf,
          r.max_rent_psf != null ? (
            <>
              <span className="font-mono tabular-nums">{formatRentPsf(r.max_rent_psf)}</span>
              <span className="text-muted-foreground"> pa</span>
            </>
          ) : undefined,
        )}
        {cash("Max premium", "max_premium", r.max_premium)}
        {cash("Max guide", "max_guide_price", r.max_guide_price)}
      </PanelSection>

      <PanelSection title="Agents" className="border-t">
        <Field label="Agents">
          <EditableAgents
            action={patchRequirementAgents}
            recordId={r.id}
            agents={members}
            leadAgentId={r.lead_agent_id}
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
