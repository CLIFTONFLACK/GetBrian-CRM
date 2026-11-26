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
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { getDealsForListing } from "@/lib/db/queries/deals";
import {
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
      content = <MapTab lat={d.lat} lng={d.lng} label={d.title ?? "Listing"} />;
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
      content = <DealsTab agencyId={agencyId} listingId={d.id} base={base} />;
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

async function OverviewTab({
  agencyId,
  d,
  base,
}: {
  agencyId: string;
  d: Disposal;
  base: SearchParamsLike;
}) {
  const [members, company, contact] = await Promise.all([
    d.lead_agent_id ? getAgencyMembers(agencyId) : Promise.resolve([]),
    d.company_id ? getLinkedCompany(agencyId, d.company_id) : Promise.resolve(null),
    d.contact_id ? getLinkedContact(agencyId, d.contact_id) : Promise.resolve(null),
  ]);
  const leadAgent = d.lead_agent_id
    ? (members.find((m) => m.id === d.lead_agent_id)?.name ?? "Unknown agent")
    : null;
  const ls = listingStatusBadge(d.status);
  const lt = listingTypeBadge(d.listing_type);
  const address = [d.address_line, d.city, d.county, d.postcode].filter(Boolean).join(", ");
  const contactName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unnamed contact"
    : null;

  return (
    <>
      <PanelSection>
        <Field label="Status">
          <Badge tone={ls.tone}>{ls.label}</Badge>
        </Field>
        <Field label="Listing type">
          <Badge tone={lt.tone}>{lt.label}</Badge>
        </Field>
        <Field label="Lead agent">{leadAgent ?? "—"}</Field>
        <Field label="Company">
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
        </Field>
        <Field label="Contact">
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
        </Field>
      </PanelSection>
      <PanelSection title="Location" className="border-t">
        <Field label="Address">{address || "—"}</Field>
        <Field label="Area">{d.area ?? "—"}</Field>
      </PanelSection>
      <PanelSection title="Premises" className="border-t">
        <Field label="Type">
          {DISPOSAL_TYPE_LABELS[d.disposal_type] ?? d.disposal_type}
          {d.to_let ? " · To let" : ""}
          {d.for_sale ? " · For sale" : ""}
        </Field>
        <Field label="Use class">{d.use_class ?? "—"}</Field>
        <Field label="Property">{d.property_type ?? "—"}</Field>
        <Field label="Size">
          {d.size_sqft != null ? `${Number(d.size_sqft).toLocaleString("en-GB")} sq ft` : "—"}
          {d.size_sqm != null ? ` (${Number(d.size_sqm).toLocaleString("en-GB")} sq m)` : ""}
        </Field>
        <Field label="Covers">
          {d.covers_internal != null ? `${d.covers_internal} internal` : "—"}
          {d.covers_external != null ? ` + ${d.covers_external} external` : ""}
        </Field>
        <Field label="Fit-out">
          {d.fit_out_state ? (FIT_OUT_LABELS[d.fit_out_state] ?? d.fit_out_state) : "—"}
        </Field>
        <Field label="EPC">{d.epc_rating ?? "—"}</Field>
      </PanelSection>
      <PanelSection title="Commercials" className="border-t">
        <Field label="Rent">
          <span className="font-mono tabular-nums">{money(d.rent_pa)}</span>
          {d.rent_pa != null ? <span className="text-muted-foreground"> pa</span> : null}
        </Field>
        <Field label="Premium">
          <span className="font-mono tabular-nums">{money(d.premium)}</span>
        </Field>
        <Field label="Guide price">
          <span className="font-mono tabular-nums">{money(d.guide_price)}</span>
        </Field>
        <Field label="Rateable">
          <span className="font-mono tabular-nums">{money(d.rateable_value)}</span>
        </Field>
        <Field label="Service charge">
          <span className="font-mono tabular-nums">{money(d.service_charge)}</span>
        </Field>
        <Field label="Tenure">{d.tenure_raw ?? "—"}</Field>
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
  listingId,
  base,
}: {
  agencyId: string;
  listingId: string;
  base: SearchParamsLike;
}) {
  const deals = await getDealsForListing(agencyId, listingId);
  return (
    <PanelSection title="Deals">
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
