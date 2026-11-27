import {
  AddDealButton,
  DEAL_ID_TOKEN,
  type DealRequirementOption,
} from "@/components/add-deal-button";
import { BrochurePreview } from "@/components/brochure-preview";
import { CreateDealButton } from "@/components/create-deal-button";
import { DisposalDocuments, type DisposalDoc } from "@/components/disposal-documents";
import { DisposalImages, type DisposalImage } from "@/components/disposal-images";
import { LocationFlexSlider } from "@/components/location-flex-slider";
import { MatchReasons } from "@/components/match-reasons";
import {
  EmptyNote,
  Field,
  money,
  PanelLink,
  PanelSection,
} from "@/components/record-panel/fields";
import {
  EditableAddress,
  EditableAgents,
  EditableField,
  EditableLinks,
  EditableMulti,
  type InlineKind,
} from "@/components/record-panel/inline-edit";
import { PanelFrame, RecordNotFound } from "@/components/record-panel/panel-frame";
import { MapTab } from "@/components/record-panel/tabs/map-tab";
import { NotesActivityTab } from "@/components/record-panel/tabs/notes-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  dealStageBadge,
  isListingMatchable,
  listingStatusBadge,
  listingTypeBadge,
  matchScoreBadge,
} from "@/lib/badges";
import {
  patchListingAddress,
  patchListingAgents,
  patchListingField,
  patchListingLinks,
  patchListingUseClasses,
} from "@/lib/actions/panel-edit-listing";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import {
  DISPOSAL_TYPES,
  FIT_OUT_STATES,
  LISTING_STATUSES,
  LISTING_TYPES,
  PRICE_QUALIFIERS,
} from "@/lib/panel-fields/listing";
import { parseUseClasses, USE_CLASS_OPTIONS } from "@/lib/use-classes";
import { getDealsForListing } from "@/lib/db/queries/deals";
import { previewIsCurrent } from "@/lib/disposals/brochure-preview-state";
import {
  getBrochurePreview,
  getDisposalAgentIds,
  getDisposalById,
  getLinkedCompany,
  getLinkedContact,
  listDisposalDocuments,
} from "@/lib/db/queries/disposals";
import { listActiveRequirementsForMatching } from "@/lib/db/queries/requirements";
import { signDisposalDocUrl } from "@/lib/disposal-docs";
import {
  byMatchQuality,
  DEFAULT_LOCATION_FLEX,
  scoreMatch,
  thinBriefHint,
} from "@/lib/matching/score";
import {
  formatRecordRef,
  openRecordHref,
  type RecordRef,
  type SearchParamsLike,
} from "@/lib/record-ref";

type Disposal = NonNullable<Awaited<ReturnType<typeof getDisposalById>>>;

const DISPOSAL_TYPE_LABELS: Record<string, string> = {
  freehold: "Freehold",
  new_lease: "New lease",
  lease_assignment: "Lease assignment",
  sublease: "Sublease",
  unknown: "Unspecified",
};
const FIT_OUT_LABELS: Record<string, string> = {
  fully_fitted: "Fully fitted",
  part_fitted: "Part fitted",
  shell: "Shell",
};

export async function ListingPanel({
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
  const d = await getDisposalById(agencyId, record.id);
  if (!d) return <RecordNotFound />;

  const lt = listingTypeBadge(d.listing_type);
  const tabProps = { entityType: "listing", entityId: d.id, agencyId } as const;

  let content: React.ReactNode;
  switch (tab) {
    case "media":
      content = <MediaTab agencyId={agencyId} d={d} />;
      break;
    case "map":
      content = (
        <MapTab
          lat={d.lat}
          lng={d.lng}
          label={d.title ?? "Listing"}
          recordId={d.id}
          address={{ address_line: d.address_line, city: d.city, postcode: d.postcode, county: d.county }}
          addressAction={patchListingAddress}
        />
      );
      break;
    case "matchmaker":
      content = (
        <ListingMatchmaker
          agencyId={agencyId}
          d={d}
          record={record}
          base={base}
          flexParam={flexParam}
        />
      );
      break;
    case "deals":
      content = <DealsTab agencyId={agencyId} d={d} base={base} />;
      break;
    case "notes":
      content = <NotesActivityTab {...tabProps} userId={userId} />;
      break;
    default:
      content = <OverviewTab agencyId={agencyId} d={d} base={base} />;
  }

  return (
    <PanelFrame
      record={record}
      tab={tab}
      base={base}
      title={d.title ?? "Untitled listing"}
      badge={<Badge tone={lt.tone}>{lt.label}</Badge>}
    >
      {content}
    </PanelFrame>
  );
}

const PRICE_QUALIFIER_LABELS: Record<string, string> = {
  fixed: "Fixed price",
  offers_in_region: "Offers in the region of",
  offers_in_excess: "Offers in excess of",
  on_application: "On application",
};

const labelled = (values: readonly string[], labels: Record<string, string>) =>
  values.map((v) => ({ value: v, label: labels[v] ?? v }));

async function OverviewTab({
  agencyId,
  d,
  base,
}: {
  agencyId: string;
  d: Disposal;
  base: SearchParamsLike;
}) {
  const [members, agentIds, company, contact, storedPreview] = await Promise.all([
    getAgencyMembers(agencyId),
    getDisposalAgentIds(agencyId, d.id),
    d.company_id ? getLinkedCompany(agencyId, d.company_id) : Promise.resolve(null),
    d.contact_id ? getLinkedContact(agencyId, d.contact_id) : Promise.resolve(null),
    d.brochure_url ? getBrochurePreview(agencyId, d.id) : Promise.resolve(null),
  ]);
  // A stored image counts only for the link it was drawn from. Otherwise the
  // panel asks the server to make one, unless a recent try already failed.
  const previewState = previewIsCurrent(storedPreview, d.brochure_url);
  const currentPreview = {
    url: previewState === "ready" ? (storedPreview?.preview_url ?? null) : null,
    tryOnMount: previewState === "needed",
  };
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgent = d.lead_agent_id ? (nameOf.get(d.lead_agent_id) ?? "Unknown agent") : null;
  const agents = agentIds.map((id) => ({ id, name: nameOf.get(id) ?? "Unknown agent" }));
  const ls = listingStatusBadge(d.status);
  const lt = listingTypeBadge(d.listing_type);
  const contactName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unnamed contact"
    : null;
  const classes = parseUseClasses(d.property_type, d.use_class);

  // One editable row. `value` is the stored value as text; `display` replaces it in the read view.
  const row = (
    label: string,
    field: string,
    kind: InlineKind,
    value: string | number | boolean | null | undefined,
    display?: React.ReactNode,
    options?: { value: string; label: string }[],
  ) => (
    <Field label={label}>
      <EditableField
        action={patchListingField}
        recordId={d.id}
        field={field}
        label={label}
        kind={kind}
        value={value == null ? "" : String(value)}
        display={display}
        options={options}
      />
    </Field>
  );
  const flag = (label: string, field: string, value: boolean | null) =>
    row(label, field, "boolean", Boolean(value));
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

  return (
    <>
      <PanelSection>
        {row("Title", "title", "text", d.title)}
        {row(
          "Status",
          "status",
          "select",
          d.status,
          <Badge tone={ls.tone}>{ls.label}</Badge>,
          LISTING_STATUSES.map((v) => ({ value: v, label: v })),
        )}
        {row(
          "Listing type",
          "listing_type",
          "select",
          d.listing_type,
          <Badge tone={lt.tone}>{lt.label}</Badge>,
          LISTING_TYPES.map((v) => ({ value: v, label: v === "cdg" ? "CDG" : "Market intel" })),
        )}
        <Field label="Company">
          <EditableLinks
            action={patchListingLinks}
            recordId={d.id}
            companyId={d.company_id}
            contactId={d.contact_id}
            hint={d.source === "manual" ? "A listing made by hand needs a contact." : undefined}
            display={
              <span className="flex flex-col gap-0.5">
                <span>
                  {company ? (
                    <PanelLink
                      href={openRecordHref(base, { type: "company", id: company.id })}
                      className="text-info"
                    >
                      {company.name}
                    </PanelLink>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Contact:{" "}
                  {contact && contactName ? (
                    <PanelLink
                      href={openRecordHref(base, { type: "contact", id: contact.id })}
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
        <Field label="Agents">
          <EditableAgents
            action={patchListingAgents}
            recordId={d.id}
            agents={members}
            leadAgentId={d.lead_agent_id}
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

      <PanelSection title="Location" className="border-t">
        <Field label="Address">
          <EditableAddress
            action={patchListingAddress}
            recordId={d.id}
            address={{ address_line: d.address_line, city: d.city, postcode: d.postcode, county: d.county }}
          />
        </Field>
        {row("Area", "area", "text", d.area)}
      </PanelSection>

      <PanelSection title="Premises" className="border-t">
        {row(
          "Type",
          "disposal_type",
          "select",
          d.disposal_type,
          DISPOSAL_TYPE_LABELS[d.disposal_type] ?? d.disposal_type,
          labelled(DISPOSAL_TYPES, DISPOSAL_TYPE_LABELS),
        )}
        {flag("To let", "to_let", d.to_let)}
        {flag("For sale", "for_sale", d.for_sale)}
        <Field label="Use class">
          <EditableMulti
            action={patchListingUseClasses}
            recordId={d.id}
            field="use_classes"
            label="Use class"
            options={USE_CLASS_OPTIONS.map(([value, label]) => ({ value, label }))}
            values={classes}
            display={d.property_type ?? d.use_class ?? "—"}
          />
        </Field>
        {row("Size (sq ft)", "size_sqft", "number", d.size_sqft, d.size_sqft != null ? `${Number(d.size_sqft).toLocaleString("en-GB")} sq ft` : undefined)}
        {row("Size (sq m)", "size_sqm", "number", d.size_sqm, d.size_sqm != null ? `${Number(d.size_sqm).toLocaleString("en-GB")} sq m` : undefined)}
        {row("Covers (in)", "covers_internal", "number", d.covers_internal)}
        {row("Covers (out)", "covers_external", "number", d.covers_external)}
        {row(
          "Fit-out",
          "fit_out_state",
          "select",
          d.fit_out_state,
          d.fit_out_state ? (FIT_OUT_LABELS[d.fit_out_state] ?? d.fit_out_state) : undefined,
          [{ value: "", label: "— Not stated —" }, ...labelled(FIT_OUT_STATES, FIT_OUT_LABELS)],
        )}
        {row("EPC", "epc_rating", "text", d.epc_rating)}
        {row("Key features", "key_features", "tags", d.key_features.join(", "))}
      </PanelSection>

      <PanelSection title="Commercials" className="border-t">
        {cash("Rent", "rent_pa", d.rent_pa, "pa")}
        {cash("Premium", "premium", d.premium)}
        {cash("Guide price", "guide_price", d.guide_price)}
        {row(
          "Price qualifier",
          "price_qualifier",
          "select",
          d.price_qualifier,
          d.price_qualifier ? (PRICE_QUALIFIER_LABELS[d.price_qualifier] ?? d.price_qualifier) : undefined,
          [{ value: "", label: "— None —" }, ...labelled(PRICE_QUALIFIERS, PRICE_QUALIFIER_LABELS)],
        )}
        {cash("Rateable value", "rateable_value", d.rateable_value)}
        {cash("Service charge", "service_charge", d.service_charge)}
        {row("Tenure", "tenure_raw", "text", d.tenure_raw)}
      </PanelSection>

      <PanelSection title="Lease and statutory" className="border-t">
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Show lease terms, rates and charges</summary>
          <div className="mt-3 space-y-3">
            {row("Lease term (years)", "lease_term_years", "number", d.lease_term_years)}
            {row("Lease expiry", "lease_expiry", "date", d.lease_expiry)}
            {row("Rent review basis", "rent_review_basis", "text", d.rent_review_basis)}
            {row("Next review (year)", "next_rent_review", "number", d.next_rent_review)}
            {row("Rent period", "rent_period", "text", d.rent_period)}
            {flag("1954 Act", "inside_1954_act", d.inside_1954_act)}
            {flag("VAT applies", "vat_applicable", d.vat_applicable)}
            {cash("Business rates", "business_rates", d.business_rates)}
            {cash("Estate charge", "estate_charge", d.estate_charge)}
            {cash("Parking charge", "parking_charge", d.parking_charge)}
          </div>
        </details>
      </PanelSection>

      <PanelSection title="Description" className="border-t">
        {row("Description", "description", "textarea", d.description)}
        {row("Summary", "summary", "textarea", d.summary)}
        {row("Location", "location_description", "textarea", d.location_description)}
        {row("Licensing", "licensing_notes", "textarea", d.licensing_notes)}
        {row("Brochure", "brochure_url", "url", d.brochure_url)}
        {d.brochure_url ? (
          <Field label="Page 1">
            <BrochurePreview
              key={`${d.brochure_url}|${currentPreview.url ?? ""}|${currentPreview.tryOnMount}`}
              disposalId={d.id}
              brochureUrl={d.brochure_url}
              previewUrl={currentPreview.url}
              tryOnMount={currentPreview.tryOnMount}
            />
          </Field>
        ) : null}
      </PanelSection>
    </>
  );
}

async function MediaTab({ agencyId, d }: { agencyId: string; d: Disposal }) {
  const images = (Array.isArray(d.images) ? d.images : []) as DisposalImage[];
  const docRows = await listDisposalDocuments(agencyId, d.id);
  // Fields are picked one by one: the row carries file_path, the raw private
  // Blob URL, which must not reach the browser. Only the signed link does.
  const docs: DisposalDoc[] = await Promise.all(
    docRows.map(async (r) => ({
      id: r.id,
      name: r.name,
      doc_type: r.doc_type,
      size_bytes: r.size_bytes,
      url: await signDisposalDocUrl(agencyId, r.id),
    })),
  );
  return (
    <>
      <PanelSection title="Images">
        <DisposalImages disposalId={d.id} images={images} />
      </PanelSection>
      <PanelSection title="Documents" className="border-t">
        <DisposalDocuments disposalId={d.id} docs={docs} />
      </PanelSection>
    </>
  );
}

/**
 * The listing page's MatchMaker block: active briefs scored against this
 * listing, top 10. A let, sold or withdrawn listing shows the same "not
 * matched" line as the page. The flex form is a GET form that carries the
 * panel's own params, so Apply does not close the panel.
 */
async function ListingMatchmaker({
  agencyId,
  d,
  record,
  base,
  flexParam,
}: {
  agencyId: string;
  d: Disposal;
  record: RecordRef;
  base: SearchParamsLike;
  flexParam: string | undefined;
}) {
  const flexParsed = Number(flexParam ?? DEFAULT_LOCATION_FLEX);
  const locationFlex = Math.min(
    100,
    Math.max(0, Number.isFinite(flexParsed) ? flexParsed : DEFAULT_LOCATION_FLEX),
  );
  const matchable = isListingMatchable(d.status);
  const reqs = matchable ? await listActiveRequirementsForMatching(agencyId) : [];
  const matches = reqs
    .map((rq) => ({ rq, ...scoreMatch(rq, d, { locationFlex }) }))
    .filter((m) => m.score > 0)
    .sort(byMatchQuality((m) => m.rq.id))
    .slice(0, 10);

  const hidden: Record<string, string> = { record: formatRecordRef(record), tab: "matchmaker" };
  for (const [k, v] of Object.entries(base)) {
    if (v && k !== "record" && k !== "tab" && k !== "flex") hidden[k] = v;
  }

  return (
    <PanelSection
      title="MatchMaker opportunities"
      action={
        <form className="flex items-end gap-2">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <LocationFlexSlider defaultValue={locationFlex} />
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </form>
      }
    >
      {!matchable ? (
        <EmptyNote>This listing is let / sold / withdrawn, so it is not matched.</EmptyNote>
      ) : matches.length === 0 ? (
        <EmptyNote>No operator requirements match this listing yet.</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {matches.map(({ rq, score, reasons, thin, coverage, missing }) => {
            const ms = matchScoreBadge(score);
            return (
              <li key={rq.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <PanelLink href={openRecordHref(base, { type: "requirement", id: rq.id })}>
                    {rq.title}
                  </PanelLink>
                  <div className="flex items-center gap-2">
                    {thin ? (
                      <Badge tone="amber" title={thinBriefHint({ coverage, missing })}>
                        Thin brief
                      </Badge>
                    ) : null}
                    <Badge tone={ms.tone}>{ms.label}</Badge>
                    <CreateDealButton requirementId={rq.id} listingId={d.id} />
                  </div>
                </div>
                <div className="mt-2">
                  <MatchReasons reasons={reasons} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}

async function DealsTab({
  agencyId,
  d,
  base,
}: {
  agencyId: string;
  d: Disposal;
  base: SearchParamsLike;
}) {
  const [deals, reqs] = await Promise.all([
    getDealsForListing(agencyId, d.id),
    listActiveRequirementsForMatching(agencyId),
  ]);
  const hasDeal = new Set(deals.map((x) => x.requirement_id).filter(Boolean));
  const requirements: DealRequirementOption[] = reqs
    .map((rq) => ({
      id: rq.id,
      title: rq.title,
      score: Math.round(scoreMatch(rq, d, { locationFlex: DEFAULT_LOCATION_FLEX }).score),
      hasDeal: hasDeal.has(rq.id),
    }))
    // Best match first, then by name. Requirements with a deal sink to the bottom.
    .sort((a, b) => Number(a.hasDeal) - Number(b.hasDeal) || b.score - a.score || a.title.localeCompare(b.title));
  return (
    <PanelSection
      title="Deals"
      action={
        <AddDealButton
          listingId={d.id}
          requirements={requirements}
          openHref={openRecordHref(base, { type: "deal", id: DEAL_ID_TOKEN })}
        />
      }
    >
      {deals.length === 0 ? (
        <EmptyNote>No deals on this listing yet.</EmptyNote>
      ) : (
        <ul className="divide-y">
          {deals.map((deal) => {
            const ds = dealStageBadge(deal.stage);
            return (
              <li
                key={deal.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <PanelLink href={openRecordHref(base, { type: "deal", id: deal.id })}>
                  {deal.title}
                </PanelLink>
                <span className="flex items-center gap-2">
                  {deal.value != null ? (
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {money(deal.value)}
                    </span>
                  ) : null}
                  <Badge tone={ds.tone}>{ds.label}</Badge>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}
