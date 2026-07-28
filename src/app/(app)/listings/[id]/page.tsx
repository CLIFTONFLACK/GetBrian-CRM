import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileDown, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EditableDealTitle } from "@/components/editable-deal-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  companyTypeBadge,
  contactRoleBadge,
  dealStageBadge,
  listingTypeBadge,
  matchScoreBadge,
} from "@/lib/badges";
import { deleteDisposal } from "@/lib/actions/disposals";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DEFAULT_LOCATION_FLEX, scoreMatch } from "@/lib/matching/score";
import { LocationFlexSlider } from "@/components/location-flex-slider";
import { CreateDealButton } from "@/components/create-deal-button";
import { MatchReasons } from "@/components/match-reasons";
import { DisposalAssignmentForm } from "@/components/disposal-assignment-form";
import { SendHistoryCard } from "@/components/send-history-card";
import { getSendHistory } from "@/lib/send-history";
import { DisposalDocuments, type DisposalDoc } from "@/components/disposal-documents";
import { DisposalAreas } from "@/components/disposal-areas";
import { DisposalImages } from "@/components/disposal-images";
import { ListingStatusSelect } from "@/components/listing-status-select";
import { ListingShareActions } from "@/components/listing-share-actions";
import { LocationMap } from "@/components/location-map";
import { SendToTeam } from "@/components/send-to-team";
import { getCompanyTypes, typeLabel } from "@/lib/company-types";
import { getAgencyMembers } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const money = (v: number | null) =>
  v != null ? `£${Number(v).toLocaleString("en-GB")}` : "—";

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

type ImageItem = { url: string; alt?: string | null };
type SectionItem = { title: string; content: string };

/** Per-record tab title (was the generic marketing `<title>` before). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("disposals")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.title ?? "Listing" };
}

export default async function ListingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flex?: string }>;
}) {
  const { id } = await params;
  const { flex } = await searchParams;
  const flexParsed = Number(flex ?? DEFAULT_LOCATION_FLEX);
  const locationFlex = Math.min(
    100,
    Math.max(0, Number.isFinite(flexParsed) ? flexParsed : DEFAULT_LOCATION_FLEX),
  );
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: d } = await supabase
    .from("disposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!d) notFound();

  const lt = listingTypeBadge(d.listing_type);
  const images = (Array.isArray(d.images) ? d.images : []) as ImageItem[];
  const sections = (Array.isArray(d.sections) ? d.sections : []) as SectionItem[];
  const location = [d.address_line, d.city, d.county, d.postcode]
    .filter(Boolean)
    .join(", ");

  // None of these depend on each other's results (only on `d`, already
  // resolved above) — fetch them all concurrently instead of serially.
  const [
    { data: reqs },
    { data: dealRows },
    { data: agentRows },
    agents,
    { data: docRows },
    { data: areaRows },
    { data: leadAgent },
    companyTypes,
  ] = await Promise.all([
    // Active briefs only — a satisfied/withdrawn requirement is not an
    // opportunity, and offering a "Create deal" button against one is wrong.
    supabase
      .from("requirements")
      .select(
        "id, title, target_towns, target_regions, target_counties, target_postcode_districts, target_neighbourhoods, target_london_zones, min_sqft, max_sqft, min_covers, max_covers, use_classes, tenure_prefs, max_rent, max_premium, max_guide_price",
      )
      .eq("status", "active"),
    // Deals already created from this listing ("under offer to X").
    supabase
      .from("deals")
      .select("id, title, stage, value")
      .eq("listing_id", id)
      .order("updated_at", { ascending: false }),
    supabase.from("disposal_agents").select("user_id").eq("disposal_id", id),
    getAgencyMembers(supabase, d.agency_id),
    supabase
      .from("disposal_documents")
      .select("id, name, doc_type, size_bytes, file_path")
      .eq("disposal_id", id)
      .order("created_at"),
    supabase
      .from("disposal_areas")
      .select("id, name, size_sqft, size_sqm, rent_pa, availability")
      .eq("disposal_id", id)
      .order("sort_order")
      .order("created_at"),
    d.lead_agent_id
      ? supabase
          .from("profiles")
          .select("full_name, email, phone, avatar_url, linkedin_url, x_url")
          .eq("id", d.lead_agent_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getCompanyTypes(),
  ]);

  const matches = (reqs ?? [])
    .map((rq) => ({ rq, ...scoreMatch(rq, d, { locationFlex }) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const deals = dealRows ?? [];
  const additionalAgentIds = (agentRows ?? []).map((r) => r.user_id);

  const docRowsList = docRows ?? [];
  const { data: signedList } = docRowsList.length
    ? await supabase.storage
        .from("disposal-docs")
        .createSignedUrls(
          docRowsList.map((r) => r.file_path),
          3600,
        )
    : { data: [] as { path: string | null; signedUrl: string | null }[] };
  const signedByPath = new Map(
    (signedList ?? []).map((s) => [s.path, s.signedUrl]),
  );
  const docs: DisposalDoc[] = docRowsList.map((r) => ({
    ...r,
    url: signedByPath.get(r.file_path) ?? null,
  }));

  const areas = areaRows ?? [];

  // External send history — who this listing has been emailed to.
  const sendHistory = await getSendHistory(supabase, { listingId: id });

  // #4: linked company + point-of-contact for this listing.
  const [{ data: linkedCompany }, { data: linkedContact }] = await Promise.all([
    d.company_id
      ? supabase
          .from("companies")
          .select("id, name, type")
          .eq("id", d.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    d.contact_id
      ? supabase
          .from("contacts")
          .select("id, first_name, last_name, role, email, phone")
          .eq("id", d.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {d.title ?? "Untitled listing"}
            </h1>
            <ListingStatusSelect id={d.id} status={d.status} />
            <Badge tone={lt.tone}>{lt.label}</Badge>
          </div>
          {location ? (
            <p className="mt-1 text-sm text-muted-foreground">{location}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <a
            href={`/listings/${d.id}/particulars`}
            className={cn(buttonVariants({ variant: "default", size: "sm" }))}
          >
            <FileDown />
            Download PDF
          </a>
          {d.source_url ? (
            <a
              href={d.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <ExternalLink />
              Source
            </a>
          ) : null}
          <ListingShareActions
            title={d.title ?? "Listing"}
            summary={d.summary ?? undefined}
          />
          <SendToTeam
            link={`/listings/${d.id}`}
            subject={d.title ?? "this listing"}
            agents={agents}
            meId={user?.id}
          />
          <Link
            href={`/listings/${d.id}/edit`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Pencil />
            Edit
          </Link>
          <form action={deleteDisposal}>
            <input type="hidden" name="id" value={d.id} />
            <ConfirmSubmitButton
              confirmMessage="Delete this listing? Its area schedule, documents and uploaded files will be removed and this can't be undone."
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      {images.length > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.slice(0, 6).map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img.url}
              alt={img.alt ?? d.title ?? "Listing image"}
              className="h-32 w-full rounded-md border object-cover"
            />
          ))}
        </div>
      ) : null}

      {d.lat != null && d.lng != null ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent>
            {location ? (
              <p className="mb-3 text-sm text-muted-foreground">{location}</p>
            ) : null}
            <LocationMap lat={d.lat} lng={d.lng} label={d.title ?? "Listing"} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Premises</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Type">
              {DISPOSAL_TYPE_LABELS[d.disposal_type] ?? d.disposal_type}
              {d.to_let ? " · To let" : ""}
              {d.for_sale ? " · For sale" : ""}
            </Row>
            <Row label="Use class">{d.use_class ?? "—"}</Row>
            <Row label="Property">{d.property_type ?? "—"}</Row>
            <Row label="Size">
              {d.size_sqft != null
                ? `${Number(d.size_sqft).toLocaleString("en-GB")} sq ft`
                : "—"}
              {d.size_sqm != null
                ? ` (${Number(d.size_sqm).toLocaleString("en-GB")} sq m)`
                : ""}
            </Row>
            <Row label="Covers">
              {d.covers_internal != null ? `${d.covers_internal} internal` : "—"}
              {d.covers_external != null ? ` + ${d.covers_external} external` : ""}
            </Row>
            <Row label="Fit-out">
              {d.fit_out_state
                ? (FIT_OUT_LABELS[d.fit_out_state] ?? d.fit_out_state)
                : "—"}
            </Row>
            <Row label="EPC">{d.epc_rating ?? "—"}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commercials</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Rent">
              <span className="font-mono tabular-nums">{money(d.rent_pa)}</span>
              {d.rent_pa != null ? " pa" : ""}
            </Row>
            <Row label="Premium">
              <span className="font-mono tabular-nums">{money(d.premium)}</span>
            </Row>
            <Row label="Guide price">
              <span className="font-mono tabular-nums">{money(d.guide_price)}</span>
            </Row>
            <Row label="Rateable">
              <span className="font-mono tabular-nums">{money(d.rateable_value)}</span>
            </Row>
            <Row label="Service charge">
              <span className="font-mono tabular-nums">{money(d.service_charge)}</span>
            </Row>
            <Row label="Tenure">{d.tenure_raw ?? "—"}</Row>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Available area</CardTitle>
        </CardHeader>
        <CardContent>
          <DisposalAreas disposalId={d.id} areas={areas} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Images</CardTitle>
        </CardHeader>
        <CardContent>
          <DisposalImages disposalId={d.id} images={images} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <DisposalDocuments disposalId={d.id} docs={docs} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>MatchMaker Opportunities</CardTitle>
          <form className="flex items-end gap-2">
            <LocationFlexSlider defaultValue={locationFlex} />
            <Button type="submit" size="sm" variant="secondary">
              Apply
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          {matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No operator requirements match this listing yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {matches.map(({ rq, score, reasons }) => {
                const ms = matchScoreBadge(score);
                return (
                  <li key={rq.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/requirements/${rq.id}`}
                        className="font-medium text-foreground hover:text-info hover:underline"
                      >
                        {rq.title}
                      </Link>
                      <div className="flex items-center gap-2">
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
        </CardContent>
      </Card>

      {deals.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Deals</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {deals.map((deal) => {
                const ds = dealStageBadge(deal.stage);
                return (
                  <li key={deal.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <EditableDealTitle
                        dealId={deal.id}
                        title={deal.title}
                        href={`/deals/${deal.id}`}
                        className="font-medium text-foreground hover:text-info hover:underline"
                      />
                      <div className="flex items-center gap-2">
                        {deal.value != null ? (
                          <span className="font-mono text-sm tabular-nums text-muted-foreground">
                            {money(deal.value)}
                          </span>
                        ) : null}
                        <Badge tone={ds.tone}>{ds.label}</Badge>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {linkedCompany || linkedContact ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Company &amp; contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            {linkedCompany ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Company
                </p>
                <p className="flex items-center gap-2">
                  <Link
                    href={`/companies/${linkedCompany.id}`}
                    className="font-medium text-foreground hover:text-info hover:underline"
                  >
                    {linkedCompany.name}
                  </Link>
                  {(() => {
                    const b = companyTypeBadge(
                      linkedCompany.type,
                      typeLabel(companyTypes, linkedCompany.type),
                    );
                    return <Badge tone={b.tone}>{b.label}</Badge>;
                  })()}
                </p>
              </div>
            ) : null}
            {linkedContact ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Contact
                </p>
                <p className="flex items-center gap-2">
                  <Link
                    href={`/contacts/${linkedContact.id}`}
                    className="font-medium text-foreground hover:text-info hover:underline"
                  >
                    {[linkedContact.first_name, linkedContact.last_name]
                      .filter(Boolean)
                      .join(" ") || "Unnamed contact"}
                  </Link>
                  {(() => {
                    const b = contactRoleBadge(linkedContact.role);
                    return <Badge tone={b.tone}>{b.label}</Badge>;
                  })()}
                </p>
                {linkedContact.email ? (
                  <p>
                    <a
                      href={`mailto:${linkedContact.email}`}
                      className="text-info hover:underline"
                    >
                      {linkedContact.email}
                    </a>
                  </p>
                ) : null}
                {linkedContact.phone ? (
                  <p className="text-muted-foreground">{linkedContact.phone}</p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {leadAgent ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Lead agent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-4">
              {leadAgent.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={leadAgent.avatar_url}
                  alt={leadAgent.full_name ?? "Agent"}
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                />
              ) : null}
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">
                  {leadAgent.full_name ?? "—"}
                </p>
                {leadAgent.email ? (
                  <p>
                    <a
                      href={`mailto:${leadAgent.email}`}
                      className="text-info hover:underline"
                    >
                      {leadAgent.email}
                    </a>
                  </p>
                ) : null}
                {leadAgent.phone ? (
                  <p className="text-muted-foreground">{leadAgent.phone}</p>
                ) : null}
                {leadAgent.linkedin_url || leadAgent.x_url ? (
                  <p className="flex gap-3 pt-1">
                    {leadAgent.linkedin_url ? (
                      <a
                        href={leadAgent.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-info hover:underline"
                      >
                        LinkedIn
                      </a>
                    ) : null}
                    {leadAgent.x_url ? (
                      <a
                        href={leadAgent.x_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-info hover:underline"
                      >
                        X
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Assignment</CardTitle>
        </CardHeader>
        <CardContent>
          <DisposalAssignmentForm
            disposalId={d.id}
            agents={agents}
            leadAgentId={d.lead_agent_id}
            additionalAgentIds={additionalAgentIds}
          />
        </CardContent>
      </Card>

      {d.agent_name || d.agent_email || d.agent_phone ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Agent (from source)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {d.agent_name ? <p className="font-medium">{d.agent_name}</p> : null}
            {d.agent_email ? (
              <p>
                <a
                  href={`mailto:${d.agent_email}`}
                  className="text-info hover:underline"
                >
                  {d.agent_email}
                </a>
              </p>
            ) : null}
            {d.agent_phone ? (
              <p className="text-muted-foreground">{d.agent_phone}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {d.description ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {d.description}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {sections.length > 0 ? (
        <div className="mt-4 space-y-4">
          {sections.map((sec, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle>{sec.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {sec.content}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <SendHistoryCard sends={sendHistory} className="mt-4" />
    </div>
  );
}

function Row({
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
